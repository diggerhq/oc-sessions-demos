# App Builder on OpenComputer

A small Lovable/v0-style app builder: describe a web app, an agent builds and runs it in a
sandbox, and you keep chatting to change it. It's a Next.js app plus a prompt — the agent
runs on OpenComputer [Durable Agent Sessions](https://docs.opencomputer.dev/agent-sessions),
so there's no separate agent backend to operate.

This repo is the app, and a walkthrough of how it's built.

![Durable Agent Sessions architecture: the app starts and steers a durable event-log session and streams it live; a runtime (the brain) reads and appends to the log and acts in a sandbox (the hands); the model runs on your key from the secret store, which never enters a sandbox.](docs/architecture.svg)

## What you write vs. what OpenComputer provides

| You write | OpenComputer provides |
| --- | --- |
| a prompt (the agent) | the agent loop and a sandbox to run commands in |
| ~3 SDK calls (`src/oc.ts`) | a durable log of every step |
| a chat UI that renders events | live streaming and resume from any point |
| | hibernation while idle, wake on the next message |
| | session-scoped tokens the browser can use directly |

Persistent build sessions, sandboxed execution, streaming to the browser, and resuming a
project later are handled by the platform.

## How it's built

The whole integration is the official [`@opencomputer/sdk`](https://www.npmjs.com/package/@opencomputer/sdk)
— a handful of calls. Server-side (in [`src/oc.ts`](src/oc.ts)) you hold the org key; in the
browser you use a short-lived client token. The org key never reaches the browser.

### 1. Define the agent

An [agent](https://docs.opencomputer.dev/agent-sessions/agents) is a name, model, and prompt:

```ts
const oc = new OpenComputer({ apiKey: process.env.OPENCOMPUTER_API_KEY! });

const agent = await oc.agents.create({
  name: "app-builder",
  model: "anthropic/claude-opus-4-8",
  prompt,                              // the agent's instructions (src/agent.ts)
  key: process.env.ANTHROPIC_API_KEY,  // sealed in the secret store — never enters the sandbox
});                                    // idempotent by name — safe to call on every boot
```

The agent works through sandbox tools (`bash`, `read`, `write`, `ls`).

### 2. Start a session

Start a [session](https://docs.opencomputer.dev/agent-sessions/sessions) on the agent with a
task — it runs immediately:

```ts
const session = await oc.sessions.create({ agent: agent.id, input });

session.id;           // durable — reopen this run any time
session.clientToken;  // browser-safe (read + steer) — hand this to the front-end
```

OpenComputer provisions the sandbox, runs the agent, and records every step in a durable log
that survives a server restart or a closed tab.

### 3. Stream it

From the browser, connect to the session with the client token and tail its events as an
async iterator. `level=internal` includes the command trace; `after=0` replays the log so
reopening a session shows its history:

```ts
// src/app/page.tsx (client)
const session = await connectSession({ sessionId: id, clientToken: token });
for await (const ev of session.events({ level: "internal", after: 0, signal })) {
  addEvent(ev);
}
```

The SDK reconnects from the last `seq` on a dropped connection and keeps tailing until the
`signal` aborts, so the feed self-heals.

### 4. Steer it

Send a follow-up at any time, also from the browser — on the same `session` handle. An idle
session wakes and continues with its context:

```ts
// src/app/page.tsx (client)
await session.steer("add a dark-mode toggle");
```

### 5. Render events

Each step is an [event](https://docs.opencomputer.dev/agent-sessions/events). The SDK types
them as a discriminated `Event` union (camelCase fields); the UI switches on `type`
([`src/app/page.tsx`](src/app/page.tsx)):

```tsx
switch (ev.type) {
  case "user.message":   return <Bubble you>{ev.body.text}</Bubble>;
  case "agent.message":  return <Bubble>{ev.body.text}</Bubble>;
  case "tool.call":      return <Command>$ {ev.body.argsSummary}</Command>;
  case "exec.completed": return <Output exit={ev.body.exitCode}>{ev.body.summary}</Output>;
  case "turn.completed": return <Done />;
}
```

Unknown types fall back to their `text`/`summary`, so new ones don't break the UI. That's
the whole integration — five SDK calls.

## Run it

You need an OpenComputer API key ([app.opencomputer.dev](https://app.opencomputer.dev)) and
an Anthropic key.

```bash
cp .env.example .env.local      # set OPENCOMPUTER_API_KEY + ANTHROPIC_API_KEY
npm install
npm run dev                     # http://localhost:3000
```

To preview the UI without keys, [`mock/`](mock) is a small fake of the API that streams a
scripted build. Point both URLs at it (`.env.local`: `OC_API_URL` and `NEXT_PUBLIC_OC_API_URL`
= `http://localhost:8787`, with placeholder keys), then run `npm run mock` and `npm run dev`.

Deploy is standard Next.js (e.g. `vercel`); set the two keys as environment variables.

## Layout

```
src/oc.ts              the OpenComputer calls: create / steer / mint token
src/agent.ts           the prompt
src/app/page.tsx       the UI: projects · chat trace · preview
src/app/api/projects/  start a project · list · mint a client token
mock/                  a fake OC for local UI testing (not deployed)
docs/architecture.svg
```

## Notes

- The project link carries the session id; opening it mints a client token server-side. For
  production, require auth before minting and set session
  [`limits`](https://docs.opencomputer.dev/agent-sessions/sessions) to cap spend.

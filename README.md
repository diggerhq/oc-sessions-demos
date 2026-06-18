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
| ~3 API calls (`src/oc.ts`) | a durable log of every step |
| a chat UI that renders events | live streaming and resume from any point |
| | hibernation while idle, wake on the next message |
| | session-scoped tokens the browser can use directly |

Persistent build sessions, sandboxed execution, streaming to the browser, and resuming a
project later are handled by the platform.

## How it's built

The OpenComputer calls are in [`src/oc.ts`](src/oc.ts) (~40 lines) plus two `/api` routes.
Base URL `https://api.opencomputer.dev/v3`. Management calls use the org API key
(server-side only); the browser uses a client token.

### 1. Define the agent

An [agent](https://docs.opencomputer.dev/agent-sessions/agents) is a name, model, and
prompt. The Anthropic key is passed inline and stored in OpenComputer's
[secret store](https://docs.opencomputer.dev/agent-sessions/authentication#model-credentials);
it doesn't enter the sandbox. Creation is idempotent by name, so this runs on first use:

```ts
// src/oc.ts
export function ensureAgent() {
  agentId ??= oc("/agents", {
    method: "POST",
    body: JSON.stringify({
      name: "app-builder",
      model: "anthropic/claude-opus-4-8",
      runtime: "claude",
      prompt: BUILDER_AGENT_PROMPT,
      key: process.env.ANTHROPIC_API_KEY,
    }),
  }).then((a) => a.id);
  return agentId;
}
```

The prompt ([`src/agent.ts`](src/agent.ts)) is what makes this an app builder. The agent's
tools (`bash`, `read`, `write`, `ls`, `use_repo`) run against the sandbox.

### 2. Start a project (a session)

A project is a [session](https://docs.opencomputer.dev/agent-sessions/sessions). Starting
one returns the session and a browser-safe `client_token`:

```ts
// src/oc.ts
export async function createProject(input: string) {
  const agent = await ensureAgent();
  const { session, client_token } = await oc("/sessions", {
    method: "POST",
    body: JSON.stringify({ agent, input }),
  });
  return { id: session.id, token: client_token };
}
```

The route returns the id and token to the browser
([`src/app/api/projects/route.ts`](src/app/api/projects/route.ts)):

```ts
export async function POST(req: Request) {
  const { input } = await req.json();
  return Response.json(await createProject(input)); // → { id, token }
}
```

OpenComputer provisions the sandbox, runs the agent, and records each step in a durable
log that survives a server restart or a closed tab.

### 3. Stream it

From the browser, open an `EventSource` to OpenComputer with the client token. `level=internal`
includes the command trace; `after=0` replays the log so reopening a project shows its
history:

```ts
// src/app/page.tsx (client)
const es = new EventSource(
  `${OC}/v3/sessions/${id}/events?stream=sse&level=internal&after=0&token=${token}`,
);
es.onmessage = (e) => addEvent(JSON.parse(e.data));
```

Each event's `seq` is the SSE id, so `EventSource` reconnects from where it left off via
`Last-Event-ID`.

### 4. Steer it

Send a follow-up at any time, also from the browser. An idle session wakes and continues
with its context:

```ts
// src/app/page.tsx (client)
await fetch(`${OC}/v3/sessions/${id}/messages`, {
  method: "POST",
  headers: { Authorization: `Bearer ${clientToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ text: "add a dark-mode toggle" }),
});
```

### 5. Render events

Each step is an [event](https://docs.opencomputer.dev/agent-sessions/events) with a typed
`type` field; the UI switches on it ([`src/app/page.tsx`](src/app/page.tsx)):

```tsx
switch (ev.type) {
  case "user.message":   return <Bubble you>{ev.body.text}</Bubble>;
  case "agent.message":  return <Bubble>{ev.body.text}</Bubble>;
  case "tool.call":      return <Command>$ {ev.body.args_summary}</Command>;
  case "exec.completed": return <Output exit={ev.body.exit_code}>{ev.body.summary}</Output>;
  case "turn.completed": return <Done />;
}
```

Unknown types fall back to their `text`/`summary`, so new ones don't break the UI. That
covers the backend: `src/oc.ts` and the two routes.

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

- First run takes ~1–2 minutes while the sandbox cold-starts; steers are fast.
- Live preview isn't wired yet: the agent runs a dev server in the sandbox, and the UI will
  iframe a `preview.url` event once the platform emits one. The preview pane shows a
  placeholder until then.
- The project link carries the session id; opening it mints a client token server-side. For
  production, require auth before minting and set session
  [`limits`](https://docs.opencomputer.dev/agent-sessions/sessions) to cap spend.

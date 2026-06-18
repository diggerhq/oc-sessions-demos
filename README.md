# App Builder on OpenComputer

A mini **Lovable / v0 / bolt.new** — chat to build a web app, watch the agent work in a
real sandbox, steer it, come back to it later. The whole thing is a Next.js app and a
prompt. There is **no agent backend to build**: OpenComputer's
[Durable Agent Sessions](https://docs.opencomputer.dev/agent-sessions) runs the agent as a
durable, streamable, steerable session on sandboxed compute — you just call it.

This repo is both the app and a step-by-step guide to building one like it.

![Durable Agent Sessions architecture: your app starts and steers a durable event-log session and streams it live; a runtime (the brain) reads and appends to the log and acts in a sandbox (the hands); the model runs on your key from the secret store, which never enters a sandbox.](docs/architecture.svg)

## What you build vs. what OpenComputer handles

| You write | OpenComputer handles |
| --- | --- |
| a prompt (the agent) | the agent loop + a sandbox to run real commands in |
| ~3 API calls (`src/oc.ts`) | a durable event log of every step |
| a chat UI that renders events | live streaming + resume from any point |
| — | hibernation while idle (≈ free), wake on the next message |
| — | browser-safe tokens so the UI talks to OC directly |

The hard parts of an "AI app builder" — persistent build sessions, sandboxed execution,
streaming the work to a browser, picking a project back up tomorrow — are the platform's
job. What's left is small enough to read in one sitting.

---

## Build one, step by step

Everything that touches OpenComputer lives in **[`src/oc.ts`](src/oc.ts)** (~40 lines) and
two `/api` routes. Base URL: `https://api.opencomputer.dev/v3`. Management calls use your
**org API key** (server-side only); the browser uses a **client token**.

### Step 1 — Define the agent (once)

An [agent](https://docs.opencomputer.dev/agent-sessions/agents) is the reusable "what": a
name, a model, a prompt. Pass your Anthropic key inline — OpenComputer seals it in its
[secret store](https://docs.opencomputer.dev/agent-sessions/authentication#model-credentials);
it never enters a sandbox. Creating is idempotent by name, so we just do it on first use:

```ts
// src/oc.ts — runs on first project, then cached
export function ensureAgent() {
  agentId ??= oc("/agents", {
    method: "POST",
    body: JSON.stringify({
      name: "app-builder",
      model: "anthropic/claude-opus-4-8",
      runtime: "claude",
      prompt: BUILDER_AGENT_PROMPT,   // "build a web app in the sandbox, keep it running…"
      key: process.env.ANTHROPIC_API_KEY,
    }),
  }).then((a) => a.id);
  return agentId;
}
```

The prompt is the *only* thing that makes this an "app builder" vs. anything else — see
[`src/agent.ts`](src/agent.ts). **OpenComputer gives the agent the tools** (`bash`, `read`,
`write`, `ls`, `use_repo`) against an isolated sandbox; you don't wire any of that up.

### Step 2 — Start a project (a session)

A "project" is a [session](https://docs.opencomputer.dev/agent-sessions/sessions). Starting
one returns the session **and** a browser-safe `client_token`:

```ts
// src/oc.ts
export async function createProject(input: string) {
  const agent = await ensureAgent();
  const { session, client_token } = await oc("/sessions", {
    method: "POST",
    body: JSON.stringify({ agent, input }),   // input = "build a todo app with dark UI"
  });
  return { id: session.id, token: client_token };
}
```

This is the only place the org key starts a run. Your route hands the browser just the id
and the token ([`src/app/api/projects/route.ts`](src/app/api/projects/route.ts)):

```ts
export async function POST(req: Request) {
  const { input } = await req.json();
  return Response.json(await createProject(input));   // → { id, token }
}
```

**OpenComputer handles the rest:** it provisions the sandbox, runs the agent, and records
every step in a durable log — even if your server restarts, or the user closes the tab.

### Step 3 — Watch it build, live

From the browser, open an `EventSource` straight to OpenComputer with the client token —
no server in the loop. `level=internal` streams the full build trace (commands + output),
`after=0` replays the whole log so re-opening a project shows its history:

```ts
// src/app/page.tsx (client)
const es = new EventSource(
  `${OC}/v3/sessions/${id}/events?stream=sse&level=internal&after=0&token=${token}`,
);
es.onmessage = (e) => addEvent(JSON.parse(e.data));
```

Each event carries its `seq` as the SSE id, so a dropped connection **resumes itself** via
`Last-Event-ID` — you write zero reconnection code.

### Step 4 — Steer it

Send a follow-up at any time, also straight from the browser. The session wakes (from
hibernation if idle) and continues with full context:

```ts
// src/app/page.tsx (client)
await fetch(`${OC}/v3/sessions/${id}/messages`, {
  method: "POST",
  headers: { Authorization: `Bearer ${clientToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ text: "add a dark-mode toggle" }),
});
```

### Step 5 — Render the trace

Every step is an [event](https://docs.opencomputer.dev/agent-sessions/events) with a stable
`type` — **switch on it, never parse prose**. That's the entire UI logic
([`src/app/page.tsx`](src/app/page.tsx)):

```tsx
switch (ev.type) {
  case "user.message":   return <Bubble you>{ev.body.text}</Bubble>;
  case "agent.message":  return <Bubble>{ev.body.text}</Bubble>;        // the agent talking
  case "tool.call":      return <Command>$ {ev.body.args_summary}</Command>;
  case "exec.completed": return <Output exit={ev.body.exit_code}>{ev.body.summary}</Output>;
  case "turn.completed": return <Done />;                                // the "done" signal
}
```

New event types render fine from their `text`/`summary`, so the platform can add more
without breaking your UI.

**That's the whole backend.** No queue, no database, no streaming infra, no sandbox
orchestration — `src/oc.ts` plus those two routes.

---

## Run it

You need two keys: an **OpenComputer API key** ([app.opencomputer.dev](https://app.opencomputer.dev))
and your **Anthropic key**.

```bash
cp .env.example .env.local      # add OPENCOMPUTER_API_KEY + ANTHROPIC_API_KEY
npm install
npm run dev                     # http://localhost:3000
```

**See the UI with no keys / no backend** — a tiny fake OpenComputer in [`mock/`](mock)
streams a scripted build. Point the URLs at it (`.env.local`:
`OC_API_URL` + `NEXT_PUBLIC_OC_API_URL` = `http://localhost:8787`, any placeholder keys):

```bash
npm run mock                    # terminal 1
npm run dev                     # terminal 2
```

**Deploy** (Vercel — it's just a Next.js app; nothing is always-on):

```bash
npm i -g vercel && vercel
vercel env add OPENCOMPUTER_API_KEY
vercel env add ANTHROPIC_API_KEY
vercel --prod                   # → a public URL
```

## Layout

```
src/
  oc.ts              the entire OpenComputer backend — create / steer / mint token
  agent.ts           the prompt (the only thing that makes this an "app builder")
  app/
    page.tsx         the 3-pane UI: projects · chat trace · preview
    api/projects/    POST start a project · GET list · POST :id/token (mint)
mock/                a dependency-free fake OC for local UI testing (not deployed)
docs/architecture.svg
```

## Notes

- **First run is slow** (~a minute or two) while the sandbox cold-starts; steers are fast
  (the sandbox is warm). The UI shows a "spinning up a sandbox" state meanwhile.
- **Live preview** of the running app is the one piece left as a seam: the agent runs a dev
  server in its sandbox, and the UI iframes a `preview.url` event when the platform emits
  one (coming soon). Until then the preview pane shows a placeholder; everything else works.
- **Sharing:** the project link carries only the session id; opening it mints a fresh
  client token server-side. For a real product, gate token minting behind your own auth and
  use session [`limits`](https://docs.opencomputer.dev/agent-sessions/sessions) to cap spend.

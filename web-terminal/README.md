# web-terminal — a shareable, resumable agent run

Give an agent a task, watch it work live in your browser, steer it with a message, and
share the URL. Close the tab and reopen the link, drop your connection, walk away and
come back — nothing is lost. The agent runs in a real sandbox on
[OpenComputer Durable Agent Sessions](https://docs.opencomputer.dev/agent-sessions);
this app is just the window onto it.

## How it works

The whole backend is [`src/oc.ts`](src/oc.ts) — two calls. Everything else is OpenComputer.

```
browser ──"start task"──▶  /api/sessions       (holds the org key)
                              └─▶ POST /v3/sessions ──▶ OpenComputer
browser ◀── { id, client_token } ──┘

browser ──(client_token)──▶  GET  /v3/sessions/:id/events?stream=sse   (watch live)
browser ──(client_token)──▶  POST /v3/sessions/:id/messages           (steer)
                              ▲ straight to OpenComputer — the app isn't in the loop
```

Your server's only job is to start the run and hand the browser a **client token** (a
short-lived, session-scoped key that can stream and steer that one session). The browser
talks to OpenComputer directly after that — so there's nothing to keep running, and the
org key never leaves the server. The shareable link carries only the session id; opening
it mints a fresh token and replays the durable log from the start.

## Setup

You need two keys:

- `OPENCOMPUTER_API_KEY` — from [app.opencomputer.dev](https://app.opencomputer.dev)
- `ANTHROPIC_API_KEY` — your Anthropic key (OpenComputer seals it in its secret store;
  it never enters the sandbox)

The agent itself is created for you, idempotently, on the first task — see
`ensureAgent()` in [`src/oc.ts`](src/oc.ts). Edit the prompt in
[`src/agent.ts`](src/agent.ts) to change what it does.

## Run it locally

```bash
cp .env.example .env.local      # fill in the two keys
npm install
npm run dev                     # http://localhost:3000
```

## Deploy (Vercel)

```bash
npm i -g vercel
vercel                          # first run links/creates the project
vercel env add OPENCOMPUTER_API_KEY
vercel env add ANTHROPIC_API_KEY
vercel --prod                   # → a public URL you can share and demo
```

## Try the demo

1. Start a task (an example is one click away): *"clone a public repo, run its tests,
   tell me what broke."*
2. Watch it stream — cloning, installing, running tests — live.
3. **Close the tab.** Reopen the URL → the run replays from the durable log, right where
   it was. (Same if your wifi drops: the stream just resumes.)
4. **Walk away.** The session goes idle and its sandbox hibernates (≈ free). Come back
   and **steer** it — *"also check the CI config"* — it wakes and continues with full
   context.

## What's OpenComputer vs. what's yours

| Yours (this repo) | OpenComputer |
| --- | --- |
| the page + two `/api` calls | the durable event log + live stream + resume |
| an agent prompt | the sandbox, the agent loop, hibernation/wake |
| ~one screen of code | browser-safe tokens, steering, the model on your key |

## Notes (demo simplifications)

- **Anyone with the link can watch and steer** (and steering spends tokens on your
  Anthropic key). That's intentional for a shareable demo — for a real product, gate
  `/api/sessions/:id/token` behind your own auth, and lean on session
  [`limits`](https://docs.opencomputer.dev/agent-sessions/sessions) to cap spend.
- Client tokens are short-lived (1h here); a long-after resume just mints a fresh one on
  load.

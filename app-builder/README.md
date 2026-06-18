# app-builder — chat to build a web app

A mini app-builder in the spirit of Lovable / v0 / bolt.new: describe an app, an agent
builds it in a real sandbox on [OpenComputer Durable Agent
Sessions](https://docs.opencomputer.dev/agent-sessions), and you keep chatting to change
it. Each app is a **project** you can leave and come back to — it's durable, resumable,
and hibernates (≈ free) while you're away.

## How it maps onto sessions

| In the UI | OpenComputer |
| --- | --- |
| a **project** | a session (one per app) |
| the **chat** + tool-call cards | the session's durable event stream (`agent.message`, `tool.call`, `exec.completed`) |
| **new project** | `POST /sessions` on the `app-builder` agent |
| the **projects list** | `GET /sessions?agent=…` |
| sending a message | a steer (`POST /sessions/:id/messages`) |
| the **live preview** | *coming soon* — see below |

The whole backend is [`src/oc.ts`](src/oc.ts): list/create projects and mint a token.
The browser streams and steers **directly** against OpenComputer with a short-lived
client token, so there's nothing always-on and the org key never leaves the server. Open
a project and its durable log replays the entire conversation.

## The preview pane (the one deferred piece)

The agent builds the app and runs a dev server in its sandbox. Showing that running app
needs a **preview URL** off the sandbox, surfaced through the session. The clean seam:
the platform emits a **`preview.url`** event (already a planned event type) and the app
iframes whatever URL it carries — see `Preview` in [`src/app/page.tsx`](src/app/page.tsx).
Until that ships, the pane shows a placeholder; everything else works today.

## Setup

Two keys:
- `OPENCOMPUTER_API_KEY` — from [app.opencomputer.dev](https://app.opencomputer.dev)
- `ANTHROPIC_API_KEY` — your Anthropic key (OpenComputer seals it; it never enters the sandbox)

The `app-builder` agent is created idempotently on the first project — see `ensureAgent()`
in [`src/oc.ts`](src/oc.ts); edit its prompt in [`src/agent.ts`](src/agent.ts).

## Run it locally

```bash
cp .env.example .env.local      # fill in the two keys
npm install
npm run dev                     # http://localhost:3000
```

### Just want to see the UI? (no keys, no backend)

A tiny fake OpenComputer lives in [`mock/`](mock) and streams a scripted build. In
`.env.local`, point both URLs at it (`OC_API_URL` and `NEXT_PUBLIC_OC_API_URL` =
`http://localhost:8787`; any placeholder works for the two keys), then:

```bash
npm run mock        # terminal 1 → http://localhost:8787
npm run dev         # terminal 2 → http://localhost:3000
```

Create a project and watch the chat, tool-call cards, and preview pane come to life.

## Deploy (Vercel)

```bash
npm i -g vercel
vercel                          # link/create the project
vercel env add OPENCOMPUTER_API_KEY
vercel env add ANTHROPIC_API_KEY
vercel --prod                   # → a public URL
```

## What's OpenComputer vs. what's yours

| Yours (this repo) | OpenComputer |
| --- | --- |
| a three-pane UI + three `/api` calls | durable projects, the event log, live stream, resume |
| an agent prompt | the sandbox, the build loop, hibernation/wake |
| ~one screen of code per file | browser-safe tokens, steering, the model on your key |

## Notes (demo simplifications)

- **Anyone with a project link can watch and steer** (steering spends tokens on your
  Anthropic key). Fine for a shared demo; for a real product, gate
  `/api/projects/:id/token` behind your own auth and use session
  [`limits`](https://docs.opencomputer.dev/agent-sessions/sessions).
- Project titles are kept in the browser (localStorage); the projects list itself comes
  from the sessions API.

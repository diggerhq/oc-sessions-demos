# Agents on OpenComputer — three apps, built thin

Three agent products you'd recognize, each a **complete, self-contained, deployable
app** — and each surprisingly small, because [OpenComputer Durable Agent
Sessions](https://docs.opencomputer.dev/agent-sessions/overview) does the hard part: it
runs the agent as a **durable, streamable, steerable** session on real sandboxed
compute, with reliable delivery. You write only what makes each product *yours*.

Each app lives in its own top-level directory. Clone one, add your keys, deploy it,
demo it from a public URL. They don't share code — the only thing they share is the
OpenComputer backend.

## The apps

| App | What it is | In the spirit of | What you write |
|---|---|---|---|
| [`app-builder/`](app-builder) | Describe an app → an agent builds it in a sandbox; chat to change it. Each app is a durable project you watch live and come back to. | Lovable / v0 / bolt.new | a 3-pane UI + three routes |
| [`pr-reviewer/`](pr-reviewer) | Open a PR on a public repo → an agent reviews the diff and posts a comment. | Greptile | a GitHub webhook + the comment |
| [`slack-teammate/`](slack-teammate) | Mention a bot in Slack → a durable thread you keep talking to; it asks, you answer, it remembers. | Devin | the Slack glue |

## Each app is self-contained

Every directory is its own small project — own `README.md`, own `package.json`, own
code, own one-command deploy. Each README walks through:

1. **Bring your keys** — an OpenComputer API key and your Anthropic key.
2. **Bring your app** (where relevant) — a GitHub App or Slack App you create and point
   at the deployed URL. Each README has the exact steps; it's a few minutes.
3. **Deploy** — one command to a public URL, so you can demo it in a real PR or Slack
   workspace. The app with a UI ships on **Next.js + Vercel**; the pure-backend ones
   ship as a **Cloudflare Worker**.

There's no shared library and no config-file magic to learn — each app talks to
OpenComputer directly with a few clearly-marked calls, so you can read one folder top to
bottom and understand the whole thing.

**No server to keep running.** None of these apps need an always-on host — OpenComputer
holds the durable state, the compute, and the live stream, so each app is just a
stateless edge that starts or steers a session and returns. That's the whole point.

## What OpenComputer handles so you don't

- **Durable log & resume** — every step in one ordered log; reconnect from any cursor, miss nothing.
- **Live stream & browser-safe tokens** — stream a session straight to the browser without exposing your account key.
- **Steering** — send a message mid-run; the session wakes and continues with full context.
- **Hibernation** — an idle session sleeps (≈ free) and resumes on the next message.
- **Reliable delivery** — at-least-once, signed, retried, dead-lettered webhooks, all inspectable.
- **Sandboxed compute** — the agent runs real commands in an isolated sandbox; your key never enters it.

These are the parts every agent product otherwise rebuilds. Here they're a few API calls.

## Status

These run against the Durable Agent Sessions API (`/v3`). Today the `claude` runtime
works on **public** repositories, and native GitHub / Slack *channels* are coming soon —
so `pr-reviewer` and `slack-teammate` bring their own GitHub / Slack app and bridge it
to a session. That bridge *is* the point: the agent run is the part you no longer build.
See the [docs](https://docs.opencomputer.dev/agent-sessions/overview).

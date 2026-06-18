# 001 — Thin agents on Durable Agent Sessions

Status: **active** — design for the new demo repo backing Launch #1 (Durable Agent
Sessions). Companion to the launch SoT in `oc-bg-agents/.agents/work/launch-durable-agent-sessions.md`
(the API we build against) and its docs PR (`opencomputer` branch `docs/durable-sessions`,
`docs/agent-sessions/*`). Where this doc and the SoT/docs disagree on the API surface,
**the shipped docs win** — pin against them.

## 1. Thesis

The hard part of an "agent product" — Greptile, Devin, a build-in-public agent
terminal — is not the prompt. It's the **infrastructure around the agent run**: a
durable record of every step, a live stream to a UI, the ability to steer a run
mid-flight, sandboxed compute the agent can act in, and reliable delivery of results.
Each company rebuilds that stack.

Durable Agent Sessions makes that stack a **few API calls**. This repo proves it by
rebuilding three recognizable products **as thin as they can possibly be** — each one
is just its own channel/business glue on top of one shared OpenComputer backend. The
demo *is* the contrast: the part you'd think is the moat is now `src/oc/`, ~identical
for all three; the part that's actually yours is small.

Goal for a reader: "I could ship my agent product this weekend, and OpenComputer is
already doing the load-bearing 80%."

## 2. Why a new repo (not the old gallery)

The existing gallery (`oc-agent-demos`: `issue-fixer`, `pr-reviewer`, `slack-helper`,
`docs-reconciler`) proves the **old** thesis: *event → agent fires on a fresh machine
→ delivers → goes dormant.* Fire-and-forget, `oc agent deploy ./dir`, platform
connectors do the triggering; the agent **is** the product.

Launch #1 is the opposite paradigm: **API-first, interactive, build-your-own-app.**
`POST /v3/sessions` → live SSE → steer → resume → hibernate → signed webhook. OC owns
the durable substrate; *you* build the surface. None of the old five port over — they
assume connectors and deploy-from-dir we're not shipping here. Hence a clean repo with
its own mental model.

Deliberately **not** chasing "magic" (no `opencomputer.toml`, no declarative deploy).
The "configure once" step is an explicit, readable **setup script** that calls the OC
APIs — so the reader sees exactly what's happening.

## 3. Architecture — three self-contained apps (no shared code)

Each app is its own **top-level directory**: a complete, standalone, deployable
project. There is **no shared library** and no cross-app imports. The only thing the
three share is the **OpenComputer backend** (the platform) — each talks to it directly.

```
web-terminal/      a shareable, resumable agent terminal
pr-reviewer/       a PR reviewer that posts a comment
slack-teammate/    a Slack teammate with durable threads
README.md          the gallery index
AGENTS.md          conventions
.agents/design/    this doc
```

Every app dir is self-contained and looks roughly like:
```
<app>/
  README.md            what it is · bring-your-keys · bring-your-GitHub/Slack-app · deploy
  package.json         its own deps, its own start/deploy scripts
  .env.example         OPENCOMPUTER_API_KEY, ANTHROPIC_API_KEY, channel secrets
  src/
    oc.ts              this app's small, clearly-marked OpenComputer calls
    <channel>.ts       the business/channel glue (route+page / GitHub / Slack)
    index.ts           entrypoint
  <deploy config>      one-command deploy to a public URL (§ Deployment)
```

**Why duplicate the OC calls instead of a shared lib?** Self-containment is the
product. A reader clones **one** folder, reads it top to bottom, and ships it — no
hunting through a shared package. The OC surface each app touches is small (a handful of
`fetch`es), so a little duplication buys total legibility. Each `oc.ts` keeps the
OpenComputer calls visually separated from the channel logic (a banner comment), so the
"this part is OpenComputer / this part is mine" split is obvious *within* each app.

**Configure once, per app.** Each app does its own one-time setup — create the Anthropic
[credential](#4-pinned-api-surface-from-the-shipped-docs--docsagent-sessions) and
register its [agent(s)](#4-pinned-api-surface-from-the-shipped-docs--docsagent-sessions)
by name — as an explicit step its README documents (a small `setup` script or first-run
bootstrap), **not** a toml file. The org key lives only server-side; the web app hands
the browser a **client token** and never exposes the org key (the prescribed pattern).

## 3a. Deployment (each app → a public URL; none always-on)

Each app must be demoable from a **public URL** (a real GitHub PR, a real Slack
workspace, a shareable terminal link). **No app needs an always-on container — and that
is the thesis showing up in the deploy model.** Because OpenComputer owns the durable
state, the long-running compute, *and* the live stream, each app collapses to a
**stateless edge**: it starts or steers a session, hands out a token or posts a
result, and returns. The agent turn runs in OC, not in the app; nothing waits.

The three things that would otherwise force an always-on server are exactly what OC
takes off your plate, so we avoid them by design:
- **proxying the SSE stream** → the browser streams **directly** from OC with the client
  token (the app never holds the connection);
- **polling for completion** → OC **pushes** via signed webhooks;
- **Slack Socket Mode** (a persistent WebSocket) → we use the Slack **Events API over
  HTTP** (request/response).

**Deploy target is therefore per-app, by nature:**
| App | Nature | Deploy |
|---|---|---|
| `web-terminal/` | has a frontend | **Next.js + Vercel** (static page + one serverless route to mint the session/token) |
| `pr-reviewer/` | pure backend | **Cloudflare Worker** (`wrangler deploy`) |
| `slack-teammate/` | pure backend | **Cloudflare Worker** (`wrangler deploy`) |

**Fly is unused** — kept only as a fallback *if* a future app genuinely needs an
always-on process; none here do.

**Worker notes (pr-reviewer / slack-teammate):** the `standardwebhooks` npm lib assumes
Node crypto, so in a Worker verify the OC signature with **Web Crypto** inline (it's just
`HMAC-SHA256(secret, "{webhook-id}.{webhook-timestamp}.{rawBody}")`, base64-compare);
likewise GitHub's `X-Hub-Signature-256`. Secrets via `wrangler secret put`. Slack's 3s
ack: respond `200` immediately, continue the OC call in `ctx.waitUntil(...)`.

## 4. Pinned API surface (from the shipped docs — `docs/agent-sessions/*`)

Base `https://api.opencomputer.dev/v3`. Management = org key (`Authorization: Bearer`).
Stream + steer also accept a **client token** (`?token=` for `EventSource`; `Bearer`
otherwise).

- **Credentials** — `POST /credentials { provider:"anthropic", key, name? }` ·
  `PUT /credentials/default { provider, credential }`. A credential is **required**
  (no platform billing yet → `422 no_credential`). Key is sealed in the secret store;
  **never enters a sandbox**.
- **Agents** — `POST /agents { name, prompt, model:"anthropic/claude-opus-4-8",
  runtime?:"claude", key?|credential?, limits? }`, idempotent by `(owner, name)`.
- **Sessions** — `POST /sessions { agent, input, key?, webhook?, destinations?[],
  limits?:{ tokens?, turn_seconds?, turns? } }` → `{ session, client_token }`.
  `input` is a string or an envelope; structured context rides `input.refs`
  (`repo`/`branch`/`commit`/`issue`). `GET /sessions/:id`, `GET /sessions/:id/result`
  → `{ last_turn, result? }`, `POST …/cancel`, `POST …/archive`,
  `POST …/client-tokens`.
- **Events** — `GET /sessions/:id/events?after=&level=&type=&stream=sse&token=`.
  `Event = { id, seq, ts, session, actor, type, level, body, refs }`. Switch on
  **`type`**: `agent.message` · `user.message` · `turn.started` · `turn.completed
  { yield_reason, result_event_id? }` (**the done signal**) · `tool.call` ·
  `exec.completed { command, exit_code, summary, content_ref? }` · `error.*`. Levels
  (cumulative): `user` ⊂ `progress` ⊂ `internal`. Resume via `after=<seq>` /
  `Last-Event-ID`.
- **Steer** — `POST /sessions/:id/messages { text, idempotency_key? } | { envelope }`
  → `202 { event:{id,seq}, session:{id,status,head} }`. `yield_reason:"needs_input"`
  means the agent `ask`ed; answer it with a steer.
- **Destinations / deliveries** — `POST /sessions/:id/destinations { url, secret?,
  level?, types?, include_raw? }`; `GET …/deliveries`, `…/deliveries/:id`,
  `POST …/deliveries/:id/redeliver`. Signed Standard Webhooks (`webhook-id`,
  `webhook-timestamp`, `webhook-signature`); at-least-once → dedupe on `webhook-id`.
- **Runtime tools (`claude`)** — `bash` · `read` · `write` · `ls` · `use_repo`
  (**public** repos only in v1) · `say` (→ `user` message; final `say` = result) ·
  `ask` (→ yields `needs_input`). `deliver`/`reconcile` (PR/comment, converge) are
  **coming soon** — until then, output leaves via webhooks. Sandbox has open outbound
  internet (private/loopback/metadata blocked).

## 5. The three apps

### 5a. `web-terminal/` — a shareable, resumable agent terminal  *(build first)*
- **What:** a single page. Type a task → it streams live; a steer box sends follow-ups;
  the URL is shareable and re-openable. The demo *is* breaking it: close the tab / drop
  wifi → reopen, the stream resumes from the cursor; walk away → the session idles and
  the sandbox hibernates (≈ free) → come back, steer, it wakes with full context.
- **Glue you write:** one server route (`POST /api/tasks` → `startSession` → return
  `{ session_id, client_token }`) + a page that opens an `EventSource` with `?token=`
  and posts steers **directly to OC** with the client token. The server holds the org
  key and does nothing else. ~one route + ~40 lines of browser JS.
- **Deploy:** Next.js on Vercel (static page + the one serverless route).
- **OC made load-bearing:** durable log, SSE resume, browser-safe client tokens, steer,
  hibernation, sandboxed compute — nearly the whole surface in one story.
- **Default task:** "clone this public repo, run its tests, tell me what broke" (visual,
  self-contained, steer-friendly: "also check the CI config"). No external app creds.
- **Hard without us:** step persistence + a reconnect-by-cursor stream + scoped browser
  tokens + sandbox lifecycle — a week of plumbing for a page of glue.

### 5b. `slack-teammate/` — a Devin-style teammate with durable threads
- **What:** mention the bot → it starts a session; **the Slack thread is the session.**
  Replies in the thread `steer` it; it relays `progress`/`user` events back; when it
  `ask`s (`needs_input`), the thread is how you answer. Idle threads hibernate (≈ free)
  and never lose context.
- **Glue you write:** a Slack events handler that maps `thread_ts ↔ session_id`
  (`startSession` on first mention via `key=thread_ts` for get-or-create; `steer`
  after) and posts OC events into the thread. Bring your own Slack app (OC's Slack
  channel is coming soon — the bridge is the demo).
- **OC made load-bearing:** steer + `needs_input` loop, durable multi-turn context,
  hibernation between messages.
- **Deploy:** Cloudflare Worker (Events API over HTTP; ack `200` fast, continue in
  `ctx.waitUntil`).
- **Hard without us:** a durable, resumable, multi-turn conversation with real compute
  per thread — and not paying for it while idle.

### 5c. `pr-reviewer/` — a Greptile-style PR reviewer
- **What:** open a PR on a public repo → an agent checks out the repo at the commit,
  reviews the diff, and posts a review comment.
- **Glue you write:** a GitHub webhook receiver (`pull_request.opened`) → `startSession`
  with `input.refs = { repo, commit, pr }` + a `webhook` destination (or
  `types:["turn.completed"]`) → on the verified completion, **post the comment to GitHub
  with your own token** (OC's GitHub `deliver` is coming soon; the demo does the GitHub
  I/O). Public repos only in v1.
- **OC made load-bearing:** the durable review run, retries, reliable **signed**
  delivery (survives your server blipping; any delivery is inspectable + redeliverable).
- **Deploy:** Cloudflare Worker (two routes: GitHub webhook in, OC delivery in).
- **Hard without us:** a reviewer that runs real analysis in a sandbox, survives
  crashes, hibernates between PRs (≈ free), and *reliably* posts even when your endpoint
  is briefly down.

## 6. Build order
1. **`web-terminal/`** — the densest proof, zero external app setup. Build it first; it's
   a complete launchable slice on its own.
2. **`slack-teammate/`** — best steer / `needs_input` / hibernation story.
3. **`pr-reviewer/`** — best reliable-delivery / survives-crashes story.

Ship-a-day framing: each app is its own launchable; the web terminal leads.

## 7. Conventions
- **Each top-level dir is self-contained** — own `README.md`, `package.json`, `src/`,
  `.env.example`, deploy config. **No shared library, no cross-app imports.** Duplicating
  the few OC `fetch`es per app is intentional (clone-one-folder legibility).
- **TypeScript + Node**, minimal deps (the docs examples are JS; `standardwebhooks`,
  `@slack/*`, `octokit` are JS). Each app organized beautifully but **simply** — a reader
  should grok one folder in a sitting.
- **No toml / no declarative deploy** — each app's one-time setup is an explicit script
  its README documents.
- **Separate OpenComputer from your logic, visibly** — keep each app's OC calls in
  `src/oc.ts` behind a banner comment, channel logic elsewhere.
- **Secrets:** `OPENCOMPUTER_API_KEY` + `ANTHROPIC_API_KEY` + channel secrets from env
  (`.env`, gitignored; `.env.example` committed). Never commit keys; never log them.
- **Switch on `type`/`level`, never parse prose.** Dedupe webhooks on `webhook-id`.

## 8. Open questions
1. **Deploy target.** ✅ **Resolved (§3a):** per-app by nature — `web-terminal` →
   Next.js+Vercel (it has a frontend); `pr-reviewer` + `slack-teammate` → Cloudflare
   Worker (pure backend). No app needs always-on; Fly is an unused fallback.
2. **Repo name.** `oc-sessions-demos` (working name) vs something product-y
   (`thin-agents`, `agents-on-opencomputer`). Becomes a public GitHub repo eventually.
3. **Web app stack.** Plain Node/Hono + a static HTML page (max-thin, max-legible) vs a
   tiny framework. *(lean: plain + static — legibility is the product.)*
4. **Per-app channel setup.** Confirmed: real **bring-your-own GitHub App / Slack App**,
   documented step-by-step in each app's README (leaner than shipping stubs/mocks).

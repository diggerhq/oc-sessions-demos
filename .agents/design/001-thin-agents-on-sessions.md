# 001 — App Builder on Durable Agent Sessions

Status: **active** — design + learnings for this demo repo. Companion to the launch SoT
(`oc-bg-agents/.agents/work/launch-durable-agent-sessions.md`) and the shipped user docs
(`opencomputer` branch `docs/durable-sessions`, `docs/agent-sessions/*`). Where this and
the shipped docs disagree on the API, **the docs win** — pin against them.

> History: this repo began as a 3-app gallery (app-builder · pr-reviewer · slack-teammate).
> We focused it down to the **single app-builder** showcase (2026-06-18) — it's the densest
> proof and a recognizable product. The other two remain ideas for later, not in this repo.

## 1. Thesis

The hard part of an AI app builder (Lovable / v0 / bolt.new) isn't the prompt — it's the
**infrastructure around the agent run**: persistent build sessions, sandboxed execution,
streaming the work to a browser, and picking a project back up later. Durable Agent
Sessions makes all of that a few API calls. This repo rebuilds a recognizable product **as
thin as it can be** to show that: the agent backend collapses to `src/oc.ts` (~40 lines) +
two routes; the rest is a prompt and a chat UI.

## 2. Architecture

A single, self-contained **Next.js app**, deployed to **Vercel** (stateless — the durable
state and compute live in OpenComputer, so nothing is always-on).

```
src/oc.ts          the whole OC integration: ensureAgent · createProject · mintToken
src/agent.ts       the prompt — the only thing that makes this an "app builder"
src/app/page.tsx   3-pane UI: projects (sessions) · chat trace · preview
src/app/api/       projects (start/list) · projects/:id/token (mint client token)
mock/              dependency-free fake OC for local UI testing (never deployed)
docs/architecture.svg   the user-facing platform diagram (reused in the README)
```

**The split is physical:** all OpenComputer calls sit in `src/oc.ts` behind a banner;
UI/business logic is elsewhere. The org key lives only server-side (the `/api` routes); the
browser gets a **client token** and talks to OC directly for streaming + steering.

**Mapping the product onto the API:** project = session · chat = the event stream · new
project = `POST /sessions` on the `app-builder` agent · projects list = `GET /sessions?agent=` ·
a message = a steer. Opening a project replays its durable log = the whole conversation.

## 3. Pinned API surface (from the shipped docs)

Base `https://api.opencomputer.dev/v3`. Org key (server) for management; client token
(`Bearer` or `?token=` for EventSource) for one session's read+steer.

- **Agents** — `POST /agents { name, prompt, model:"anthropic/claude-opus-4-8", runtime?,
  key? }` (idempotent by `(owner,name)`; `key` → sealed credential, never in a sandbox).
- **Sessions** — `POST /sessions { agent, input, key?, webhook?, limits? }` →
  `{ session, client_token }`; `GET /sessions?agent=&status=` ; `GET /sessions/:id` ;
  `POST /sessions/:id/client-tokens { scopes?, ttl? }` → `{ client_token }`.
- **Events** — `GET /sessions/:id/events?after=&level=&stream=sse&token=`.
  `Event = { id, seq, ts, session, actor, type, level, body, refs }`. Switch on **`type`**.
  `level` cumulative: `user ⊂ progress ⊂ internal`; `after`/`Last-Event-ID` to resume.
- **Steer** — `POST /sessions/:id/messages { text, idempotency_key? }` → `202`.
- **Runtime tools (`claude`)** — `bash · read · write · ls` · `say` (→ user message;
  final = result) · `ask` (→ `needs_input`). (`use_repo` exists for public repos but this
  demo builds fresh apps, so it isn't used.) `deliver`/`reconcile` coming soon.

## 4. The app — `app-builder`

Three-pane UI: **projects** (left), **chat trace** (middle), **live preview** (right).
Describe an app → the agent scaffolds + runs it in a sandbox; keep chatting to change it.

**The build trace.** Render by event `type`: `agent.message` (narration / result),
`tool.call` (`$ command`), `exec.completed` (output + exit badge), `turn.completed` (done).
Stream `level=internal&after=0` to show every step and replay history on open.

**Preview = the deferred seam (built everything except this).** The agent runs a dev server
in its sandbox; surfacing it needs a sandbox **preview URL exposed through the session**.
Recommended reconciliation: the platform emits a **`preview.url`** event at `level:user` and
the app iframes that URL (or reads a `GET /sessions/:id/preview` field) — staying inside the
session abstraction, no raw sandbox handles in the browser. The `Preview` component scans
events for `type:"preview.url"` and shows a placeholder until that ships. (Interim escape
hatch, avoid: session-create returns the hands `sandbox_id` + call the sandbox preview API.)

## 5. Learnings from running on real `/v3` (2026-06-18)

- **Real event vocabulary:** `user.message{text}` · `turn.started{turn_id,input_from/to_seq}`
  · `agent.message{text}` (emitted at progress=narration AND user=answer/result) ·
  `tool.call{tool,args_summary}` (args_summary = the command) ·
  `exec.completed{command,summary,exit_code,content_ref?,bytes?}` (summary = real stdout) ·
  `agent.result{subtype,num_turns,usage,total_cost_usd}` (internal) ·
  `turn.completed{turn_id,yield_reason,result_event_id}`. `actor:{kind}`. ids
  `ses_/agt_/trn_/evt_`. Numbers sometimes serialized as strings (`head:"2"`).
- **Client-token visibility:** initially capped at `user`-level (browser saw only chat, no
  trace). Fixed backend-side (sessions-api `a6b4a71`): client tokens now see **all levels**
  of their own session and honor `?level=`. App needs no special token — just request
  `level=internal`.
- **Cold-start (open backend perf item):** first turn's first command runs ~**3 min** in
  (sandbox provision + brain-box runtime cold-start: pushing + `npm install`-ing the claude
  bundle into a fresh sandbox each turn), `errors=0` — just slow. Needs a **warm pool /
  prebuilt runtime image** + sandbox quota bump. Steers are fast (warm sandbox). The UI
  shows a "spinning up a sandbox" state to keep the wait legible. Debug with
  `sessions-api/scripts/v3-trace.ts <session_id>` (ClickHouse telemetry waterfall).

## 6. Conventions
- TypeScript + Next.js, minimal deps. Organized simply — grok the repo in a sitting.
- No toml / declarative deploy; the OC setup is explicit code (`ensureAgent`).
- Secrets from env (`.env.local`, gitignored). Never commit/log keys. `mock/` is dev-only.

## 7. Future (not in this repo yet)
- Wire the preview pane once `/v3` emits `preview.url`.
- The pr-reviewer (Greptile-style) and slack-teammate (Devin-style) apps, if we expand the
  showcase — each a separate self-contained app bridging its channel to a session.

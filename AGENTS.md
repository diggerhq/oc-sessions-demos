# AGENTS.md — guide for agents working in this repo

What this is: a single, self-contained demo — a **Lovable-style app builder** built on
OpenComputer [Durable Agent Sessions](https://docs.opencomputer.dev/agent-sessions). It
exists to show that the agent-run infrastructure (durable sessions, sandboxed compute,
live streaming, steering, hibernation) is a few API calls — so the app is tiny.

## Read order
1. `README.md` — the user-facing build guide (the centerpiece).
2. `src/oc.ts` — the entire OpenComputer integration (~40 lines).
3. `.agents/design/001-thin-agents-on-sessions.md` — design rationale, the pinned `/v3`
   API surface, and hard-won learnings (event vocabulary, cold-start, client-token levels).

## The invariant: keep it thin and legible
- All OpenComputer calls live in `src/oc.ts` behind a banner comment; channel/UI logic is
  separate (`src/app/`). "This is OpenComputer / this is mine" must be obvious.
- The prompt (`src/agent.ts`) is the only thing that makes this an *app builder*.
- Switch on event `type` — never parse prose. Default to `level=internal` for the full
  build trace; resume with `after=`/`Last-Event-ID`.
- Pin the API against the shipped docs (`opencomputer` `docs/agent-sessions/*`); if this
  repo and the docs disagree, the docs win.

## Hard rules
- **No secrets in git.** `OPENCOMPUTER_API_KEY` / `ANTHROPIC_API_KEY` come from env;
  `.env.local` is gitignored. Never commit or log a key.
- **`mock/` is dev-only** — a fake OC for local UI testing; never deployed, never on a code
  path the real app depends on.
- This is a public-facing showcase: keep internal strategy out of `README.md` and app copy
  (it belongs in `.agents/`).

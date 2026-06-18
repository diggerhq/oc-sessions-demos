# oc-sessions-demos — Guide for Agents

What this is: a demo repo for **Launch #1 — Durable Agent Sessions**. Three
recognizable agent products (a mini app-builder à la Lovable, a Greptile-style PR
reviewer, a Devin-style Slack teammate) built **as thin as possible** on one shared
OpenComputer backend — to show that the agent-run infrastructure is now a few API calls.

## Read order
1. `README.md` — the user-facing face of the repo.
2. `.agents/design/001-thin-agents-on-sessions.md` — the thesis, architecture, the
   pinned API surface, per-app specs, build order, open questions. **Start here to build.**

## The one invariant: each app is self-contained
- Every agent is a **top-level dir** = a complete, standalone, deployable app: own
  `README.md`, `package.json`, `src/`, `.env.example`, deploy config.
- **No shared library, no cross-app imports.** Duplicating the few OpenComputer `fetch`es
  per app is intentional — a reader clones one folder and ships it.
- The only thing apps share is the **OpenComputer backend** (the platform).
- Within an app, keep OC calls in `src/oc.ts` behind a banner comment, channel logic
  elsewhere — so "this is OpenComputer / this is mine" is obvious in one folder.

## Conventions
- TypeScript + Node, minimal deps. Organized beautifully but **simply** — grok one
  folder in a sitting. No `opencomputer.toml` magic — each app's one-time setup is an
  explicit script its README documents.
- Each app deploys to a **public URL** in one command (for real PR / Slack / shareable
  demos); its README documents pointing the GitHub/Slack app at that URL.
- Switch on event `type`/`level`; never parse prose. Dedupe webhooks on `webhook-id`.
- Pin the API against the shipped docs (`opencomputer` `docs/agent-sessions/*`) — if
  this repo and the docs disagree, the docs win.

## Hard rules
- **No secrets in git.** `OPENCOMPUTER_API_KEY` / `ANTHROPIC_API_KEY` come from env;
  `oc.json` holds ids only and is gitignored. Never commit or log a key.
- **Clean base before new work** — start from a clean merged trunk, not a leftover branch.
- This is a public-facing showcase: keep internal strategy (the "moat is gone" framing)
  in `.agents/`, not in `README.md` or app copy.

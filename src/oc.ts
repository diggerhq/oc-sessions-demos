// ─────────────────────────────────────────────────────────────────────────────
//  OpenComputer — every call this app makes to the Durable Agent Sessions API,
//  via the official SDK (@opencomputer/sdk). This is the whole backend. It holds
//  the org key and runs server-side only (imported by the /api routes); the
//  browser never imports this file — it talks to OpenComputer directly with a
//  short-lived client token (see src/app/page.tsx, `connectSession`).
//  A "project" is just a session; the projects list is just `sessions.list`.
//  Docs: https://docs.opencomputer.dev/agent-sessions
// ─────────────────────────────────────────────────────────────────────────────

import { OpenComputer } from "@opencomputer/sdk";
import { BUILDER_AGENT } from "./agent";

const ORG_KEY = process.env.OPENCOMPUTER_API_KEY;
if (!ORG_KEY) throw new Error("OPENCOMPUTER_API_KEY is not set");
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// One client, holding the org key. `baseUrl` is optional (defaults to the public API).
const oc = new OpenComputer({ apiKey: ORG_KEY, baseUrl: process.env.OC_API_URL });

// Configure once: create (idempotently) the agent that backs every project.
// `agents.create` is idempotent by (owner, name); passing `key` stores your Anthropic
// key as a sealed credential. Cached per server process; reset on failure.
let agentId: Promise<string> | null = null;
export function ensureAgent(): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  agentId ??= oc.agents
    .create({ ...BUILDER_AGENT, key: ANTHROPIC_KEY })
    .then((a) => a.id)
    .catch((e) => { agentId = null; throw e; });
  return agentId;
}

// A project is a session. List them (newest first) for the builder agent.
export async function listProjects() {
  const agent = await ensureAgent();
  const { data } = await oc.sessions.list({ agent, limit: 50 });
  return data.map((s) => ({ id: s.id, status: s.status, created_at: s.createdAt }));
}

// Start a project: a new session on the builder agent with the user's first request.
// `create` returns a Session handle whose `clientToken` is browser-safe (read + steer).
export async function createProject(input: string) {
  const agent = await ensureAgent();
  const session = await oc.sessions.create({ agent, input });
  return { id: session.id, token: session.clientToken! };
}

// Mint a fresh, short-lived client token for an existing project — used when a
// project is opened, so the browser can stream + steer it without the org key.
export async function mintToken(sessionId: string) {
  const session = await oc.sessions.get(sessionId);
  const token = await session.mintClientToken({ scopes: ["read", "steer"], ttlSeconds: 3600 });
  return { token };
}

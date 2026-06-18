// ─────────────────────────────────────────────────────────────────────────────
//  OpenComputer — every call this app makes to the Durable Agent Sessions API.
//  This is the whole backend. It holds the org key and runs server-side only
//  (imported by the /api routes); the browser never imports this file.
//  A "project" is just a session; the projects list is just GET /sessions.
//  Docs: https://docs.opencomputer.dev/agent-sessions
// ─────────────────────────────────────────────────────────────────────────────

import { BUILDER_AGENT } from "./agent";

const OC = process.env.OC_API_URL ?? "https://api.opencomputer.dev";
const ORG_KEY = process.env.OPENCOMPUTER_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function oc(path: string, init: RequestInit = {}) {
  if (!ORG_KEY) throw new Error("OPENCOMPUTER_API_KEY is not set");
  const res = await fetch(`${OC}/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ORG_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`OpenComputer ${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Configure once: create (idempotently) the agent that backs every project.
// `POST /agents` is idempotent by (owner, name); passing `key` stores your
// Anthropic key as a sealed credential. Cached per server process.
let agentId: Promise<string> | null = null;
export function ensureAgent(): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  // Reset the cache on failure so a transient error doesn't stick until restart.
  agentId ??= oc("/agents", {
    method: "POST",
    body: JSON.stringify({ ...BUILDER_AGENT, key: ANTHROPIC_KEY }),
  }).then((a) => a.id as string).catch((e) => { agentId = null; throw e; });
  return agentId;
}

// A project is a session. List them (newest first) for the builder agent.
export async function listProjects() {
  const agent = await ensureAgent();
  const r = await oc(`/sessions?agent=${agent}&limit=50`);
  const sessions = (r.data ?? r) as any[];
  return sessions.map((s) => ({ id: s.id, status: s.status, created_at: s.created_at }));
}

// Start a project: a new session on the builder agent with the user's first request.
// Returns the session id and a browser-safe client token (read + steer).
export async function createProject(input: string) {
  const agent = await ensureAgent();
  const { session, client_token } = await oc("/sessions", {
    method: "POST",
    body: JSON.stringify({ agent, input }),
  });
  return { id: session.id as string, token: client_token as string };
}

// Mint a fresh, short-lived client token for an existing project — used when a
// project is opened, so the browser can stream + steer it without the org key.
export async function mintToken(sessionId: string) {
  const r = await oc(`/sessions/${sessionId}/client-tokens`, {
    method: "POST",
    body: JSON.stringify({ scopes: ["read", "steer"], ttl: 3600 }),
  });
  return { token: (r.token ?? r.client_token) as string, expires_at: r.expires_at };
}

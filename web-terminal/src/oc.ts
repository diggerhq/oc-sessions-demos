// ─────────────────────────────────────────────────────────────────────────────
//  OpenComputer — every call this app makes to the Durable Agent Sessions API.
//  This is the whole backend. It holds the org key and runs server-side only
//  (imported by the /api routes); the browser never imports this file.
//  Docs: https://docs.opencomputer.dev/agent-sessions
// ─────────────────────────────────────────────────────────────────────────────

import { CODER_AGENT } from "./agent";

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

// Configure once: create (idempotently) the agent that backs every session.
// `POST /agents` is idempotent by (owner, name); passing `key` stores your
// Anthropic key as a sealed credential. Cached per server process.
let agentId: Promise<string> | null = null;
export function ensureAgent(): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  agentId ??= oc("/agents", {
    method: "POST",
    body: JSON.stringify({ ...CODER_AGENT, key: ANTHROPIC_KEY }),
  }).then((a) => a.id as string);
  return agentId;
}

// Start a session on the agent with the user's task.
// Returns the session id and a browser-safe client token (read + steer).
export async function createSession(input: string) {
  const agent = await ensureAgent();
  const { session, client_token } = await oc("/sessions", {
    method: "POST",
    body: JSON.stringify({ agent, input }),
  });
  return { id: session.id as string, token: client_token as string };
}

// Mint a fresh, short-lived client token for an existing session — used when a
// shared link is (re)opened, so the browser can stream + steer without the org key.
export async function mintToken(sessionId: string) {
  const r = await oc(`/sessions/${sessionId}/client-tokens`, {
    method: "POST",
    body: JSON.stringify({ scopes: ["read", "steer"], ttl: 3600 }),
  });
  return { token: (r.token ?? r.client_token) as string, expires_at: r.expires_at };
}

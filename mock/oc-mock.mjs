// A tiny, dependency-free FAKE of the OpenComputer Durable Agent Sessions API,
// just enough to drive the app-builder UI locally without a real backend or keys.
//
// It is NOT part of the app — point the app at it for local UI testing:
//   OC_API_URL=http://localhost:8787  NEXT_PUBLIC_OC_API_URL=http://localhost:8787
// and run `node mock/oc-mock.mjs` (or `npm run mock`) alongside `npm run dev`.
//
// It implements only the routes app-builder calls, holds sessions in memory, and
// streams a scripted "build" over SSE so you can watch the chat + tool cards +
// preview light up. Restarting it clears all state.

import http from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const sessions = new Map(); // id -> { id, status, prompt, created_at, events[], subs:Set, seq }

let n = 1000;
const uid = (p) => `${p}_${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const A = {
  agent: { id: "agent", type: "agent" },
  system: { id: "system", type: "system" },
  human: { id: "you", display: "You", type: "human" },
};

function newSession(prompt) {
  const id = uid("sess");
  const s = { id, status: "queued", prompt, created_at: now(), events: [], subs: new Set(), seq: 0 };
  sessions.set(id, s);
  return s;
}

// Append an event, assign its seq/id, and push it to every live SSE subscriber.
function append(s, e) {
  s.seq += 1;
  const ev = { id: uid("evt"), seq: s.seq, ts: now(), session: s.id, refs: {}, ...e };
  s.events.push(ev);
  const frame = `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`;
  for (const res of s.subs) res.write(frame);
  return ev;
}

const m = (type, level, actor, body) => ({ type, level, actor, body });

async function runBuild(s) {
  s.status = "running";
  const turn = uid("turn");
  append(s, m("turn.started", "progress", A.agent, { turn_id: turn, input_from_seq: 1, input_to_seq: 1 }));
  await delay(700); append(s, m("agent.message", "progress", A.agent, { text: "Scaffolding a Vite + React app…" }));
  await delay(900); append(s, m("tool.call", "progress", A.agent, { tool: "bash", args_summary: "npm create vite@latest . -- --template react" }));
  await delay(1100); append(s, m("exec.completed", "progress", A.agent, { command: "npm create vite@latest . -- --template react", exit_code: 0, summary: "scaffolded a react app" }));
  await delay(700); append(s, m("agent.message", "progress", A.agent, { text: "Installing dependencies…" }));
  await delay(1300); append(s, m("exec.completed", "progress", A.agent, { command: "npm install", exit_code: 0, summary: "added 271 packages in 9s" }));
  await delay(800); append(s, m("agent.message", "progress", A.agent, { text: "Writing the app — src/App.jsx…" }));
  append(s, m("tool.call", "progress", A.agent, { tool: "write", args_summary: "src/App.jsx (+ src/App.css)" }));
  await delay(1200); append(s, m("agent.message", "progress", A.agent, { text: "Starting the dev server on :3000…" }));
  append(s, m("exec.completed", "progress", A.agent, { command: "npm run dev -- --host 0.0.0.0 --port 3000", exit_code: 0, summary: "VITE v5 ready in 412 ms" }));
  await delay(900); append(s, m("preview.url", "user", A.system, { url: `http://localhost:${PORT}/preview/${s.id}`, port: 3000 }));
  const r = append(s, m("agent.message", "user", A.agent, { text: `Your app is running — ${summarize(s.prompt)} Tell me what to change.` }));
  append(s, m("turn.completed", "user", A.system, { turn_id: turn, yield_reason: "completed", result_event_id: r.id }));
  s.status = "idle";
}

async function runChange(s, text) {
  s.status = "running";
  const turn = uid("turn");
  append(s, m("turn.started", "progress", A.agent, { turn_id: turn }));
  await delay(700); append(s, m("agent.message", "progress", A.agent, { text: `On it — ${text}` }));
  await delay(900); append(s, m("tool.call", "progress", A.agent, { tool: "write", args_summary: "src/App.jsx" }));
  await delay(1100); append(s, m("exec.completed", "progress", A.agent, { command: "vite (hmr)", exit_code: 0, summary: "hot-updated /src/App.jsx" }));
  await delay(700);
  const r = append(s, m("agent.message", "user", A.agent, { text: `Done — ${text}. Refresh the preview to see it.` }));
  append(s, m("turn.completed", "user", A.system, { turn_id: turn, yield_reason: "completed", result_event_id: r.id }));
  s.status = "idle";
}

function summarize(p = "") {
  const t = p.toLowerCase();
  if (t.includes("todo")) return "add tasks, toggle them done, and they persist in localStorage.";
  if (t.includes("timer") || t.includes("pomodoro")) return "start / pause / reset the timer.";
  if (t.includes("note") || t.includes("markdown")) return "type markdown on the left, see it rendered on the right.";
  return "it’s a small React app scaffolded from your request.";
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key,Last-Event-ID");
}
const json = (res, obj, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } }); });

function sse(req, res, id, url) {
  const s = sessions.get(id);
  if (!s) return json(res, { error: "not found" }, 404);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
  const after = Number(url.searchParams.get("after") ?? req.headers["last-event-id"] ?? 0);
  for (const ev of s.events) if (ev.seq > after) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
  s.subs.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { clearInterval(ping); s.subs.delete(res); });
}

function previewPage(res, id) {
  const s = sessions.get(id);
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><meta charset=utf8><title>mock preview</title>
<style>body{margin:0;font:16px system-ui;background:#fafafa;color:#111;display:grid;place-items:center;height:100vh;text-align:center}
.card{max-width:30rem;padding:2rem}.tag{font:12px ui-monospace;letter-spacing:1px;color:#999}</style>
<div class=card><div class=tag>MOCK PREVIEW</div><h2>“${(s?.prompt ?? "your app").replace(/</g, "&lt;")}”</h2>
<p>This is the mock preview pane. With the real API, the agent's running app would render here via its <code>preview.url</code>.</p></div>`);
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return (res.writeHead(204), res.end());
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  let g;

  if (req.method === "GET" && (g = p.match(/^\/preview\/(.+)$/))) return previewPage(res, g[1]);
  if (req.method === "POST" && p === "/v3/agents") return json(res, { id: "agt_mock", name: "app-builder", runtime: "claude" });
  if (req.method === "GET" && p === "/v3/sessions") {
    const data = [...sessions.values()].map((s) => ({ id: s.id, status: s.status, created_at: s.created_at })).reverse();
    return json(res, { data });
  }
  if (req.method === "POST" && p === "/v3/sessions") {
    const b = await readBody(req);
    const s = newSession(typeof b.input === "string" ? b.input : "an app");
    runBuild(s);
    return json(res, { session: { id: s.id, status: s.status, head: s.seq, input_cursor: 0 }, client_token: `ct_${s.id}` });
  }
  if ((g = p.match(/^\/v3\/sessions\/([^/]+)\/client-tokens$/)) && req.method === "POST")
    return json(res, { token: `ct_${g[1]}`, scopes: ["read", "steer"], expires_at: new Date(Date.now() + 3600e3).toISOString() });
  if ((g = p.match(/^\/v3\/sessions\/([^/]+)\/events$/)) && req.method === "GET") return sse(req, res, g[1], url);
  if ((g = p.match(/^\/v3\/sessions\/([^/]+)\/messages$/)) && req.method === "POST") {
    const s = sessions.get(g[1]);
    if (!s) return json(res, { error: "not found" }, 404);
    const b = await readBody(req);
    const text = b.text ?? b.envelope?.text ?? "";
    const ev = append(s, m("user.message", "user", A.human, { text }));
    runChange(s, text);
    return json(res, { event: { id: ev.id, seq: ev.seq }, session: { id: s.id, status: s.status, head: s.seq } }, 202);
  }
  return json(res, { error: `mock: no route for ${req.method} ${p}` }, 404);
});

server.listen(PORT, () => {
  console.log(`\n  mock OpenComputer  →  http://localhost:${PORT}`);
  console.log(`  point the app at it:  OC_API_URL=http://localhost:${PORT}  NEXT_PUBLIC_OC_API_URL=http://localhost:${PORT}\n`);
});

"use client";

import { useEffect, useRef, useState } from "react";

// The browser talks to OpenComputer DIRECTLY — streaming and steering — using a
// short-lived client token from our /api routes. The org key never reaches here.
const OC = process.env.NEXT_PUBLIC_OC_API_URL ?? "https://api.opencomputer.dev";

type Ev = { id: string; seq: number; type: string; level: string; body?: any };
type Project = { id: string; status: string; created_at?: string };
type Status = "idle" | "connecting" | "live" | "reconnecting";

const EXAMPLES = [
  "Build a todo app with a clean dark UI and local storage.",
  "Make a markdown notes app with a live preview pane.",
  "Build a pomodoro timer with start/pause/reset and a circular progress ring.",
];

const titleKey = (id: string) => `ab:title:${id}`;
function getTitle(id: string) {
  try { return localStorage.getItem(titleKey(id)) || "Untitled app"; } catch { return "Untitled app"; }
}

export default function Page() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [newText, setNewText] = useState("");
  const [steer, setSteer] = useState("");
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const tokenRef = useRef<string>("");
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadProjects();
    const id = new URLSearchParams(window.location.search).get("p");
    if (id) open(id);
    return () => esRef.current?.close();
  }, []);

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }); }, [events]);

  async function loadProjects() {
    try {
      const list = await (await fetch("/api/projects")).json();
      if (Array.isArray(list)) setProjects(list);
    } catch { /* offline / not configured — sidebar just stays empty */ }
  }

  async function open(id: string) {
    setSelected(id);
    setEvents([]);
    setStatus("connecting");
    history.replaceState(null, "", `?p=${id}`);
    const { token, error } = await (await fetch(`/api/projects/${id}/token`, { method: "POST" })).json();
    if (error) return setStatus("idle");
    openStream(id, token);
  }

  function openStream(id: string, token: string) {
    esRef.current?.close();
    tokenRef.current = token;
    // level=internal → every build step: tool calls + commands as cards, plus the
    // agent's messages and your steers. after=0 replays the full log on open (the whole
    // conversation); each event's seq is the SSE id, so EventSource auto-resumes on reconnect.
    const es = new EventSource(`${OC}/v3/sessions/${id}/events?stream=sse&level=internal&after=0&token=${token}`);
    es.onopen = () => setStatus("live");
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as Ev;
      setEvents((prev) => (prev.some((p) => p.id === ev.id) ? prev : [...prev, ev]));
    };
    es.onerror = () => setStatus("reconnecting"); // retries via Last-Event-ID
    esRef.current = es;
  }

  async function create() {
    const input = newText.trim();
    if (!input || starting) return;
    setStarting(true);
    try {
      const { id, token, error } = await (
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input }),
        })
      ).json();
      if (error) return alert(error);
      try { localStorage.setItem(titleKey(id), input.slice(0, 48)); } catch {}
      setProjects((p) => [{ id, status: "queued" }, ...p]);
      setNewText("");
      setSelected(id);
      setEvents([]);
      setStatus("connecting");
      history.replaceState(null, "", `?p=${id}`);
      openStream(id, token);
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    const text = steer.trim();
    if (!text || !selected) return;
    setSteer("");
    await fetch(`${OC}/v3/sessions/${selected}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenRef.current}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  function newProject() {
    esRef.current?.close();
    setSelected(null);
    setEvents([]);
    setStatus("idle");
    history.replaceState(null, "", window.location.pathname);
  }

  function share() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">app<span className="accent">·</span>builder</div>
        <button className="newbtn" onClick={newProject}>+ New project</button>
        <div className="projects">
          {projects.length === 0 && <div className="empty-projects">No projects yet.</div>}
          {projects.map((p) => (
            <div key={p.id} className={`proj ${selected === p.id ? "active" : ""}`} onClick={() => open(p.id)}>
              <span className={`dot ${p.status}`} />
              <span className="name">{getTitle(p.id)}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        {selected ? (
          <>
            <div className="topbar">
              <span className="title">{getTitle(selected)}</span>
              <span className="status">
                <span className={`dot ${status}`} /> {status}
              </span>
              <button className="share" onClick={share}>{copied ? "copied ✓" : "share"}</button>
            </div>
            <div className="feed" ref={feedRef}>
              {events.map((ev) => <EventItem key={ev.id} ev={ev} />)}
              {events.length === 0 && <div className="note">waiting for the agent’s first step…</div>}
            </div>
            <div className="composer">
              <input
                placeholder="ask for a change — e.g. “add a dark-mode toggle”"
                value={steer}
                onChange={(e) => setSteer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button className="go" onClick={send} disabled={!steer.trim()}>Send</button>
            </div>
          </>
        ) : (
          <div className="hero">
            <h1>What do you want to build?</h1>
            <p>Describe an app. An agent builds it in a real sandbox on OpenComputer as a
              durable project — come back to it any time, and keep chatting to change it.</p>
            <textarea
              rows={3}
              placeholder="e.g. a todo app with a clean dark UI and local storage"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && create()}
            />
            <div className="examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="example" onClick={() => setNewText(ex)}>{ex}</button>
              ))}
            </div>
            <div className="row">
              <button className="go" onClick={create} disabled={!newText.trim() || starting}>
                {starting ? "starting…" : "Build it  ⌘↵"}
              </button>
            </div>
          </div>
        )}
      </main>

      <aside className="preview">
        <div className="bar">PREVIEW</div>
        <Preview events={events} />
      </aside>
    </div>
  );
}

// The preview seam: when the platform exposes the sandbox's dev server it emits a
// `preview.url` event — we just iframe whatever URL it carries. Until that ships,
// show a placeholder. (See the repo design doc on preview reconciliation.)
function Preview({ events }: { events: Ev[] }) {
  const url = [...events].reverse().find((e) => e.type === "preview.url")?.body?.url;
  if (url) return <iframe className="frame" src={url} title="app preview" />;
  return (
    <div className="preview-empty">
      <div className="preview-badge">LIVE PREVIEW</div>
      <p>Your running app will appear here.</p>
      <p className="dim">Live preview URLs from the session’s sandbox are coming soon.</p>
    </div>
  );
}

// Render one event as a build-trace item. Switch on `type` — never parse prose.
// The trace shows what the agent actually does: its narration, the commands it runs,
// and their output. (The model's private reasoning is not surfaced by the API.)
function EventItem({ ev }: { ev: Ev }) {
  const b = ev.body ?? {};
  switch (ev.type) {
    case "user.message":
      return <div className="bubble you">{b.text}</div>;
    case "agent.message":
      // user-level = an answer / result (bubble); progress = the model narrating its work
      return ev.level === "user"
        ? <div className="bubble agent">{b.text}</div>
        : <div className="narrate">{b.text}</div>;
    case "tool.call":
      return <div className="cmd"><span className="prompt">$</span>{b.args_summary || b.tool || "tool"}</div>;
    case "exec.completed": {
      const ok = Number(b.exit_code) === 0;
      return (
        <div className="exec">
          <div className="exec-head">
            <span className={`exit ${ok ? "ok" : "bad"}`}>exit {b.exit_code}</span>
            {b.content_ref && <span className="ref">large output{b.bytes ? ` · ${b.bytes}B` : ""}</span>}
          </div>
          {b.summary ? <pre className="exec-out">{b.summary}</pre> : null}
        </div>
      );
    }
    case "turn.started":
      return <div className="sep">● working…</div>;
    case "turn.completed":
      return <div className={`sep ${b.yield_reason === "needs_input" ? "" : "done"}`}>
        {b.yield_reason === "needs_input" ? "✋ waiting for you" : "✓ done"}
      </div>;
    case "agent.result":
      return b.num_turns ? <div className="sep">finished · {b.num_turns} steps</div> : null;
    default:
      if (ev.type.startsWith("error"))
        return <div className="err">{b.code ?? ev.type}: {b.message ?? ""}</div>;
      return b.text || b.summary ? <div className="narrate">{b.text ?? b.summary}</div> : null;
  }
}

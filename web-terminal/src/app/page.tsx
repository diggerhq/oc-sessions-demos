"use client";

import { useEffect, useRef, useState } from "react";

// The browser talks to OpenComputer DIRECTLY — streaming and steering — using a
// short-lived client token from our /api routes. The org key never reaches here.
const OC = process.env.NEXT_PUBLIC_OC_API_URL ?? "https://api.opencomputer.dev";

type Ev = { id: string; seq: number; type: string; level: string; body?: any };
type Status = "idle" | "connecting" | "live" | "reconnecting";

const EXAMPLES = [
  "Clone https://github.com/pallets/flask, run its test suite, and tell me what (if anything) is failing.",
  "Write a Python script that prints the first 25 primes, run it, and show the output.",
  "Clone a small public repo of your choice and summarize its architecture in 5 bullets.",
];

export default function Page() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [task, setTask] = useState("");
  const [steer, setSteer] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const tokenRef = useRef<string>("");
  const feedRef = useRef<HTMLDivElement | null>(null);

  // Resume from a shared link (?s=<sessionId>) on load — the durable log replays.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("s");
    if (id) resume(id);
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [events]);

  async function resume(id: string) {
    setSessionId(id);
    setStatus("connecting");
    const r = await fetch(`/api/sessions/${id}/token`, { method: "POST" });
    const { token, error } = await r.json();
    if (error) return setStatus("idle");
    openStream(id, token);
  }

  function openStream(id: string, token: string) {
    esRef.current?.close();
    tokenRef.current = token;
    // level=progress → the agent's work updates + its user-facing messages.
    // Each event's seq is the SSE id, so EventSource auto-resumes on reconnect.
    const es = new EventSource(
      `${OC}/v3/sessions/${id}/events?stream=sse&level=progress&token=${token}`,
    );
    es.onopen = () => setStatus("live");
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as Ev;
      setEvents((prev) => (prev.some((p) => p.id === ev.id) ? prev : [...prev, ev]));
    };
    es.onerror = () => setStatus("reconnecting"); // EventSource retries via Last-Event-ID
    esRef.current = es;
  }

  async function start() {
    if (!task.trim() || starting) return;
    setStarting(true);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: task }),
      });
      const { id, token, error } = await r.json();
      if (error) return alert(error);
      history.replaceState(null, "", `?s=${id}`);
      setSessionId(id);
      setStatus("connecting");
      setEvents([]);
      openStream(id, token);
      setTask("");
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    const text = steer.trim();
    if (!text || !sessionId) return;
    setSteer("");
    await fetch(`${OC}/v3/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenRef.current}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }); // it echoes back over the stream as a user.message event
  }

  function share() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="app">
      <header className="header">
        <span className="brand">
          agent<span className="accent">::</span>terminal
        </span>
        <span className="spacer" />
        {sessionId && (
          <>
            <span className="status">
              <span className={`dot ${status}`} />
              {status}
            </span>
            <button className="share" onClick={share}>
              {copied ? "copied ✓" : "share"}
            </button>
          </>
        )}
      </header>

      {!sessionId ? (
        <div className="hero">
          <h1>Give an agent a task. Watch it work.</h1>
          <p>
            It runs in a real sandbox on OpenComputer as a durable session — close this
            tab and reopen the link, drop your wifi, walk away and come back: nothing is
            lost, and you can steer it at any time.
          </p>
          <textarea
            rows={3}
            placeholder="e.g. clone a public repo, run its tests, and tell me what broke"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && start()}
          />
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="example" onClick={() => setTask(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <div className="composer" style={{ border: "none", padding: 0 }}>
            <span className="spacer" />
            <button className="go" onClick={start} disabled={!task.trim() || starting}>
              {starting ? "starting…" : "Start  ⌘↵"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="feed" ref={feedRef}>
            {events.map((ev) => {
              const v = view(ev);
              return (
                <div key={ev.id} className={`row ${v.cls}`}>
                  <span className="tag">{v.tag}</span>
                  <span className="msg">{v.text}</span>
                </div>
              );
            })}
            {events.length === 0 && (
              <div className="row dim">
                <span className="tag" />
                <span className="msg">waiting for the agent’s first step…</span>
              </div>
            )}
          </div>
          <div className="composer">
            <input
              placeholder="steer the agent — e.g. “also check the CI config”"
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="go" onClick={send} disabled={!steer.trim()}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Map an event to how it renders. Switch on `type` — never parse prose.
function view(ev: Ev): { cls: string; tag: string; text: string } {
  const b = ev.body ?? {};
  switch (ev.type) {
    case "user.message":
      return { cls: "you", tag: "you", text: b.text ?? "" };
    case "agent.message":
      return { cls: ev.level === "user" ? "agent" : "dim", tag: "agent", text: b.text ?? "" };
    case "turn.started":
      return { cls: "dim", tag: "", text: "● working…" };
    case "turn.completed":
      return {
        cls: "badge",
        tag: "",
        text: b.yield_reason === "needs_input" ? "✋ waiting for you" : `✓ done (${b.yield_reason ?? "completed"})`,
      };
    case "exec.completed":
      return {
        cls: "mono",
        tag: "$",
        text: `${b.command ?? ""}\n  exit ${b.exit_code} · ${b.summary ?? ""}`.trim(),
      };
    case "tool.call":
      return { cls: "dim", tag: "", text: `↳ ${b.tool ?? "tool"} ${b.args_summary ?? ""}`.trim() };
    default:
      if (ev.type.startsWith("error"))
        return { cls: "err", tag: "error", text: `${b.code ?? ev.type}: ${b.message ?? ""}` };
      return { cls: "dim", tag: ev.type.split(".")[0], text: b.text ?? b.summary ?? ev.type };
  }
}

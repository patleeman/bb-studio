// Thread List: threads that need you first, then running ones. Click a row to
// open it in BB; the reply button sends a message without leaving the HUD.
import { html, render, useEffect, useState, Button, Input, cn } from "studio://kit/ui.js";

const studio = window.studio;
const RECENT_FAILURE_MS = 30 * 60_000;
const ACTIVE = new Set(["active", "starting"]);

function relevant(threads) {
  const now = Date.now();
  return threads.filter((t) =>
    t.status === "error" ? now - (t.updatedAt ?? 0) < RECENT_FAILURE_MS : t.needsYou || ACTIVE.has(t.status),
  );
}

function since(ms) {
  if (!ms) return "";
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

function Dot({ thread }) {
  const color = thread.status === "error" ? "bg-destructive" : thread.needsYou ? "bg-attention" : "bg-success animate-pulse";
  return html`<span className=${cn("inline-block size-2 shrink-0 rounded-full", color)} />`;
}

function Row({ thread }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const send = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    await studio.bb.threads.tell(thread.id, text.trim());
    setText("");
    setReplying(false);
  };
  return html`
    <li className="no-drag rounded-md px-2 py-1.5 hover:bg-state-hover">
      <div className="flex items-center gap-2">
        <${Dot} thread=${thread} />
        <button className="min-w-0 flex-1 truncate text-left text-sm text-foreground" onClick=${() => studio.bb.open(thread.id)}>
          ${thread.title}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">${since(thread.updatedAt)}</span>
        ${thread.needsYou &&
        html`<${Button} variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick=${() => setReplying(!replying)}>Reply<//>`}
      </div>
      ${replying &&
      html`<form className="mt-1.5 flex gap-1.5" onSubmit=${send}>
        <${Input} autoFocus value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Reply…" className="h-7 text-xs" />
        <${Button} size="sm" className="h-7 text-xs" type="submit">Send<//>
      </form>`}
    </li>
  `;
}

function Hud() {
  const [threads, setThreads] = useState(null);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    studio.bb.threads.list().then(setThreads, () => (setConnected(false), setThreads([])));
    const offs = [
      studio.on("bb:threads", (list) => (setConnected(true), setThreads(list))),
      studio.on("bb:connected", () => setConnected(true)),
      studio.on("bb:disconnected", () => setConnected(false)),
      studio.on("shortcut:toggle", () => studio.window.toggle("main")),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Notify once when a thread starts needing you.
  useEffect(() => {
    if (!threads) return;
    const seen = new Set(JSON.parse(sessionStorage.getItem("needsYou") ?? "[]"));
    for (const t of threads) if (t.needsYou && !seen.has(t.id) && seen.size) studio.notify({ title: "A thread needs you", body: t.title }).catch(() => {});
    sessionStorage.setItem("needsYou", JSON.stringify(threads.filter((t) => t.needsYou).map((t) => t.id)));
  }, [threads]);

  const rows = relevant(threads ?? []);
  const waiting = rows.filter((t) => t.needsYou).length;
  const running = rows.filter((t) => !t.needsYou).length;

  return html`
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-background/95 text-foreground shadow-lg">
      <header className="drag flex items-center justify-between border-b border-border-hairline px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Threads</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          ${connected ? `${running} running · ${waiting} need you` : "BB not connected"}
        </span>
      </header>
      <ul className="flex-1 overflow-y-auto p-1">
        ${threads === null
          ? html`<li className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</li>`
          : rows.length
            ? rows.map((t) => html`<${Row} key=${t.id} thread=${t} />`)
            : html`<li className="px-2 py-1.5 text-xs text-muted-foreground">
                ${connected ? "Nothing running. All caught up." : "Start BB with the Studio Applets plugin installed."}
              </li>`}
      </ul>
    </div>
  `;
}

render(html`<${Hud} />`);

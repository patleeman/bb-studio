// Thread HUD: one BB thread floating above your work, with its live
// conversation and a composer. Alt+Shift+Space brings it to the pointer (or
// hides it when it has focus); Esc hides it. Enter sends: while the thread
// works, the message waits for the turn to end, and ⌘Enter steers it instead.
import { html, render, useEffect, useRef, useState, useCallback, Button, Icon, Textarea, cn } from "studio://kit/ui.js";

const studio = window.studio;
const ACTIVE = new Set(["active", "starting"]);
const FAST_MS = 1000;
const SLOW_MS = 4000;

function pickDefault(threads) {
  return threads.find((t) => t.needsYou && t.status !== "error") ?? threads.find((t) => ACTIVE.has(t.status)) ?? threads[0] ?? null;
}

/** Plain text with ``` fences shown as code. */
function Text({ text }) {
  const parts = text.split(/```[^\n]*\n?/);
  return html`${parts.map((part, i) =>
    i % 2
      ? html`<pre key=${i} className="my-1.5 overflow-x-auto rounded-md bg-surface-recessed p-2 font-mono text-xs">${part.replace(/\n$/, "")}</pre>`
      : html`<span key=${i} className="whitespace-pre-wrap">${part}</span>`,
  )}`;
}

function Item({ item }) {
  if (item.type === "user")
    return html`<div className="flex justify-end"><div className="max-w-[85%] rounded-lg bg-muted px-2.5 py-1.5 text-sm"><${Text} text=${item.text} /></div></div>`;
  if (item.type === "tool")
    return html`<div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
      <${Icon} name=${item.status === "running" ? "LoaderCircle" : "Wrench"} className=${cn("size-3 shrink-0", item.status === "running" && "animate-spin")} />
      <span className="truncate">${item.text}</span>
    </div>`;
  return html`<div className="text-sm leading-relaxed"><${Text} text=${item.text} /></div>`;
}

function Picker({ threads, current, onPick, onClose }) {
  return html`
    <div className="no-drag absolute inset-x-2 top-10 z-10 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
      ${threads.length === 0 && html`<div className="px-2 py-1.5 text-xs text-muted-foreground">No threads.</div>`}
      ${threads.map(
        (t) => html`<button
          key=${t.id}
          className=${cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover", t.id === current && "bg-state-active")}
          onClick=${() => (onPick(t.id), onClose())}
        >
          <${Dot} status=${t.status} needsYou=${t.needsYou} />
          <span className="min-w-0 flex-1 truncate">${t.title}</span>
        </button>`,
      )}
    </div>
  `;
}

function Dot({ status, needsYou }) {
  const color = status === "error" ? "bg-destructive" : needsYou ? "bg-attention" : ACTIVE.has(status) ? "bg-success animate-pulse" : "bg-muted-foreground/40";
  return html`<span className=${cn("inline-block size-2 shrink-0 rounded-full", color)} />`;
}

function Hud() {
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [view, setView] = useState(null);
  const [connected, setConnected] = useState(true);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const scroller = useRef(null);
  const composer = useRef(null);
  const pinnedToBottom = useRef(true);
  const lastStatus = useRef(null);

  // Thread list, and which thread to show: the saved one, else a sensible default.
  useEffect(() => {
    const apply = (list) => {
      setThreads(list);
      setConnected(true);
    };
    studio.bb.threads.list().then(async (list) => {
      apply(list);
      const saved = await studio.storage.get("threadId");
      setThreadId(list.some((t) => t.id === saved) ? saved : pickDefault(list)?.id ?? null);
    }, () => setConnected(false));
    const offs = [
      studio.on("bb:threads", apply),
      studio.on("bb:connected", () => setConnected(true)),
      studio.on("bb:disconnected", () => setConnected(false)),
      studio.on("shortcut:summon", async () => {
        if (await studio.window.isFocused("main")) studio.window.hide("main");
        else {
          await studio.window.summon("main");
          composer.current?.focus();
        }
      }),
      studio.on("window:focus", () => composer.current?.focus()),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") picking ? setPicking(false) : studio.window.hide("main");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  // The conversation: fast while the thread works, slower while it's idle.
  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      const next = await studio.bb.threads.timeline(threadId, 60);
      setView(next);
      setConnected(true);
      const wasActive = ACTIVE.has(lastStatus.current);
      lastStatus.current = next.thread.status;
      if (wasActive && !ACTIVE.has(next.thread.status) && !(await studio.window.isFocused("main")))
        studio.notify({ title: next.thread.status === "error" ? "Thread failed" : "Thread finished", body: next.thread.title }).catch(() => {});
    } catch (cause) {
      if (cause.code === "bb_unavailable") setConnected(false);
      else setError(cause.message);
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    studio.storage.set("threadId", threadId);
    lastStatus.current = null;
    setView(null);
    pinnedToBottom.current = true;
    let stopped = false;
    let timer;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, ACTIVE.has(lastStatus.current) ? FAST_MS : SLOW_MS);
    };
    loop();
    return () => ((stopped = true), clearTimeout(timer));
  }, [threadId, refresh]);

  // Stay at the bottom as messages arrive, unless you scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [view]);

  const send = async (mode) => {
    const text = draft.trim();
    if (!text || !threadId) return;
    setDraft("");
    setError(null);
    pinnedToBottom.current = true;
    try {
      await studio.bb.threads.tell(threadId, text, { mode });
      refresh();
    } catch (cause) {
      setDraft(text);
      setError(cause.message);
    }
  };

  const thread = view?.thread ?? threads.find((t) => t.id === threadId) ?? null;
  const working = thread && ACTIVE.has(thread.status);

  return html`
    <div className="relative flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl">
      <header className="drag flex h-10 shrink-0 items-center gap-2 border-b border-border-hairline px-2.5">
        ${thread && html`<${Dot} status=${thread.status} needsYou=${thread.needsYou} />`}
        <button className="no-drag flex min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium" onClick=${() => setPicking(!picking)}>
          <span className="truncate">${connected ? (thread?.title ?? "Pick a thread") : "BB not connected"}</span>
          <${Icon} name="ChevronDown" className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
        ${thread &&
        html`<${Button} variant="ghost" size="icon" className="no-drag size-7" title="Open in BB" onClick=${() => studio.bb.open(thread.id)}>
          <${Icon} name="ExternalLink" />
        <//>`}
        <${Button} variant="ghost" size="icon" className="no-drag size-7" title="Hide (Esc)" onClick=${() => studio.window.hide("main")}>
          <${Icon} name="X" />
        <//>
      </header>

      ${picking && html`<${Picker} threads=${threads} current=${threadId} onPick=${setThreadId} onClose=${() => setPicking(false)} />`}

      <main
        ref=${scroller}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
        onScroll=${(e) => (pinnedToBottom.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}
      >
        ${!threadId && html`<p className="text-xs text-muted-foreground">${connected ? "No threads yet." : "Start BB with the Studio Applets plugin installed."}</p>`}
        ${threadId && !view && connected && html`<p className="text-xs text-muted-foreground">Loading…</p>`}
        ${view?.items.map((item) => html`<${Item} key=${item.id} item=${item} />`)}
        ${working && html`<div className="flex items-center gap-1.5 text-xs text-muted-foreground"><${Icon} name="LoaderCircle" className="size-3 animate-spin" /> Working…</div>`}
      </main>

      ${view?.waitingOnYou &&
      html`<div className="mx-2 mb-2 flex items-center gap-2 rounded-md bg-surface-attention px-2.5 py-1.5 text-xs">
        <span className="flex-1">The thread is waiting for your answer.</span>
        <${Button} size="sm" variant="outline" className="h-6 px-2 text-xs" onClick=${() => studio.bb.open(threadId)}>Answer in BB<//>
      </div>`}

      <form className="shrink-0 border-t border-border-hairline p-2" onSubmit=${(e) => (e.preventDefault(), send("queue"))}>
        <div className="flex items-end gap-1.5">
          <${Textarea}
            ref=${composer}
            rows=${1}
            value=${draft}
            disabled=${!threadId}
            placeholder=${working ? "Message (waits for the turn, ⌘Enter steers)" : "Message"}
            className="max-h-36 min-h-9 resize-none text-sm"
            onInput=${(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown=${(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(e.metaKey || e.ctrlKey ? "steer" : "queue");
              }
            }}
          />
          ${working
            ? html`<${Button} type="button" variant="outline" size="icon" className="size-9 shrink-0" title="Stop" onClick=${() => studio.bb.threads.stop(threadId).then(refresh)}>
                <${Icon} name="Square" />
              <//>`
            : html`<${Button} type="submit" size="icon" className="size-9 shrink-0" title="Send (Enter)" disabled=${!draft.trim()}>
                <${Icon} name="ArrowUp" />
              <//>`}
        </div>
        ${error && html`<p className="mt-1 text-xs text-destructive-text">${error}</p>`}
      </form>
    </div>
  `;
}

render(html`<${Hud} />`);

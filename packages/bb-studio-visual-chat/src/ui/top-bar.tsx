// The canvas's header. On the page in BB's main view it is a faint bar: the
// chat picker and New chat. In a window of its own it is the window's title
// bar: one draggable row (canvas.css .canvas-titlebar) that starts after the
// macOS traffic lights, with the chat picker, "Open thread in BB", New chat
// and "?" (the window's shortcuts, src/ui/shortcuts.ts). The model is in the
// composer's row only (route.tsx).
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { canvasContract } from "../contract";
import type { CanvasMeta, CanvasView } from "../shared";
import { CanvasNavContext } from "./nav";
import { handleSearchEscape, isMac, shortcutRows, windowAction } from "./shortcuts";
import { cn, Icon } from "./studio";

/** Room for the macOS traffic lights in a hidden-inset title bar (about 72px wide), plus a gap. */
export const TRAFFIC_LIGHTS_INSET = 78;

/** The chats the picker lists: the latest dozen, or those whose title holds the search text. */
export function matchingChats<Chat extends Pick<CanvasMeta, "title">>(list: readonly Chat[], query: string): Chat[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list.slice(0, 12);
  return list.filter((chat) => words.every((word) => chat.title.toLowerCase().includes(word))).slice(0, 30);
}

const BAR_BUTTON = "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-foreground/5 hover:text-foreground";

export function TopBar({ canvas }: { canvas: CanvasView | null }) {
  const rpc = useRpc<typeof canvasContract>();
  const nav = useContext(CanvasNavContext);
  const win = nav.window ?? null;
  const mac = useMemo(() => isMac(), []);
  const [menu, setMenu] = useState<"chats" | "help" | null>(null);
  const [list, setList] = useState<CanvasMeta[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // The picker opens with an empty search, on the first chat.
  useEffect(() => {
    if (menu !== "chats") return;
    setQuery("");
    setActive(0);
  }, [menu]);
  useEffect(() => {
    if (menu !== "chats") return;
    let live = true;
    rpc.call("canvas.list", null).then(({ canvases }) => { if (live) setList(canvases as CanvasMeta[]); }, () => {});
    return () => { live = false; };
  }, [menu, rpc]);

  // An open menu closes on a click outside it and on Esc (the search field takes its own Esc first).
  useEffect(() => {
    if (!menu) return;
    const outside = (event: MouseEvent) => { if (!(event.target as HTMLElement | null)?.closest?.("[data-canvas-menu]")) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); setMenu(null); } };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("mousedown", outside); window.removeEventListener("keydown", escape); };
  }, [menu]);

  // The window's shortcuts. Only in a window of its own: in BB's main window these keys are BB's.
  const threadId = canvas?.threadId ?? null;
  useEffect(() => {
    if (!win) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const action = windowAction(event, mac);
      if (!action) return;
      event.preventDefault();
      if (action === "new-chat") { setMenu(null); nav.open(null); }
      else if (action === "switch-chat") { setMenu("chats"); search.current?.focus(); }
      else if (action === "focus-input") { setMenu(null); bar.current?.closest("[data-canvas-page]")?.querySelector<HTMLElement>("[data-canvas-input]")?.focus(); }
      else if (action === "open-thread") { if (threadId) nav.openThread?.(threadId); }
      else win.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [win, mac, nav, threadId]);

  const matches = useMemo(() => matchingChats(list ?? [], query), [list, query]);
  const openChat = (chat: CanvasMeta | undefined) => {
    if (!chat) return;
    setMenu(null);
    nav.open(chat.threadId);
  };
  const closeChats = () => { setMenu(null); trigger.current?.focus(); };
  const hint = (id: string) => (win ? ` (${shortcutRows(mac).find((row) => row.id === id)?.keys ?? ""})` : "");

  return (
    <div
      ref={bar}
      className={cn("relative z-20 flex shrink-0 items-center gap-1 text-sm text-muted-foreground", win ? "canvas-titlebar h-10 select-none pr-3" : "h-11 px-5")}
      style={win ? { paddingLeft: win.inset ? TRAFFIC_LIGHTS_INSET : 12 } : undefined}
      data-canvas-header={win ? "window" : "page"}
      data-canvas-inset={win?.inset ? "" : undefined}
    >
      <div className="relative flex min-w-0 shrink items-center" data-canvas-menu>
        <button ref={trigger} type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-foreground/5 hover:text-foreground" onClick={() => setMenu((value) => (value === "chats" ? null : "chats"))} aria-expanded={menu === "chats"} aria-haspopup="dialog" title={`Switch chat${hint("switch-chat")}`} data-canvas-chat-picker>
          <Icon name="GridView" className="size-3.5 shrink-0" />
          <span className="truncate">{canvas?.title ?? "New visual chat"}</span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0 opacity-60" />
        </button>
        {menu === "chats" ? (
          <div role="dialog" aria-label="Chats" className="absolute left-0 top-9 z-30 w-80 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg" data-canvas-chat-menu>
            <input
              ref={search}
              type="text"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={(event) => {
                if (handleSearchEscape(event, query, () => { setQuery(""); setActive(0); }, closeChats)) return;
                if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, Math.max(matches.length - 1, 0))); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
                else if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); openChat(matches[active]); }
              }}
              placeholder="Search chats…"
              aria-label="Search chats"
              className="mb-1 w-full rounded-md border border-border/70 bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/30"
              data-canvas-chat-search
              autoFocus
            />
            <div role="listbox" aria-label="Chats" className="max-h-[60vh] overflow-y-auto">
              {list === null ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p> : matches.length ? matches.map((each, index) => (
                <button key={each.id} role="option" aria-selected={index === active} type="button" className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-state-hover", index === active && "bg-state-hover", each.threadId === canvas?.threadId && "font-medium")} onMouseEnter={() => setActive(index)} onClick={() => openChat(each)} data-canvas-chat-option={each.threadId}>
                  <span className="min-w-0 flex-1 truncate">{each.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{each.itemCount} items</span>
                </button>
              )) : <p className="px-2 py-1.5 text-xs text-muted-foreground">{list.length ? "No chat matches." : "No chats yet."}</p>}
            </div>
          </div>
        ) : null}
      </div>
      {/* The model is in one place only, the composer's row (route.tsx), as in BB. */}
      <div className="min-w-2 flex-1" />
      {canvas && nav.openThread ? (
        <button type="button" className={BAR_BUTTON} title={`Open thread in BB${hint("open-thread")}`} onClick={() => nav.openThread!(canvas.threadId)} data-canvas-open-thread>
          <Icon name="ArrowUpRight" className="size-3.5" /> Open thread in BB
        </button>
      ) : null}
      <button type="button" className={BAR_BUTTON} title={`New chat${hint("new-chat")}`} onClick={() => nav.open(null)} data-canvas-new-chat>
        <Icon name="Plus" className="size-3.5" /> New chat
      </button>
      {win ? (
        <div className="relative flex shrink-0 items-center" data-canvas-menu>
          <button type="button" className="flex size-6 items-center justify-center rounded-full border border-border/70 text-xs hover:bg-foreground/5 hover:text-foreground" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" aria-haspopup="dialog" aria-expanded={menu === "help"} onClick={() => setMenu((value) => (value === "help" ? null : "help"))} data-canvas-help>
            ?
          </button>
          {menu === "help" ? (
            <div role="dialog" aria-label="Keyboard shortcuts" className="absolute right-0 top-9 z-30 w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg" data-canvas-help-menu>
              <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Keyboard shortcuts</p>
              <dl>
                {shortcutRows(mac).map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 px-1 py-1 text-sm" data-canvas-shortcut={row.id}>
                    <dt className="min-w-0 truncate">{row.label}</dt>
                    <dd className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">{row.keys}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// The Bot's own sidebar: a column inside its page (BB's sidebar is global and
// stays as it is). The bot on top (its main thread is the page), then the
// threads it started: Needs you, Running, Recurring, Recent, each started
// thread nested under the one that started it, and its earlier conversations.
// A sub-thread opens in the right panel's Threads tab. The header names the
// bot as one of a list so more kinds of bot can join it later.
import { Icon } from "@bb-studio/kit/ui";
import { ThreadTitle } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { BotActivityView, BotScheduledView, BotThreadView, BotView } from "../../contract";
import { BotAvatar, colorForName } from "./BotAvatar";
import { sidebarGroups, useStrip, type TreeNode } from "./workspace";

const LAYOUT_KEY = "studio.bot.sidebar";
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 252;
type Layout = { width: number; collapsed: boolean; closed: string[] };

function readLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    return {
      width: clampWidth(typeof raw?.width === "number" ? raw.width : SIDEBAR_DEFAULT),
      collapsed: raw?.collapsed === true,
      closed: Array.isArray(raw?.closed) ? raw.closed.filter((each): each is string => typeof each === "string") : ["earlier"],
    };
  } catch {
    return { width: SIDEBAR_DEFAULT, collapsed: false, closed: ["earlier"] };
  }
}
export const clampWidth = (width: number) => Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)));

function useLayout(): [Layout, (patch: Partial<Layout>) => void] {
  const [layout, setLayout] = useState(readLayout);
  const update = (patch: Partial<Layout>) => setLayout((current) => {
    const next = { ...current, ...patch };
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  return [layout, update];
}

const WORKING = new Set(["active", "starting", "stopping"]);
type Tone = "needs" | "running" | "waiting" | "failed" | "idle";
function toneOf(thread: BotThreadView): Tone {
  if (thread.needsYou) return "needs";
  if (WORKING.has(thread.status)) return "running";
  if (thread.status === "pending") return "waiting";
  if (/error|fail/.test(thread.status)) return "failed";
  return "idle";
}
const TONE_DOT: Record<Tone, string> = {
  needs: "bg-warning",
  running: "bg-success bot-pulse",
  waiting: "border border-muted-foreground/60",
  failed: "bg-destructive",
  idle: "bg-muted-foreground/35",
};
const TONE_LABEL: Record<Tone, string> = { needs: "Needs you", running: "Running", waiting: "Waiting to start", failed: "Failed", idle: "Done" };

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
function age(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}d`;
  return relative.format(-Math.round(minutes / 10080), "week").replace(/\s?ago$/, "");
}

export function BotSidebar({ bot, status, working, activity, earlier, onOpen }: {
  bot: NonNullable<BotView["bot"]>;
  status: string;
  working: boolean;
  activity: BotActivityView | null | undefined;
  /** Its earlier conversations, newest first. */
  earlier: string[];
  onOpen(threadId: string): void;
}) {
  const [layout, setLayout] = useLayout();
  const [strip] = useStrip(bot.id);
  const groups = sidebarGroups(activity);
  const color = bot.color ?? colorForName(bot.name);
  const surface = { "--bot-accent": color, background: `color-mix(in oklab, ${color} 4%, transparent)` } as CSSProperties;
  const toggle = (id: string) => setLayout({ closed: layout.closed.includes(id) ? layout.closed.filter((each) => each !== id) : [...layout.closed, id] });
  const active = strip.active;

  if (layout.collapsed) {
    return (
      <nav aria-label={`${bot.name} threads`} className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-border py-2" style={surface}>
        <button type="button" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground" aria-label="Show bot sidebar" title="Show sidebar" onClick={() => setLayout({ collapsed: false })}>
          <Icon name="PanelLeft" className="size-4" />
        </button>
        <span className="relative">
          <BotAvatar shape={bot.shape ?? null} color={bot.color ?? null} emoji={bot.avatar} size={26} working={working} />
          {groups.needsYou.length ? <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-background" aria-label="Needs you" /> : null}
        </span>
      </nav>
    );
  }

  const tree = (nodes: TreeNode[]) => <ThreadTree nodes={nodes} depth={0} active={active} onOpen={onOpen} />;
  return (
    <nav aria-label={`${bot.name} threads`} className="relative flex shrink-0 flex-col border-r border-border" style={{ ...surface, width: layout.width }}>
      <div className="flex h-8 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">Bots</span>
        <button type="button" className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground" aria-label="Hide bot sidebar" title="Hide sidebar" onClick={() => setLayout({ collapsed: true })}>
          <Icon name="PanelLeft" className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {/* The bot itself: its main thread is the page, so it is always the selected row. */}
        <div aria-current="page" data-testid="bot-main" className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5"
          style={{ background: "color-mix(in oklab, var(--bot-accent) 13%, transparent)" }}>
          <BotAvatar shape={bot.shape ?? null} color={bot.color ?? null} emoji={bot.avatar} size={28} working={working} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{bot.name}</span>
            <span className="truncate text-[11px] text-muted-foreground">{status}</span>
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {groups.needsYou.length ? (
            <Group id="needs" title="Needs you" closed={layout.closed} onToggle={toggle} badge={groups.needsYou.length}>
              {groups.needsYou.map((thread) => <Row key={thread.id} thread={thread} depth={0} active={active === thread.id} onOpen={onOpen} />)}
            </Group>
          ) : null}
          {groups.running.length ? <Group id="running" title="Running" closed={layout.closed} onToggle={toggle}>{tree(groups.running)}</Group> : null}
          {groups.recurring.length ? (
            <Group id="recurring" title="Recurring" closed={layout.closed} onToggle={toggle}>
              {groups.recurring.map((item) => <RecurringRow key={item.id} item={item} />)}
            </Group>
          ) : null}
          {groups.recent.length ? <Group id="recent" title="Recent" closed={layout.closed} onToggle={toggle}>{tree(groups.recent)}</Group> : null}
          {!groups.needsYou.length && !groups.running.length && !groups.recent.length ? (
            <p className="px-2 text-xs text-muted-foreground">Threads {bot.name} starts show up here.</p>
          ) : null}
          {earlier.length ? (
            <Group id="earlier" title="Earlier conversations" closed={layout.closed} onToggle={toggle}>
              {earlier.map((id) => (
                <button key={id} type="button" onClick={() => onOpen(id)} aria-current={active === id ? "true" : undefined}
                  className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground aria-[current]:bg-state-active aria-[current]:text-foreground">
                  <Icon name="Clock" className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate"><ThreadTitle threadId={id} /></span>
                </button>
              ))}
            </Group>
          ) : null}
        </div>
      </div>
      <ResizeHandle width={layout.width} onResize={(width) => setLayout({ width })} />
    </nav>
  );
}

function Group({ id, title, closed, onToggle, badge, children }: { id: string; title: string; closed: string[]; onToggle(id: string): void; badge?: number; children: ReactNode }) {
  const open = !closed.includes(id);
  return (
    <section aria-label={title} className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => onToggle(id)}
        className="group flex h-6 items-center gap-1 rounded-md px-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground">
        <span className="min-w-0 truncate">{title}</span>
        {badge ? <span className="rounded-full bg-warning/20 px-1.5 text-[10px] leading-4 text-foreground">{badge}</span> : null}
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3 opacity-0 group-hover:opacity-100" />
      </button>
      {open ? <div className="flex flex-col">{children}</div> : null}
    </section>
  );
}

function ThreadTree({ nodes, depth, active, onOpen }: { nodes: TreeNode[]; depth: number; active: string | null; onOpen(threadId: string): void }) {
  return (
    <ul className={depth ? "relative ml-[15px] border-l border-border/70 pl-1" : "flex flex-col"}>
      {nodes.map((node) => (
        <li key={node.thread.id}>
          <Row thread={node.thread} depth={depth} active={active === node.thread.id} onOpen={onOpen} />
          {node.children.length ? <ThreadTree nodes={node.children} depth={depth + 1} active={active} onOpen={onOpen} /> : null}
        </li>
      ))}
    </ul>
  );
}

function Row({ thread, active, onOpen }: { thread: BotThreadView; depth: number; active: boolean; onOpen(threadId: string): void }) {
  const tone = toneOf(thread);
  return (
    <button type="button" data-thread={thread.id} aria-current={active ? "true" : undefined} onClick={() => onOpen(thread.id)} title={thread.title}
      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-state-hover aria-[current]:bg-state-active">
      <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} role="img" aria-label={TONE_LABEL[tone]} />
      <span className={`min-w-0 flex-1 truncate ${tone === "idle" ? "text-muted-foreground" : ""}`}>{thread.title}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{age(thread.updatedAt)}</span>
    </button>
  );
}

function RecurringRow({ item }: { item: BotScheduledView }) {
  const next = item.nextRunAt ? new Date(item.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-2 text-[13px]" title={next ? `Next: ${next}` : undefined}>
      <Icon name="Repeat" className={`size-3.5 shrink-0 ${item.enabled ? "text-muted-foreground" : "text-muted-foreground/40"}`} />
      <span className={`min-w-0 flex-1 truncate ${item.enabled ? "" : "text-muted-foreground"}`}>{item.name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{item.enabled ? next ?? "on" : "off"}</span>
    </div>
  );
}

/** Drag the column's right edge; arrow keys work too. */
function ResizeHandle({ width, onResize }: { width: number; onResize(width: number): void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  useEffect(() => {
    if (live === null) return;
    const move = (event: PointerEvent) => { if (drag.current) setLive(clampWidth(drag.current.width + event.clientX - drag.current.x)); };
    const up = () => { drag.current = null; setLive((value) => { if (value !== null) onResize(value); return null; }); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [live !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const nav = handle.current?.parentElement;
    if (nav && live !== null) nav.style.width = `${live}px`;
  }, [live]);
  const handle = useRef<HTMLDivElement>(null);
  return (
    <div ref={handle} role="separator" aria-orientation="vertical" aria-label="Resize bot sidebar" aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={live ?? width} tabIndex={0}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none hover:bg-border/60 focus-visible:bg-ring/40"
      onPointerDown={(event) => { event.preventDefault(); drag.current = { x: event.clientX, width }; setLive(width); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(clampWidth(width - 16));
        else if (event.key === "ArrowRight") onResize(clampWidth(width + 16));
      }} />
  );
}

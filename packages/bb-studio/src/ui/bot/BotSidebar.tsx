// The Bots sidebar: Studio's thread list provider ("Bot (Studio)"), which
// replaces BB's thread list while the Bot page shows (threadListSwitch.ts).
// A "Bots" list: every Bot (the primary first), the selected one (the Bot
// page's route, selection.ts) expanded under it into the threads it started: Needs you, Running,
// Runners, Recurring, Recent (each nested under the thread that started it) and its
// earlier conversations. A sub-thread opens in the Bot page's Threads tab;
// the bot itself opens its main thread, the page.
import { Icon } from "@bb-studio/kit/ui";
import { openAppPath, usePathname } from "@bb-studio/kit/app";
import { ThreadTitle, useSdk, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { botPath, forBot, NEW_BOT_PATH, useBotSelection } from "./selection";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { BotActivityView, BotScheduledView, BotThreadView, BotView } from "../../contract";
import { useLive } from "../live";
import { openThreadPage, runningCount, statusLabel } from "./BotHome";
import { BOT_STYLES, BotAvatar, botProvider, colorForName } from "./BotAvatar";
import { isBotPath, syncThreadList } from "./threadListSwitch";
import { ImportBotDialog } from "./ImportBot";
import { RunnerSidebarRow, useOpenRunner, useRunners } from "./Runners";
import { sidebarGroups, useOpenSubThread, useStrip, type TreeNode } from "./workspace";

const LAYOUT_KEY = "studio.bot.sidebar";
type Layout = { closed: string[] };

function readLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    return { closed: Array.isArray(raw?.closed) ? raw.closed.filter((each): each is string => typeof each === "string") : ["earlier"] };
  } catch {
    return { closed: ["earlier"] };
  }
}

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

/**
 * The provider's component. Shown off the Bot page only by mistake (a reload
 * mid-switch, a second window): it puts BB's list back at once and shows a
 * quiet placeholder for that moment.
 */
export function BotThreadList({ onNavigate }: PluginThreadListProps) {
  const sdk = useSdk();
  const onBotPage = isBotPath(usePathname());
  useEffect(() => { if (!onBotPage) void syncThreadList(sdk, false); }, [sdk, onBotPage]);
  if (!onBotPage) return <p className="px-3 py-2 text-xs text-muted-foreground">Loading threads…</p>;
  return <BotsList onNavigate={onNavigate} />;
}

/**
 * Mounted in every window (an app overlay): sets BB's sidebar to the Bots list
 * when this window shows the Bot page and back when it leaves, and re-checks
 * when the window gains focus, so the window in use decides.
 */
export function BotListSwitcher() {
  const sdk = useSdk();
  const onBotPage = isBotPath(usePathname());
  useEffect(() => {
    const sync = () => void syncThreadList(sdk, onBotPage);
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, [sdk, onBotPage]);
  return null;
}

type BotSummary = NonNullable<BotView["bot"]>;

function BotsList({ onNavigate }: { onNavigate(): void }) {
  const { botId, creating } = useBotSelection();
  const list = useLive<{ bots: BotSummary[] }>("bot_list", {}, { pollMs: 30_000 });
  const view = useLive<BotView>("bot_get", forBot(botId), { pollMs: 30_000 });
  const bots = list.data?.bots ?? [];
  const selected = creating ? null : view.data?.bot ?? null;
  const [importing, setImporting] = useState(false);
  return (
    <nav aria-label="Bots" className="studio-root flex flex-col gap-0.5 px-1.5 pb-3">
      <style>{BOT_STYLES}</style>
      {/* New bot: BB's New thread row is hidden on the Bot page (threadListSwitch.ts). */}
      <div className="flex h-7 items-center gap-1 pl-2 text-[11px] font-medium text-muted-foreground">
        <span className="min-w-0 flex-1">Bots</span>
        <button type="button" aria-label="New bot" title="New bot" data-testid="bot-new" onClick={() => { openAppPath(NEW_BOT_PATH); onNavigate(); }}
          className="flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground"><Icon name="Plus" className="size-3.5" /></button>
        <button type="button" aria-label="Import bot" title="Import bot from an external agent" data-testid="bot-import" onClick={() => setImporting(true)}
          className="flex size-6 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground"><Icon name="Download" className="size-3.5" /></button>
      </div>
      {importing ? <ImportBotDialog onClose={() => setImporting(false)} /> : null}
      {creating && bots.length ? (
        <div aria-current="page" data-testid="bot-new-row" className="flex min-w-0 items-center gap-2.5 rounded-md bg-state-active px-2 py-1.5 text-sm">
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50"><Icon name="Plus" className="size-3" /></span>
          <span className="min-w-0 flex-1 truncate">New bot</span>
        </div>
      ) : null}
      {bots.length ? bots.map((bot) => bot.id === selected?.id
        ? <BotEntry key={bot.id} view={view.data!} onNavigate={onNavigate} />
        : <BotRow key={bot.id} bot={bot} onNavigate={onNavigate} />)
        : <p className="px-2 text-xs text-muted-foreground">{list.loading || view.loading ? "Loading…" : list.error ?? view.error ?? "No bot yet. Say hi to make one."}</p>}
    </nav>
  );
}

/** A Bot that isn't selected: one row that opens its page. */
function BotRow({ bot, onNavigate }: { bot: BotSummary; onNavigate(): void }) {
  return (
    <button type="button" data-testid="bot-row" data-bot={bot.id} title={bot.name}
      onClick={() => { openAppPath(botPath(bot.id, bot.primary !== false)); onNavigate(); }}
      className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-state-hover">
      <BotAvatar shape={bot.shape ?? null} color={bot.color ?? null} emoji={bot.avatar} size={22} provider={botProvider(bot)} />
      <span className="min-w-0 flex-1 truncate text-sm">{bot.name}</span>
      {bot.state !== "active" ? <span className="shrink-0 text-[11px] text-muted-foreground">{bot.state}</span> : null}
    </button>
  );
}

/** One bot: its row, and (it's the selected bot) its threads under it. */
function BotEntry({ view, onNavigate }: { view: BotView; onNavigate(): void }) {
  const bot = view.bot!;
  const activity = useLive<BotActivityView>("bot_activity", { botId: bot.id }, { pollMs: 15_000 });
  const chain = useLive<{ threadIds: string[] }>("bot_chain", { botId: bot.id }, { pollMs: 120_000 });
  const [layout, setLayout] = useLayout();
  const [strip] = useStrip(bot.id);
  const openSub = useOpenSubThread(bot.id, openThreadPage);
  const running = runningCount(activity.data);
  const status = statusLabel(view.run, bot.state, running);
  const groups = sidebarGroups(activity.data);
  const ids = chain.data?.threadIds ?? [];
  const earlier = bot.threadId && ids.at(-1) === bot.threadId ? ids.slice(0, -1).reverse() : [];
  const color = bot.color ?? colorForName(bot.name);
  const accent = { "--bot-accent": color } as CSSProperties;
  const toggle = (id: string) => setLayout({ closed: layout.closed.includes(id) ? layout.closed.filter((each) => each !== id) : [...layout.closed, id] });
  const active = strip.active;
  const onOpen = (threadId: string) => { openSub(threadId); onNavigate(); };
  const runners = useRunners(bot.id);
  const openRunner = useOpenRunner(bot.id, onOpen, () => { runners.refresh(); activity.refresh(); });
  const tree = (nodes: TreeNode[]) => <ThreadTree nodes={nodes} depth={0} active={active} onOpen={onOpen} />;

  return (
    <div className="flex flex-col" style={accent}>
      {/* The bot: its main thread is the Bot page. */}
      <button type="button" aria-current="page" data-testid="bot-main" title={`${bot.name}: ${status}`}
        onClick={() => { openAppPath(botPath(bot.id, bot.primary !== false)); onNavigate(); }}
        className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:brightness-110"
        style={{ background: "color-mix(in oklab, var(--bot-accent) 14%, transparent)" }}>
        <span className="relative shrink-0">
          <BotAvatar shape={bot.shape ?? null} color={bot.color ?? null} emoji={bot.avatar} size={28} working={running > 0} provider={botProvider(bot)} />
          {groups.needsYou.length ? <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-background" aria-label="Needs you" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{bot.name}</span>
          <span className="truncate text-[11px] text-muted-foreground">{status}</span>
        </span>
      </button>

      <div className="mt-2 ml-3 flex flex-col gap-2.5 border-l pl-1.5" style={{ borderColor: "color-mix(in oklab, var(--bot-accent) 35%, transparent)" }}>
        {groups.needsYou.length ? (
          <Group id="needs" title="Needs you" closed={layout.closed} onToggle={toggle} badge={groups.needsYou.length}>
            {groups.needsYou.map((thread) => <Row key={thread.id} thread={thread} depth={0} active={active === thread.id} onOpen={onOpen} />)}
          </Group>
        ) : null}
        {groups.running.length ? <Group id="running" title="Running" closed={layout.closed} onToggle={toggle}>{tree(groups.running)}</Group> : null}
        {runners.data?.runners.length ? (
          <Group id="runners" title="Runners" closed={layout.closed} onToggle={toggle}>
            {runners.data.runners.map((runner) => <RunnerSidebarRow key={runner.id} runner={runner} active={!!runner.threadId && active === runner.threadId} onOpen={openRunner} />)}
          </Group>
        ) : null}
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

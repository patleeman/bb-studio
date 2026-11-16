import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState } from "react";
import { toAppPathOf } from "../../kit/app/host-sdk";
import { usePathname } from "../../kit/app/route";
import { useComposerThread } from "../../kit/composer";
import { Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { TASKS_UNAVAILABLE, USER_OWNER, type Task } from "../../tasks/contract";
import { ownerShort, ownerThreadId, taskStatus } from "../../tasks/ui/model";
import { stepProgress, treeOf, type FlightNode } from "../../tasks/ui/board-model";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
import { FlightChildren, FlightGlyph, flightText, FoldToggle, useFold } from "../../tasks/ui/Flight";
import { TaskGlyph } from "../../tasks/ui/TaskCard";
import { openLoops, useLoopPeople } from "../../loops/ui/hooks";
import { ENDED_DETAIL } from "./model";
import { useCardsOnScreen } from "./on-screen";
import { revealCard } from "./reveal";
import { openLinkFromAnywhere } from "../../links/open";

export const COLLAPSED_KEY = "bb.studio.in-flight.collapsed";

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
}

function writeCollapsed(value: boolean): void {
  try { window.localStorage.setItem(COLLAPSED_KEY, String(value)); } catch { return; }
}

export function InFlightBanner() {
  const threadId = useComposerThread();
  return threadId ? <InFlight threadId={threadId} /> : null;
}

export function InFlight({ threadId }: { threadId: string }) {
  const flight = useLive("tasks.flight", { threadId }, { pollMs: 30_000 });
  const people = useLoopPeople();
  const call = useCall();
  const navigate = useBbNavigate();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [showDone, setShowDone] = useState(false);
  const [unfolded, toggleFold] = useFold();
  const [hidden, setHidden] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const onScreen = useCardsOnScreen();
  const nodes = useMemo(() => (flight.data ? treeOf(flight.data) : []), [flight.data]);
  const threads = flight.data?.threads ?? [];
  const names = { bot: people.botName, leads: people.leads, threads, botThreadId: people.botThreadId };
  const titles = new Map((flight.data?.tasks ?? []).map((t) => [t.id, t.title]));
  const titleOf = (id: string) => titles.get(id) ?? null;
  const visible = nodes.filter((node) => !onScreen.has(node.task.id) && hidden.get(node.task.id) !== node.task.updatedAt);
  const live = (node: FlightNode) => node.row.open && !node.task.stale;
  const rows = visible.some(live) ? visible : [];
  if (!flight.data && flight.error?.includes(TASKS_UNAVAILABLE)) return <p role="alert" data-testid="in-flight-error" className="px-3 py-1.5 text-xs text-destructive">{flight.error}</p>;
  if (!rows.length) return null;
  const open = rows.filter(live);
  const finished = rows.filter((node) => !live(node));
  const needs = open.filter((node) => node.row.needsYou).length;
  const running = open.filter((node) => node.task.state === "in_progress").length;
  const toggle = () => { setCollapsed(!collapsed); writeCollapsed(!collapsed); };
  const reveal = (task: Task) => {
    if (task.card) { revealCard({ id: task.id, threadId, messageSeq: task.card.messageSeq, pathname, toAppPath: toAppPathOf(navigate) }); return; }
    const owner = task.owner === USER_OWNER ? null : ownerThreadId(task.owner, people.botThreadId, threads);
    if (owner && owner !== threadId) navigate.toThread(owner);
    else if (task.workers[0] && task.workers[0] !== threadId) navigate.toThread(task.workers[0]);
    else openLoops(people.botId);
  };
  const openSub = (task: Task) => {
    if (task.card) { reveal(task); return; }
    void openLinkFromAnywhere(`bb://todo/${encodeURIComponent(task.id)}`, { source: "card", title: task.title });
  };
  const hide = (gone: readonly Task[]) => setHidden((before) => new Map([...before, ...gone.map((card) => [card.id, card.updatedAt] as const)]));
  const unhide = (gone: readonly Task[]) => setHidden((before) => new Map([...before].filter(([id]) => !gone.some((card) => card.id === id))));
  const dismiss = (card: Task) => {
    hide([card]);
    void call("work.dismiss", { id: card.id }).then(() => flight.refresh(), () => unhide([card]));
  };
  const clearDone = () => {
    const gone = finished.map((node) => node.task);
    hide(gone);
    setShowDone(false);
    void call("work.clear", { threadId }).then(() => flight.refresh(), () => unhide(gone));
  };
  const row = (node: FlightNode) => {
    const card = node.task;
    const text = flightText(node, names, now, titleOf);
    const status = taskStatus(card);
    const agent = card.owner !== USER_OWNER;
    const folded = unfolded.has(card.id);
    return (
      <li key={card.id} className="border-b border-border/35 last:border-b-0">
        <div className="group flex min-w-0 items-center">
          <button type="button" data-testid="in-flight-row" data-state={status.id} data-look={text.look} data-owner={card.owner} data-stale={card.stale || undefined} title={card.title} aria-label={text.aria} onClick={() => reveal(card)} className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 pl-3 pr-1 text-left text-xs transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none">
            <span className="flex w-3.5 shrink-0 justify-center">{card.stale ? <TaskGlyph glyph={status.glyph} stale label={status.label} /> : <FlightGlyph task={card} needsYou={node.row.needsYou} size={14} />}</span>
            <span className="min-w-0 max-w-[45%] shrink-0 truncate text-foreground">{card.title}</span>
            {agent ? <span data-testid="in-flight-owner" className="max-w-[25%] shrink-0 truncate text-muted-foreground">{ownerShort(card, names)}</span> : null}
            <span className="min-w-0 flex-1 truncate text-subtle-foreground">{text.line}</span>
            {text.look === "needs-you"
              ? <span data-testid="in-flight-needs-you" className="shrink-0 rounded bg-warning/15 px-1.5 py-px text-2xs font-medium text-warning">Needs you</span>
              : <span data-testid="in-flight-right" className={cn("shrink-0 text-2xs", text.look === "running" ? "text-foreground/80" : "text-subtle-foreground")} title={card.stale ? ENDED_DETAIL : undefined}>{card.stale || !node.row.open || text.look === "todo" ? status.label : text.look === "running" && !stepProgress(card.progress.step) ? status.label : capitalize(text.right)}</span>}
          </button>
          <FoldToggle node={node} open={folded} onToggle={() => toggleFold(card.id)} className="mr-0.5" />
          {card.card ? <button type="button" data-testid="in-flight-dismiss" aria-label={`Remove ${card.title} from In flight`} title="Remove from In flight" onClick={() => dismiss(card)} className="mr-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100">
            <Icon name="X" className="size-3" />
          </button> : <span className="mr-1.5 size-6 shrink-0" />}
        </div>
        {folded ? <FlightChildren node={node} names={names} now={now} titleOf={titleOf} onOpenTask={openSub} onOpenThread={(id) => navigate.toThread(id)} /> : null}
      </li>
    );
  };
  return (
    <div data-testid="in-flight" role="region" aria-label="In flight" className="min-w-0">
      <div className={cn("flex min-h-8 min-w-0 items-stretch text-xs text-foreground", !collapsed && "border-b border-border/35")}>
        <button type="button" aria-expanded={!collapsed} onClick={toggle} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 pl-3 pr-2 transition-colors hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none">
          <span className="font-normal">In flight</span>
          {needs ? <span data-testid="in-flight-needs" className="flex shrink-0 items-center gap-1 text-2xs text-warning"><span aria-hidden className="size-1.5 rounded-full bg-warning" />{needs} {needs === 1 ? "needs" : "need"} you</span> : null}
          {running ? <span data-testid="in-flight-running" className="shrink-0 text-2xs text-subtle-foreground">{running} running</span> : null}
          <span data-testid="in-flight-count" aria-label={`${open.length} open`} className="ml-auto shrink-0 text-2xs tabular-nums text-subtle-foreground">{open.length}</span>
          <Icon name={collapsed ? "ChevronUp" : "ChevronDown"} className="size-3 shrink-0 text-muted-foreground" />
        </button>
        {finished.length ? (
          <button type="button" data-testid="in-flight-clear" onClick={clearDone} className="shrink-0 cursor-pointer border-l border-border/35 px-3 text-2xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:outline-none">Clear done</button>
        ) : null}
      </div>
      {collapsed ? null : (
        <ul className="py-0.5">
          {open.map(row)}
          {finished.length ? (
            <li key="done" className="border-b border-border/35 last:border-b-0">
              <button type="button" data-testid="in-flight-done" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1 px-3 py-1 text-left text-2xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:outline-none">
                <span className="tabular-nums">{finished.length} done today</span>
                <Icon name={showDone ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0" />
              </button>
            </li>
          ) : null}
          {showDone ? finished.map(row) : null}
        </ul>
      )}
    </div>
  );
}

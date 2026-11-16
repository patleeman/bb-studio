import { useState, type MouseEvent, type ReactNode } from "react";
import { Icon, cn } from "../../kit/ui/index";
import { CARD_BUTTON, CARD_GHOST, CARD_PRIMARY, ChooseSheet, HandOffMenu } from "../../loops/ui/LoopMenus";
import { dueLabel, INLINE_OPTIONS, shortWhen } from "../../loops/ui/model";
import type { Loop } from "../../loops/contract";
import type { AreaView } from "../../areas/contract";
import { AreaCard, ownerThreadOf } from "../../areas/ui/AreaCard";
import { areaOrder } from "../../areas/ui/model";
import { needsYou, type Task } from "../contract";
import { useTaskActions } from "./actions";
import { countBelow, doneSummary, flightHeader, moreLine, todoHeader, todoShown, type FlightNode, type TodoBox } from "./board-model";
import { PageFlightRow, useFold } from "./Flight";
import { handOffTargets, ownerLabel, type Names, type ThreadName } from "./model";
import { TaskOutputs } from "./Outputs";

export const BOX = "flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card px-5 py-4";

export function BoxHead({ title, detail, id, aside }: { title: string; detail?: string | null; id: string; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-w-0 items-baseline gap-2">
      <h2 id={id} className="text-sm font-semibold text-foreground">{title}</h2>
      {detail ? <span data-testid="box-detail" className="min-w-0 truncate text-xs text-subtle-foreground">{detail}</span> : null}
      {aside ? <span className="ml-auto shrink-0">{aside}</span> : null}
    </div>
  );
}

export type ChatAsk = { id: string; text?: string | null; reason: string; createdAt: number };
type Open = (task: Task, event?: MouseEvent) => void;
const asLoop = (task: Task) => ({ id: task.id, title: task.title, options: task.options }) as unknown as Loop;

function AskActions({ task, targets, refresh }: { task: Task; targets: { owner: string; name: string }[]; refresh(): void }) {
  const { act, busy, error } = useTaskActions(refresh);
  const choose = (option: string) => void act({ id: task.id, action: "choose", option });
  const options = task.kind === "decide" ? task.options : [];
  return (
    <span data-testid="ask-actions" className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {options.length > INLINE_OPTIONS
        ? <ChooseSheet loop={asLoop(task)} disabled={busy} onChoose={choose} />
        : options.map((option, i) => <button key={option} type="button" data-testid="ask-option" disabled={busy} aria-label={`${option}: ${task.title}`} className={i === 0 ? CARD_PRIMARY : CARD_BUTTON} onClick={() => choose(option)}>{option}</button>)}
      {!options.length ? <button type="button" data-testid="ask-done" disabled={busy} aria-label={`${task.kind === "read" ? "Got it" : "Done"}: ${task.title}`} className={CARD_BUTTON} onClick={() => void act({ id: task.id, action: task.kind === "read" ? "got_it" : "done" })}>{task.kind === "read" ? "Got it" : "Done"}</button> : null}
      {targets.length ? <HandOffMenu targets={targets} disabled={busy} className={CARD_GHOST} label={`Hand off: ${task.title}`} onHandOff={(to) => void act({ id: task.id, action: "hand_off", to })} /> : null}
      {error ? <span role="alert" className="basis-full text-right text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

export function TodoBoxView({ box, chat, names, threads, targets, now, zone, query, onOpen, onOpenChat, refresh, adding }: {
  box: TodoBox;
  chat: readonly ChatAsk[];
  names: Names;
  threads: readonly ThreadName[];
  targets: { owner: string; name: string }[];
  now: number;
  zone?: string;
  query: boolean;
  onOpen: Open;
  onOpenChat: (() => void) | null;
  refresh(): void;
  adding?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = todoShown(box, chat.length, expanded);
  const more = moreLine(shown.moreToday, shown.moreLater);
  const empty = !box.asks.length && !box.today.length && !box.later.length && !chat.length;
  const sub = (task: Task) => {
    if (needsYou(task)) return [task.area ?? task.project, task.needs ?? (task.why || null)].filter(Boolean).join(" · ") || null;
    const due = dueLabel(task.timing.due, now, zone);
    return [task.area, due?.text].filter(Boolean).join(" · ") || null;
  };
  const askRow = (task: Task) => (
    <li key={task.id} data-testid="todo-ask" data-task-id={task.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/50 py-2 first:border-t-0">
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-warning bg-warning/15"><span className="size-1.5 rounded-full bg-warning" /></span>
      <button type="button" onClick={(event) => onOpen(task, event)} aria-label={`${task.title}, needs you${task.needs ? `: ${task.needs}` : ""}`} className="flex min-w-48 flex-1 basis-48 cursor-pointer flex-col rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate text-sm font-medium text-foreground">{task.title}</span>
        {sub(task) ? <span className="truncate text-xs text-subtle-foreground">{sub(task)}</span> : null}
      </button>
      <AskActions task={task} targets={handOffTargets(task, targets, threads, names.botThreadId ?? null)} refresh={refresh} />
    </li>
  );
  const chatRow = (ask: ChatAsk) => (
    <li key={ask.id} data-testid="todo-chat" className="flex min-w-0 items-center gap-3 border-t border-border/50 py-2 first:border-t-0">
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-warning bg-warning/15"><span className="size-1.5 rounded-full bg-warning" /></span>
      <button type="button" disabled={!onOpenChat} onClick={() => onOpenChat?.()} aria-label={`${ask.text ?? ask.reason}, a question in ${names.bot}'s chat`} className="flex min-w-0 flex-1 cursor-pointer flex-col rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate text-sm font-medium text-foreground">{ask.text ?? ask.reason}</span>
        <span className="truncate text-xs text-subtle-foreground">{names.bot} · {shortWhen(ask.createdAt, now, zone)}</span>
      </button>
    </li>
  );
  const ownRow = (task: Task) => <OwnTodo key={task.id} task={task} sub={sub(task)} onOpen={onOpen} refresh={refresh} />;
  return (
    <section aria-labelledby="tasks-todo-head" data-testid="tasks-todo" data-studio-card="" className={BOX}>
      <BoxHead id="tasks-todo-head" title="Your to-do" detail={todoHeader(box, chat.length)} />
      {adding}
      {empty ? <p data-testid="todo-empty" className="py-3 text-sm text-muted-foreground">{query ? "No to-dos match." : "Nothing for you right now."}</p> : null}
      <ul className="flex flex-col">
        {chat.map(chatRow)}
        {box.asks.slice(0, shown.asks).map(askRow)}
        {box.today.slice(0, shown.today).map(ownRow)}
      </ul>
      {expanded && box.later.length ? <>
        <h3 className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle-foreground">Later</h3>
        <ul data-testid="todo-later" className="flex flex-col">{box.later.map(ownRow)}</ul>
      </> : null}
      {more || expanded ? (
        <button type="button" data-testid="todo-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="mt-1 self-start rounded px-0.5 text-xs text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {expanded ? (more ?? "Show less") : more}
        </button>
      ) : null}
    </section>
  );
}

function OwnTodo({ task, sub, onOpen, refresh }: { task: Task; sub: string | null; onOpen: Open; refresh(): void }) {
  const { act, busy, error } = useTaskActions(refresh);
  const waiting = task.kind === "waiting-outside";
  return (
    <li data-testid="todo-own" data-task-id={task.id} className="flex min-w-0 flex-wrap items-center gap-x-3 border-t border-border/50 py-2 first:border-t-0">
      <button type="button" data-testid="todo-check" disabled={busy || waiting} aria-label={`Mark ${task.title} done`} onClick={() => void act({ id: task.id, action: task.kind === "read" ? "got_it" : "done" })}
        className="-mx-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
        <span className="size-4 rounded-full border-[1.5px] border-muted-foreground/80 hover:border-foreground" />
      </button>
      <button type="button" onClick={(event) => onOpen(task, event)} className="flex min-w-0 flex-1 cursor-pointer flex-col rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate text-sm text-foreground">{task.title}</span>
        {sub ? <span className="truncate text-xs text-subtle-foreground">{sub}</span> : null}
      </button>
      {error ? <p role="alert" data-testid="todo-error" className="basis-full pl-9 text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

export function PageInFlight({ nodes, names, now, titleOf, onOpen, onOpenThread, query }: { nodes: readonly FlightNode[]; names: Names; now: number; titleOf(id: string): string | null; onOpen: Open; onOpenThread(threadId: string): void; query: boolean }) {
  const [open, toggle] = useFold();
  return (
    <section aria-labelledby="tasks-flight-head" data-testid="tasks-flight" data-studio-card="" className={BOX}>
      <BoxHead id="tasks-flight-head" title="In flight" detail={flightHeader(nodes)} />
      {nodes.length ? (
        <ul className="flex flex-col">
          {nodes.map((node) => <PageFlightRow key={node.task.id} node={node} names={names} now={now} titleOf={titleOf} open={open.has(node.task.id)} onToggle={() => toggle(node.task.id)} onOpenTask={(task) => onOpen(task)} onOpenThread={onOpenThread} />)}
        </ul>
      ) : <p data-testid="flight-empty" className="py-3 text-sm text-muted-foreground">{query ? "Nothing in flight matches." : "Nothing in flight. Agents' work shows here while it runs or waits."}</p>}
    </section>
  );
}

export function AreasSection({ areas, error, flight, now, zone, query = false, onOpenTask, onOpenThread }: { areas: readonly AreaView[] | null; query?: boolean; error: string | null; flight: readonly FlightNode[]; now: number; zone?: string; onOpenTask(id: string, title: string): void; onOpenThread(threadId: string): void }) {
  const ordered = areas ? areaOrder(areas) : [];
  const problems = ordered.filter((a) => a.status === "broken" || a.status === "flagged").length;
  const workOf = (area: AreaView) => {
    const thread = area.owner.kind === "lead" ? ownerThreadOf(area) : null;
    if (!thread) return { live: false, workers: 0 };
    const mine = flight.filter((n) => n.row.home === thread || n.task.owner === `thread:${thread}`);
    return { live: mine.some((n) => n.task.state === "in_progress"), workers: mine.reduce((sum, n) => sum + countBelow(n).workers, 0) };
  };
  return (
    <section aria-labelledby="tasks-areas-head" data-testid="tasks-areas" className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 id="tasks-areas-head" className="text-sm font-semibold text-foreground">Areas</h2>
        {ordered.length ? <span className="text-xs text-subtle-foreground">{problems ? `${problems} need${problems === 1 ? "s" : ""} a look · problems first` : "all fine"}</span> : null}
      </div>
      {error && !areas ? <p role="alert" data-testid="areas-error" className="text-sm text-destructive">{error}</p> : null}
      {areas && !ordered.length ? <p data-testid="areas-empty" className="rounded-2xl border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">{query ? "No areas match." : "No areas yet. Each runner and project lead gets a card here once it reports how its part is doing."}</p> : null}
      {ordered.length ? (
        <div data-testid="areas-grid" className="grid grid-cols-1 gap-3.5 @2xl/bot-page:grid-cols-2 @5xl/bot-page:grid-cols-3">
          {ordered.map((area) => { const work = workOf(area); return <AreaCard key={area.id} area={area} now={now} zone={zone} live={work.live} workers={work.workers} onOpenTask={onOpenTask} onOpenOwner={onOpenThread} />; })}
        </div>
      ) : null}
    </section>
  );
}

export function DoneBar({ tasks, names, now, zone, query = false, onOpen }: { query?: boolean; tasks: readonly Task[]; names: Names; now: number; zone?: string; onOpen: Open }) {
  const [open, setOpen] = useState(false);
  const summary = doneSummary(tasks, now, zone);
  const nothing = summary.week === 0;
  return (
    <section aria-label="Done" data-testid="tasks-done" data-open={open} data-studio-card="" className={cn(BOX, "py-0")}>
      <button type="button" data-testid="done-toggle" aria-expanded={open} disabled={nothing} onClick={() => setOpen(!open)}
        className="flex min-h-12 min-w-0 cursor-pointer items-center gap-4 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
        <Icon name="Check" aria-hidden className="size-4 shrink-0 text-success" />
        <span className="shrink-0 text-sm font-semibold text-foreground">Done</span>
        <span data-testid="done-counts" className="shrink-0 text-xs text-muted-foreground">{nothing ? (query ? "Nothing done this week matches" : "Nothing done this week yet") : `${summary.today} today · ${summary.week} this week`}</span>
        <span data-testid="done-latest" className="min-w-0 flex-1 truncate text-xs text-subtle-foreground">{summary.latest.length ? `Latest: ${summary.latest.map((t) => t.title).join(" · ")}` : ""}</span>
        {nothing ? null : <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">{open ? "Hide" : "Show"}<Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3" /></span>}
      </button>
      {open ? (
        <div data-testid="done-week" className="flex flex-col gap-4 border-t border-border/60 pt-3 pb-4">
          {summary.groups.map((group) => (
            <section key={group.owner} aria-label={`Done by ${ownerLabel(group.owner, names)}`} data-testid="done-group" data-owner={group.owner}>
              <h3 className="mb-1 flex items-baseline gap-2 text-xs font-semibold text-muted-foreground">{ownerLabel(group.owner, names)}<span className="font-normal tabular-nums text-subtle-foreground">{group.tasks.length}</span></h3>
              <ul className="flex flex-col">
                {group.tasks.map(({ task, folded }) => {
                  const outputs = [...task.outputs, ...folded.flatMap((t) => t.outputs)].filter((o, i, all) => all.findIndex((x) => x.kind === o.kind && x.ref === o.ref) === i);
                  return (
                    <li key={task.id} data-testid="done-item" data-task-id={task.id} className="flex min-w-0 flex-col gap-1 border-t border-border/40 py-1.5 first:border-t-0">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <button type="button" onClick={(event) => onOpen(task, event)} className="min-w-0 flex-1 cursor-pointer truncate rounded text-left text-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{task.title}</button>
                        {folded.length ? <span className="shrink-0 text-xs text-subtle-foreground">with {folded.length} subtask{folded.length === 1 ? "" : "s"}</span> : null}
                        <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{task.closedAt ? shortWhen(task.closedAt, now, zone) : ""}</span>
                      </div>
                      <TaskOutputs outputs={outputs} source="botPage" />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}


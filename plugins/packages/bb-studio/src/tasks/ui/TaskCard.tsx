import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { remember } from "../../kit/app/directive-card";
import { CHAT_CARD_BODY, CHAT_CARD_SKELETON, ChatCard, ChatCardHeader, ChatCardIconButton } from "../../kit/app/chat-card";
import { relativeTime } from "../../kit/format";
import { Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { useTaskActions } from "./actions";
export { useTaskActions } from "./actions";
import { BotAvatar } from "../../ui/bot/BotAvatar";
import type { Loop } from "../../loops/contract";
import { CARD_BUTTON, CARD_GHOST, CARD_PRIMARY, ChooseSheet, HandOffMenu, OptionButton, SnoozeMenu } from "../../loops/ui/LoopMenus";
import { dueLabel, elapsed, INLINE_OPTIONS, shortWhen, triggerLabel } from "../../loops/ui/model";
import { useLoopPeople, useTodosZone, type LoopPeople } from "../../loops/ui/hooks";
import { useCardOnScreen } from "../../work/ui/on-screen";
import { isClosed, needsYou, TODO_ID, USER_OWNER, type Task } from "../contract";
import type { TaskView } from "../rpc-contract";
import { WORK_ID } from "../../work/shared";
import { everMine, handOffTargets, historyLines, isMine, ownerLabel, ownerThreadId, rowNumber, taskKind, taskStatus, type Glyph, type Names, type Tone } from "./model";

const STALE_MS = 3 * 86_400_000;

export const isTaskId = (id: string) => TODO_ID.test(id) || WORK_ID.test(id);

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  return now;
}

const TONE: Record<Tone, string> = { warning: "text-warning", destructive: "text-destructive", muted: "text-muted-foreground", default: "text-foreground", success: "text-success" };

export function TaskGlyph({ glyph, stale = false, label, className }: { glyph: Glyph; stale?: boolean; label: string; className?: string }) {
  if (stale) return <span role="img" aria-label="Ended without a final update" data-testid="state-ended" className={cn("flex shrink-0 items-center text-muted-foreground", className)}><Icon name="Check" aria-hidden className="size-3" /><span aria-hidden className="-ml-px text-[9px] font-semibold leading-none">?</span></span>;
  if (glyph === "running") return <span role="img" aria-label={label} className={cn("size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent motion-reduce:animate-none", className)} />;
  if (glyph === "waiting") return <Icon name="Clock" aria-label={label} className={cn("size-3 shrink-0 text-muted-foreground", className)} />;
  if (glyph === "needs-you") return <span role="img" aria-label={label} className={cn("size-2 shrink-0 rounded-full bg-warning", className)} />;
  if (glyph === "failed") return <Icon name="X" aria-label={label} className={cn("size-3 shrink-0 text-destructive", className)} />;
  if (glyph === "dropped") return <Icon name="X" aria-label={label} className={cn("size-3 shrink-0 text-muted-foreground", className)} />;
  if (glyph === "todo") return <span role="img" aria-label={label} className={cn("size-2.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground", className)} />;
  return <Icon name="Check" aria-label={label} className={cn("size-3 shrink-0 text-success", className)} />;
}

export function TaskDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const id = attributes.id ?? "";
  if (!isTaskId(id)) return null;
  const row = rowNumber(attributes.row);
  return <LiveTask id={id} row={row} threadId={message?.threadId ?? null} messageId={message?.id ?? null} />;
}

export function LiveTask({ id, row, threadId, messageId }: { id: string; row: number | null; threadId: string | null; messageId: string | null }) {
  const live = useLive("tasks.get", { id }, { pollMs: 120_000 });
  const call = useCall();
  const missing = !!live.error && /not found/i.test(live.error);
  const view = remember<TaskView>(`task:${id}`, missing ? null : (live.data ?? undefined));
  const people = useLoopPeople();
  const anchored = useRef(false);
  const task = view?.task;
  const unplaced = !!task?.card && !!threadId && !!messageId && task.conversation === threadId && task.card.messageSeq === null && task.card.messageId === null;
  useEffect(() => {
    if (!unplaced || anchored.current || !threadId || !messageId) return;
    anchored.current = true;
    void call("work.anchor", { id, threadId, messageId }).catch(() => {});
  }, [unplaced, call, id, threadId, messageId]);
  if (missing) return <div data-testid="task-missing" className="my-1 flex items-center gap-2 text-xs text-muted-foreground"><Icon name="Unavailable" className="size-3.5" />This task was removed.</div>;
  if (!view && live.error) return <p role="alert" data-testid="task-error" className="my-1 flex items-center gap-2 text-xs text-destructive"><Icon name="AlertCircle" className="size-3.5 shrink-0" />{live.error}</p>;
  if (!view) return row !== null ? <div className="h-8 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" /> : <div className={cn(CHAT_CARD_SKELETON, "h-28")} />;
  return row !== null ? <TaskRow view={view} people={people} refresh={live.refresh} /> : <TaskCardView view={view} people={people} refresh={live.refresh} chat />;
}


function useBotFace() {
  const bot = useLive("bot_get", {}, { pollMs: 120_000 }).data?.bot ?? null;
  return bot ? { shape: bot.shape ?? null, color: bot.color ?? null, emoji: bot.avatar } : null;
}

export function OwnerBadge({ owner, names, className }: { owner: string; names: Names; className?: string }) {
  const face = useBotFace();
  const name = ownerLabel(owner, names);
  const avatar = owner === "cos" && face
    ? <BotAvatar shape={face.shape} color={face.color} emoji={face.emoji} size={16} />
    : <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon name={owner === USER_OWNER ? "UserRound" : "Bot"} className="size-2.5" /></span>;
  return <span data-testid="task-owner" data-owner={owner} className={cn("inline-flex min-w-0 shrink-0 items-center gap-1.5", className)}>{avatar}<span className="truncate font-medium text-foreground">{name}</span></span>;
}

const asLoop = (task: Task) => ({ id: task.id, title: task.title, options: task.options }) as unknown as Loop;

export function TaskCardView({ view, people, refresh, chat = false, bare = false }: { view: TaskView; people: LoopPeople; refresh(): void; chat?: boolean; bare?: boolean }) {
  const { task, history, threads } = view;
  const navigate = useBbNavigate();
  const now = useNow();
  const zone = useTodosZone();
  const onScreen = useCardOnScreen(task.id);
  const { act, busy, error, note } = useTaskActions(refresh);
  const [showHistory, setShowHistory] = useState(false);
  const names: Names = { bot: people.botName, leads: people.leads, threads, botThreadId: people.botThreadId };
  const status = taskStatus(task);
  const kind = taskKind(task);
  const closed = isClosed(task);
  const mine = isMine(task);
  const open = !closed;
  const ownerThread = ownerThreadId(task.owner, people.botThreadId, threads);
  const workThread = task.workers[0] ?? (task.owner.startsWith("thread:") ? ownerThread : null);
  const threadToOpen = workThread ?? (task.owner === "cos" ? people.botThreadId : null);
  const openThread = threadToOpen ? () => navigate.toThread(threadToOpen) : undefined;
  const due = task.timing.due !== null ? dueLabel(task.timing.due, now, zone) : null;
  const trigger = open && mine && task.timing.trigger.type !== "none" && !due ? triggerLabel(task.timing.trigger, now, null, zone) : null;
  const step = open ? task.progress.step : null;
  const lines = historyLines(history, names);
  const targets = handOffTargets(task, people.targets, threads, people.botThreadId);
  const choose = (option: string) => void act({ id: task.id, action: "choose", option });
  const snooze = view.todo && mine && open && task.kind !== "waiting-outside"
    ? <SnoozeMenu disabled={busy} onSnooze={(preset) => void act({ id: task.id, action: "snooze", snooze: preset })} onPick={(at) => void act({ id: task.id, action: "snooze", at })} />
    : null;
  const handOff = open && targets.length ? <HandOffMenu targets={targets} disabled={busy} onHandOff={(to) => void act({ id: task.id, action: "hand_off", to })} /> : null;
  const done = (primary: boolean) => <button type="button" data-testid="task-done" className={primary ? CARD_PRIMARY : CARD_GHOST} disabled={busy} onClick={() => void act({ id: task.id, action: task.kind === "read" ? "got_it" : "done" })}><Icon name="CircleCheck" />{task.kind === "read" ? "Got it" : "Done"}</button>;
  const takeBack = <button type="button" data-testid="task-take-back" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: task.id, action: "take_back" })}><Icon name="ArrowTurnBackward" />{task.origin === "loop" || everMine(history) ? "Take back" : "Take over"}</button>;
  const openButton = openThread ? <button type="button" data-testid="task-open-thread" className={CARD_GHOST} onClick={openThread}><Icon name="MessageSquare" />{task.owner === "cos" && !task.workers.length ? "Open chat" : "Open thread"}</button> : null;
  let actions: ReactNode;
  if (closed) {
    actions = <>
      <button type="button" data-testid="task-undo" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: task.id, action: "reopen" })}><Icon name="ArrowTurnBackward" />Undo</button>
      {openButton}
    </>;
  } else if (mine) {
    const options = task.kind === "decide" && task.options.length
      ? (task.options.length > INLINE_OPTIONS ? <ChooseSheet loop={asLoop(task)} disabled={busy} onChoose={choose} /> : task.options.map((option) => <OptionButton key={option} option={option} disabled={busy} onChoose={() => choose(option)} />))
      : null;
    const nudge = view.todo && task.kind === "waiting-outside" ? <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: task.id, action: "nudge" })}><Icon name="BellDot" />Nudge them</button> : null;
    actions = <>
      {options ?? (task.kind === "waiting-outside" ? nudge : done(true))}
      {options || task.kind === "waiting-outside" ? done(false) : null}
      {snooze}
      {handOff}
      {openButton}
    </>;
  } else {
    actions = <>
      {openButton}
      {takeBack}
      {handOff}
      {done(false)}
    </>;
  }
  const stamp = closed && task.closedAt ? task.closedAt : task.updatedAt;
  return (
    <ChatCard ref={chat ? onScreen : undefined} data-testid="task-card" data-work-card-id={task.id} data-task-id={task.id} data-state={status.id} data-kind={task.kind} data-stale={task.stale || undefined}
      className={cn("studio-work-card", bare && "my-0")}>
      <ChatCardHeader icon={kind.icon} iconClassName={closed ? TONE[status.tone] : undefined} title={task.title} onOpen={openThread}
        meta={<>
          {kind.label}
          {step ? <> · <span data-testid="task-step">{step}</span></> : null}
          {due && open ? <> · <span className={due.urgent ? "text-warning" : undefined}>{due.text}</span></> : null}
          {trigger ? <> · <span data-testid="task-when">{trigger.text}</span></> : null}
          {task.priority === "urgent" && open ? <> · <span className="font-medium text-destructive">Urgent</span></> : null}
        </>}
        actions={<>
          <span className={cn("shrink-0 text-xs text-muted-foreground", !openThread && "pr-1.5")} title={new Date(stamp).toLocaleString()}>{relativeTime(stamp, now)}</span>
          {openThread ? <ChatCardIconButton icon="ArrowUpRight" label={`Open ${ownerLabel(task.owner, names)}`} onClick={openThread} /> : null}
        </>} />
      <div className={cn(CHAT_CARD_BODY, "flex flex-col gap-2 pt-0")}>
        {task.why ? <p data-testid="task-why" className="line-clamp-2 text-sm text-muted-foreground">{task.why}</p> : null}
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <OwnerBadge owner={task.owner} names={names} />
          <span aria-hidden className="text-muted-foreground">·</span>
          <TaskGlyph glyph={status.glyph} stale={status.stale} label={status.label} />
          <span data-testid="task-state" className={cn("shrink-0", TONE[status.tone])}>{status.stale ? "Ended without a final update" : status.label}</span>
          {task.progress.line ? <span data-testid="task-line" className="min-w-0 truncate text-muted-foreground">{task.progress.line}</span> : null}
        </div>
        {needsYou(task) && task.needs ? (
          <div data-testid="task-needs" className="rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-warning/5 px-2.5 py-1.5 text-sm text-foreground">{task.needs}</div>
        ) : null}
        <div data-testid="task-actions" className="flex flex-wrap items-center gap-1.5">
          {actions}
          {lines.length ? (
            <button type="button" data-testid="task-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)} className={cn(CARD_GHOST, "ml-auto")}>
              <Icon name={showHistory ? "ChevronDown" : "ChevronRight"} />History<span className="tabular-nums">{lines.length}</span>
            </button>
          ) : null}
        </div>
        {showHistory ? (
          <ol data-testid="task-history" className="flex flex-col gap-1 border-t border-border/70 pt-2 text-xs">
            {lines.slice(0, 20).map((line, i) => (
              <li key={`${line.at}-${i}`} className="flex min-w-0 items-baseline gap-2">
                <span className="w-16 shrink-0 tabular-nums text-subtle-foreground">{shortWhen(line.at, now, zone)}</span>
                <span className="min-w-0 text-muted-foreground">{line.text}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {view.todo && mine && open && now - task.updatedAt > STALE_MS ? (
          <div data-testid="task-review" className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2 text-xs text-muted-foreground">
            <Icon name="TimeSchedule" className="size-3.5" />No update in {elapsed(task.updatedAt, now)}. Still on it?
            <span className="ml-auto flex gap-1.5">
              <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: task.id, action: "keep" })}><Icon name="Check" />Keep</button>
              <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void act({ id: task.id, action: "drop" })}><Icon name="X" />Dismiss</button>
            </span>
          </div>
        ) : null}
        {note ? <p data-testid="task-note" className="text-xs text-muted-foreground">{note}</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>
    </ChatCard>
  );
}

export function TaskRow({ view, people, refresh }: { view: TaskView; people: LoopPeople; refresh(): void }) {
  const { task } = view;
  const [open, setOpen] = useState(false);
  const now = useNow();
  const zone = useTodosZone();
  const closed = isClosed(task);
  const status = taskStatus(task);
  const due = task.timing.due !== null ? dueLabel(task.timing.due, now, zone) : null;
  const names: Names = { bot: people.botName, leads: people.leads, threads: view.threads, botThreadId: people.botThreadId };
  const right = closed ? status.label
    : needsYou(task) ? status.label
      : !isMine(task) ? ownerLabel(task.owner, names)
        : task.kind === "decide" ? `${task.options.length} option${task.options.length === 1 ? "" : "s"}`
          : due?.text ?? (task.kind === "read" ? "Read" : "");
  const urgent = !closed && (needsYou(task) || !!due?.urgent);
  return (
    <div data-testid="task-row" data-task-id={task.id} data-state={status.id} className="w-full max-w-3xl">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="group flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-state-hover">
        <Icon name={closed ? "CircleCheck" : taskKind(task).icon} className={cn("size-4 shrink-0", closed ? "text-success" : "text-muted-foreground")} />
        <span className={cn("min-w-0 flex-1 truncate", closed ? "text-muted-foreground line-through" : "text-foreground")}>{task.title}</span>
        <span className={cn("shrink-0 text-xs", urgent ? "text-warning" : "text-muted-foreground")}>{right}</span>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>
      {open ? <div className="pt-1 pb-2"><TaskCardView view={view} people={people} refresh={refresh} bare /></div> : null}
    </div>
  );
}

import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { remember } from "../../kit/app/directive-card";
import { useNow } from "../../kit/app/visible-poll";
import { CHAT_CARD_BODY, CHAT_CARD_SKELETON, ChatCard, ChatCardHeader, ChatCardIconButton } from "../../kit/app/chat-card";
import { relativeTime } from "../../kit/format";
import { Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { TaskOutputs } from "./Outputs";
import { useNearScreen, useTaskView } from "./task-views";
import { BotAvatar } from "../../ui/bot/BotAvatar";
import { CARD_GHOST } from "../../loops/ui/LoopMenus";
import { dueLabel, fullWhen, shortWhen, triggerLabel } from "../../loops/ui/model";
import { useLoopPeople, useTodosZone, type LoopPeople } from "../../loops/ui/hooks";
import { isClosed, needsYou, TODO_ID, USER_OWNER, type Task } from "../contract";
import type { TaskView } from "../rpc-contract";
import { WORK_ID } from "../../work/shared";
import { SEVERITY_LABEL, severityTone, historyLines, isMine, ownerLabel, ownerShort, ownerThreadId, rowNumber, taskKind, taskStatus, type Glyph, type Names, type Tone } from "./model";


export const isTaskId = (id: string) => TODO_ID.test(id) || WORK_ID.test(id);

const useCardNow = () => useNow(60_000);

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
  const [nearRef, near] = useNearScreen();
  const live = useTaskView(id, near);
  const call = useCall();
  const missing = live.missing;
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
  // The wrapper is what useNearScreen watches: a card far off screen stays out of the reads.
  return <div ref={nearRef} data-task-card-slot="">{body()}</div>;
  function body() {
    if (missing) return <div data-testid="task-missing" className="my-1 flex items-center gap-2 text-xs text-muted-foreground"><Icon name="Unavailable" className="size-3.5" />This task was removed.</div>;
    if (!view && live.error) return <p role="alert" data-testid="task-error" className="my-1 flex items-center gap-2 text-xs text-destructive"><Icon name="AlertCircle" className="size-3.5 shrink-0" />{live.error}</p>;
    if (!view) return row !== null ? <div className="h-8 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" /> : <div className={cn(CHAT_CARD_SKELETON, "h-28")} />;
    return row !== null ? <TaskRow view={view} people={people} refresh={live.refresh} /> : <TaskCardView view={view} people={people} refresh={live.refresh} />;
  }
}


function useBotFace() {
  const bot = useLive("bot_get", {}, { pollMs: 120_000 }).data?.bot ?? null;
  return bot ? { shape: bot.shape ?? null, color: bot.color ?? null, emoji: bot.avatar } : null;
}

export function OwnerBadge({ owner, names, className, task }: { owner: string; names: Names; className?: string; task?: Pick<Task, "owner" | "title" | "kind" | "card"> }) {
  const face = useBotFace();
  const name = task ? ownerShort(task, names) : ownerLabel(owner, names);
  const avatar = owner === "cos" && face
    ? <BotAvatar shape={face.shape} color={face.color} emoji={face.emoji} size={16} />
    : <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon name={owner === USER_OWNER ? "UserRound" : "Bot"} className="size-2.5" /></span>;
  return <span data-testid="task-owner" data-owner={owner} className={cn("inline-flex min-w-0 shrink-0 items-center gap-1.5", className)}>{avatar}<span className="truncate font-medium text-foreground">{name}</span></span>;
}

/** A task's facts in its detail: what it is, where it belongs, who has it, when, and the thread it lives in. */
export function taskFacts(task: Task, names: Names, now: number, zone?: string): { label: string; value: string; testId: string }[] {
  const status = taskStatus(task);
  const due = task.timing.due !== null ? fullWhen(task.timing.due, now, zone) : null;
  return [
    { label: "Status", value: status.stale ? "Ended without a final update" : status.label, testId: "fact-status" },
    { label: "Kind", value: taskKind(task).label, testId: "fact-kind" },
    ...(task.area ? [{ label: "Area", value: task.area, testId: "fact-area" }] : []),
    ...(task.project && task.project !== task.area ? [{ label: "Project", value: task.project, testId: "fact-project" }] : []),
    { label: "Owner", value: ownerLabel(task.owner, names), testId: "fact-owner" },
    ...(due ? [{ label: "Due", value: due, testId: "fact-due" }] : []),
    { label: "Created", value: fullWhen(task.createdAt, now, zone), testId: "fact-created" },
    { label: "Updated", value: fullWhen(task.updatedAt, now, zone), testId: "fact-updated" },
    ...(task.closedAt ? [{ label: task.state === "dropped" ? "Dropped" : "Closed", value: fullWhen(task.closedAt, now, zone), testId: "fact-closed" }] : []),
  ];
}

/** The thread a task lives in: its worker, else the thread that owns it, else the conversation it started in (the Bot's chat for the Bot's own). */
export function linkedThread(task: Pick<Task, "owner" | "workers" | "conversation">, threads: TaskView["threads"], botThreadId: string | null, botName: string): { threadId: string; name: string } | null {
  const ownerThread = task.owner.startsWith("thread:") ? ownerThreadId(task.owner, botThreadId, threads) : null;
  const id = task.workers[0] ?? ownerThread ?? task.conversation ?? (task.owner === "cos" ? botThreadId : null);
  if (!id) return null;
  const named = threads.find((t) => t.threadId === id || t.owner === `thread:${id}`);
  return { threadId: id, name: named?.name ?? (id === botThreadId ? `${botName}'s chat` : "Thread") };
}

/**
 * One task, as a card. In a chat it is the task's card; in its detail (the
 * task's side-panel tab, which every task row on the Tasks page opens) it
 * also shows its notes in full, its facts and linked thread, and Drop and
 * Start work. `extra` adds actions the caller owns.
 */
export function TaskCardView({ view, people, bare = false, detail = false, extra }: { view: TaskView; people: LoopPeople; refresh(): void; bare?: boolean; detail?: boolean; extra?: ReactNode }) {
  const { task, history, threads } = view;
  const navigate = useBbNavigate();
  const now = useCardNow();
  const zone = useTodosZone();
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
  const recurring = task.automation?.role === "schedule";
  const found = task.automation?.role === "finding" && task.automation.count > 1 ? `Found ${task.automation.count} times` : null;
  const step = recurring ? task.schedule?.text ?? null : found ? null : open ? task.progress.step : null;
  const lines = historyLines(history, names);
  // Read-only (strands replaced tasks): an old ::work or ::loop card shows where it stands, with its thread to open.
  const openButton = openThread && !detail ? <button type="button" data-testid="task-open-thread" className={CARD_GHOST} onClick={openThread}><Icon name="MessageSquare" />{task.owner === "cos" && !task.workers.length ? "Open chat" : "Open thread"}</button> : null;
  const linked = detail ? linkedThread(task, threads, people.botThreadId, people.botName) : null;
  const actions: ReactNode = openButton;
  const stamp = closed && task.closedAt ? task.closedAt : task.updatedAt;
  return (
    <ChatCard data-testid="task-card" data-work-card-id={task.id} data-task-id={task.id} data-state={status.id} data-kind={task.kind} data-stale={task.stale || undefined}
      className={cn(bare && "my-0")}>
      <ChatCardHeader icon={kind.icon} iconClassName={closed ? TONE[status.tone] : undefined} title={detail ? <span data-testid="task-title" className="whitespace-normal [overflow-wrap:anywhere]">{task.title}</span> : task.title} onOpen={openThread}
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
        {task.why ? <p data-testid="task-why" className={cn("text-sm text-muted-foreground", detail ? "whitespace-pre-wrap text-foreground/90" : "line-clamp-2")}>{task.why}</p> : null}
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <OwnerBadge owner={task.owner} names={names} task={task} />
          <span aria-hidden className="text-muted-foreground">·</span>
          <TaskGlyph glyph={status.glyph} stale={status.stale} label={status.label} />
          <span data-testid="task-state" className={cn("shrink-0", TONE[status.tone])}>{status.stale ? "Ended without a final update" : status.label}</span>
          {found ? <span data-testid="task-found" className="shrink-0 text-muted-foreground">· {found}</span> : null}
          {task.automation?.severity && open ? <span data-testid="task-severity" className={cn("shrink-0 font-medium", TONE[severityTone(task.automation.severity)])}>· {SEVERITY_LABEL[task.automation.severity]}</span> : null}
          {task.progress.line ? <span data-testid="task-line" className="min-w-0 truncate text-muted-foreground">{task.progress.line}</span> : null}
        </div>
        <TaskOutputs outputs={task.outputs} />
        {needsYou(task) && task.needs ? (
          <div data-testid="task-needs" className="rounded-md border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-warning/5 px-2.5 py-1.5 text-sm text-foreground">{task.needs}</div>
        ) : null}
        {detail ? (
          <dl data-testid="task-facts" className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border/70 pt-2.5 text-sm">
            {taskFacts(task, names, now, zone).map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd data-testid={fact.testId} className="min-w-0 text-foreground [overflow-wrap:anywhere]">{fact.value}</dd>
              </div>
            ))}
            {linked ? (
              <div className="contents">
                <dt className="self-center text-muted-foreground">Thread</dt>
                <dd data-testid="fact-thread" className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-foreground">{linked.name}</span>
                  <button type="button" data-testid="task-open-linked" className={CARD_GHOST} aria-label={`Open ${linked.name}`} onClick={() => navigate.toThread(linked.threadId)}><Icon name="ArrowUpRight" />Open</button>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <div data-testid="task-actions" className="flex flex-wrap items-center gap-1.5">
          {actions}
          {extra}
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
        {view.runs?.length ? (
          <ol data-testid="task-runs" aria-label="Latest runs" className="flex flex-col gap-1 border-t border-border/70 pt-2 text-xs">
            {view.runs.map((run) => {
              const runStatus = taskStatus(run);
              return (
                <li key={run.id} data-testid="task-run" data-task-id={run.id} data-state={runStatus.id} className="flex min-w-0 items-baseline gap-2">
                  <span className="w-16 shrink-0 tabular-nums text-subtle-foreground">{shortWhen(run.createdAt, now, zone)}</span>
                  <span className={cn("shrink-0", TONE[runStatus.tone])}>{run.automation?.role === "finding" ? `Finding · ${runStatus.label}` : runStatus.label}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{run.automation?.role === "finding" ? run.title : run.progress.line ?? ""}</span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </ChatCard>
  );
}

export function TaskRow({ view, people, refresh }: { view: TaskView; people: LoopPeople; refresh(): void }) {
  const { task } = view;
  const [open, setOpen] = useState(false);
  const now = useCardNow();
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


import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { errorMessage } from "../../kit/format";
import { Button } from "../../kit/ui/button";
import { Input } from "../../kit/ui/input";
import { cn } from "../../kit/ui/utils";
import type { BotView } from "../../contract";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageMore, BotPageRow, BotPageToolbar, foldRows, noMatch, useBotPageQuery, useRowOpen } from "../../ui/bot-page";
import { useCall, useLive } from "../../ui/live";
import { isClosed, needsYou, USER_OWNER, type Task } from "../../tasks/contract";
import { SEVERITY_LABEL, ALL, matches, ownerFilterOf, ownerShort, sectionTasks, taskSection, taskKind, taskStatus, type Names } from "../../tasks/ui/model";
import { areaAsks, pageFlight, todoBox, type FlightNode } from "../../tasks/ui/board-model";
import { AreasSection, DoneBar, PageInFlight, TodoBoxView } from "../../tasks/ui/TasksNow";
import { SCHEDULED_ICON, scheduledMeta } from "./scheduled-model";
import { NewAutomationMenu, newKinds, useAutomationEditor, useAutomations } from "../../ui/bot/Automations";
import { useNeedsYou } from "./LoopsTab";
import { dueLabel, eventLabel, placeLabel, shortWhen } from "./model";
import { useLoopPeople, useTodosZone } from "./hooks";
import type { Loop } from "../contract";

export function taskMeta(task: Task, names: Names, now: number, zone?: string): { text: string; tone: "warning" | "neutral" } | null {
  if (isClosed(task)) return task.closedAt ? { text: shortWhen(task.closedAt, now, zone), tone: "neutral" } : null;
  if (needsYou(task)) return { text: "Needs you", tone: "warning" };
  const due = dueLabel(task.timing.due, now, zone);
  if (due) return { text: due.text, tone: due.urgent ? "warning" : "neutral" };
  if (task.schedule) return { text: task.schedule.paused ? `${task.schedule.text} · Paused` : task.schedule.text, tone: "neutral" };
  const trigger = task.timing.trigger;
  if (trigger.type === "time" && trigger.at !== undefined) return { text: shortWhen(trigger.at, now, zone), tone: "neutral" };
  if (trigger.type === "place" && trigger.place) return { text: placeLabel(trigger.place, trigger.direction), tone: "neutral" };
  if (trigger.type === "event" && trigger.event) return { text: eventLabel(trigger.event, trigger.label), tone: "neutral" };
  if (task.owner !== USER_OWNER) return { text: `${ownerShort(task, names)} · ${taskStatus(task).label}`, tone: "neutral" };
  if (task.kind === "waiting-outside") return { text: `Since ${shortWhen(task.createdAt, now, zone)}`, tone: "neutral" };
  return null;
}

export type TasksTab = "now" | "scheduled";

export function TodosPage({ view, tab: initialTab = "now" }: { view: BotView; tab?: TasksTab }) {
  const bot = view.bot!;
  const call = useCall();
  const people = useLoopPeople();
  const zone = useTodosZone();
  const rowOpen = useRowOpen();
  const navigate = useBbNavigate();
  const ownsTasks = bot.primary !== false;
  const [tab, setTab] = useState<TasksTab>(ownsTasks ? initialTab : "scheduled");
  const board = useLive("tasks.board", {}, { enabled: ownsTasks, pollMs: 30_000 });
  const list = useLive("tasks.list", {}, { enabled: ownsTasks, pollMs: 60_000 });
  const areas = useLive("areas.list", {}, { enabled: ownsTasks, pollMs: 60_000 });
  const scheduledList = useLive("loops.scheduled", {}, { pollMs: 60_000 });
  const automationList = useAutomations(bot.id);
  const editor = useAutomationEditor(bot.id, automationList.data?.automations ?? [], () => { automationList.refresh(); scheduledList.refresh(); });
  const boardTasks = useMemo(() => (ownsTasks ? board.data?.tasks ?? [] : []), [ownsTasks, board.data]);
  const tasks = useMemo(() => (ownsTasks ? list.data?.tasks ?? [] : []), [ownsTasks, list.data]);
  const surfaced = useMemo(() => boardTasks.filter((t) => !isClosed(t) && t.owner === USER_OWNER && t.attention.queue === "surfaced") as unknown as Loop[], [boardTasks]);
  const { pending } = useNeedsYou(ownsTasks ? people.botThreadId : null, surfaced);
  const [query, setQuery] = useBotPageQuery();
  const [adding, setAdding] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const fold = <T,>(id: string, rows: readonly T[]) => foldRows(rows, unfolded.has(id));
  const moreLine = (id: string, title: string, count: number) => count ? <BotPageMore count={count} group={title} testId="tasks-more" onOpen={() => setUnfolded((open) => new Set([...open, id]))} /> : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const threads = useMemo(() => [...(board.data?.threads ?? []), ...(list.data?.threads ?? [])], [board.data, list.data]);
  const names: Names = { bot: people.botName, leads: people.leads, threads, botThreadId: people.botThreadId };
  const searching = !!query.trim();
  const match = (t: Task) => matches(t, { area: ALL, project: ALL, owner: ALL, query, botThreadId: people.botThreadId });
  const box = useMemo(() => {
    const all = todoBox(boardTasks, now, zone);
    return searching ? { asks: all.asks.filter(match), today: all.today.filter(match), later: all.later.filter(match) } : all;
  }, [boardTasks, now, zone, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const flight = useMemo(() => {
    const nodes = board.data ? pageFlight(board.data) : [];
    if (!searching) return nodes;
    const deep = (n: FlightNode): boolean => match(n.task) || n.children.some(deep) || n.workers.some((w) => w.name.toLowerCase().includes(query.trim().toLowerCase()));
    return nodes.filter(deep);
  }, [board.data, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownAreas = useMemo(() => {
    const all = areas.data?.areas ?? null;
    if (!all || !searching) return all;
    const words = query.trim().toLowerCase().split(/\s+/);
    return all.filter((a) => words.every((w) => [a.name, a.covers, a.now ?? "", a.ownerName, ...a.open.map((i) => i.title)].join(" ").toLowerCase().includes(w)));
  }, [areas.data, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const doneTasks = useMemo(() => (searching ? tasks.filter(match) : tasks), [tasks, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const asksFromAreas = useMemo(() => {
    const all = areaAsks(areas.data?.areas ?? [], boardTasks);
    if (!searching) return all;
    const words = query.trim().toLowerCase().split(/\s+/);
    return all.filter((a) => words.every((w) => `${a.title} ${a.area}`.toLowerCase().includes(w)));
  }, [areas.data, boardTasks, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const openArea = (areaId: string) => {
    const card = document.querySelector<HTMLElement>(`[data-testid=area-card][data-area="${areaId.replace(/["\\]/g, "")}"]`);
    card?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    card?.focus({ preventScroll: true });
  };
  const titles = useMemo(() => new Map(boardTasks.map((t) => [t.id, t.title])), [boardTasks]);
  const titleOf = (id: string) => titles.get(id) ?? null;
  const chat = searching ? [] : pending;
  const sections = useMemo(() => sectionTasks(tasks, { area: ALL, project: ALL, owner: ALL, query, botThreadId: people.botThreadId }, now, zone), [tasks, query, now, zone, people.botThreadId]);
  const scheduled = useMemo(() => (scheduledList.data?.items ?? []).filter((item) => item.source === "automation" && item.botId === bot.id && (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase()))),
    [scheduledList.data, bot.id, query]);
  const itemKey = (item: { id: string; botId: string | null }) => (item.id === "heartbeat" ? `heartbeat:${item.botId}` : item.id);
  const recurring = new Map(tasks.filter((t) => t.automation?.role === "schedule").map((t) => [t.automation!.id, t]));
  const listedIds = new Set((scheduledList.data?.items ?? []).filter((item) => item.source === "automation").map(itemKey));
  const scheduledTasks = sections.scheduled.filter((t) => !(t.automation?.role === "schedule" && listedIds.has(t.automation.id)));
  const add = (text: string) => call("loops.add", { text }).then(() => { board.refresh(); list.refresh(); });
  const refresh = () => { board.refresh(); list.refresh(); };
  const botChat = people.botThreadId ? rowOpen({ kind: "conversation", id: people.botThreadId }, people.botName) : null;
  const openTask = (task: Pick<Task, "id" | "title">, event?: MouseEvent) => rowOpen({ kind: "todo", id: task.id }, task.title).onOpen(event as never);
  const openThread = (threadId: string) => navigate.toThread(threadId);
  const ready = !!scheduledList.data || !!scheduledList.error;
  const scheduledCount = scheduled.length + scheduledTasks.length;
  const scheduledRows = fold("scheduled", scheduled);
  const anyScheduled = (scheduledList.data?.items ?? []).some((item) => item.source === "automation" && item.botId === bot.id) || tasks.some((t) => taskSection(t, now, zone) === "scheduled");
  const row = (task: Task) => {
    const meta = taskMeta(task, names, now, zone);
    const agent = task.owner !== USER_OWNER && task.kind !== "waiting-outside";
    return (
      <BotPageRow key={task.id} testId="task-row" data={{ "data-task": task.id, "data-owner": ownerFilterOf(task.owner, people.botThreadId) }}
        icon={agent ? "Bot" : taskKind(task).icon} iconClassName={task.state === "in_progress" ? "text-success" : needsYou(task) ? "text-warning" : undefined}
        title={task.title} titleText={task.title} meta={meta?.text} metaTone={meta?.tone ?? "neutral"} {...rowOpen({ kind: "todo", id: task.id }, task.title)} />
    );
  };
  const tabs = ownsTasks ? {
    label: "View", value: tab, onChange: (next: TasksTab) => setTab(next),
    options: [{ id: "now" as const, label: "Now" }, { id: "scheduled" as const, label: "Scheduled", ...(ready ? { count: scheduledCount } : {}) }],
  } : undefined;
  const tasksError = board.error && !board.data ? board.error : null;

  return (
    <BotPageLayout testId="todos-page" title={ownsTasks ? "Tasks" : "Scheduled"} bot={bot.name} botId={bot.id} wide={ownsTasks && tab === "now"}
      toolbar={<BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: tab === "now" ? "Search tasks" : "Search scheduled" }} filter={tabs}
        newAction={tab === "now" && ownsTasks ? undefined : <NewAutomationMenu kinds={newKinds(bot.kind === "external")} disabled={bot.state !== "active"} onPick={editor.openNew} />}
        onNew={tab === "now" && ownsTasks ? () => setAdding(true) : undefined} newLabel="New task" />}>
      {tab === "now" && ownsTasks ? <div data-studio-dense-cards="" data-testid="tasks-now" className="contents">
        {tasksError ? <p role="alert" data-testid="tasks-error" className="text-sm text-destructive">{tasksError}</p> : null}
        {board.data ? <div data-testid="tasks-top" className="grid grid-cols-1 items-start gap-5 @4xl/bot-page:grid-cols-[1fr_1.15fr]">
          <TodoBoxView box={box} chat={chat} areaAsks={asksFromAreas} onOpenArea={openArea} names={names} threads={threads} targets={people.targets} now={now} zone={zone} query={searching}
            onOpen={openTask} onOpenChat={botChat ? () => botChat.onOpen(undefined as never) : null} refresh={refresh}
            adding={adding ? <AddTask onAdd={add} onClose={() => setAdding(false)} /> : null} />
          <PageInFlight nodes={flight} names={names} now={now} titleOf={titleOf} onOpen={openTask} onOpenThread={openThread} query={searching} />
        </div> : tasksError ? null : <TasksLoading />}
        <AreasSection areas={shownAreas} error={areas.error} query={searching} flight={flight} now={now} zone={zone} onOpenTask={(id, title) => openTask({ id, title })} onOpenThread={openThread} />
        {list.data ? <DoneBar tasks={doneTasks} names={names} query={searching} now={now} zone={zone} onOpen={openTask} /> : null}
      </div> : null}
      {tab === "scheduled" && ready ? (
        <BotPageGroup title="Scheduled" count={scheduledCount} testId="tasks-scheduled">
          {editor.error ? <p role="alert" className="pb-2 text-xs text-destructive">{editor.error}</p> : null}
          {scheduledList.error && !scheduledList.data ? <p role="alert" data-testid="scheduled-error" className="pb-2 text-xs text-destructive">{scheduledList.error}</p> : null}
          {scheduledTasks.map(row)}
          {scheduledRows.shown.map((item) => {
            const parent = recurring.get(itemKey(item));
            const severity = parent?.automation?.severity ?? null;
            const last = parent?.progress.line ? `${severity ? `${SEVERITY_LABEL[severity]} · ` : ""}${parent.progress.line}` : null;
            const runs = parent ? rowOpen({ kind: "todo", id: parent.id }, parent.title) : null;
            return (
              <BotPageRow key={item.key} testId="scheduled-row" data={{ "data-scheduled": item.key, ...(parent ? { "data-task": parent.id } : {}) }} icon={SCHEDULED_ICON[item.kind]} muted={item.state === "paused"}
                title={item.title} titleText={last ? `${item.title} · Last: ${last}` : item.title} meta={scheduledMeta(item, now, zone)} {...rowOpen(item.link, item.title)}
                columns={last ? [{ key: "last", content: <span data-testid="scheduled-last" title={last}>{last}</span>, className: cn("max-w-[40%]", severity === "critical" ? "text-destructive" : /^Needs you/.test(parent?.progress.line ?? "") || severity === "warn" ? "text-warning" : "text-subtle-foreground") }] : undefined}
                actions={runs ? <Button type="button" variant="ghost" size="sm" data-testid="scheduled-runs" className="h-7 px-2 text-xs font-normal" aria-label={`Runs: ${item.title}`} onClick={(event) => runs.onOpen(event)}>Runs</Button> : undefined} />
            );
          })}
          {!scheduledCount && !(scheduledList.error && !scheduledList.data) ? <BotPageEmpty testId="scheduled-empty" {...(query.trim() && anyScheduled ? { title: noMatch("scheduled items", query) } : { title: "Nothing scheduled yet", hint: "Add a reminder or a check-in with New." })} /> : null}
          {moreLine("scheduled", "Scheduled", scheduledRows.more)}
        </BotPageGroup>
      ) : null}
      {editor.dialogs}
    </BotPageLayout>
  );
}

function TasksLoading() {
  const box = (label: string) => (
    <section aria-label={label} aria-busy="true" data-studio-card="" className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card px-5 py-4">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {[0, 1, 2].map((n) => <span key={n} className="h-4 w-full animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />)}
    </section>
  );
  return <div data-testid="tasks-loading" className="grid grid-cols-1 items-start gap-5 @4xl/bot-page:grid-cols-[1fr_1.15fr]">{box("Your to-do")}{box("In flight")}</div>;
}

export function AddTask({ onAdd, onClose }: { onAdd(text: string): Promise<unknown>; onClose(): void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true); setError(null);
    try { await onAdd(line); setText(""); onClose(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const keys = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
  return (
    <form data-testid="todo-add" className="flex flex-col gap-1.5" onSubmit={(event) => void submit(event)}>
      <div className="flex items-center gap-2">
        <Input autoFocus aria-label="New task" placeholder="New task" value={text} disabled={busy} maxLength={500} onChange={(event) => setText(event.target.value)} onKeyDown={keys} className="h-8 text-sm" />
        <Button type="submit" size="sm" className="h-8 px-3 text-sm" disabled={!text.trim() || busy}>Add</Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-sm font-normal" onClick={onClose}>Cancel</Button>
      </div>
      {error ? <p role="alert" className="px-1 text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

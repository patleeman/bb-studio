import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { errorMessage } from "../../kit/format";
import { Button } from "../../kit/ui/button";
import { Input } from "../../kit/ui/input";
import type { BotView } from "../../contract";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageMore, BotPageRow, BotPageToolbar, foldRows, noMatch, useBotPageQuery, useRowOpen } from "../../ui/bot-page";
import { MenuSelect } from "../../ui/menu-select";
import { useCall, useLive } from "../../ui/live";
import { isClosed, needsYou, USER_OWNER, type Task } from "../../tasks/contract";
import { ALL, filterChoices, ownerFilterOf, ownerLabel, sectionTasks, taskKind, taskStatus, type Names, type SectionId } from "../../tasks/ui/model";
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
  if (task.owner !== USER_OWNER) return { text: `${ownerLabel(task.owner, names)} · ${taskStatus(task).label}`, tone: "neutral" };
  if (task.kind === "waiting-outside") return { text: `Since ${shortWhen(task.createdAt, now, zone)}`, tone: "neutral" };
  return null;
}

export function TodosPage({ view }: { view: BotView }) {
  const bot = view.bot!;
  const call = useCall();
  const people = useLoopPeople();
  const zone = useTodosZone();
  const rowOpen = useRowOpen();
  const ownsTasks = bot.primary !== false;
  const list = useLive("tasks.list", {}, { enabled: ownsTasks, pollMs: 60_000 });
  const scheduledList = useLive("loops.scheduled", {}, { pollMs: 60_000 });
  const automationList = useAutomations(bot.id);
  const editor = useAutomationEditor(bot.id, automationList.data?.automations ?? [], () => { automationList.refresh(); scheduledList.refresh(); });
  const tasks = useMemo(() => (ownsTasks ? list.data?.tasks ?? [] : []), [ownsTasks, list.data]);
  const surfaced = useMemo(() => tasks.filter((t) => !isClosed(t) && t.owner === USER_OWNER && t.attention.queue === "surfaced") as unknown as Loop[], [tasks]);
  const { pending } = useNeedsYou(ownsTasks ? people.botThreadId : null, surfaced);
  const [query, setQuery] = useBotPageQuery();
  const [area, setArea] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [owner, setOwner] = useState(ALL);
  const [adding, setAdding] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const fold = <T,>(id: string, rows: readonly T[]) => foldRows(rows, unfolded.has(id));
  const moreLine = (id: string, title: string, count: number) => count ? <BotPageMore count={count} group={title} testId="tasks-more" onOpen={() => setUnfolded((open) => new Set([...open, id]))} /> : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const names: Names = { bot: people.botName, leads: people.leads, threads: list.data?.threads ?? [], botThreadId: people.botThreadId };
  const sections = useMemo(() => sectionTasks(tasks, { area, project, owner, query }, now, zone), [tasks, area, project, owner, query, now, zone]);
  const filtered = area !== ALL || project !== ALL || owner !== ALL;
  const showChat = !query.trim() && area === ALL && project === ALL && (owner === ALL || owner === USER_OWNER);
  const chatRows = showChat ? pending.length : 0;
  const scheduled = useMemo(() => (scheduledList.data?.items ?? []).filter((item) => item.source === "automation" && item.botId === bot.id && (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())) && !filtered),
    [scheduledList.data, bot.id, query, filtered]);
  const total = sections.today.length + sections.later.length + sections.agents.length + sections.waiting.length + sections.scheduled.length + chatRows;
  const add = (text: string) => call("loops.add", { text }).then(() => { setUnfolded((open) => new Set([...open, "today"])); list.refresh(); });
  const botChat = people.botThreadId ? rowOpen({ kind: "conversation", id: people.botThreadId }, people.botName) : null;
  const ready = ownsTasks ? !!list.data || !!list.error : !!scheduledList.data || !!scheduledList.error;
  const projects = people.projects ?? new Map<string, string>();
  const choices = {
    area: filterChoices(tasks, (t) => t.area),
    project: filterChoices(tasks, (t) => t.project, (id) => projects.get(id) ?? id),
    owner: [{ id: ALL, label: "Everyone" }, { id: USER_OWNER, label: "You" }, { id: "cos", label: people.botName }, { id: "agents", label: "Agents" },
      ...[...new Set(tasks.map((t) => t.owner).filter((o) => o.startsWith("thread:")))].map((o) => ({ id: o, label: ownerLabel(o, names) }))],
  };

  const row = (task: Task) => {
    const meta = taskMeta(task, names, now, zone);
    const closed = isClosed(task);
    const agent = task.owner !== USER_OWNER && task.kind !== "waiting-outside";
    return (
      <BotPageRow key={task.id} testId={closed ? "task-done-row" : "task-row"} data={{ "data-task": task.id, "data-owner": ownerFilterOf(task.owner) }} muted={closed}
        icon={closed ? (task.state === "done" ? "CircleCheck" : "X") : agent ? "Bot" : taskKind(task).icon}
        iconClassName={closed ? (task.state === "done" ? "text-success" : undefined) : task.state === "in_progress" ? "text-success" : needsYou(task) ? "text-warning" : undefined}
        title={task.title} titleText={task.title} meta={meta?.text} metaTone={meta?.tone ?? "neutral"} {...rowOpen({ kind: "todo", id: task.id }, task.title)} />
    );
  };
  const group = (id: SectionId, title: string, rows: readonly Task[], extra = 0, lead: ReactNode = null) => {
    if (!rows.length && !extra) return null;
    const { shown, more } = fold(id, rows);
    return (
      <BotPageGroup key={id} title={title} count={rows.length + extra} testId={`tasks-${id}`}>
        {lead}
        {shown.map(row)}
        {moreLine(id, title, more)}
      </BotPageGroup>
    );
  };
  const empty = query.trim() ? { title: noMatch("tasks", query), action: { label: "Clear search", onClick: () => setQuery("") } }
    : filtered ? { title: "No tasks match these filters", action: { label: "Show all", onClick: () => { setArea(ALL); setProject(ALL); setOwner(ALL); } } }
      : { title: "No tasks yet", hint: "Ask the Bot to take something on, or add a task.", action: adding ? null : { label: "New task", onClick: () => setAdding(true) } };
  const mine = sections.today.length + sections.later.length + chatRows;
  const scheduledCount = scheduled.length + sections.scheduled.length;
  const scheduledRows = fold("scheduled", scheduled);
  const doneRows = fold("done", sections.done);

  return (
    <BotPageLayout testId="todos-page" title={ownsTasks ? "Tasks" : "Scheduled"} bot={bot.name} botId={bot.id}
      toolbar={ownsTasks ? <BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: "Search tasks" }} onNew={() => setAdding(true)}
        menus={<>
          {choices.area.length > 1 ? <MenuSelect label="Area" testId="tasks-filter-area" value={area} choices={choices.area} onChange={setArea} /> : null}
          {choices.project.length > 1 ? <MenuSelect label="Project" testId="tasks-filter-project" value={project} choices={choices.project} onChange={setProject} /> : null}
          <MenuSelect label="Owner" testId="tasks-filter-owner" value={owner} choices={choices.owner} onChange={setOwner} />
        </>} />
        : <BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: "Search scheduled" }} />}>
      {adding ? <AddTask onAdd={add} onClose={() => setAdding(false)} /> : null}
      {ownsTasks && list.error ? <p role="alert" data-testid="tasks-error" className="text-sm text-destructive">{list.error}</p> : null}
      {ownsTasks && list.data && total === 0 ? <BotPageEmpty testId="tasks-empty" {...empty} /> : null}
      {ownsTasks && list.data && mine ? <h2 data-testid="tasks-mine" className="px-2 pt-1 text-xs font-medium text-subtle-foreground">Mine</h2> : null}
      {ownsTasks && list.data ? <>
        {group("today", "Today", sections.today, chatRows, showChat ? pending.map((question) => (
          <BotPageRow key={question.id} testId="todo-chat" icon="MessageQuestion" title={question.text ?? question.reason} titleText={question.text ?? question.reason}
            meta={shortWhen(question.createdAt, now, zone)} onOpen={botChat?.onOpen} disabled={!botChat} />
        )) : null)}
        {group("later", "Later", sections.later)}
        {group("agents", "Agents on it", sections.agents)}
        {group("waiting", "Waiting", sections.waiting)}
      </> : null}
      {ready ? (
        <BotPageGroup title={ownsTasks ? "Scheduled & recurring" : "Scheduled"} count={scheduledCount} testId="tasks-scheduled"
          aside={<NewAutomationMenu kinds={newKinds(bot.kind === "external")} disabled={bot.state !== "active"} onPick={editor.openNew} />}>
          {editor.error ? <p role="alert" className="pb-2 text-xs text-destructive">{editor.error}</p> : null}
          {scheduledList.error && !scheduledList.data ? <p role="alert" data-testid="scheduled-error" className="pb-2 text-xs text-destructive">{scheduledList.error}</p> : null}
          {sections.scheduled.map(row)}
          {scheduledRows.shown.map((item) => (
            <BotPageRow key={item.key} testId="scheduled-row" data={{ "data-scheduled": item.key }} icon={SCHEDULED_ICON[item.kind]} muted={item.state === "paused"}
              title={item.title} titleText={item.title} meta={scheduledMeta(item, now, zone)} {...rowOpen(item.link, item.title)} />
          ))}
          {!scheduledCount && !(scheduledList.error && !scheduledList.data) ? <BotPageEmpty testId="scheduled-empty" {...(query.trim() ? { title: noMatch("scheduled items", query) } : filtered ? { title: "No scheduled items match these filters" } : { title: "Nothing scheduled yet", hint: "Add a reminder or a check-in with New." })} /> : null}
          {moreLine("scheduled", "Scheduled", scheduledRows.more)}
        </BotPageGroup>
      ) : null}
      {editor.dialogs}
      {ownsTasks && sections.done.length ? (
        <BotPageGroup title={`${sections.done.length} done`} label="Done" collapsible defaultOpen={false} testId="tasks-done">
          {doneRows.shown.map(row)}
          {moreLine("done", "Done", doneRows.more)}
        </BotPageGroup>
      ) : null}
    </BotPageLayout>
  );
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

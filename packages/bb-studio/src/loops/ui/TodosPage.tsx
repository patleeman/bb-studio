// The Bot's Todos page (bot/<botId>/loops), on the Bot-page template
// (src/ui/bot-page): one line per todo, its title on the left and one small
// due date or "when" on the right, in four groups: Today, This week, Later
// and Waiting on others (rules in todos-model.ts), then Scheduled (the Bot's
// check-ins, reminders, watchers and runners, src/loops/scheduled.ts), then
// Done, folded. A group shows 8 rows, then "N more", as the Library's do. The
// Bot chat's pending questions lead Today; a reply not read yet is the
// chat's unread state, not a todo. Search and the
// area pills filter it; New hands a typed line to the Bot to fill in. A row
// opens the todo as a tab in the workbench beside the page (TodoTab.tsx).
// Todos are one list, the primary Bot's: under another Bot the page is that
// Bot's Scheduled alone, titled Scheduled.
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { errorMessage } from "../../kit/format";
import { Button } from "../../kit/ui/button";
import { Input } from "../../kit/ui/input";
import type { BotView } from "../../contract";
import { BotPageEmpty, BotPageGroup, BotPageLayout, BotPageMore, BotPageRow, BotPageToolbar, foldRows, noMatch, useBotPageQuery, useRowOpen } from "../../ui/bot-page";
import { useCall, useLive } from "../../ui/live";
import type { Loop } from "../contract";
import { SCHEDULED_ICON, scheduledMeta } from "./scheduled-model";
import { NewAutomationMenu, newKinds, useAutomationEditor, useAutomations } from "../../ui/bot/Automations";
import { useNeedsYou } from "./LoopsTab";
import { KIND, ownerName, shortWhen } from "./model";
import { useLoopPeople, useTodosZone } from "./hooks";
import { ALL_AREAS, areaPills, groupTodos, openTodos, TODO_GROUPS, todoWhen } from "./todos-model";

export function TodosPage({ view }: { view: BotView }) {
  const bot = view.bot!;
  const call = useCall();
  const people = useLoopPeople();
  const zone = useTodosZone();
  const rowOpen = useRowOpen();
  const ownsTodos = bot.primary !== false;
  const list = useLive("loops.list", {}, { enabled: ownsTodos, pollMs: 60_000 });
  const scheduledList = useLive("loops.scheduled", {}, { pollMs: 60_000 });
  const automationList = useAutomations(bot.id);
  const editor = useAutomationEditor(bot.id, automationList.data?.automations ?? [], () => { automationList.refresh(); scheduledList.refresh(); });
  const { pending } = useNeedsYou(ownsTodos ? people.botThreadId : null, list.data?.needsYouNow);
  const [query, setQuery] = useBotPageQuery();
  const [area, setArea] = useState(ALL_AREAS);
  const [adding, setAdding] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const fold = <T,>(id: string, rows: readonly T[]) => foldRows(rows, unfolded.has(id));
  const moreLine = (id: string, title: string, count: number) => count ? <BotPageMore count={count} group={title} testId="todos-more" onOpen={() => setUnfolded((open) => new Set([...open, id]))} /> : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const data = ownsTodos ? list.data : undefined;
  const ready = ownsTodos ? !!data : !!scheduledList.data;
  const open = useMemo(() => data ? openTodos(data) : [], [data]);
  const groups = useMemo(() => groupTodos(open, { area, query }, now, zone), [open, area, query, now, zone]);
  const owners = useMemo(() => new Map((data?.owners ?? []).map((each) => [each.owner, each] as const)), [data?.owners]);
  const done = useMemo(() => [...(data?.done ?? [])].filter((loop) => area === ALL_AREAS || loop.area === area).filter((loop) => !query.trim() || loop.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)), [data?.done, area, query]);
  const showChat = area === ALL_AREAS && !query.trim();
  const scheduled = useMemo(() => (scheduledList.data?.items ?? []).filter((item) => item.source === "automation" && item.botId === bot.id && (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())) && area === ALL_AREAS), [scheduledList.data, bot.id, query, area]);
  const chatRows = showChat ? pending.length : 0;
  const nameOf = (loop: Loop) => ownerName(loop.owner, { bot: people.botName, leads: people.leads }, owners.get(loop.owner));
  const total = TODO_GROUPS.reduce((sum, group) => sum + groups[group.id].length, 0) + chatRows;
  const add = (text: string) => call("loops.add", { text }).then(() => list.refresh());
  const scheduledRows = fold("scheduled", scheduled);
  const doneRows = fold("done", done);
  const botChat = people.botThreadId ? rowOpen({ kind: "conversation", id: people.botThreadId }, people.botName) : null;

  const row = (loop: Loop) => {
    const when = todoWhen(loop, nameOf(loop), now, zone);
    return (
      <BotPageRow key={loop.id} testId="todo-row" data={{ "data-loop": loop.id }} icon={loop.owner === "patrick" || loop.kind === "waiting" ? KIND[loop.kind].icon : "Bot"}
        iconClassName={loop.status === "in_progress" ? "text-success" : undefined} title={loop.title} titleText={loop.title}
        meta={when?.text} metaTone={when?.urgent ? "warning" : "neutral"} {...rowOpen({ kind: "todo", id: loop.id }, loop.title)} />
    );
  };

  return (
    <BotPageLayout testId="todos-page" title={ownsTodos ? "Todos" : "Scheduled"} bot={bot.name} botId={bot.id}
      toolbar={ownsTodos ? <BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: "Search todos" }}
        filter={{ label: "Area", value: area, options: areaPills(open), onChange: setArea }} onNew={() => setAdding(true)} />
        : <BotPageToolbar search={{ value: query, onChange: setQuery, placeholder: "Search scheduled" }} />}>
      {adding ? <AddTodo onAdd={add} onClose={() => setAdding(false)} /> : null}
      {ownsTodos && list.error ? <p role="alert" className="text-sm text-destructive">{list.error}</p> : null}
      {!data ? null : total === 0 ? <BotPageEmpty testId="todos-empty" {...(query.trim()
        ? { title: noMatch("todos", query), action: { label: "Clear search", onClick: () => setQuery("") } }
        : area !== ALL_AREAS ? { title: `No todos in ${area}`, action: { label: "Show all", onClick: () => setArea(ALL_AREAS) } }
        : { title: "No todos yet", hint: "Ask the Bot to keep track of something, or add a todo.", action: adding ? null : { label: "New todo", onClick: () => setAdding(true) } })} /> : TODO_GROUPS.map((group) => {
        const loops = groups[group.id];
        const chat = group.id === "today" ? chatRows : 0;
        if (!loops.length && !chat) return null;
        const { shown, more } = fold(group.id, loops);
        return (
          <BotPageGroup key={group.id} title={group.title} count={loops.length + chat} testId={`todos-${group.id}`}>
            {group.id === "today" && showChat ? <>
              {pending.map((question) => (
                <BotPageRow key={question.id} testId="todo-chat" icon="MessageQuestion" title={question.text ?? question.reason} titleText={question.text ?? question.reason}
                  meta={shortWhen(question.createdAt, now, zone)} onOpen={botChat?.onOpen} disabled={!botChat} />
              ))}
            </> : null}
            {shown.map(row)}
            {moreLine(group.id, group.title, more)}
          </BotPageGroup>
        );
      })}
      {ready ? (
        <BotPageGroup title="Scheduled" count={scheduled.length} testId="todos-scheduled"
          aside={<NewAutomationMenu kinds={newKinds(bot.kind === "external")} disabled={bot.state !== "active"} onPick={editor.openNew} />}>
          {editor.error ? <p role="alert" className="pb-2 text-xs text-destructive">{editor.error}</p> : null}
          {scheduledRows.shown.map((item) => (
            <BotPageRow key={item.key} testId="scheduled-row" data={{ "data-scheduled": item.key }} icon={SCHEDULED_ICON[item.kind]} muted={item.state === "paused"}
              title={item.title} titleText={item.title} meta={scheduledMeta(item, now, zone)} {...rowOpen(item.link, item.title)} />
          ))}
          {!scheduled.length ? <BotPageEmpty testId="scheduled-empty" {...(query.trim() ? { title: noMatch("scheduled items", query) } : { title: "Nothing scheduled yet", hint: "Add a reminder or a check-in with New." })} /> : null}
          {moreLine("scheduled", "Scheduled", scheduledRows.more)}
        </BotPageGroup>
      ) : null}
      {editor.dialogs}
      {data && done.length ? (
        <BotPageGroup title="Done" count={done.length} collapsible defaultOpen={false} testId="todos-done">
          {doneRows.shown.map((loop) => (
            <BotPageRow key={loop.id} testId="todo-done" data={{ "data-loop": loop.id }} muted icon={loop.status === "dropped" ? "X" : "CircleCheck"} iconClassName={loop.status === "dropped" ? undefined : "text-success"}
              title={loop.title} titleText={loop.title} meta={loop.closedAt ? shortWhen(loop.closedAt, now, zone) : undefined} {...rowOpen({ kind: "todo", id: loop.id }, loop.title)} />
          ))}
          {moreLine("done", "Done", doneRows.more)}
        </BotPageGroup>
      ) : null}
    </BotPageLayout>
  );
}

/** New: a typed line the Bot fills in. Enter adds, Escape closes. */
function AddTodo({ onAdd, onClose }: { onAdd(text: string): Promise<unknown>; onClose(): void }) {
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
        <Input autoFocus aria-label="New todo" placeholder="New todo" value={text} disabled={busy} maxLength={500} onChange={(event) => setText(event.target.value)} onKeyDown={keys} className="h-8 text-sm" />
        <Button type="submit" size="sm" className="h-8 px-3 text-sm" disabled={!text.trim() || busy}>Add</Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-sm font-normal" onClick={onClose}>Cancel</Button>
      </div>
      {error ? <p role="alert" className="px-1 text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

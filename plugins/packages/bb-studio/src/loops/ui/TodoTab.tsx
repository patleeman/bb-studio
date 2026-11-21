import { useBbNavigate, type JsonValue } from "@get-bb/plugin-sdk/app";
import { Icon } from "../../kit/ui/icon";
import { NotFoundTab } from "../../links/NotFoundTab";
import { linkFor } from "../../links/router";
import { BotItemDetail, BotItemError, type BotPageFact } from "../../ui/bot-page/BotItemDetail";
import { useLive } from "../../ui/live";
import type { Loop } from "../contract";
import { CARD_BUTTON } from "./LoopMenus";
import { fullWhen, shortWhen, ownerName, ownerThread, safeUrl, sourceText, triggerLabel, type OwnerInfo } from "./model";
import { TaskDetail } from "../../tasks/ui/TaskDetail";
import { historyLines, taskStatus } from "../../tasks/ui/model";
import { needsYou } from "../../tasks/contract";
import type { TaskView } from "../../tasks/rpc-contract";
import { useLoopPeople, useTodosZone, type LoopPeople } from "./hooks";

export const entryId = (params: JsonValue | null): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return typeof params.id === "string" && params.id ? params.id : null;
};

// Every old task or to-do opens here, from a link or an old card: one
// read-only detail, the task's card with its facts (TaskDetail). A legacy
// to-do with no task record falls back to TodoDetail. Strands replaced
// tasks; nothing here changes a row.
export function TodoTab({ params }: { params: JsonValue | null }) {
  const id = entryId(params);
  const people = useLoopPeople();
  const task = useLive("tasks.get", { id: id ?? "" }, { enabled: !!id, pollMs: 60_000 });
  const live = useLive("loops.get", { id: id ?? "" }, { enabled: !!id, pollMs: 60_000 });
  const gone = !!id && !!live.error && !live.data && /not found/i.test(live.error);
  const refresh = () => { task.refresh(); live.refresh(); };
  if (!id) return <NotFoundTab params={{ kind: "todo", id, link: "bb://todo" }} />;
  if (task.data) return <TaskDetail key={id} view={task.data} people={people} refresh={refresh} />;
  if (!task.error) return null;
  if (live.data) return <TodoDetail key={id} loop={live.data.loop} people={people} owner={live.data.owner} view={null} />;
  if (live.error && !gone) return <BotItemError message={live.error} />;
  if (!live.error) return null;
  return <NotFoundTab params={{ kind: "todo", id, link: linkFor({ kind: "todo", id }) }} />;
}

export function TodoDetail({ loop, people, owner, view = null }: { loop: Loop; people: LoopPeople; owner: OwnerInfo | undefined; view?: TaskView | null }) {
  const navigate = useBbNavigate();
  const zone = useTodosZone();
  const history = view ? historyLines(view.history, { bot: people.botName, leads: people.leads, threads: view.threads, botThreadId: people.botThreadId }) : [];
  const closed = loop.closedAt !== null;
  const trigger = loop.trigger.type === "none" ? null : triggerLabel(loop.trigger, Date.now(), null, zone);
  const source = sourceText(loop.source);
  const url = safeUrl(loop.source?.url);
  const thread = ownerThread(loop.owner, people.botThreadId, owner);
  const sourceThread = loop.source?.kind === "thread" ? loop.source.ref : null;
  const by = loop.closedBy === "patrick" ? "You" : loop.closedBy === "cos" ? people.botName : loop.closedBy;
  const due = loop.due !== null ? fullWhen(loop.due, Date.now(), zone) : null;
  const whenIsDue = !!trigger && trigger.text === due;
  const facts: BotPageFact[] = [
    ...(due !== null ? [{ label: "Due", value: due }] : []),
    ...(trigger && !whenIsDue ? [{ label: "When", value: trigger.text }] : []),
    ...(loop.area ? [{ label: "Area", value: loop.area }] : []),
    { label: "Owner", value: ownerName(loop.owner, { bot: people.botName, leads: people.leads }, owner) },
    ...(view ? [{ label: "State", value: taskStatus(view.task).label }] : []),
    ...(view && view.task.needs && needsYou(view.task) ? [{ label: "Needs", value: view.task.needs }] : []),
    ...(source ? [{ label: "Source", value: url ? <a href={url} target="_blank" rel="noreferrer" className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">{source}</a>
      : sourceThread ? <button type="button" className="underline decoration-border underline-offset-2 hover:decoration-foreground" onClick={() => navigate.toThread(sourceThread)}>{source}</button> : source }] : []),
    ...(closed && loop.closedAt ? [{ label: loop.status === "dropped" ? "Dismissed" : "Done", value: `${by ? `${by} · ` : ""}${fullWhen(loop.closedAt, Date.now(), zone)}` }] : []),
  ];
  return (
    <BotItemDetail testId="todo-detail" title={loop.title} facts={facts} actions={thread ? <>
      <button type="button" className={CARD_BUTTON} onClick={() => navigate.toThread(thread)}><Icon name="MessageSquare" />{loop.owner === "cos" ? "Open chat" : "Open thread"}</button>
    </> : null}>
      {loop.why ? <p data-testid="todo-why" className="text-sm whitespace-pre-wrap text-foreground">{loop.why}</p> : null}
      {history.length ? (
        <section aria-label="History" data-testid="todo-history" className="flex flex-col gap-1 pt-2 text-xs">
          <h3 className="text-xs font-medium text-subtle-foreground">History</h3>
          <ol className="flex flex-col gap-1">
            {history.slice(0, 6).map((line, i) => (
              <li key={`${line.at}-${i}`} className="flex min-w-0 items-baseline gap-2">
                <span className="w-16 shrink-0 tabular-nums text-subtle-foreground">{shortWhen(line.at, Date.now(), zone)}</span>
                <span className="min-w-0 text-muted-foreground">{line.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </BotItemDetail>
  );
}

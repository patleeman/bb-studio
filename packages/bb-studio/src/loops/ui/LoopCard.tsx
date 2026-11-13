// `::loop{id="loop_…"}` in the Bot's chat: one open todo as a card Patrick
// acts on in place (docs/attention-router/backend.md). Each kind has its own
// buttons: do (Done, Snooze, Give to, Dismiss), decide (its options, Snooze),
// read (Got it) and waiting (Nudge them, Dismiss). A handed-off todo shows who is
// on it, live; a closed one collapses to a line with Undo.
//
// The morning card's rows are `::loop{id row="1"}`, a compact line that opens
// the full card, and `::loops{more="3"}`, a link to the Todos list. The Bot
// posts `::loops{open="pane"}` to offer the Todos list beside the chat.
//
// With Todos off (the loopsEnabled setting), every card is a
// quiet placeholder.
import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { Icon, cn } from "../../kit/ui/index";
import { remember } from "../../kit/app/index";
import { CHAT_CARD, CHAT_CARD_ACTION, CHAT_CARD_BODY, CHAT_CARD_HEAD, CHAT_CARD_ICON_BUTTON, CHAT_CARD_SKELETON, ChatCard, ChatCardHeader } from "../../kit/app/chat-card";
import { useLive } from "../../ui/live";
import type { Loop } from "../contract";
import { CARD_BUTTON, CARD_GHOST, CARD_PRIMARY, ChooseSheet, HandOffMenu, OptionButton, SnoozeMenu } from "./LoopMenus";
import { closedVerb, dueLabel, elapsed, INLINE_OPTIONS, KIND, lastEvent, ownerName, ownerThread, releaseLabel, safeUrl, shortWhen, sourceText, type OwnerInfo } from "./model";
import { useLoopActions, useLoopPeople, useLoopsEnabled, useOpenLoopsPane, type LoopPeople } from "./hooks";

export const isLoopId = (id: string) => /^loop_[A-Za-z0-9-]{1,80}$/.test(id);

type History = { type: string; at: number; data: string }[];
type LoopView = { loop: Loop; history: History; owner?: OwnerInfo };

/** A quiet line in place of a card while Todos are off. */
export function LoopsOff() {
  return (
    <div data-testid="loop-off" className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
      <Icon name="Unavailable" className="size-3.5" />Todos are off
    </div>
  );
}

/** The ticking "now", once a minute, for live elapsed times. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  return now;
}

/** While off, a morning card shows one placeholder: its first row's. Message id → that row's todo id. */
const offRows = new Map<string, string>();

export function LoopDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const enabled = useLoopsEnabled();
  const id = attributes.id ?? "";
  const row = attributes.row === "1" || attributes.row === "true";
  if (!isLoopId(id)) return null;
  if (!enabled) {
    if (!row) return <LoopsOff />;
    if (!offRows.has(message.id)) offRows.set(message.id, id);
    return offRows.get(message.id) === id ? <LoopsOff /> : null;
  }
  return <LiveLoop id={id} row={row} />;
}

function LiveLoop({ id, row }: { id: string; row: boolean }) {
  const live = useLive("loops.get", { id }, { pollMs: 120_000 });
  const missing = !!live.error && /not found/i.test(live.error);
  const view = remember<LoopView>(`loop:${id}`, missing ? null : (live.data ?? undefined) as LoopView | undefined);
  const people = useLoopPeople();
  if (missing) return <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground"><Icon name="Unavailable" className="size-3.5" />This todo was removed.</div>;
  if (!view) return row
    ? <div className="h-8 animate-pulse rounded-md bg-muted/40 motion-reduce:animate-none" />
    : <div className={cn(CHAT_CARD_SKELETON, "h-28")} />;
  return row ? <LoopRow view={view} people={people} refresh={live.refresh} /> : <LoopCard view={view} people={people} refresh={live.refresh} />;
}

/** A todo's card in every state. Exported for the Todos tab and tests. */
export function LoopCard({ view, people, refresh, bare = false }: { view: LoopView; people: LoopPeople; refresh(): void; bare?: boolean }) {
  const { loop, history } = view;
  const now = useNow();
  if (loop.closedAt !== null) return <ClosedLine view={view} refresh={refresh} />;
  const release = releaseLabel(loop, history);
  return (
    <div className={cn("w-full", !bare && "my-2")} data-testid="loop-card" data-kind={loop.kind}>
      {bare ? null : (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name={release.icon} className="size-3.5" />{release.text}
        </div>
      )}
      <div data-studio-card="" className={cn(CHAT_CARD, CHAT_CARD_BODY, "my-0")}>
        {loop.owner === "patrick"
          ? <OpenCard loop={loop} people={people} refresh={refresh} now={now} />
          : <HandedOff loop={loop} history={history} owner={view.owner} people={people} refresh={refresh} now={now} />}
        {now - loop.updatedAt > STALE_MS ? <Stale loop={loop} refresh={refresh} now={now} /> : null}
      </div>
    </div>
  );
}

function Header({ loop, now, label }: { loop: Loop; now: number; label?: string }) {
  const kind = KIND[loop.kind];
  const source = sourceText(loop.source);
  const url = safeUrl(loop.source?.url);
  const due = dueLabel(loop.due, now);
  const right = loop.kind === "waiting" ? { text: `Since ${shortWhen(loop.createdAt, now)}`, urgent: false } : due;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon name={kind.icon} className="size-3.5" />
      <span>{label ?? kind.label}</span>
      {source ? <>
        <span aria-hidden>·</span>
        {url ? <a href={url} target="_blank" rel="noreferrer" className="truncate underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground">{source}</a> : <span className="truncate">{source}</span>}
      </> : null}
      {loop.priority === "urgent" ? <span className="rounded bg-destructive/15 px-1 text-xs font-medium text-destructive">Urgent</span> : null}
      {right ? <span className={cn("ml-auto shrink-0", right.urgent && "text-warning")}>{right.text}</span> : null}
    </div>
  );
}

function Body({ loop }: { loop: Loop }) {
  return <>
    <div data-studio-card-title="" className="mt-1 text-sm font-medium leading-snug text-foreground">{loop.title}</div>
    {loop.why ? <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{loop.why}</p> : null}
  </>;
}

function OpenCard({ loop, people, refresh, now }: { loop: Loop; people: LoopPeople; refresh(): void; now: number }) {
  const { act, update, busy, error } = useLoopActions(refresh);
  const [note, setNote] = useState<string | null>(null);
  const snooze = <SnoozeMenu disabled={busy} onSnooze={(preset) => void act({ id: loop.id, action: "snooze", snooze: preset })}
    onPick={(at) => void update({ id: loop.id, changes: { status: "snoozed", trigger: { type: "time", at } } })} />;
  const drop = <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void act({ id: loop.id, action: "drop" })}><Icon name="X" />Dismiss</button>;
  let actions;
  if (loop.kind === "decide") {
    actions = <>
      {loop.options.length > INLINE_OPTIONS
        ? <ChooseSheet loop={loop} disabled={busy} onChoose={(option) => void act({ id: loop.id, action: "choose", option })} />
        : loop.options.map((option) => <OptionButton key={option} option={option} disabled={busy} onChoose={() => void act({ id: loop.id, action: "choose", option })} />)}
      {snooze}
    </>;
  } else if (loop.kind === "read") {
    actions = <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: loop.id, action: "got_it" })}><Icon name="CircleCheck" />Got it</button>;
  } else if (loop.kind === "waiting") {
    // Nudging someone is outward-facing: the Bot drafts it for approval, never sends on a tap.
    actions = <>
      <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: loop.id, action: "nudge" }).then((ok) => ok && setNote(`${people.botName} is drafting a nudge in the chat.`))}><Icon name="BellDot" />Nudge them</button>
      {drop}
    </>;
  } else {
    actions = <>
      <button type="button" className={CARD_PRIMARY} disabled={busy} onClick={() => void act({ id: loop.id, action: "done" })}><Icon name="CircleCheck" />Done</button>
      {snooze}
      <HandOffMenu targets={people.targets} disabled={busy} onHandOff={(owner) => void act({ id: loop.id, action: "hand_off", owner })} />
      {drop}
    </>;
  }
  return <>
    <Header loop={loop} now={now} label={loop.status === "snoozed" ? `${KIND[loop.kind].label} · snoozed` : undefined} />
    <Body loop={loop} />
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{actions}</div>
    {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
  </>;
}

const STALE_MS = 3 * 86_400_000;

/** The weekly stale review (src/loops/scheduler.ts): no update in three days, Keep or Dismiss. */
function Stale({ loop, refresh, now }: { loop: Loop; refresh(): void; now: number }) {
  const { act, busy, error } = useLoopActions(refresh);
  return (
    <div data-testid="loop-stale" className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2.5 text-xs text-muted-foreground">
      <Icon name="TimeSchedule" className="size-3.5" />No update in {elapsed(loop.updatedAt, now)}. Still on it?
      <span className="ml-auto flex gap-1.5">
        <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: loop.id, action: "keep" })}><Icon name="Check" />Keep</button>
        <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void act({ id: loop.id, action: "drop" })}><Icon name="X" />Dismiss</button>
      </span>
      {error ? <p role="alert" className="w-full text-destructive">{error}</p> : null}
    </div>
  );
}

/** A todo an agent works on: who, since when, live; Open thread and Take it back. */
function HandedOff({ loop, history, owner, people, refresh, now }: { loop: Loop; history: History; owner?: OwnerInfo; people: LoopPeople; refresh(): void; now: number }) {
  const navigate = useBbNavigate();
  const { update, busy, error } = useLoopActions(refresh);
  const name = ownerName(loop.owner, { bot: people.botName, leads: people.leads }, owner);
  const since = lastEvent(history, "handed_off") ?? loop.updatedAt;
  const thread = ownerThread(loop.owner, people.botThreadId, owner);
  return <>
    <Header loop={loop} now={now} label={`${KIND[loop.kind].label} · handed off`} />
    <Body loop={loop} />
    <div className="mt-2 flex items-center gap-1.5 text-sm" data-testid="loop-progress">
      <span className="size-2 rounded-full bg-success motion-safe:animate-pulse" aria-hidden />
      <span className="font-medium text-foreground">{name} is on it</span>
      <span className="text-muted-foreground">· {elapsed(since, now)}</span>
    </div>
    <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="h-full w-1/3 rounded-full bg-success/70 motion-safe:animate-[loop-progress_2.4s_ease-in-out_infinite]" />
    </div>
    <style>{"@keyframes loop-progress{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {thread ? <button type="button" className={CARD_BUTTON} onClick={() => navigate.toThread(thread)}><Icon name="MessageSquare" />{loop.owner === "cos" ? "Open chat" : "Open thread"}</button> : null}
      <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void update({ id: loop.id, changes: { owner: "patrick", status: "surfaced" } })}><Icon name="ArrowTurnBackward" />Take it back</button>
    </div>
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
  </>;
}

/** A closed todo: one line, how it ended, when, and Undo. */
function ClosedLine({ view, refresh }: { view: LoopView; refresh(): void }) {
  const { loop, history } = view;
  const { update, busy, error } = useLoopActions(refresh);
  const verb = closedVerb(loop, history);
  const dropped = loop.status === "dropped";
  return (
    <div className="my-2 w-full" data-testid="loop-closed">
      <div data-studio-card="" className={cn(CHAT_CARD, CHAT_CARD_HEAD, "my-0 flex-row")}>
        <Icon name={dropped ? "X" : loop.kind === "decide" ? "Fork" : "CircleCheck"} className={cn("size-4 shrink-0", dropped ? "text-muted-foreground" : "text-success")} />
        <span className="shrink-0 font-medium text-foreground">{verb}</span>
        <span className="min-w-0 truncate text-muted-foreground">· {loop.title}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{loop.closedAt ? shortWhen(loop.closedAt) : ""}{loop.closedBy && loop.closedBy !== "patrick" ? " · closed by the Bot" : ""}</span>
        <button type="button" aria-label={`Undo ${verb.toLowerCase()}`} title="Undo" disabled={busy} onClick={() => void update({ id: loop.id, changes: { status: "surfaced" } })}
          className={CHAT_CARD_ICON_BUTTON}>
          <Icon name="ArrowTurnBackward" className="size-3.5" />
        </button>
      </div>
      {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** A morning row: icon, title and what's pressing; a click opens the full card in place. */
export function LoopRow({ view, people, refresh }: { view: LoopView; people: LoopPeople; refresh(): void }) {
  const { loop } = view;
  const [open, setOpen] = useState(false);
  const now = useNow();
  const closed = loop.closedAt !== null;
  const due = dueLabel(loop.due, now);
  const right = closed ? closedVerb(loop, view.history)
    : loop.kind === "decide" ? `${loop.options.length} option${loop.options.length === 1 ? "" : "s"}`
      : due?.text ?? (loop.kind === "read" ? "Read" : "");
  return (
    <div data-testid="loop-row" className="w-full max-w-3xl">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="group flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-sm hover:bg-state-hover">
        <Icon name={closed ? "CircleCheck" : KIND[loop.kind].icon} className={cn("size-4 shrink-0", closed ? "text-success" : "text-muted-foreground")} />
        <span className={cn("min-w-0 flex-1 truncate", closed ? "text-muted-foreground line-through" : "text-foreground")}>{loop.title}</span>
        <span className={cn("shrink-0 text-xs", !closed && due?.urgent ? "text-warning" : "text-muted-foreground")}>{right}</span>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>
      {open ? <div className="pt-1 pb-2"><LoopCard view={view} people={people} refresh={refresh} bare /></div> : null}
    </div>
  );
}

/**
 * `::loops{…}`, the Todos list from the chat:
 * - `more="3"`: "3 more in Todos ›", nothing when more is 0;
 * - `open="pane"`: a card whose button opens Todos beside the chat.
 * Both open the Todos pane beside the chat, or the Todos tab where there is
 * no side panel.
 */
export function LoopsDirective({ attributes }: PluginMessageDirectiveProps) {
  const enabled = useLoopsEnabled();
  // Off, the morning card's first row already says so; a lone card says it itself.
  if (attributes.open !== undefined) return enabled ? <LoopsOpenCard /> : <LoopsOff />;
  if (!enabled) return null;
  const more = Number.parseInt(attributes.more ?? "", 10);
  if (!Number.isFinite(more) || more <= 0) return null;
  return <LoopsMore more={more} />;
}

function LoopsMore({ more }: { more: number }) {
  const people = useLoopPeople();
  const openPane = useOpenLoopsPane();
  return (
    <button type="button" data-testid="loops-more" onClick={() => openPane(people.botId)}
      className="group flex h-8 w-full max-w-3xl items-center gap-2.5 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground">
      <Icon name="ListTodo" className="size-4 shrink-0" />
      <span className="flex-1">{more} more in Todos</span>
      <Icon name="ChevronRight" className="size-3.5" />
    </button>
  );
}

/** What's open, by section, for the card's one line: "2 need you · 3 coming up". */
export function loopsSummary(groups: { needsYouNow: unknown[]; comingUp: unknown[]; agentsOnIt: unknown[]; waitingOnOthers: unknown[] } | null | undefined): string {
  if (!groups) return "";
  const parts = [
    groups.needsYouNow.length ? `${groups.needsYouNow.length} need${groups.needsYouNow.length === 1 ? "s" : ""} you` : "",
    groups.comingUp.length ? `${groups.comingUp.length} coming up` : "",
    groups.agentsOnIt.length ? `${groups.agentsOnIt.length} with agents` : "",
    groups.waitingOnOthers.length ? `${groups.waitingOnOthers.length} waiting on others` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No todos";
}

function LoopsOpenCard() {
  const people = useLoopPeople();
  const openPane = useOpenLoopsPane();
  const list = useLive("loops.list", {}, { pollMs: 60_000 });
  const summary = loopsSummary(list.data);
  return (
    <ChatCard data-testid="loops-open">
      <ChatCardHeader icon="ListTodo" title="Todos" meta={summary || undefined}
        actions={<button type="button" className={CHAT_CARD_ACTION} onClick={() => openPane(people.botId)}><Icon name="PanelRight" />Open Todos</button>} />
    </ChatCard>
  );
}

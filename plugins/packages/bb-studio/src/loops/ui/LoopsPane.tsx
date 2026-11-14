// The Todos pane: the Todos tab's sections in the thread's side panel, so the
// list stays up while the user talks todos through with the Chief of Staff. It
// is the "Todos" thread panel action (app.tsx), opened from the Bot chat's
// header, a `::loops{open="pane"}` card, "N more in Todos" and
// the panel launcher. Rows are compact: a title, one line of
// detail and a ⋯ menu with the row's actions, as on the phone. Change trigger
// opens in place under its row. Discuss, first in each menu, puts the todo in
// the chat's draft as an `@loop` chip; dragging a row into the composer drops
// its `::loop` line (reference.ts). It refetches on Studio's realtime signal,
// like the tab and the cards (useLive).
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ThreadTabProps } from "../../kit/app/thread-panel";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { renameTabOf, useHostTabWindow } from "../../kit/app/host-sdk";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, Icon, cn,
} from "../../kit/ui/index";
import { ICON_BUTTON } from "../../kit/app/index";
import type { Loop } from "../contract";
import { PickTime, TriggerForm } from "./LoopMenus";
import { AddLoop, AreaChip, OwnerMenu, useLoopsBoard, type RowProps } from "./LoopsTab";
import { areaChips, dueLabel, elapsed, fullWhen, KIND, optionParts, ownerName, ownerThread, shortWhen, SNOOZE, snoozeHint, sourceText, triggerLabel } from "./model";
import { focusDiscussed, LOOPS_PANE, loopDragProps, openLoops, useDiscussLoop, useLoopActions, useTodosZone } from "./hooks";

export { LOOPS_PANE };

const DONE_SHOWN = 3;
const MENU_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground disabled:opacity-50 [&_svg]:size-4";

/** The "Todos" thread panel tab. `threadId` is the chat it's beside. */
export function LoopsPane({ threadId }: ThreadTabProps) {
  const navigate = useBbNavigate();
  useEffect(() => { renameTabOf(navigate)?.({ tab: { id: LOOPS_PANE }, title: "Todos" }); }, [navigate]);
  return (
    <div className="studio-root flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="loops-pane">
      <Board threadId={threadId} />
    </div>
  );
}

function Board({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const zone = useTodosZone();
  const [showAllDone, setShowAllDone] = useState(false);
  const { people, area, setArea, owner, setOwner, ownerLabel, list, groups, pending, open, chat, needs, nextAt, row, add, filtered } = useLoopsBoard();
  // Todos closed from their circle stay where they were, done with Undo,
  // until the pane closes; the refetch has moved them to Done by then.
  const [closed, setClosed] = useState<ReadonlyMap<string, Closed>>(new Map());
  const close = (entry: Closed) => setClosed((current) => new Map(current).set(entry.loop.id, entry));
  const reopen = (id: string) => setClosed((current) => { const next = new Map(current); next.delete(id); return next; });
  const lines = (loops: Loop[], place: Place) => withClosed(loops, place, closed).map((loop, index) => {
    const done = closed.get(loop.id);
    return done ? <JustDoneLine key={loop.id} entry={done} refresh={row.refresh} onUndone={() => reopen(loop.id)} />
      : <LoopLine key={loop.id} loop={loop} place={place} {...row} onClosed={(action) => close({ loop, place, index, action })} />;
  });
  const kept = (place: Place) => [...closed.values()].some((each) => each.place === place);
  // Beside the Bot's own chat, its questions and replies are right there.
  const besideChat = !!people.botThreadId && people.botThreadId === threadId;
  const openChat = people.botThreadId && !besideChat
    ? <button type="button" className={MENU_BUTTON} aria-label={`Open your chat with ${people.botName}`} title="Open chat" onClick={() => navigate.toThread(people.botThreadId!)}><Icon name="MessageSquare" /></button>
    : null;
  const tabWindow = useHostTabWindow();
  const where = besideChat ? "In this chat" : `In your chat with ${people.botName}`;
  return <>
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      {tabWindow ? null : <>
        <Icon name="ListTodo" className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Todos</h2>
      </>}
      {needs ? <span className="rounded-full bg-warning px-1.5 text-xs font-medium leading-4 text-background tabular-nums" aria-label={`${needs} need you now`}>{needs}</span> : null}
      <button type="button" className={cn(ICON_BUTTON, "ml-auto")} aria-label="Open the full Todos page" title="Open the full Todos page" onClick={() => openLoops(people.botId)}>
        <Icon name="Maximize2" className="size-4" />
      </button>
    </header>
    <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
      <AddLoop onAdd={add} compact />
      <div className="flex min-w-0 items-center gap-1">
        <div role="group" aria-label="Area" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {areaChips(groups?.areas, area).map((each) => (
            <button key={each ?? "all"} type="button" aria-pressed={area === each} onClick={() => setArea(each)}
              className="h-7 shrink-0 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground">
              {each ?? "All"}
            </button>
          ))}
        </div>
        <OwnerMenu owner={owner} label={ownerLabel} people={people} onOwner={setOwner}>
          <button type="button" aria-label={`Owner: ${ownerLabel}`} title={`Owner: ${ownerLabel}`}
            className={cn("inline-flex h-7 max-w-32 shrink-0 items-center gap-1 rounded-md px-2 text-xs hover:bg-state-hover data-[state=open]:bg-state-active", owner ? "bg-state-active text-foreground" : "text-muted-foreground")}>
            <Icon name="UserRound" className="size-3.5 shrink-0" /><span className="truncate">{ownerLabel}</span><Icon name="ChevronDown" className="size-3 shrink-0 opacity-60" />
          </button>
        </OwnerMenu>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-6">
      {list.error ? <p role="alert" className="px-3 pt-2 text-xs text-destructive">{list.error}</p> : null}
      {!groups ? <div className="m-3 h-40 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" /> : <>
        {open === 0 && !chat && !closed.size ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center" data-testid="loops-empty">
            <Icon name="ListTodo" className="size-5 text-muted-foreground" />
            <div className="text-sm font-medium">{filtered ? "No todos match" : "No todos"}</div>
          </div>
        ) : <>
          {needs || kept("needs") ? (
            <PaneSection title="Needs you now" count={needs}>
              {pending.map((question) => (
                <PaneRow key={question.id} testId="loop-pending" icon="MessageQuestion" title={question.reason}
                  meta={<span>{where} · {shortWhen(question.createdAt, Date.now(), zone)}</span>} trailing={openChat} />
              ))}
              {lines(groups.needsYouNow, "needs")}
            </PaneSection>
          ) : null}
          {groups.comingUp.length || kept("coming") ? (
            <PaneSection title="Coming up" count={groups.comingUp.length} aside={Number.isFinite(nextAt) ? `Next: ${fullWhen(nextAt, Date.now(), zone)}` : undefined}>
              {lines(groups.comingUp, "coming")}
            </PaneSection>
          ) : null}
          {groups.agentsOnIt.length ? (
            <PaneSection title="Agents on it" count={groups.agentsOnIt.length}>
              {lines(groups.agentsOnIt, "agents")}
            </PaneSection>
          ) : null}
          {groups.waitingOnOthers.length ? (
            <PaneSection title="Waiting on others" count={groups.waitingOnOthers.length}>
              {lines(groups.waitingOnOthers, "waiting")}
            </PaneSection>
          ) : null}
        </>}
        {groups.done.length ? (
          <PaneSection title="Done · last 7 days" count={groups.done.length}
            aside={groups.done.length > DONE_SHOWN ? <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAllDone(!showAllDone)}>{showAllDone ? "Show less" : "Show all"}</button> : undefined}>
            {groups.done.filter((loop) => !closed.has(loop.id)).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, showAllDone ? undefined : DONE_SHOWN).map((loop) => <DoneLine key={loop.id} loop={loop} {...row} />)}
          </PaneSection>
        ) : null}
      </>}
    </div>
  </>;
}

function PaneSection({ title, count, aside, children }: { title: string; count: number; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col pt-3">
      <div className="flex items-center gap-2 px-2 pb-1 text-xs">
        <h3 className="font-medium text-muted-foreground">{title}</h3>
        <span className="text-muted-foreground/70 tabular-nums">{count}</span>
        {aside ? <span className="ml-auto truncate text-muted-foreground">{aside}</span> : null}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function PaneRow({ icon, iconClass, lead, title, meta, trailing, below, testId, muted, drag }: { icon: string; iconClass?: string; lead?: ReactNode; title: ReactNode; meta?: ReactNode; trailing?: ReactNode; below?: ReactNode; testId?: string; muted?: boolean; drag?: ReturnType<typeof loopDragProps> }) {
  return (
    <div className="flex flex-col rounded-md hover:bg-state-hover/40 has-[[data-state=open]]:bg-state-hover/40 data-[dragging]:opacity-50" data-testid={testId} {...drag}>
      <div className="flex min-w-0 items-start gap-2.5 py-1.5 pr-1 pl-2">
        {lead ?? <Icon name={icon} className={cn("mt-1 size-4 shrink-0 text-muted-foreground", iconClass)} />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
          <div className={cn("line-clamp-2 text-sm leading-snug", muted ? "text-muted-foreground" : "text-foreground")}>{title}</div>
          {meta ? <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">{meta}</div> : null}
        </div>
        {trailing}
      </div>
      {below}
    </div>
  );
}

type Place = "needs" | "coming" | "agents" | "waiting";
/** A todo closed from its circle: where it was, and how it closed. */
type Closed = { loop: Loop; place: Place; index: number; action: "done" | "got_it" };

/** A section's todos with the ones just closed from it back at their places. */
export function withClosed(loops: readonly Loop[], place: Place, closed: ReadonlyMap<string, Closed>): Loop[] {
  const list = [...loops];
  const missing = [...closed.values()].filter((each) => each.place === place && !list.some((loop) => loop.id === each.loop.id)).sort((a, b) => a.index - b.index);
  for (const each of missing) list.splice(Math.min(each.index, list.length), 0, each.loop);
  return list;
}

/** Done is one click for the user's do and read todos (read: Got it); decisions and waits have their own actions. */
export const closesFromCircle = (loop: Loop) => loop.owner === "patrick" && (loop.kind === "do" || loop.kind === "read");

/** The row's kind circle as its Done checkbox: a check on hover, Mark done. */
function DoneCircle({ loop, disabled, onDone }: { loop: Loop; disabled: boolean; onDone(): void }) {
  return (
    <button type="button" role="checkbox" aria-checked={false} aria-label={`Mark done: ${loop.title}`} title="Mark done" disabled={disabled} onClick={onDone}
      className="group/done -m-0.5 mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-success/15 hover:text-success focus-visible:bg-success/15 focus-visible:text-success disabled:opacity-50">
      <Icon name={KIND[loop.kind].icon} className="size-4 group-hover/done:hidden group-focus-visible/done:hidden" />
      <Icon name="Check" className="hidden size-3.5 group-hover/done:block group-focus-visible/done:block" />
    </button>
  );
}

/** A todo just closed from its circle, in place: done, struck through, with Undo. */
function JustDoneLine({ entry, refresh, onUndone }: { entry: Closed; refresh(): void; onUndone(): void }) {
  const { update, busy, error } = useLoopActions(refresh);
  const { loop } = entry;
  return (
    <PaneRow testId="loop-just-done" muted icon="CircleCheck" iconClass="text-success" title={<span className="line-through decoration-muted-foreground/60">{loop.title}</span>}
      meta={<span>{entry.action === "got_it" ? "Got it" : "Done"} · just now</span>}
      trailing={
        <button type="button" disabled={busy} aria-label={`Undo: ${loop.title}`} onClick={() => void update({ id: loop.id, changes: { status: "surfaced" } }).then((ok) => ok && onUndone())}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50 [&_svg]:size-3.5">
          <Icon name="ArrowTurnBackward" />Undo
        </button>
      }
      below={error ? <p role="alert" className="px-8 pb-2 text-xs text-destructive">{error}</p> : null} />
  );
}

/** A row's detail line: its parts with a "·" between them, then the area chip. */
function Dotted({ parts, area }: { parts: ReactNode[]; area: string | null }) {
  const shown = parts.filter(Boolean);
  return <>
    {shown.map((part, index) => <span key={index} className="contents">{index ? <span aria-hidden>·</span> : null}{part}</span>)}
    <AreaChip area={area} />
  </>;
}

/** One open todo: its line and its ⋯ menu, with what its section allows. */
function LoopLine({ loop, place, people, places, refresh, held, owners, onClosed }: RowProps & { place: Place; onClosed(action: "done" | "got_it"): void }) {
  const navigate = useBbNavigate();
  const zone = useTodosZone();
  const { act, update, busy, error } = useLoopActions(refresh);
  const discuss = useDiscussLoop(people.botThreadId, people.botName);
  // After Discuss the caret goes to the composer once the menu has closed, not back to ⋯.
  const discussing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState(false);
  const mine = loop.owner === "patrick";
  const owner = owners.get(loop.owner);
  const who = ownerName(loop.owner, { bot: people.botName, leads: people.leads }, owner);
  const thread = ownerThread(loop.owner, people.botThreadId, owner);
  const due = dueLabel(loop.due, Date.now(), zone);
  const trigger = triggerLabel(loop.trigger, Date.now(), held.get(loop.id), zone);
  const source = sourceText(loop.source);
  const working = loop.status === "in_progress";

  // A released todo goes back to waiting on its new trigger, as on the tab.
  const saveTrigger = (changes: { trigger: Loop["trigger"]; push: boolean }) => {
    setEditing(false);
    void update({ id: loop.id, changes: place === "needs" ? { ...changes, status: "queued" } : changes });
  };
  const changeTrigger = <DropdownMenuItem onSelect={() => setEditing(true)}><Icon name="DateTime" />Change when…</DropdownMenuItem>;
  const drop = <DropdownMenuItem onSelect={() => void act({ id: loop.id, action: "drop" })}><Icon name="X" />Dismiss</DropdownMenuItem>;
  const snooze = (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger><Icon name="Clock" />Snooze</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        {SNOOZE.map((preset) => (
          <DropdownMenuItem key={preset.id} onSelect={() => void act({ id: loop.id, action: "snooze", snooze: preset.id })}>
            <Icon name={preset.icon} /><span className="flex-1">{preset.label}</span><span className="text-xs text-muted-foreground">{snoozeHint(preset.id, Date.now(), zone)}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setPicking(true)}><Icon name="Calendar" />Pick a time…</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  let items: ReactNode;
  let meta: ReactNode;
  if (place === "needs") {
    items = loop.kind === "decide" ? <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Choose</DropdownMenuLabel>
      {loop.options.map((option) => (
        <DropdownMenuItem key={option} title={option} onSelect={() => void act({ id: loop.id, action: "choose", option })}>
          <Icon name="Fork" /><span className="truncate">{optionParts(option).label}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />{snooze}{changeTrigger}
    </> : loop.kind === "read" ? <>
      <DropdownMenuItem onSelect={() => void act({ id: loop.id, action: "got_it" })}><Icon name="CircleCheck" />Got it</DropdownMenuItem>
      {snooze}{changeTrigger}
    </> : <>
      <DropdownMenuItem onSelect={() => void act({ id: loop.id, action: "done" })}><Icon name="CircleCheck" />Done</DropdownMenuItem>
      {snooze}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Icon name="ArrowTurnForward" />Give to</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-48">
          {people.targets.map((target) => <DropdownMenuItem key={target.owner} onSelect={() => void act({ id: loop.id, action: "hand_off", owner: target.owner })}><Icon name="Bot" />{target.name}</DropdownMenuItem>)}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {changeTrigger}<DropdownMenuSeparator />{drop}
    </>;
    const detail = loop.why || source;
    meta = <Dotted area={loop.area} parts={[
      due ? <span className={due.urgent ? "text-warning" : undefined}>{due.text}</span> : null,
      loop.kind === "decide" ? <span>{loop.options.length} option{loop.options.length === 1 ? "" : "s"}</span> : null,
      detail ? <span className="min-w-0 truncate" title={detail}>{detail}</span> : null,
    ]} />;
  } else if (place === "coming") {
    items = <>
      {mine ? <DropdownMenuItem onSelect={() => void update({ id: loop.id, surfaceNow: true })}><Icon name="ArrowUp" />Remind me now</DropdownMenuItem> : null}
      {changeTrigger}
    </>;
    meta = <>
      <span className="inline-flex items-center gap-1 text-foreground/80" title={loop.push ? "Sends to iPhone when it fires" : undefined}>
        <Icon name={trigger.icon} className="size-3" />{trigger.text}{loop.push ? <Icon name="Smartphone" className="size-3" aria-label="Sends to iPhone" /> : null}
      </span>
      {mine ? null : <><span aria-hidden>·</span><span className="min-w-0 truncate">{who} will do it</span></>}
      <AreaChip area={loop.area} />
    </>;
  } else if (place === "agents") {
    items = <>
      {thread ? <DropdownMenuItem onSelect={() => navigate.toThread(thread)}><Icon name="MessageSquare" />{loop.owner === "cos" ? "Open chat" : "Open thread"}</DropdownMenuItem> : null}
      <DropdownMenuItem onSelect={() => void update({ id: loop.id, changes: { owner: "patrick", status: "surfaced" } })}><Icon name="ArrowTurnBackward" />Take it back</DropdownMenuItem>
    </>;
    meta = <>
      {working ? <span className="size-1.5 rounded-full bg-success" aria-hidden /> : null}
      <span className="min-w-0 truncate font-medium text-foreground/80">{who}</span>
      <span className="shrink-0">· On it · {elapsed(loop.updatedAt)}</span>
      <AreaChip area={loop.area} />
    </>;
  } else {
    items = <>
      <DropdownMenuItem onSelect={() => void act({ id: loop.id, action: "nudge" }).then((ok) => setNote(ok))}><Icon name="BellDot" />Nudge them</DropdownMenuItem>
      {changeTrigger}<DropdownMenuSeparator />{drop}
    </>;
    meta = <>
      <span>Since {shortWhen(loop.createdAt, Date.now(), zone)}</span>
      {source ? <><span aria-hidden>·</span><span className="min-w-0 truncate">{source}</span></> : null}
      <AreaChip area={loop.area} />
    </>;
  }

  const testId = { needs: "loop-needs", coming: "loop-coming", agents: "loop-agent", waiting: "loop-waiting" }[place];
  const icon = place === "agents" || (place === "coming" && !mine) ? "Bot" : KIND[loop.kind].icon;
  const circle = (place === "needs" || place === "coming") && closesFromCircle(loop) ? (loop.kind === "read" ? "got_it" : "done") : null;
  return <>
    <PaneRow testId={testId} drag={loopDragProps(loop)} icon={icon} iconClass={place === "agents" && working ? "text-success" : undefined} title={loop.title} meta={meta}
      lead={circle ? <DoneCircle loop={loop} disabled={busy} onDone={() => void act({ id: loop.id, action: circle }).then((ok) => ok && onClosed(circle))} /> : undefined}
      trailing={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={MENU_BUTTON} disabled={busy} aria-label={`Actions: ${loop.title}`} title="Actions"><Icon name="MoreHorizontal" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48" onCloseAutoFocus={(event) => { if (discussing.current) { discussing.current = false; event.preventDefault(); focusDiscussed(people.botThreadId); } }}>
            <DropdownMenuItem onSelect={() => { discussing.current = true; void discuss(loop, { focus: false }); }}><Icon name="MessageCirclePlus" />Discuss</DropdownMenuItem>
            <DropdownMenuSeparator />
            {items}
          </DropdownMenuContent>
        </DropdownMenu>
      }
      below={<>
        {editing ? (
          <div className="mx-2 mb-2 rounded-lg border border-border bg-background p-3" data-testid="loop-trigger-inline">
            <TriggerForm loop={loop} places={places} onCancel={() => setEditing(false)} onSave={saveTrigger} />
          </div>
        ) : null}
        {note ? <p role="status" className="px-8 pb-2 text-xs text-muted-foreground">{people.botName} is drafting a nudge in the chat.</p> : null}
        {error ? <p role="alert" className="px-8 pb-2 text-xs text-destructive">{error}</p> : null}
      </>} />
    {picking ? <PickTime onClose={() => setPicking(false)} onPick={(at) => { setPicking(false); void update({ id: loop.id, changes: { status: "snoozed", trigger: { type: "time", at } } }); }} /> : null}
  </>;
}

function DoneLine({ loop, people, refresh }: RowProps) {
  const { update, busy } = useLoopActions(refresh);
  const zone = useTodosZone();
  const dropped = loop.status === "dropped";
  const by = loop.closedBy === "patrick" ? "You" : loop.closedBy === "cos" ? people.botName : loop.closedBy ?? "";
  return (
    <PaneRow testId="loop-done" muted icon={dropped ? "X" : "CircleCheck"} iconClass={dropped ? undefined : "text-success"} title={loop.title}
      meta={<span>{by}{by ? " · " : ""}{loop.closedAt ? fullWhen(loop.closedAt, Date.now(), zone) : ""}</span>}
      trailing={
        <button type="button" aria-label={`Undo: ${loop.title}`} title="Undo" disabled={busy} onClick={() => void update({ id: loop.id, changes: { status: "surfaced" } })} className={MENU_BUTTON}>
          <Icon name="ArrowTurnBackward" />
        </button>
      } />
  );
}

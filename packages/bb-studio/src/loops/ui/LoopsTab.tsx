// The Bot page's Loops tab (bot/<botId>/loops): everything the Chief of Staff
// tracks for Patrick, in five sections: Needs you now (with the Bot chat's
// pending questions, read-only and counted once), Coming up, Agents on it,
// Waiting on others and Done in the last seven days. Area chips and an Owner
// menu filter it; "Add a loop" hands a typed line to the Bot to fill in.
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { errorMessage } from "../../kit/format";
import type { Loop } from "../contract";
import { CARD_BUTTON, CARD_GHOST, CARD_PRIMARY, ChangeTrigger, ChooseSheet, HandOffMenu, OptionButton, SnoozeMenu } from "./LoopMenus";
import { AREAS, dueLabel, elapsed, fullWhen, INLINE_OPTIONS, KIND, ownerName, ownerThread, shortWhen, sourceText, triggerLabel } from "./model";
import { useLoopActions, useLoopPeople, usePlaceNames, type LoopPeople } from "./hooks";

// A row's actions show on hover or keyboard focus (and always on touch), and
// stay while one of their menus is open; hidden, they take no room.
const ROW_ACTIONS = "hidden items-center gap-1.5 group-hover:flex group-focus-within:flex group-has-[[data-state=open]]:flex [@media(hover:none)]:flex";
const DONE_SHOWN = 3;

type Pending = { id: string; reason: string; createdAt: number };

/** The Bot chat's pending questions and approvals (one inbox, decision 8). */
export function usePendingQuestions(threadId: string | null): Pending[] {
  const sdk = useSdk();
  const [pending, setPending] = useState<Pending[]>([]);
  useEffect(() => {
    if (!threadId) { setPending([]); return; }
    let live = true;
    const load = () => void sdk.threads.interactions.list({ threadId }).then((list) => {
      if (!live) return;
      const items = (list as { id?: string; status?: string; createdAt?: number; payload?: { kind?: string } | null }[])
        .filter((each) => each.status === "pending" && each.id)
        .map((each) => ({ id: each.id!, createdAt: each.createdAt ?? Date.now(), reason: each.payload?.kind === "approval" ? "Waiting for your approval" : "Asked you a question" }));
      setPending(items);
    }, () => {});
    load();
    const timer = setInterval(load, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [sdk, threadId]);
  return pending;
}

export function LoopsTab() {
  const people = useLoopPeople();
  const call = useCall();
  const navigate = useBbNavigate();
  const [area, setArea] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const filters = { ...(area ? { area } : {}), ...(owner ? { owner } : {}) };
  const list = useLive("loops.list", filters, { pollMs: 60_000 });
  const places = usePlaceNames(true);
  const pending = usePendingQuestions(people.botThreadId)
    // A question the Bot tracks as a loop shows once, as the loop.
    .filter((question) => !(list.data?.needsYouNow ?? []).some((loop) => loop.source?.kind === "interaction" && loop.source.ref === question.id));
  const showPending = !owner || owner === "patrick";
  const groups = list.data;
  const [showAllDone, setShowAllDone] = useState(false);
  const open = groups ? groups.needsYouNow.length + groups.comingUp.length + groups.agentsOnIt.length + groups.waitingOnOthers.length : 0;
  const needs = (groups?.needsYouNow.length ?? 0) + (showPending ? pending.length : 0);
  const nextAt = groups?.comingUp.map((loop) => loop.trigger.type === "time" ? loop.trigger.at ?? Infinity : Infinity).reduce((a, b) => Math.min(a, b), Infinity) ?? Infinity;
  const ownerLabel = owner === null ? "Anyone" : owner === "patrick" ? "Me" : ownerName(owner, { bot: people.botName, leads: people.leads });
  const row = { people, places, refresh: list.refresh };
  return (
    <div className="flex flex-col gap-4 px-4 pb-8" data-testid="loops-tab">
      <AddLoop onAdd={(text) => call("loops.add", { text }).then(() => list.refresh())} botName={people.botName} />
      <div className="flex flex-wrap items-center gap-1">
        {[null, ...AREAS].map((each) => (
          <button key={each ?? "all"} type="button" aria-pressed={area === each} onClick={() => setArea(each)}
            className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground">
            {each ?? "All"}
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(CARD_BUTTON, "ml-auto h-8 px-3 text-sm")} aria-label={`Owner: ${ownerLabel}`}><Icon name="UserRound" />Owner: {ownerLabel}<Icon name="ChevronDown" className="opacity-60" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Owner</DropdownMenuLabel>
            {[{ owner: null, name: "Anyone" }, { owner: "patrick", name: "Me" }, people.targets[0]!].map((each) => (
              <DropdownMenuItem key={each.owner ?? "anyone"} onSelect={() => setOwner(each.owner)}>
                <Icon name="Check" className={owner === each.owner ? "" : "invisible"} />{each.name}
              </DropdownMenuItem>
            ))}
            {people.targets.length > 1 ? <DropdownMenuSeparator /> : null}
            {people.targets.slice(1).map((each) => (
              <DropdownMenuItem key={each.owner} onSelect={() => setOwner(each.owner)}>
                <Icon name="Check" className={owner === each.owner ? "" : "invisible"} />{each.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {list.error ? <p role="alert" className="text-xs text-destructive">{list.error}</p> : null}
      {!groups ? <div className="h-40 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" /> : <>
        {open === 0 && !(showPending && pending.length) ? (
          <div className="flex flex-col items-center gap-1.5 py-10 text-center" data-testid="loops-empty">
            <Icon name="ListTodo" className="size-5 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">{area || owner ? "No open loops match" : "No open loops"}</div>
            <p className="max-w-md text-sm text-muted-foreground">When email, calls or chats need you, {people.botName} adds a loop here and brings it back at the right moment. You can also add one above.</p>
          </div>
        ) : <>
          {needs ? (
            <Section title="Needs you now" count={needs}>
              {showPending ? pending.map((question) => (
                <Row key={question.id} icon="MessageQuestion" title={question.reason} testId="loop-pending"
                  subtitle={<>In your chat with {people.botName} · {shortWhen(question.createdAt)}</>}
                  right={people.botThreadId ? <button type="button" className={CARD_GHOST} onClick={() => navigate.toThread(people.botThreadId!)}><Icon name="MessageSquare" />Open chat</button> : null} />
              )) : null}
              {groups.needsYouNow.map((loop) => <NeedsYouRow key={loop.id} loop={loop} {...row} />)}
            </Section>
          ) : null}
          {groups.comingUp.length ? (
            <Section title="Coming up" count={groups.comingUp.length} aside={Number.isFinite(nextAt) ? `Next: ${fullWhen(nextAt)}` : undefined}>
              {groups.comingUp.map((loop) => <ComingUpRow key={loop.id} loop={loop} {...row} />)}
            </Section>
          ) : null}
          {groups.agentsOnIt.length ? (
            <Section title="Agents on it" count={groups.agentsOnIt.length}>
              {groups.agentsOnIt.map((loop) => <AgentRow key={loop.id} loop={loop} {...row} />)}
            </Section>
          ) : null}
          {groups.waitingOnOthers.length ? (
            <Section title="Waiting on others" count={groups.waitingOnOthers.length}>
              {groups.waitingOnOthers.map((loop) => <WaitingRow key={loop.id} loop={loop} {...row} />)}
            </Section>
          ) : null}
        </>}
        {groups.done.length ? (
          <Section title="Done · last 7 days" count={groups.done.length}
            aside={groups.done.length > DONE_SHOWN ? <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setShowAllDone(!showAllDone)}>{showAllDone ? "Show less" : "Show all"}</button> : undefined}>
            {[...groups.done].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, showAllDone ? undefined : DONE_SHOWN).map((loop) => <DoneRow key={loop.id} loop={loop} {...row} />)}
          </Section>
        ) : null}
      </>}
    </div>
  );
}

function AddLoop({ onAdd, botName }: { onAdd(text: string): Promise<unknown>; botName: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const submit = async () => {
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true); setNote(null);
    try { await onAdd(line); setText(""); setNote({ text: `Added. ${botName} is filling it in.`, error: false }); }
    catch (cause) { setNote({ text: errorMessage(cause), error: true }); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1">
      <form className="flex h-11 items-center gap-2 rounded-lg border border-border px-3 focus-within:border-ring" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Icon name="Plus" className="size-4 shrink-0 text-muted-foreground" />
        <input aria-label="Add a loop" value={text} disabled={busy} maxLength={500} onChange={(e) => setText(e.target.value)}
          placeholder="Add a loop: “call the plumber when I’m home”" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        <button type="submit" aria-label="Add" disabled={!text.trim() || busy}
          className="inline-flex h-6 items-center rounded border border-border px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Icon name="CornerDownLeft" className="size-3.5" />
        </button>
      </form>
      {note ? <p role={note.error ? "alert" : "status"} className={cn("px-1 text-xs", note.error ? "text-destructive" : "text-muted-foreground")}>{note.text}</p> : null}
    </div>
  );
}

function Section({ title, count, aside, children }: { title: string; count: number; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-border pb-2 text-sm">
        <h3 className="font-medium text-muted-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground/70 tabular-nums">{count}</span>
        {aside ? <span className="ml-auto text-sm text-muted-foreground">{aside}</span> : null}
      </div>
      <div className="flex flex-col divide-y divide-border">{children}</div>
    </section>
  );
}

function AreaChip({ area }: { area: string | null }) {
  return area ? <span className="shrink-0 rounded border border-border px-1.5 text-xs leading-5 text-muted-foreground">{area}</span> : null;
}

function Row({ icon, iconClass, title, subtitle, right, actions, testId, muted }: { icon: string; iconClass?: string; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; actions?: ReactNode; testId?: string; muted?: boolean }) {
  return (
    <div tabIndex={actions ? 0 : undefined} className="group flex flex-col gap-1.5 py-2.5 outline-none hover:bg-state-hover/40 focus-within:bg-state-hover/40" data-testid={testId}>
      <div className="flex min-w-0 items-start gap-3 px-2">
        <Icon name={icon} className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", iconClass)} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className={cn("truncate text-sm", muted ? "text-muted-foreground" : "text-foreground")}>{title}</div>
          {subtitle ? <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{right}</div> : null}
      </div>
      {actions ? <div className={cn("flex-wrap pl-9 pr-2", ROW_ACTIONS)}>{actions}</div> : null}
    </div>
  );
}

function Subtitle({ loop, extra }: { loop: Loop; extra?: ReactNode }) {
  const source = sourceText(loop.source);
  return <>
    {extra}
    {loop.why ? <span className="min-w-0 truncate">{loop.why}</span> : null}
    {source ? <span className="flex shrink-0 items-center gap-1.5">{loop.why || extra ? <span aria-hidden>·</span> : null}{source}</span> : null}
    <AreaChip area={loop.area} />
  </>;
}

type RowProps = { loop: Loop; people: LoopPeople; places: string[]; refresh(): void };

function TriggerButton({ loop, places, onSave }: { loop: Loop; places: string[]; onSave(changes: { trigger: Loop["trigger"]; push: boolean }): void }) {
  return <ChangeTrigger loop={loop} places={places} onSave={onSave} />;
}

function NeedsYouRow({ loop, people, places, refresh }: RowProps) {
  const { act, update, busy, error } = useLoopActions(refresh);
  const due = dueLabel(loop.due);
  const retrigger = (changes: { trigger: Loop["trigger"]; push: boolean }) => void update({ id: loop.id, changes: { ...changes, status: "queued" } });
  const snooze = <SnoozeMenu disabled={busy} onSnooze={(preset) => void act({ id: loop.id, action: "snooze", snooze: preset })} onPick={(at) => void update({ id: loop.id, changes: { status: "snoozed", trigger: { type: "time", at } } })} />;
  const drop = <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void act({ id: loop.id, action: "drop" })}><Icon name="X" />Drop</button>;
  const actions = loop.kind === "decide" ? <>
    {loop.options.length > INLINE_OPTIONS ? <ChooseSheet loop={loop} disabled={busy} onChoose={(option) => void act({ id: loop.id, action: "choose", option })} />
      : loop.options.map((option) => <OptionButton key={option} option={option} disabled={busy} onChoose={() => void act({ id: loop.id, action: "choose", option })} />)}
    {snooze}
  </> : loop.kind === "read" ? <>
    <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: loop.id, action: "got_it" })}><Icon name="CircleCheck" />Got it</button>
    {snooze}
  </> : <>
    <button type="button" className={CARD_PRIMARY} disabled={busy} onClick={() => void act({ id: loop.id, action: "done" })}><Icon name="CircleCheck" />Done</button>
    {snooze}
    <HandOffMenu targets={people.targets} disabled={busy} onHandOff={(owner) => void act({ id: loop.id, action: "hand_off", owner })} />
    {drop}
  </>;
  return <>
    <Row testId="loop-needs" icon={KIND[loop.kind].icon} title={loop.title} subtitle={<Subtitle loop={loop} />}
      right={due ? <span className={due.urgent ? "text-warning" : undefined}>{due.text}</span> : null}
      actions={<>{actions}<span className="ml-auto" /><TriggerButton loop={loop} places={places} onSave={retrigger} /></>} />
    {error ? <p role="alert" className="px-9 pb-2 text-xs text-destructive">{error}</p> : null}
  </>;
}

function ComingUpRow({ loop, places, refresh }: RowProps) {
  const { update, busy, error } = useLoopActions(refresh);
  const trigger = triggerLabel(loop.trigger);
  return <>
    <Row testId="loop-coming" icon={KIND[loop.kind].icon} title={<span className="flex min-w-0 items-center gap-2"><span className="truncate">{loop.title}</span><AreaChip area={loop.area} /></span>}
      right={<>
        <span className={ROW_ACTIONS}>
          <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void update({ id: loop.id, surfaceNow: true })}><Icon name="ArrowUp" />Surface now</button>
          <TriggerButton loop={loop} places={places} onSave={(changes) => void update({ id: loop.id, changes })} />
        </span>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-foreground" title={loop.push ? "Sends to iPhone when it fires" : undefined}>
          <Icon name={trigger.icon} className="size-3.5 text-muted-foreground" />{trigger.text}{loop.push ? <Icon name="Smartphone" className="size-3 text-muted-foreground" /> : null}
        </span>
      </>} />
    {error ? <p role="alert" className="px-9 pb-2 text-xs text-destructive">{error}</p> : null}
  </>;
}

function AgentRow({ loop, people, refresh }: RowProps) {
  const navigate = useBbNavigate();
  const { update, busy } = useLoopActions(refresh);
  const thread = ownerThread(loop.owner, people.botThreadId);
  const working = loop.status === "in_progress";
  return (
    <Row testId="loop-agent" icon="Bot" iconClass={working ? "text-success" : undefined} title={loop.title}
      subtitle={<>
        {working ? <span className="size-1.5 rounded-full bg-success" aria-hidden /> : null}
        <span className="font-medium text-foreground">{ownerName(loop.owner, { bot: people.botName, leads: people.leads })}</span>
        <span aria-hidden>·</span><span>{working ? `On it · ${elapsed(loop.updatedAt)}` : "Waiting to start"}</span>
        <AreaChip area={loop.area} />
      </>}
      right={<>
        <span className={ROW_ACTIONS}><button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void update({ id: loop.id, changes: { owner: "patrick", status: "surfaced" } })}><Icon name="ArrowTurnBackward" />Take it back</button></span>
        {thread ? <button type="button" className={CARD_GHOST} onClick={() => navigate.toThread(thread)}><Icon name="MessageSquare" />Open thread</button> : null}
      </>} />
  );
}

function WaitingRow({ loop, people, places, refresh }: RowProps) {
  const { act, update, busy, error } = useLoopActions(refresh);
  const [note, setNote] = useState(false);
  return <>
    <Row testId="loop-waiting" icon={KIND.waiting.icon} title={loop.title} subtitle={<Subtitle loop={loop} />}
      right={<>
        <span>Since {shortWhen(loop.createdAt)}</span>
        <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: loop.id, action: "nudge" }).then((ok) => setNote(ok))}><Icon name="BellDot" />Nudge them</button>
      </>}
      actions={<>
        <TriggerButton loop={loop} places={places} onSave={(changes) => void update({ id: loop.id, changes })} />
        <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void act({ id: loop.id, action: "drop" })}><Icon name="X" />Drop</button>
      </>} />
    {note ? <p role="status" className="px-9 pb-2 text-xs text-muted-foreground">{people.botName} is drafting a nudge for you to approve in the chat.</p> : null}
    {error ? <p role="alert" className="px-9 pb-2 text-xs text-destructive">{error}</p> : null}
  </>;
}

function DoneRow({ loop, people, refresh }: RowProps) {
  const { update, busy } = useLoopActions(refresh);
  const dropped = loop.status === "dropped";
  const by = loop.closedBy === "patrick" ? "You" : loop.closedBy === "cos" ? people.botName : loop.closedBy ?? "";
  return (
    <Row testId="loop-done" muted icon={dropped ? "X" : "CircleCheck"} iconClass={dropped ? undefined : "text-success"} title={loop.title}
      right={<>
        <span className="text-xs">{by}{by ? " · " : ""}{loop.closedAt ? fullWhen(loop.closedAt) : ""}</span>
        <button type="button" aria-label={`Undo: ${loop.title}`} title="Undo" disabled={busy} onClick={() => void update({ id: loop.id, changes: { status: "surfaced" } })}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50">
          <Icon name="ArrowTurnBackward" className="size-3.5" />
        </button>
      </>} />
  );
}

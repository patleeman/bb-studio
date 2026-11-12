import { useBbNavigate, type JsonValue } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { Icon } from "../../kit/ui/icon";
import { NotFoundTab } from "../../links/NotFoundTab";
import { linkFor } from "../../links/router";
import { BotItemDetail, BotItemError, type BotPageFact } from "../../ui/bot-page/BotItemDetail";
import { useLive } from "../../ui/live";
import type { Loop } from "../contract";
import { ChangeTrigger, ChooseSheet, HandOffMenu, OptionButton, SnoozeMenu, CARD_BUTTON, CARD_GHOST, CARD_PRIMARY } from "./LoopMenus";
import { fullWhen, INLINE_OPTIONS, ownerName, ownerThread, safeUrl, sourceText, triggerLabel, type OwnerInfo } from "./model";
import { useDiscussLoop, useLoopActions, useLoopPeople, usePlaceNames, type LoopPeople } from "./hooks";

export const entryId = (params: JsonValue | null): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return typeof params.id === "string" && params.id ? params.id : null;
};

export function TodoTab({ params }: { params: JsonValue | null }) {
  const id = entryId(params);
  const people = useLoopPeople();
  const places = usePlaceNames(true);
  const live = useLive("loops.get", { id: id ?? "" }, { enabled: !!id, pollMs: 60_000 });
  if (id && live.error && !live.data && !/not found/i.test(live.error)) return <BotItemError message={live.error} />;
  if (!id || (live.error && !live.data)) return <NotFoundTab params={{ kind: "todo", id, link: id ? linkFor({ kind: "todo", id }) : "bb://todo" }} />;
  if (!live.data) return null;
  return <TodoDetail key={id} loop={live.data.loop} people={people} places={places} owner={live.data.owner} refresh={live.refresh} />;
}

export function TodoDetail({ loop, people, places, owner, refresh }: { loop: Loop; people: LoopPeople; places: string[]; owner: OwnerInfo | undefined; refresh(): void }) {
  const navigate = useBbNavigate();
  const { act, update, busy, error } = useLoopActions(refresh);
  const discuss = useDiscussLoop(people.botThreadId, people.botName);
  const [nudged, setNudged] = useState(false);
  const closed = loop.closedAt !== null;
  const mine = loop.owner === "patrick";
  const trigger = loop.trigger.type === "none" ? null : triggerLabel(loop.trigger);
  const source = sourceText(loop.source);
  const url = safeUrl(loop.source?.url);
  const thread = ownerThread(loop.owner, people.botThreadId, owner);
  const sourceThread = loop.source?.kind === "thread" ? loop.source.ref : null;
  const by = loop.closedBy === "patrick" ? "You" : loop.closedBy === "cos" ? people.botName : loop.closedBy;
  const facts: BotPageFact[] = [
    ...(loop.due !== null ? [{ label: "Due", value: fullWhen(loop.due) }] : []),
    ...(trigger ? [{ label: "When", value: <span className="inline-flex items-center gap-1.5">{trigger.text}{loop.push ? <Icon name="Smartphone" aria-label="Sends to iPhone" className="size-3.5 text-muted-foreground" /> : null}</span> }] : []),
    ...(loop.area ? [{ label: "Area", value: loop.area }] : []),
    { label: "Owner", value: ownerName(loop.owner, { bot: people.botName, leads: people.leads }, owner) },
    ...(source ? [{ label: "Source", value: url ? <a href={url} target="_blank" rel="noreferrer" className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">{source}</a>
      : sourceThread ? <button type="button" className="underline decoration-border underline-offset-2 hover:decoration-foreground" onClick={() => navigate.toThread(sourceThread)}>{source}</button> : source }] : []),
    ...(closed && loop.closedAt ? [{ label: loop.status === "dropped" ? "Dropped" : "Done", value: `${by ? `${by} · ` : ""}${fullWhen(loop.closedAt)}` }] : []),
  ];
  const snooze = <SnoozeMenu disabled={busy} onSnooze={(preset) => void act({ id: loop.id, action: "snooze", snooze: preset })} onPick={(at) => void update({ id: loop.id, changes: { status: "snoozed", trigger: { type: "time", at } } })} />;
  const drop = <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void act({ id: loop.id, action: "drop" })}><Icon name="X" />Drop</button>;
  const discussButton = <button type="button" className={CARD_GHOST} disabled={busy} aria-label={`Discuss: ${loop.title}`} title={`Discuss with ${people.botName}`} onClick={() => void discuss(loop)}><Icon name="MessageCirclePlus" />Discuss</button>;
  const retrigger = <ChangeTrigger loop={loop} places={places} disabled={busy} onSave={(changes) => void update({ id: loop.id, changes: mine && loop.status === "surfaced" ? { ...changes, status: "queued" } : changes })} />;
  const actions = closed ? (
    <button type="button" className={CARD_BUTTON} disabled={busy} aria-label={`Undo: ${loop.title}`} onClick={() => void update({ id: loop.id, changes: { status: "surfaced" } })}><Icon name="ArrowTurnBackward" />Undo</button>
  ) : loop.kind === "waiting" ? <>
    <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: loop.id, action: "nudge" }).then((ok) => setNudged(ok))}><Icon name="BellDot" />Nudge them</button>
    {discussButton}{retrigger}{drop}
  </> : !mine ? <>
    {thread ? <button type="button" className={CARD_BUTTON} onClick={() => navigate.toThread(thread)}><Icon name="MessageSquare" />{loop.owner === "cos" ? "Open chat" : "Open thread"}</button> : null}
    <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void update({ id: loop.id, changes: { owner: "patrick", status: "surfaced" } })}><Icon name="ArrowTurnBackward" />Take it back</button>
    {discussButton}
  </> : <>
    {loop.kind === "decide" ? (loop.options.length > INLINE_OPTIONS
      ? <ChooseSheet loop={loop} disabled={busy} onChoose={(option) => void act({ id: loop.id, action: "choose", option })} />
      : loop.options.map((option) => <OptionButton key={option} option={option} disabled={busy} onChoose={() => void act({ id: loop.id, action: "choose", option })} />))
      : loop.kind === "read" ? <button type="button" className={CARD_BUTTON} disabled={busy} onClick={() => void act({ id: loop.id, action: "got_it" })}><Icon name="CircleCheck" />Got it</button>
        : <button type="button" className={CARD_PRIMARY} disabled={busy} onClick={() => void act({ id: loop.id, action: "done" })}><Icon name="CircleCheck" />Done</button>}
    {loop.status === "surfaced" ? null : <button type="button" className={CARD_GHOST} disabled={busy} onClick={() => void update({ id: loop.id, surfaceNow: true })}><Icon name="ArrowUp" />Surface now</button>}
    {snooze}
    {loop.kind === "do" ? <HandOffMenu targets={people.targets} disabled={busy} onHandOff={(owner) => void act({ id: loop.id, action: "hand_off", owner })} /> : null}
    {discussButton}{retrigger}{drop}
  </>;
  return (
    <BotItemDetail testId="todo-detail" title={loop.title} facts={facts} actions={<>
      {actions}
      {nudged ? <p role="status" className="w-full text-xs text-muted-foreground">{people.botName} is drafting a nudge in the chat.</p> : null}
      {error ? <p role="alert" className="w-full text-xs text-destructive">{error}</p> : null}
    </>}>
      {loop.why ? <p data-testid="todo-why" className="text-sm whitespace-pre-wrap text-foreground">{loop.why}</p> : null}
    </BotItemDetail>
  );
}

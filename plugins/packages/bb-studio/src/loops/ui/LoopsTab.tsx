// What the Todos pane (LoopsPane.tsx) and the Bot page share about todos:
// the Bot chat's pending questions, what needs Patrick now, the board's
// filtered sections, the Owner menu, "Add a todo" and the area chip. The
// Todos page itself is TodosPage.tsx.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Icon, cn } from "../../kit/ui/index";
import { useCall, useLive } from "../../ui/live";
import { errorMessage } from "../../kit/format";
import type { Loop } from "../contract";
import { ownerName, type Hold, type OwnerInfo } from "./model";
import { useLoopPeople, usePlaceNames, type LoopPeople } from "./hooks";


/** `text`: the question's own words, when it has them (the Bot page's Needs you shows it). */
export type Pending = { id: string; reason: string; createdAt: number; text?: string | null };
type Payload = { kind?: string; title?: string; questions?: { prompt?: string; question?: string }[]; data?: { title?: string; questions?: { question?: string }[] } | null };
const questionText = (payload: Payload | null | undefined) => payload?.questions?.[0]?.prompt ?? payload?.questions?.[0]?.question ?? payload?.data?.questions?.[0]?.question ?? (payload?.kind === "approval" ? payload.title ?? null : null);

/** The Bot chat's pending questions and approvals (one inbox, decision 8). */
export function usePendingQuestions(threadId: string | null): Pending[] {
  const sdk = useSdk();
  const [pending, setPending] = useState<Pending[]>([]);
  useEffect(() => {
    if (!threadId) { setPending([]); return; }
    let live = true;
    const load = () => void sdk.threads.interactions.list({ threadId }).then((list) => {
      if (!live) return;
      const items = (list as { id?: string; status?: string; createdAt?: number; payload?: Payload | null }[])
        .filter((each) => each.status === "pending" && each.id)
        .map((each) => ({ id: each.id!, createdAt: each.createdAt ?? Date.now(), reason: each.payload?.kind === "approval" ? "Waiting for your approval" : "Asked you a question", text: questionText(each.payload) }));
      setPending(items);
    }, () => {});
    load();
    const timer = setInterval(load, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [sdk, threadId]);
  return pending;
}

/**
 * What needs Patrick now on the Todos page and pane: released todos and the
 * Bot chat's pending questions (a tracked question once, as its todo). A
 * reply he hasn't read is the chat's unread state, not a todo.
 */
export function useNeedsYou(botThreadId: string | null, needsYouNow: readonly Loop[] | undefined) {
  const pending = usePendingQuestions(botThreadId)
    .filter((question) => !(needsYouNow ?? []).some((loop) => loop.source?.kind === "interaction" && loop.source.ref === question.id));
  return { pending, count: (needsYouNow?.length ?? 0) + pending.length };
}

/**
 * What the Todos tab and the Todos pane show: the filtered sections, the Bot
 * chat's items that count as needing Patrick, and the filters' state.
 */
export function useLoopsBoard() {
  const people = useLoopPeople();
  const call = useCall();
  const [area, setArea] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const filters = { ...(area ? { area } : {}), ...(owner ? { owner } : {}) };
  const list = useLive("loops.list", filters, { pollMs: 60_000 });
  const places = usePlaceNames(true);
  const { pending } = useNeedsYou(people.botThreadId, list.data?.needsYouNow);
  const showPending = !owner || owner === "patrick";
  const groups = list.data;
  const open = groups ? groups.needsYouNow.length + groups.comingUp.length + groups.agentsOnIt.length + groups.waitingOnOthers.length : 0;
  const chat = showPending ? pending.length : 0;
  const needs = (groups?.needsYouNow.length ?? 0) + chat;
  const held = new Map((groups?.held ?? []).map((each) => [each.id, each.reason] as const));
  const owners = new Map((groups?.owners ?? []).map((each) => [each.owner, each] as const));
  const nextAt = groups?.comingUp.map((loop) => loop.trigger.type === "time" && !held.has(loop.id) ? loop.trigger.at ?? Infinity : Infinity).reduce((a, b) => Math.min(a, b), Infinity) ?? Infinity;
  const ownerLabel = owner === null ? "Anyone" : owner === "patrick" ? "Me" : ownerName(owner, { bot: people.botName, leads: people.leads }, owners.get(owner));
  const row: Omit<RowProps, "loop"> = { people, places, refresh: list.refresh, held, owners };
  const add = (text: string) => call("loops.add", { text }).then(() => list.refresh());
  return { people, area, setArea, owner, setOwner, ownerLabel, list, groups, pending: showPending ? pending : [], open, chat, needs, nextAt, row, add, filtered: !!(area || owner) };
}

/** The Owner filter's menu: Anyone, Me, the Bot, then each project's lead. */
export function OwnerMenu({ owner, label, people, onOwner, children }: { owner: string | null; label: string; people: LoopPeople; onOwner(owner: string | null): void; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" aria-label={`Owner: ${label}`}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Owner</DropdownMenuLabel>
        {[{ owner: null, name: "Anyone" }, { owner: "patrick", name: "Me" }, people.targets[0]!].map((each) => (
          <DropdownMenuItem key={each.owner ?? "anyone"} onSelect={() => onOwner(each.owner)}>
            <Icon name="Check" className={owner === each.owner ? "" : "invisible"} />{each.name}
          </DropdownMenuItem>
        ))}
        {people.targets.length > 1 ? <DropdownMenuSeparator /> : null}
        {people.targets.slice(1).map((each) => (
          <DropdownMenuItem key={each.owner} onSelect={() => onOwner(each.owner)}>
            <Icon name="Check" className={owner === each.owner ? "" : "invisible"} />{each.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Add a todo": a typed line the Bot fills in. `compact` for the narrow pane. */
export function AddLoop({ onAdd, compact = false }: { onAdd(text: string): Promise<unknown>; compact?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const submit = async () => {
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true); setNote(null);
    try { await onAdd(line); setText(""); setNote({ text: "Added.", error: false }); }
    catch (cause) { setNote({ text: errorMessage(cause), error: true }); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1">
      <form className={cn("flex items-center gap-2 rounded-lg border border-border px-3 focus-within:border-ring", compact ? "h-9" : "h-11")} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Icon name="Plus" className="size-4 shrink-0 text-muted-foreground" />
        <input aria-label="Add a todo" value={text} disabled={busy} maxLength={500} onChange={(e) => setText(e.target.value)}
          placeholder="Add a todo" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        <button type="submit" aria-label="Add" disabled={!text.trim() || busy}
          className="inline-flex h-6 items-center rounded border border-border px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Icon name="CornerDownLeft" className="size-3.5" />
        </button>
      </form>
      {note ? <p role={note.error ? "alert" : "status"} className={cn("px-1 text-xs", note.error ? "text-destructive" : "text-muted-foreground")}>{note.text}</p> : null}
    </div>
  );
}

export function AreaChip({ area }: { area: string | null }) {
  return area ? <span className="shrink-0 rounded border border-border px-1.5 text-xs leading-5 text-muted-foreground">{area}</span> : null;
}

export type RowProps = { loop: Loop; people: LoopPeople; places: string[]; refresh(): void; held: ReadonlyMap<string, Hold>; owners: ReadonlyMap<string, OwnerInfo> };

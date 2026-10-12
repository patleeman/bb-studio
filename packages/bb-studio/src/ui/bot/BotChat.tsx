// The Bot's own chat: its whole handoff chain read as one conversation over
// BB's thread APIs (threads.timeline, live through the realtime
// `thread:changed` signal), drawn calm and messaging-style. Bot replies are
// plain text beside its avatar, the user's are soft bubbles; tool steps fold
// into one Working line, threads it starts are compact cards, and a pending
// question or approval is answered right above the composer.
import { openAppPath } from "@bb-studio/kit/app";
import { Icon } from "@bb-studio/kit/ui";
import { Markdown, useSdk } from "@get-bb/plugin-sdk/app";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BotThreadView } from "../../contract";
import { TALK_FIELD_ATTR, TALK_FIELD_LABEL_ATTR, TALK_INSERT_EVENT, toggleTalk, useTalk } from "../../pages/ui/talk";
import { BotAvatar } from "./BotAvatar";
import { chatEntries, inlineAsk, mergeChain, type ChatEntry, type ChildStatus, type InlineAsk } from "./chat-model";

const PAGE_SEGMENTS = "40";
const REFRESH_MS = 120;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TALK_FIELD = "studio-bot-chat";
const WORKING = new Set(["active", "starting", "stopping", "pending"]);
const threadPath = (id: string) => `/threads/${encodeURIComponent(id)}`;

type Sdk = ReturnType<typeof useSdk>;
type Cursor = { anchorId: string; anchorSeq: number } | null;
interface ThreadRows { latest: unknown[]; older: unknown[]; cursor: Cursor; hasOlder: boolean }

export interface BotIdentity { name: string; avatar: string; shape: string | null; color: string | null }

export interface BotChatProps {
  /** The Bot's thread and the ones it handed off from, oldest first; the last is live. */
  threadIds: string[];
  bot: BotIdentity;
  /** Live status of threads the Bot started (from its Activity), for their cards. */
  childStatus: ReadonlyMap<string, ChildStatus>;
  /** Other threads waiting on the user. */
  needsYou: BotThreadView[];
  onWorkingChange?(working: boolean): void;
  onStarter(starter: Starter): void;
}

export type Starter = { kind: "send"; text: string } | { kind: "preset"; preset: "morning" } | { kind: "customize" };
export const STARTERS: { label: string; starter: Starter }[] = [
  { label: "Plan my week", starter: { kind: "send", text: "Help me plan my week." } },
  { label: "What needs me today?", starter: { kind: "send", text: "What needs me today?" } },
  { label: "Set up a morning brief", starter: { kind: "preset", preset: "morning" } },
  { label: "Customize me", starter: { kind: "customize" } },
];

/** The chain's rows, live: the newest page of the current thread, older pages and threads on demand. */
function useChain(sdk: Sdk, threadIds: string[]) {
  const current = threadIds.at(-1)!;
  const [threads, setThreads] = useState<Record<string, ThreadRows>>({});
  const [from, setFrom] = useState(threadIds.length - 1);
  const [status, setStatus] = useState("idle");
  const [interactions, setInteractions] = useState<unknown[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingOlder = useRef(false);

  useEffect(() => { setFrom(threadIds.length - 1); }, [current, threadIds.length]);

  const refresh = useCallback(async () => {
    try {
      const [timeline, thread, pending] = await Promise.all([
        sdk.threads.timeline({ threadId: current, includeNestedRows: "true", segmentLimit: PAGE_SEGMENTS }),
        sdk.threads.get({ threadId: current }),
        sdk.threads.interactions.list({ threadId: current }).catch(() => []),
      ]);
      setThreads((previous) => {
        const had = previous[current];
        const keepOlder = !!had?.older.length;
        return { ...previous, [current]: { latest: timeline.rows, older: had?.older ?? [], cursor: keepOlder ? had!.cursor : (timeline.timelinePage.olderCursor ?? null), hasOlder: keepOlder ? had!.hasOlder : timeline.timelinePage.hasOlderRows } };
      });
      setStatus(thread.status);
      setInteractions(pending as unknown[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoaded(true);
    }
  }, [sdk, current]);

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      threadId: current,
      callback: () => { timer ??= setTimeout(() => { timer = null; void refresh(); }, REFRESH_MS); },
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [sdk, current, refresh]);

  /** One page further back: older rows of the earliest loaded thread, else the thread before it. */
  const loadOlder = useCallback(async () => {
    if (loadingOlder.current) return;
    const threadId = threadIds[from];
    const page = threadId ? threads[threadId] : null;
    if (!threadId || !page) return;
    loadingOlder.current = true;
    try {
      if (page.hasOlder && page.cursor) {
        const older = await sdk.threads.timeline({ threadId, includeNestedRows: "true", segmentLimit: PAGE_SEGMENTS, beforeAnchorId: page.cursor.anchorId, beforeAnchorSeq: String(page.cursor.anchorSeq) });
        setThreads((previous) => ({ ...previous, [threadId]: { ...previous[threadId]!, older: [...older.rows, ...previous[threadId]!.older], cursor: older.timelinePage.olderCursor ?? null, hasOlder: older.timelinePage.hasOlderRows } }));
      } else if (from > 0) {
        const previousId = threadIds[from - 1]!;
        const timeline = await sdk.threads.timeline({ threadId: previousId, includeNestedRows: "true", segmentLimit: PAGE_SEGMENTS }).catch(() => null);
        setThreads((previous) => ({ ...previous, [previousId]: { latest: timeline?.rows ?? [], older: [], cursor: timeline?.timelinePage.olderCursor ?? null, hasOlder: timeline?.timelinePage.hasOlderRows ?? false } }));
        setFrom(from - 1);
      }
    } finally {
      loadingOlder.current = false;
    }
  }, [sdk, threadIds, from, threads]);

  const rows = useMemo(() => mergeChain(threadIds.slice(from).flatMap((threadId, offset) => {
    const page = threads[threadId];
    if (!page) return [];
    const index = from + offset;
    return [{ threadId, rows: [...page.older, ...page.latest], continuation: index > 0 && !page.hasOlder }];
  })), [threads, threadIds, from]);
  const earliest = threads[threadIds[from] ?? ""];
  const hasOlder = !!earliest?.hasOlder || from > 0;

  return { current, rows, status, interactions, loaded, error, refresh, loadOlder, hasOlder };
}

export default function BotChat({ threadIds, bot, childStatus, needsYou, onWorkingChange, onStarter }: BotChatProps) {
  const sdk = useSdk();
  const chain = useChain(sdk, threadIds);
  const working = WORKING.has(chain.status);
  const [outbox, setOutbox] = useState<{ id: string; text: string; images: number }[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  useEffect(() => { onWorkingChange?.(working); }, [working, onWorkingChange]);

  const entries = useMemo(() => chatEntries(chain.rows, { working }), [chain.rows, working]);
  // Sent messages show at once; they drop off once the timeline has them.
  useEffect(() => {
    if (!outbox.length) return;
    const seen = new Set(entries.flatMap((entry) => (entry.kind === "message" && entry.role === "user" ? [entry.text.trim()] : [])));
    setOutbox((list) => (list.some((item) => seen.has(item.text.trim())) ? list.filter((item) => !seen.has(item.text.trim())) : list));
  }, [entries, outbox.length]);

  const send = useCallback(async (text: string, images: string[] = []) => {
    const body = text.trim();
    if (!body && !images.length) return false;
    const id = `local:${Date.now()}`;
    setOutbox((list) => [...list, { id, text: body, images: images.length }]);
    setSendError(null);
    try {
      await sdk.threads.send({
        threadId: chain.current,
        input: [...(body ? [{ type: "text" as const, text: body, mentions: [] }] : []), ...images.map((url) => ({ type: "image" as const, url }))],
        mode: "auto",
      });
      void chain.refresh();
      return true;
    } catch (cause) {
      setOutbox((list) => list.filter((item) => item.id !== id));
      setSendError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, [sdk, chain]);

  const stop = useCallback(() => { void sdk.threads.stop({ threadId: chain.current }).then(() => chain.refresh()).catch((cause: unknown) => setSendError(cause instanceof Error ? cause.message : String(cause))); }, [sdk, chain]);

  const asks = useMemo(() => chain.interactions.map(inlineAsk).filter((ask): ask is InlineAsk => !!ask), [chain.interactions]);
  const otherNeeds = needsYou.filter((thread) => thread.relation !== "self" && !threadIds.includes(thread.id));
  const hasConversation = entries.some((entry) => entry.kind === "message") || outbox.length > 0;
  const lastAssistant = [...entries].reverse().find((entry) => entry.kind === "message")?.id;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessageList entries={entries} outbox={outbox} bot={bot} working={working} childStatus={childStatus} hasOlder={chain.hasOlder} loadOlder={chain.loadOlder}
        lastId={lastAssistant ?? null} onSend={(text) => void send(text)}
        empty={chain.loaded && !hasConversation ? <Onboarding bot={bot} onStarter={(starter) => (starter.kind === "send" ? void send(starter.text) : onStarter(starter))} /> : null} />
      <div className="mx-auto w-full max-w-[44rem] shrink-0 px-4 pb-4">
        {asks.map((ask) => <AskCard key={ask.interactionId} ask={ask} sdk={sdk} onDone={chain.refresh} />)}
        {otherNeeds.slice(0, 2).map((thread) => (
          <NeedsCard key={thread.id} title={thread.title} onOpen={() => openAppPath(threadPath(thread.id))} />
        ))}
        {otherNeeds.length > 2 ? <p className="mb-2 px-1 text-xs text-muted-foreground">{otherNeeds.length - 2} more need you in Activity</p> : null}
        {sendError || chain.error ? <p role="alert" className="mb-2 px-1 text-xs text-destructive">{sendError ?? chain.error}</p> : null}
        <Composer name={bot.name} working={working} onSend={send} onStop={stop} />
      </div>
    </div>
  );
}

/** The conversation, newest at the bottom; it stays pinned there while the Bot writes, unless you scroll up. */
function MessageList({ entries, outbox, bot, working, childStatus, hasOlder, loadOlder, lastId, onSend, empty }: {
  entries: ChatEntry[]; outbox: { id: string; text: string; images: number }[]; bot: BotIdentity; working: boolean; childStatus: ReadonlyMap<string, ChildStatus>;
  hasOlder: boolean; loadOlder(): Promise<void>; lastId: string | null; onSend(text: string): void; empty: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);

  const onScroll = () => {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (anchor.current) {
      // Older messages came in above: keep what you were reading in place.
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  useEffect(() => {
    const el = sentinel.current;
    const root = scroller.current;
    if (!el || !root || !hasOlder || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((seen) => {
      if (!seen.some((entry) => entry.isIntersecting)) return;
      anchor.current = { height: root.scrollHeight, top: root.scrollTop };
      void loadOlder();
    }, { root, rootMargin: "400px 0px 0px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasOlder, loadOlder]);

  const last = entries.at(-1);
  const writing = last?.kind === "message" && last.role === "assistant";
  const thinking = working && !writing && last?.kind !== "work";

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto" role="log" aria-label="Chat" aria-live="polite" aria-busy={working}>
      <div className="mx-auto flex min-h-full w-full max-w-[44rem] flex-col px-4 pt-4 pb-6">
        {hasOlder ? <div ref={sentinel} className="flex justify-center py-3"><Icon name="Loading" className="size-4 animate-spin text-muted-foreground" aria-label="Loading earlier messages" /></div> : <div className="flex-1" />}
        {empty}
        {entries.map((entry, index) => (
          <Entry key={entry.id} entry={entry} bot={bot} childStatus={childStatus} previous={entries[index - 1]} isLast={entry.id === lastId} onSend={onSend} />
        ))}
        {outbox.map((item) => (
          <div key={item.id} className="bb-bot-in mt-3 flex justify-end">
            <UserBubble text={item.text} images={item.images} queued={working} />
          </div>
        ))}
        {thinking ? <Thinking bot={bot} /> : null}
      </div>
    </div>
  );
}

const Entry = memo(function Entry({ entry, bot, childStatus, previous, isLast, onSend }: { entry: ChatEntry; bot: BotIdentity; childStatus: ReadonlyMap<string, ChildStatus>; previous?: ChatEntry; isLast: boolean; onSend(text: string): void }) {
  const gap = !previous || previous.kind === "day" ? "mt-1" : entry.kind === "message" && previous.kind === "message" && previous.role === entry.role ? "mt-1.5" : "mt-5";
  switch (entry.kind) {
    case "day":
      return <div className="mt-6 mb-2 text-center text-[11px] font-medium text-muted-foreground/80" role="separator">{entry.label}</div>;
    case "message":
      if (entry.role === "user") {
        return <div className={`bb-bot-in ${gap} flex justify-end [content-visibility:auto]`}><UserBubble text={entry.text} images={entry.images} queued={entry.queued} /></div>;
      }
      return (
        <div className={`bb-bot-in ${gap} grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 [content-visibility:auto]`}>
          <div className="pt-0.5">{entry.first ? <BotAvatar shape={bot.shape} color={bot.color} emoji={bot.avatar} size={28} /> : null}</div>
          <div className="min-w-0">
            {entry.first ? <div className="mb-0.5 text-xs font-medium text-muted-foreground">{bot.name}</div> : null}
            <div className="text-[15px] leading-relaxed"><Markdown content={entry.text} /></div>
            {isLast && entry.next ? <NextChips next={entry.next} onSend={onSend} /> : null}
          </div>
        </div>
      );
    case "work":
      return <WorkLine entry={entry} gap={gap} />;
    case "child":
      return <ChildCard entry={entry} live={entry.threadId ? childStatus.get(entry.threadId) : undefined} gap={gap} />;
    case "notice":
      return <p className={`${gap} pl-10 text-xs text-destructive`} role="status">{entry.text}</p>;
  }
});

function UserBubble({ text, images, queued }: { text: string; images: number; queued: boolean }) {
  return (
    <div className={`flex max-w-[80%] flex-col items-end gap-1 ${queued ? "opacity-70" : ""}`}>
      <div data-bubble="user" className="rounded-[20px] rounded-br-md bg-foreground/[0.07] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] dark:bg-foreground/[0.1]">
        {text}
        {images ? <span className="mt-1 block text-xs text-muted-foreground">{images === 1 ? "1 image" : `${images} images`}</span> : null}
      </div>
      {queued ? <span className="pr-2 text-[11px] text-muted-foreground">Queued</span> : null}
    </div>
  );
}

function Thinking({ bot }: { bot: BotIdentity }) {
  return (
    <div className="bb-bot-in mt-5 grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3" role="status" aria-label={`${bot.name} is thinking`}>
      <BotAvatar shape={bot.shape} color={bot.color} emoji={bot.avatar} size={28} working />
      <span className="flex items-center gap-1 text-muted-foreground" aria-hidden>
        {[0, 1, 2].map((dot) => <span key={dot} className="bb-bot-dot size-1.5 rounded-full bg-current" style={{ animationDelay: `${dot * 160}ms` }} />)}
      </span>
    </div>
  );
}

/** A run of tool steps as one quiet line; click to see them. */
function WorkLine({ entry, gap }: { entry: Extract<ChatEntry, { kind: "work" }>; gap: string }) {
  const [open, setOpen] = useState(false);
  const count = entry.steps.length;
  const steps = `${count} step${count === 1 ? "" : "s"}`;
  return (
    <div className={`${gap} pl-10`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="group -ml-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground">
        {entry.running ? <Icon name="Loading" className="size-3.5 shrink-0 animate-spin" /> : <Icon name="Check" className="size-3.5 shrink-0" />}
        {entry.running ? <span className="bb-bot-shimmer">Working…</span> : <span>Worked</span>}
        <span className="text-muted-foreground/70">· {steps}</span>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 opacity-60" />
      </button>
      {open ? (
        <ol className="mt-1 mb-1 ml-1 flex flex-col gap-0.5 border-l border-border pl-3">
          {entry.steps.map((step) => (
            <li key={step.id} className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className={`size-1.5 shrink-0 rounded-full ${step.status === "error" ? "bg-destructive" : step.status === "pending" ? "bg-warning" : "bg-muted-foreground/40"}`} aria-hidden />
              <span className="truncate">{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const CHILD_LABEL: Record<ChildStatus, string> = { running: "Running", finished: "Finished", failed: "Failed", stopped: "Stopped", "needs-you": "Needs you", waiting: "Waiting" };
const CHILD_DOT: Record<ChildStatus, string> = { running: "bg-success animate-pulse motion-reduce:animate-none", finished: "bg-success", failed: "bg-destructive", stopped: "bg-muted-foreground/50", "needs-you": "bg-warning", waiting: "bg-muted-foreground/50" };

/** A thread the Bot started or heard back from, as one compact card linking to it. */
function ChildCard({ entry, live, gap }: { entry: Extract<ChatEntry, { kind: "child" }>; live?: ChildStatus; gap: string }) {
  const status = live ?? entry.status;
  const content = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.05]"><Icon name={entry.verb === "started" ? "ArrowUpRight" : status === "finished" ? "CircleCheck" : status === "failed" ? "AlertCircle" : "MessageSquare"} className="size-3.5 text-muted-foreground" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]"><span className="text-muted-foreground">{entry.verb === "started" ? "Started " : ""}</span>‘{entry.title}’</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={`size-1.5 rounded-full ${CHILD_DOT[status]}`} aria-hidden />{CHILD_LABEL[status]}</span>
      </span>
      {entry.threadId ? <Icon name="ChevronRight" className="size-4 shrink-0 text-muted-foreground/60" /> : null}
    </>
  );
  const className = "flex w-full max-w-sm items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left";
  return (
    <div className={`bb-bot-in ${gap} pl-10`}>
      {entry.threadId
        ? <button type="button" className={`${className} hover:bg-state-hover`} onClick={() => openAppPath(threadPath(entry.threadId!))} aria-label={`Open ‘${entry.title}’, ${CHILD_LABEL[status]}`}>{content}</button>
        : <div className={className}>{content}</div>}
    </div>
  );
}

function NextChips({ next, onSend }: { next: NonNullable<Extract<ChatEntry, { kind: "message" }>["next"]>; onSend(text: string): void }) {
  const items = [...next.reply, ...next.do];
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Quick replies">
      {items.map((item) => (
        <button key={`${item.emoji}${item.label}`} type="button" onClick={() => onSend(`${item.emoji} ${item.label}`)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-[13px] hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <span aria-hidden>{item.emoji}</span>{item.label}
        </button>
      ))}
    </div>
  );
}

function Onboarding({ bot, onStarter }: { bot: BotIdentity; onStarter(starter: Starter): void }) {
  return <Greeting bot={bot} onStarter={onStarter} />;
}

/** The Bot's hello and a few ways to start, as its first message. Also the page before a Bot exists. */
export function Greeting({ bot, onStarter, lines }: { bot: BotIdentity; onStarter(starter: Starter): void; lines?: string[] }) {
  const said = lines ?? [`Hi, I'm ${bot.name}.`, "I keep an eye on your projects, check in on a schedule, and tell you when something needs you. What should we start with?"];
  return (
    <div className="bb-bot-in mt-1 grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
      <BotAvatar shape={bot.shape} color={bot.color} emoji={bot.avatar} size={28} />
      <div className="min-w-0">
        <div className="mb-0.5 text-xs font-medium text-muted-foreground">{bot.name}</div>
        {said.map((line) => <p key={line} className="mb-1.5 text-[15px] leading-relaxed">{line}</p>)}
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Suggestions">
          {STARTERS.map(({ label, starter }) => (
            <button key={label} type="button" onClick={() => onStarter(starter)}
              className="inline-flex h-8 items-center rounded-full border border-border bg-background px-3.5 text-[13px] hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const CARD = "bb-bot-in mb-2 rounded-2xl border border-border bg-background px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

function NeedsCard({ title, onOpen }: { title: string; onOpen(): void }) {
  return (
    <section aria-label="Needs you" className={`${CARD} flex items-center gap-3`}>
      <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm"><span className="text-muted-foreground">Needs you · </span>{title}</span>
      <button type="button" className="h-7 shrink-0 rounded-full bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90" onClick={onOpen}>Open</button>
    </section>
  );
}

/** A question or approval from the Bot's own thread, answered right here. */
function AskCard({ ask, sdk, onDone }: { ask: InlineAsk; sdk: Sdk; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [free, setFree] = useState("");
  const resolve = async (resolution: Parameters<Sdk["threads"]["interactions"]["resolve"]>[0]["resolution"]) => {
    setBusy(true);
    setError(null);
    try {
      // Studio's question form takes its answers as `{ [questionId]: label }`.
      const form = ask.kind === "question" && ask.via === "form" ? ask.questionId : null;
      const formAnswer = form && "answers" in resolution ? resolution.answers[form] : null;
      if (form && formAnswer) await sdk.threads.interactions.respond({ threadId: ask.threadId, interactionId: ask.interactionId, value: { [form]: formAnswer.freeText ?? formAnswer.selected[0] ?? "" } });
      else await sdk.threads.interactions.resolve({ threadId: ask.threadId, interactionId: ask.interactionId, resolution });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const pill = "h-8 rounded-full px-3.5 text-[13px] font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <section aria-label="Needs you" className={CARD}>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-muted-foreground"><span className="size-1.5 rounded-full bg-warning" aria-hidden />Needs you</div>
      {ask.kind === "question" ? (
        <>
          <p className="mb-2.5 text-sm">{ask.prompt}</p>
          <div className="flex flex-wrap gap-1.5">
            {ask.options.map((option) => (
              <button key={option.value} type="button" disabled={busy} className={`${pill} border border-border hover:bg-state-hover`}
                onClick={() => void resolve({ kind: "user_answer", answers: { [ask.questionId]: { selected: [option.value] } } })}>{option.label}</button>
            ))}
          </div>
          {ask.allowFreeText ? (
            <form className="mt-2 flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); if (free.trim()) void resolve({ kind: "user_answer", answers: { [ask.questionId]: { selected: [], freeText: free.trim() } } }); }}>
              <input aria-label="Your answer" value={free} onChange={(event) => setFree(event.target.value)} placeholder={ask.options.length ? "Or type an answer" : "Type an answer"}
                className="h-8 min-w-0 flex-1 rounded-full border border-border bg-transparent px-3.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <button type="submit" disabled={busy || !free.trim()} className={`${pill} bg-foreground text-background hover:bg-foreground/90`}>Answer</button>
            </form>
          ) : null}
        </>
      ) : ask.kind === "approval" ? (
        <>
          <p className="text-sm">{ask.title}</p>
          {ask.detail ? <pre className="mt-1.5 max-h-24 overflow-auto rounded-md bg-foreground/[0.04] px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">{ask.detail}</pre> : null}
          <div className="mt-2.5 flex flex-wrap justify-end gap-1.5">
            <button type="button" disabled={busy} className={`${pill} hover:bg-state-hover`} onClick={() => void resolve({ decision: "deny" })}>Deny</button>
            {ask.allowSession ? <button type="button" disabled={busy} className={`${pill} border border-border hover:bg-state-hover`} onClick={() => void resolve({ decision: "allow_for_session", grantedPermissions: null })}>Always allow</button> : null}
            <button type="button" disabled={busy} className={`${pill} bg-foreground text-background hover:bg-foreground/90`} onClick={() => void resolve({ decision: "allow_once", grantedPermissions: null })}>Approve</button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm">{ask.title}</p>
          <button type="button" className={`${pill} bg-foreground text-background hover:bg-foreground/90`} onClick={() => openAppPath(threadPath(ask.threadId))}>Open</button>
        </div>
      )}
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image."));
    reader.readAsDataURL(file);
  });
}

/** The pill composer: grows with the text; + adds images, the mic dictates through Talk, the round button sends or stops. */
export function Composer({ name, working, onSend, onStop }: { name: string; working: boolean; onSend(text: string, images: string[]): Promise<boolean>; onStop(): void }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const talk = useTalk(TALK_FIELD);
  const dictating = talk.mode === "here";

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  // ⌘K (Ctrl+K) puts the cursor in the composer; Esc stops the Bot while it works.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); field.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Talk hands its transcript to the focused dictation field.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const onInsert = (event: Event) => {
      const said = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof said !== "string" || !said.trim()) return;
      event.preventDefault();
      event.stopPropagation();
      setText((before) => (before && !/\s$/.test(before) ? `${before} ${said.trim()}` : `${before}${said.trim()}`));
      el.focus();
    };
    el.addEventListener(TALK_INSERT_EVENT, onInsert);
    return () => el.removeEventListener(TALK_INSERT_EVENT, onInsert);
  }, []);

  const submit = async () => {
    if (!text.trim() && !images.length) return;
    const sent = { text, images };
    setText("");
    setImages([]);
    if (!(await onSend(sent.text, sent.images.map((image) => image.url)))) { setText(sent.text); setImages(sent.images); }
  };

  const addImages = async (list: FileList | null) => {
    setNote(null);
    for (const file of Array.from(list ?? [])) {
      if (!file.type.startsWith("image/")) { setNote("Only images can be attached."); continue; }
      if (file.size > MAX_IMAGE_BYTES) { setNote(`${file.name} is over 5 MB.`); continue; }
      const url = await readImage(file).catch(() => null);
      if (url) setImages((current) => [...current, { name: file.name, url }]);
    }
  };

  const canSend = !!text.trim() || images.length > 0;
  const round = "flex size-8 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <div>
      {note ? <p role="status" className="mb-1.5 px-2 text-xs text-muted-foreground">{note}</p> : null}
      <div className="rounded-[26px] border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_-6px_rgba(0,0,0,0.08)] transition-shadow focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_22px_-6px_rgba(0,0,0,0.14)] dark:bg-foreground/[0.03]">
        {images.length ? (
          <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attachments">
            {images.map((image, index) => (
              <li key={`${image.name}${index}`} className="relative">
                <img src={image.url} alt={image.name} className="size-14 rounded-lg border border-border object-cover" />
                <button type="button" aria-label={`Remove ${image.name}`} onClick={() => setImages(images.filter((_, at) => at !== index))}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"><Icon name="X" className="size-3" /></button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-end gap-1 p-1.5">
          <button type="button" className={`${round} text-muted-foreground hover:bg-state-hover hover:text-foreground`} aria-label="Attach images" onClick={() => files.current?.click()}><Icon name="Plus" className="size-4" /></button>
          <input ref={files} type="file" accept="image/*" multiple hidden onChange={(event) => { void addImages(event.target.files); event.target.value = ""; }} />
          <textarea ref={field} rows={1} value={text} aria-label={`Message ${name}`} placeholder={working ? `Add to what ${name} is doing…` : `Message ${name}`}
            {...{ [TALK_FIELD_ATTR]: TALK_FIELD, [TALK_FIELD_LABEL_ATTR]: `the chat with ${name}` }}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); void addImages(event.clipboardData.files); } }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
              else if (event.key === "Escape" && working) { event.preventDefault(); onStop(); }
            }}
            className="max-h-[200px] min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[15px] leading-5 outline-none placeholder:text-muted-foreground/70" />
          {talk.mode !== "unavailable" ? (
            <button type="button" className={`${round} ${dictating ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-state-hover hover:text-foreground"}`}
              aria-label={dictating ? "Stop dictating" : "Dictate"} aria-pressed={dictating} disabled={talk.mode === "elsewhere"} onClick={() => toggleTalk(TALK_FIELD)}>
              <Icon name={dictating && talk.phase !== "recording" ? "Loading" : "Mic"} className={`size-4 ${dictating && talk.phase !== "recording" ? "animate-spin" : ""}`} />
            </button>
          ) : null}
          {working && !canSend ? (
            <button type="button" className={`${round} bg-foreground text-background hover:bg-foreground/90`} aria-label={`Stop ${name}`} title="Stop (Esc)" onClick={onStop}><Icon name="Square" className="size-3" /></button>
          ) : (
            <button type="button" className={`${round} bg-foreground text-background hover:bg-foreground/90 disabled:bg-foreground/15 disabled:text-muted-foreground`} aria-label="Send" title="Send (Enter)" disabled={!canSend} onClick={() => void submit()}><Icon name="ArrowUp" className="size-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

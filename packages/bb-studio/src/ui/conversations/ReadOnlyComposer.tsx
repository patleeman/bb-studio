// Where the composer goes, in the main view:
// - A worker opens read-only (6c). Its header is one row, in BB's style: the
//   title, then a small status dot and its state in muted text ("Running"),
//   after it (BB's `experimental_threadHeader`). Where it runs is BB's Info
//   tab's (its Environment and Directory rows), and the conversation it works
//   for is a "From" row there. On a BB without the header slot, the same
//   one muted row ("Running · for Main") sits under the header (BB's
//   `experimental_threadBanner`), or above the box without banners. Its composer is
//   replaced by an active composer, "Ask the Bot about this worker…", with
//   "Sends to <Bot> in <conversation>" on the right by its send button: it
//   sends the
//   text to the Bot in that conversation, with a link to the worker first,
//   and goes there. A worker waiting on a question also offers "Answer it
//   here", which shows BB's composer (and that question) in this window. A
//   worker waiting on an approval doesn't: the approval is a card in its
//   conversation (src/worker-approvals.ts, ApprovalCard.tsx).
// - A worker mirrored from bb keeps that box; the read-only line above the
//   composer says it is mirrored. Workers are never taken over.
// - Any other thread mirrored from bb is a read-only conversation until it is
//   taken over: the same place shows the mirror's box with "Take over…",
//   which asks first (mirror-banner.tsx).
// - A finished conversation is read-only too: "Finished on <date>" and
//   Reopen (finish.tsx).
// - A conversation's header is its title ("Main" for the Bot's chat), then
//   "with <Bot>" in muted text (6a; BB's `experimental_threadHeader`).
// - A conversation shows its own workers in a compact line above its
//   composer (6b), each one clickable.
// The replacement uses BB's `experimental_replace` on a composer
// customization (the fork). On a BB without it, the same box is a banner in
// the composer and a style hides the composer's own input and buttons, as
// well as that can be done from outside.
import { experimental_DetailRow as DetailRow, useBbNavigate, type ExperimentalThreadInfoProps, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import type { BotThreadInfo } from "../../bot-threads-contract";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon } from "../../kit/app/index";
import { registerThreadBanner, registerThreadHeader, type ThreadHeaderDecoration } from "../../kit/app/host-sdk";
import { useComposerThread } from "../../kit/composer";
import { errorMessage } from "../../kit/format";
import { useCall, useLive } from "../live";
import { isReadOnlyMirror, MirrorBox, useMirrorStatus } from "../mirror-banner";
import { doneLabel, splitWorkers } from "./model";
import { FinishedBox, isFinished } from "./finish";
import { ConversationApprovals, ConversationApprovalsBanner } from "./ConversationApprovals";

export type ReadOnlyKind = "worker" | "mirror" | "finished" | null;

/**
 * What a thread's composer is: a worker's Ask box (also when the worker is
 * mirrored from bb: the mirror is then a quiet line in its status line), a
 * mirror's or a finished conversation's read-only box, or the normal
 * composer (null).
 */
export function readOnlyKind(info: Pick<BotThreadInfo, "kind" | "archivedAt" | "finishedSummary"> | null | undefined, mirrored: boolean): ReadOnlyKind {
  if (info?.kind === "worker") return "worker";
  if (mirrored) return "mirror";
  if (isFinished(info)) return "finished";
  return null;
}

function useThreadInfo(threadId: string | null) {
  return useLive("bot_thread_info", { threadId: threadId ?? "" }, { enabled: !!threadId, pollMs: 30_000 }).data?.info ?? null;
}

/**
 * Workers whose own question Patrick chose to answer himself ("Answer it
 * here"): BB's composer, with its question stack, shows for them until the
 * window reloads. Only for a question: an approval goes to the conversation
 * that owns the worker, as a card (src/worker-approvals.ts).
 */
const answering = new Set<string>();
const answerListeners = new Set<() => void>();
const subscribeAnswering = (listener: () => void) => { answerListeners.add(listener); return () => { answerListeners.delete(listener); }; };
export function answerHere(threadId: string): void {
  answering.add(threadId);
  for (const listener of answerListeners) listener();
}
const useAnswering = (threadId: string | null) => useSyncExternalStore(subscribeAnswering, () => !!threadId && answering.has(threadId), () => false);

/** A hook: whether this thread's composer is replaced (BB's `useActive`). */
export function useReadOnly(threadId: string | null): ReadOnlyKind {
  const info = useThreadInfo(threadId);
  const mirror = useMirrorStatus(threadId);
  const kind = readOnlyKind(info, isReadOnlyMirror(mirror));
  return useAnswering(threadId) && kind === "worker" && info?.waitingOn === "question" ? null : kind;
}

/** Whether BB draws Studio's row under each thread's header; then the status line is there and not above the Ask box. */
let statusOnTop = false;
export function setWorkerStatusOnTop(value: boolean): void { statusOnTop = value; }

/** Whether BB draws Studio's decoration in each thread's header row; then a worker's state is there. */
let statusInHeader = false;
export function setWorkerStatusInHeader(value: boolean): void { statusInHeader = value; }

/** The worker's state in words: what the status line and its glyph say. */
export function workerStateLabel(info: Pick<BotThreadInfo, "status" | "waitingOn">): string {
  switch (info.status ?? "done") {
    case "running": return "Running";
    case "failed": return "Failed";
    case "needs-you": return info.waitingOn === "approval" ? "Waiting for your approval" : "Waiting on an answer";
    default: return "Done";
  }
}

/** The header's words (6c): one short state; the box below says where to answer. */
export function workerShortLabel(info: Pick<BotThreadInfo, "status" | "waitingOn">): string {
  return info.status === "needs-you" ? "Waiting for you" : workerStateLabel(info);
}

const LINK = "text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

const DOT: Record<NonNullable<BotThreadInfo["status"]>, string> = {
  running: "bg-success",
  "needs-you": "bg-warning",
  failed: "bg-destructive",
  done: "bg-muted-foreground/60",
};

/** A worker's state as muted text after a small status dot: no pill, no age. */
export function WorkerState({ info, label }: { info: Pick<BotThreadInfo, "status">; label: string }) {
  const status = info.status ?? "done";
  return (
    <span data-testid="worker-state" data-status={status} className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[status]}`} />{label}
    </span>
  );
}

/** The conversation a worker reports to: its own, else its Bot's Main. */
function useWorkerOwner(info: BotThreadInfo): { threadId: string; title: string } | null {
  const main = useLive("bot_spaces", {}, { pollMs: 120_000 }).data?.bots?.find((bot) => bot.id === info.botId)?.mainThreadId ?? null;
  return info.owner ?? (main ? { threadId: main, title: "Main" } : null);
}

/**
 * A worker's one muted row, where BB has no header slot for its state: the
 * state ("Running", "Waiting on an answer"), then the conversation it works
 * for ("for Main"; "Approve it in Main" while it waits on an approval), and
 * "Answer it here" while it waits on a question.
 */
export function WorkerStatusLine({ info, onOpen }: { info: BotThreadInfo; onOpen(threadId: string): void }) {
  const owner = useWorkerOwner(info);
  return (
    <div data-testid="worker-status" className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
      <WorkerState info={info} label={workerStateLabel(info)} />
      {owner ? <><span aria-hidden>·</span><WorkerOwnerLink info={info} owner={owner} onOpen={onOpen} /></> : null}
      <AnswerHere info={info} />
    </div>
  );
}

function WorkerOwnerLink({ info, owner, onOpen }: { info: BotThreadInfo; owner: { threadId: string; title: string }; onOpen(threadId: string): void }) {
  return (
    <span data-testid="worker-for" className="min-w-0 truncate">{info.status === "needs-you" && info.waitingOn === "approval" ? "Approve it in " : "for "}
      <button type="button" data-testid="worker-owner" onClick={() => onOpen(owner.threadId)} className={LINK}>{owner.title}</button>
    </span>
  );
}

function AnswerHere({ info }: { info: BotThreadInfo }) {
  if (info.status !== "needs-you" || info.waitingOn !== "question") return null;
  return <button type="button" data-testid="worker-answer-here" onClick={() => answerHere(info.threadId)} className={LINK}>Answer it here</button>;
}

/** The status line as a row under a worker's header (BB's `experimental_threadBanner`), only where BB has no header slot for its state. */
export function WorkerStatusBanner({ threadId }: { threadId: string }) {
  const info = useThreadInfo(threadId);
  const navigate = useBbNavigate();
  if (statusInHeader || !info || info.kind !== "worker") return null;
  return (
    <div data-testid="worker-banner" className="studio-root flex h-8 shrink-0 items-center px-5">
      <WorkerStatusLine info={info} onOpen={(id) => navigate.toThread(id)} />
    </div>
  );
}

/** "From": the conversation a worker works for, in BB's Info tab (BB's `experimental_threadInfoRow`). Nothing on other threads. */
export function WorkerFromRow({ threadId }: Pick<ExperimentalThreadInfoProps, "threadId">) {
  const info = useThreadInfo(threadId);
  const navigate = useBbNavigate();
  if (!info || info.kind !== "worker") return null;
  return <WorkerFrom info={info} onOpen={(id) => navigate.toThread(id)} />;
}

function WorkerFrom({ info, onOpen }: { info: BotThreadInfo; onOpen(threadId: string): void }) {
  const owner = useWorkerOwner(info);
  if (!owner) return null;
  return (
    <DetailRow label="From" icon="MessageSquare">
      <button type="button" data-testid="worker-from" onClick={() => onOpen(owner.threadId)} className={`truncate ${LINK}`}>{owner.title}</button>
    </DetailRow>
  );
}

/** A conversation's header: its title where Studio names it ("Main" for the Bot's chat), and its Bot (6a). */
export function conversationHeader(info: Pick<BotThreadInfo, "isMain" | "botName">): { title: string | null; bot: string } | null {
  const bot = info.botName.trim();
  return bot ? { title: info.isMain ? "Main" : null, bot } : null;
}

/**
 * BB's thread header (`experimental_threadHeader`), one row: a worker's state
 * after its title, a conversation's Bot after its title, in muted text.
 */
export interface ThreadHeaderParts { title: string | null; detail: ReactNode; worker: boolean }

export function useThreadHeaderParts({ threadId }: { threadId: string }): ThreadHeaderParts {
  const live = useLive("bot_thread_info", { threadId }, { pollMs: 30_000 });
  const info = live.data?.info ?? null;
  if (info?.kind === "worker") return { title: null, detail: <WorkerState info={info} label={workerShortLabel(info)} />, worker: true };
  const header = info ? conversationHeader(info) : null;
  return { title: header?.title ?? null, detail: header ? <span data-testid="conversation-bot" className="truncate text-xs text-muted-foreground">with {header.bot}</span> : null, worker: false };
}

export function useStudioThreadHeader({ threadId }: { threadId: string }): ThreadHeaderDecoration | null {
  const { title, detail, worker } = useThreadHeaderParts({ threadId });
  if (worker) return { after: <span className="studio-root">{detail}</span> };
  if (!detail) return null;
  const after = (
    <span className="studio-root inline-flex min-w-0 items-center gap-2">
      {detail}
    </span>
  );
  return title ? { title, after } : { after };
}

/** Over the Ask box of a waiting worker whose state is in the header: where to answer it. */
function WorkerNeeds({ info, onOpen }: { info: BotThreadInfo; onOpen(threadId: string): void }) {
  const owner = useWorkerOwner(info);
  if (info.waitingOn === "question") return <div data-testid="worker-needs" className="text-xs text-muted-foreground"><AnswerHere info={info} /></div>;
  return owner ? <div data-testid="worker-needs" className="text-xs text-muted-foreground"><WorkerOwnerLink info={info} owner={owner} onOpen={onOpen} /></div> : null;
}

/** The box in place of a worker's composer. */
export function WorkerAskBox({ info, onSent }: { info: BotThreadInfo; onSent?(conversationId: string): void }) {
  const call = useCall();
  const navigate = useBbNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where = info.owner?.title ?? "Main";
  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { conversationId } = await call("bot_worker_ask", { threadId: info.threadId, text: message });
      setText("");
      if (onSent) onSent(conversationId);
      else navigate.toThread(conversationId);
    } catch (cause) {
      setError(errorMessage(cause) || "It didn't send.");
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  };
  const ready = !!text.trim() && !busy;
  return (
    <div className="flex flex-col gap-2">
      {statusOnTop || statusInHeader ? null : <WorkerStatusLine info={info} onOpen={(threadId) => navigate.toThread(threadId)} />}
      {statusInHeader && info.status === "needs-you" ? <WorkerNeeds info={info} onOpen={(threadId) => navigate.toThread(threadId)} /> : null}
      {/* An active composer (6c): the box is live, the send button always readable; the helper sits on the right beside it. */}
      <div data-testid="worker-ask-box" className="cursor-text rounded-[10px] border border-border bg-background px-3 pb-2 pt-2.5 shadow-sm focus-within:border-ring"
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.querySelector("textarea")?.focus(); }}>
        <textarea data-testid="worker-ask" aria-label="Ask the Bot about this worker" placeholder="Ask the Bot about this worker…" rows={2} value={text} disabled={busy}
          onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown}
          className="block w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        <div className="flex items-center justify-end gap-2.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate text-right" data-testid="worker-ask-where">{error ? <span role="alert" className="text-destructive">{error}</span> : `Sends to ${info.botName} in ${where}`}</span>
          <button type="button" data-testid="worker-ask-send" aria-label={`Send to ${info.botName} in ${where}`} disabled={!ready} onClick={() => void send()}
            className={`flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${ready ? "bg-foreground/15 hover:bg-foreground/20" : "bg-foreground/[0.08]"}`}>
            <Icon name="CornerDownLeft" className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What replaces the composer for one thread: the worker's box, the mirror's,
 * or a finished conversation's. `replaced`: BB drew it in the composer's
 * place (its banners, the workers line among them, are gone); false for the
 * banner fallback, where the line is a banner of its own.
 */
export function ReadOnlyComposer({ threadId, replaced = true }: { threadId: string; replaced?: boolean }) {
  const info = useThreadInfo(threadId);
  const mirror = useMirrorStatus(threadId);
  const kind = readOnlyKind(info, isReadOnlyMirror(mirror));
  if (!kind) return null;
  return (
    <div data-studio-readonly={kind} data-testid="readonly-composer" className="studio-root w-full px-1 pb-2">
      {kind !== "worker" && replaced ? <ConversationWorkersLine threadId={threadId} /> : null}
      {kind === "mirror" && mirror ? <MirrorBox threadId={threadId} status={mirror} title={info ? (info.isMain ? "Main" : info.title) : "this thread"} /> : kind === "finished" && info ? <FinishedBox info={info} /> : info ? <WorkerAskBox info={info} /> : null}
    </div>
  );
}

/** On a BB without `experimental_replace`: hides the composer's own controls around the box. */
export const READONLY_FALLBACK_CSS = `
[data-composer-box]:has([data-studio-readonly-fallback]) :is(textarea, input, button, [contenteditable="true"], [role="button"], [role="textbox"]):not([data-studio-readonly-fallback] *) { display: none !important; }
`;

/** The same box as a composer banner, for a BB that can't replace the composer. */
export function ReadOnlyFallbackBanner() {
  const threadId = useComposerThread();
  const kind = useReadOnly(threadId);
  if (!threadId || !kind) return null;
  return (
    <div data-studio-readonly-fallback="">
      <style>{READONLY_FALLBACK_CSS}</style>
      <ReadOnlyComposer threadId={threadId} replaced={false} />
    </div>
  );
}

const CHIP = "inline-flex h-5 min-w-0 max-w-[240px] shrink-0 items-center gap-1 rounded-md border border-border px-1.5 text-foreground hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-state-active";

function WorkerGlyph({ status }: { status: BotThreadInfo["workers"][number]["status"] }) {
  if (status === "running") return <span role="img" aria-label="Running" className="size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-success border-r-transparent" />;
  if (status === "needs-you") return <span role="img" aria-label="Waiting on an answer" className="size-1.5 shrink-0 rounded-full bg-warning" />;
  if (status === "failed") return <Icon name="X" className="size-3 shrink-0 text-destructive" aria-label="Failed" />;
  return <Icon name="Check" className="size-3 shrink-0 text-success" aria-label="Done" />;
}

/**
 * A conversation's workers above its composer: a chip for each one running
 * or needing Patrick (its full title up to 240px), and the rest folded into
 * one "N done" chip whose menu lists them. Nothing without workers. A banner
 * of BB's composer, and, where the composer is replaced (Main mirrored from
 * bb, a finished conversation), part of the box that replaces it, since BB
 * then draws no composer banners.
 */
export function ConversationWorkersLine({ threadId: given }: { threadId?: string } = {}) {
  const composerThread = useComposerThread();
  const threadId = given ?? composerThread;
  const navigate = useBbNavigate();
  const info = useThreadInfo(threadId ?? null);
  if (!info || info.kind !== "conversation" || !info.workers.length) return null;
  const { active, done } = splitWorkers(info.workers);
  return (
    <div data-testid="conversation-workers" aria-label="Workers" className="flex min-w-0 flex-wrap items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
      {active.map((worker) => (
        <button key={worker.threadId} type="button" data-testid="conversation-worker" data-status={worker.status} onClick={() => navigate.toThread(worker.threadId)} className={CHIP}>
          <WorkerGlyph status={worker.status} />
          <span className="min-w-0 truncate">{worker.title}</span>
        </button>
      ))}
      {done.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="conversation-workers-done" className={CHIP}><Icon name="Check" className="size-3 shrink-0 text-success" />{doneLabel(done.length)}</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-80">
            {done.map((worker) => (
              <DropdownMenuItem key={worker.threadId} data-testid="conversation-worker-done" onSelect={() => navigate.toThread(worker.threadId)}>
                <WorkerGlyph status={worker.status} /><span className="min-w-0 truncate">{worker.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/**
 * Registers the replacement (with its banner fallback) and the workers line.
 * `experimental_replace` is ignored by a BB that doesn't know it; there the
 * banner draws the box instead.
 */
export function registerReadOnlyComposer(app: PluginAppBuilder): void {
  // One header row (6c, 6a): a worker's state, or a conversation's Bot, after its title where BB lets a plugin decorate
  // its header; elsewhere the worker's one muted row under the header, where BB draws plugin rows there.
  setWorkerStatusOnTop(registerThreadBanner(app.slots, { id: "worker-status", component: WorkerStatusBanner }));
  setWorkerStatusInHeader(registerThreadHeader(app.slots, { id: "thread-header", useDecoration: useStudioThreadHeader }));
  // The conversation a worker works for: a "From" row in BB's Info tab.
  const infoRow = (app.slots as { experimental_threadInfoRow?: (registration: object) => void }).experimental_threadInfoRow;
  if (typeof infoRow === "function") infoRow.call(app.slots, { id: "worker-from", group: "1_thread", order: 49, component: WorkerFromRow });
  const replace: object = { experimental_replace: { useActive: ({ threadId }: { threadId: string }) => useReadOnly(threadId) !== null, component: ReadOnlyComposer } };
  app.composer.customize({ id: "readonly", scopes: ["thread"], banners: [{ id: "readonly-fallback", chrome: "bare", component: ReadOnlyFallbackBanner }], ...replace });
  app.composer.customize({ id: "conversation-workers", scopes: ["thread"], banners: [{ id: "workers", chrome: "bare", component: ConversationWorkersLine }] });
  // A conversation's live approval cards (ConversationApprovals.tsx): under its header, else above its composer.
  if (!registerThreadBanner(app.slots, { id: "approvals", component: ConversationApprovals })) {
    app.composer.customize({ id: "conversation-approvals", scopes: ["thread"], banners: [{ id: "approvals", chrome: "bare", component: ConversationApprovalsBanner }] });
  }
}

// A worker's approval, as a card in the conversation that owns it
// (src/worker-approvals.ts). Two places draw it:
//
// - The live cards (ConversationApprovals.tsx), which Studio draws itself
//   under the conversation's header, one per approval waiting now. They are
//   the source of truth: they don't depend on the Bot replying.
// - `::approval{thread="thr_worker" id="int_…"}`, the line the Bot posts in
//   the conversation when told the worker waits. While a live card shows
//   the same approval, this one offers no buttons ("Approve or deny it at
//   the top of this conversation"), so Approve is never offered twice; it
//   shows how it was settled once it is.
//
// Both show the worker's title (opens it), what it asks for and its details
// as BB's own approval prompt shows them, and Deny / Approve for this worker
// (when BB offers its always-allow variant) / Approve. They resolve the
// worker's pending interaction through BB's own resolution; afterwards the
// card says "Approved", "Approved for this worker" or "Denied".
import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "../../kit/app/index";
import { CHAT_CARD, CHAT_CARD_BODY } from "../../kit/app/chat-card";
import { cn } from "../../kit/ui/index";
import { errorMessage } from "../../kit/format";
import type { ApprovalDecision, ApprovalState, ApprovalView } from "../../worker-approvals";
import { useCall, useLive } from "../live";

const ID = /^[\w-]{3,200}$/;
/** While it waits the card reads BB again this often; once settled, never. */
const PENDING_POLL_MS = 4_000;

const DECISION_LABEL: Record<ApprovalDecision, string> = { deny: "Deny", allow_for_session: "Approve for this worker", allow_once: "Approve" };

/** The card's settled line. */
export function settledLabel(state: ApprovalState): string | null {
  switch (state) {
    case "approved": return "Approved";
    case "approved-session": return "Approved for this worker";
    case "denied": return "Denied";
    case "gone": return "No longer waiting";
    default: return null;
  }
}

/** The state a decision leaves when BB doesn't say yet. */
export const decidedState = (decision: ApprovalDecision): ApprovalState => decision === "deny" ? "denied" : decision === "allow_for_session" ? "approved-session" : "approved";

// The approvals a live card shows right now, as `<worker>:<interaction>`, so the Bot's line for the same one offers no buttons.
const shownLive = new Map<string, number>();
const liveListeners = new Set<() => void>();
const liveChanged = () => { for (const listener of liveListeners) listener(); };
const approvalKey = (threadId: string, interactionId: string) => `${threadId}:${interactionId}`;

/** A live card shows this approval until the returned cleanup. */
export function showLiveApproval(threadId: string, interactionId: string): () => void {
  const key = approvalKey(threadId, interactionId);
  shownLive.set(key, (shownLive.get(key) ?? 0) + 1);
  liveChanged();
  return () => {
    const left = (shownLive.get(key) ?? 1) - 1;
    if (left > 0) shownLive.set(key, left);
    else shownLive.delete(key);
    liveChanged();
  };
}

export function useShownLive(threadId: string, interactionId: string): boolean {
  return useSyncExternalStore((listener) => { liveListeners.add(listener); return () => { liveListeners.delete(listener); }; }, () => shownLive.has(approvalKey(threadId, interactionId)), () => false);
}

const BUTTON = "h-7 rounded-md px-2.5 text-xs font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** One approval's card: who asks, what, its details, then the choices, a note, or how it was settled. */
export function ApprovalPanel({ worker, approval, state, busy = null, error = null, note = null, onDecide, testId = "approval-card" }: {
  worker: { threadId: string; title: string };
  approval: ApprovalView | null;
  state: ApprovalState;
  busy?: ApprovalDecision | null;
  error?: string | null;
  /** Said instead of the buttons while it waits (the live card has them). */
  note?: string | null;
  onDecide?(decision: ApprovalDecision): void;
  testId?: string;
}) {
  const navigate = useBbNavigate();
  const settled = settledLabel(state);
  return (
    <section data-testid={testId} data-state={state} aria-label={`Approval for ${worker.title}`}
      data-studio-card="" data-studio-card-tone={settled ? undefined : "warning"} className={cn(CHAT_CARD, CHAT_CARD_BODY, "gap-2", !settled && "border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-warning/5")}>
      <header className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {settled ? null : <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />}
        <button type="button" data-testid="approval-worker" onClick={() => navigate.toThread(worker.threadId)} title="Open the worker"
          className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{worker.title}</button>
        <span className="shrink-0">{settled ? "asked for approval" : "asks for your approval"}</span>
      </header>
      {approval ? <>
        <h3 data-testid="approval-title" className="font-semibold text-foreground">{approval.title}</h3>
        {approval.lines.length ? (
          <pre data-testid="approval-lines" className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-foreground/[0.04] px-2.5 py-2 font-mono text-xs text-foreground">{approval.lines.join("\n")}</pre>
        ) : null}
      </> : null}
      {settled ? (
        <p data-testid="approval-settled" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {state === "denied" ? <Icon name="X" className="size-3.5 text-destructive" /> : state === "gone" ? null : <Icon name="Check" className="size-3.5 text-success" />}
          {settled}
        </p>
      ) : note ? (
        <p data-testid="approval-note" className="text-xs text-muted-foreground">{note}</p>
      ) : approval && onDecide ? (
        <footer className="flex flex-wrap items-center gap-2">
          {approval.decisions.map((decision, index) => (
            <button key={decision} type="button" data-testid={`approval-${decision}`} disabled={busy !== null || state === "resolving"} onClick={() => onDecide(decision)}
              className={`${BUTTON} ${decision === "deny" ? `border border-border text-foreground hover:bg-state-hover ${index === 0 ? "mr-auto" : ""}` : decision === "allow_once" ? "bg-foreground text-background hover:bg-foreground/90" : "border border-border text-foreground hover:bg-state-hover"}`}>
              {busy === decision ? "…" : DECISION_LABEL[decision]}
            </button>
          ))}
        </footer>
      ) : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

/** Resolves one approval through bot_worker_approval_resolve: its busy choice, error, and the state it left. */
export function useResolve(threadId: string, interactionId: string, after?: () => void) {
  const call = useCall();
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<ApprovalState | null>(null);
  const decide = async (decision: ApprovalDecision) => {
    setBusy(decision);
    setError(null);
    try {
      const result = await call("bot_worker_approval_resolve", { threadId, interactionId, decision });
      setDecided(result.approval?.state && result.approval.state !== "pending" && result.approval.state !== "resolving" ? result.approval.state : decidedState(decision));
    } catch (cause) {
      setError(errorMessage(cause) || "It didn't go through.");
    } finally {
      setBusy(null);
      after?.();
    }
  };
  return { busy, error, decided, decide };
}

/** `::approval{thread="thr_…" id="…"}`, the Bot's line for one approval. */
export function ApprovalCard({ attributes }: PluginMessageDirectiveProps) {
  const threadId = attributes.thread ?? "";
  const interactionId = attributes.id ?? "";
  const valid = ID.test(threadId) && ID.test(interactionId);
  const live = useShownLive(threadId, interactionId);
  const resolve = useResolve(threadId, interactionId, () => query.refresh());
  const settledHere = resolve.decided !== null;
  const query = useLive("bot_worker_approval", { threadId, interactionId }, { enabled: valid, pollMs: settledHere ? 0 : PENDING_POLL_MS });
  if (!valid) return null;
  const data = query.data;
  if (!data) return query.error ? <p className="text-xs text-muted-foreground">Approval unavailable</p> : null;
  const approval = data.approval;
  const waiting = !approval || approval.state === "pending" || approval.state === "resolving";
  const state: ApprovalState = waiting && resolve.decided ? resolve.decided : approval?.state ?? "gone";
  return (
    <div className="my-2">
      <ApprovalPanel worker={data.worker} approval={approval} state={state} busy={resolve.busy} error={resolve.error}
        note={live ? "Answer it at the top of this conversation." : null} onDecide={(decision) => void resolve.decide(decision)} />
    </div>
  );
}

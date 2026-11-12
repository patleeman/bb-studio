// The live approval cards (src/worker-approvals.ts): Studio draws them
// itself under a conversation's header (BB's `experimental_threadBanner`;
// above its composer on a BB without it), one per approval its workers wait
// on now (Main: also the workers with no conversation), from
// bot_conversation_approvals. They don't depend on the Bot replying. Once an
// approval is resolved, here or anywhere else, its card says "Approved",
// "Approved for this worker" or "Denied" for a moment, then goes.
import { useBbContext } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import type { ApprovalState, ApprovalView } from "../../worker-approvals";
import { useCall, useLive } from "../live";
import { ApprovalPanel, showLiveApproval, useResolve } from "./ApprovalCard";

type Item = { worker: { threadId: string; title: string; projectId: string | null }; approval: ApprovalView };

/** How long a resolved card stays, saying how it was settled. */
export const SETTLED_SHOW_MS = 4_000;
const WAITING_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

const keyOf = (item: Item) => `${item.worker.threadId}:${item.approval.id}`;

function LiveCard({ item, onSettled }: { item: Item; onSettled(state: ApprovalState): void }) {
  useEffect(() => showLiveApproval(item.worker.threadId, item.approval.id), [item.worker.threadId, item.approval.id]);
  const resolve = useResolve(item.worker.threadId, item.approval.id);
  useEffect(() => { if (resolve.decided) onSettled(resolve.decided); }, [resolve.decided]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ApprovalPanel testId="live-approval" worker={item.worker} approval={item.approval} state={resolve.decided ?? item.approval.state} busy={resolve.busy} error={resolve.error} onDecide={(decision) => void resolve.decide(decision)} />;
}

/** The live cards for one conversation; nothing when none wait (and on any thread that isn't a conversation). */
export function ConversationApprovals({ threadId }: { threadId: string }) {
  const [pollMs, setPollMs] = useState(IDLE_POLL_MS);
  const live = useLive("bot_conversation_approvals", { threadId }, { pollMs });
  const call = useCall();
  const pending = live.data?.approvals ?? NONE;
  // Cards that just left the list, kept for a moment with how they were settled.
  const [settled, setSettled] = useState<ReadonlyMap<string, Item & { state: ApprovalState }>>(new Map());
  const previous = useRef<readonly Item[]>(NONE);
  const settle = (item: Item, state: ApprovalState) => {
    const key = keyOf(item);
    setSettled((current) => new Map(current).set(key, { ...item, state }));
    setTimeout(() => setSettled((current) => { const next = new Map(current); next.delete(key); return next; }), SETTLED_SHOW_MS);
  };
  useEffect(() => { setPollMs(pending.length ? WAITING_POLL_MS : IDLE_POLL_MS); }, [pending.length]);
  useEffect(() => {
    if (!live.data) return;
    const now = new Set(pending.map(keyOf));
    // Resolved somewhere else (BB's own prompt, the Bot's line, another window): ask BB how.
    for (const gone of previous.current.filter((item) => !now.has(keyOf(item)))) {
      if (settled.has(keyOf(gone))) continue;
      void call("bot_worker_approval", { threadId: gone.worker.threadId, interactionId: gone.approval.id })
        .then((result) => settle(gone, result.approval?.state && result.approval.state !== "pending" && result.approval.state !== "resolving" ? result.approval.state : "gone"), () => settle(gone, "gone"));
    }
    previous.current = pending;
  }, [live.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = pending.filter((item) => !settled.has(keyOf(item)));
  if (!shown.length && !settled.size) return null;
  return (
    <div data-testid="live-approvals" role="region" aria-label="Approvals waiting on you" className="studio-root flex shrink-0 flex-col gap-2 border-b border-border px-5 py-2.5">
      {shown.map((item) => <LiveCard key={keyOf(item)} item={item} onSettled={(state) => settle(item, state)} />)}
      {[...settled.entries()].map(([key, item]) => <ApprovalPanel key={key} testId="live-approval" worker={item.worker} approval={item.approval} state={item.state} />)}
    </div>
  );
}

/** The same cards above the composer, on a BB without thread banners. */
export function ConversationApprovalsBanner() {
  const { threadId } = useBbContext();
  return threadId ? <ConversationApprovals threadId={threadId} /> : null;
}

const NONE: Item[] = [];

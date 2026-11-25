// The Bot chat's pending questions and approvals, for the Bot page's Needs you.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { visiblePoll } from "../../kit/app/visible-poll";

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
    const stop = visiblePoll(load, 30_000);
    return () => { live = false; stop(); };
  }, [sdk, threadId]);
  return pending;
}

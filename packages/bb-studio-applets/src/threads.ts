// Thread access for applets, in a small stable shape (ThreadSummary) so
// applets don't depend on BB's full thread records.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ThreadSummary } from "../contract";

type Sdk = BbPluginApi["sdk"];
/** The fields both `threads.get` and `threads.list` return. */
type Thread = {
  id: string;
  title?: string | null;
  projectId?: string | null;
  status: string;
  updatedAt?: number | null;
  hasPendingInteraction?: boolean;
};

const ACTIVE = new Set(["active", "starting", "pending"]);

export function summarize(thread: Thread): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title?.trim() || "Untitled thread",
    projectId: thread.projectId ?? null,
    status: thread.status,
    needsYou: Boolean(thread.hasPendingInteraction) || thread.status === "error",
    updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : null,
  };
}

/** Threads waiting on you first, then running ones, then the most recent. */
export function sortForHud(rows: ThreadSummary[]): ThreadSummary[] {
  const rank = (row: ThreadSummary) => (row.needsYou ? 0 : ACTIVE.has(row.status) ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function listThreads(sdk: Sdk, input: { projectId?: string; active?: boolean } | null): Promise<ThreadSummary[]> {
  const rows: ThreadSummary[] = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const page = await sdk.threads.list({ ...(input?.projectId ? { projectId: input.projectId } : {}), archived: false, limit: 200, offset });
    rows.push(...page.map(summarize));
    if (page.length < 200) break;
  }
  const filtered = input?.active ? rows.filter((row) => row.needsYou || ACTIVE.has(row.status)) : rows;
  return sortForHud(filtered);
}

export async function getThread(sdk: Sdk, threadId: string): Promise<ThreadSummary> {
  return summarize(await sdk.threads.get({ threadId }));
}

export async function tellThread(sdk: Sdk, threadId: string, text: string): Promise<void> {
  await sdk.threads.send({ threadId, input: [{ type: "text", text, mentions: [] }], mode: "queue-if-active" });
}

export async function openThread(sdk: Sdk, threadId: string): Promise<void> {
  await sdk.threads.open({ threadId, file: null });
}

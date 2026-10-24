// When a thread's current turn started, for the elapsed time on a running
// row (a Bot's Running threads, a runner mid-run). BB's thread objects don't
// carry it; the newest open turn in the timeline does.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Sdk = BbPluginApi["sdk"];

/** The start of the thread's open turn; null when none is open or the timeline can't be read. */
export async function turnStartedAt(sdk: Sdk, threadId: string): Promise<number | null> {
  let page: Awaited<ReturnType<Sdk["threads"]["timeline"]>> | null;
  try { page = await sdk.threads.timeline({ threadId, segmentLimit: "1", includeNestedRows: "false", summaryOnly: "true" }); } catch { return null; }
  let started: number | null = null;
  for (const row of page?.rows ?? []) {
    if (row.kind === "turn" && row.completedAt == null && (started === null || row.createdAt > started)) started = row.createdAt;
  }
  return started;
}

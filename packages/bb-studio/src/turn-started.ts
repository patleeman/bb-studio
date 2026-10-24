// When a running thread's current turn started, for the elapsed time on a
// running row (a Bot's Running threads, a runner mid-run). BB's thread
// objects don't carry it. In the timeline's newest segment, finished turns
// are folded into "turn" rows and the open turn is the rows after them, so
// its start is the first of those (or an open "turn" row's, if BB folds it).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Sdk = BbPluginApi["sdk"];
type Row = Awaited<ReturnType<Sdk["threads"]["timeline"]>>["rows"][number];

/** The open turn's start in a page of timeline rows, oldest first; null with none. */
export function openTurnStart(rows: readonly Row[]): number | null {
  let start: number | null = null;
  for (const row of rows) {
    if (row.kind === "turn") {
      if (row.completedAt == null) return row.createdAt;
      start = null;
    } else if (start === null) start = row.createdAt;
  }
  return start;
}

/** Only for a thread that is running now; null when the timeline can't be read. */
export async function turnStartedAt(sdk: Sdk, threadId: string): Promise<number | null> {
  try {
    const page = await sdk.threads.timeline({ threadId, segmentLimit: "1" });
    return openTurnStart(page.rows);
  } catch {
    return null;
  }
}

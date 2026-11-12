import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { displayName, type DesignStore } from "./store";
import { parseSteps, parseViewport, screenUrl } from "../shared";
import { VERDICT_DONE, parseVerdict, reviewTargets, reviewerPrompt } from "./review";
import type { ReviewRequest, ReviewResult } from "./review-queue";

const REVIEW_TIMEOUT_MS = 15 * 60_000;

/** Run and release one hidden reviewer for the selected screen revisions. */
export async function runDesignReview(bb: BbPluginApi, store: DesignStore, designId: string, { screenIds, requesterThreadId }: ReviewRequest, disposed: AbortSignal): Promise<ReviewResult> {
  const row = store.get(designId);
  if (!row) throw new Error("Design not found.");
  const round = screenIds.length ? Number(screenIds[0]!.slice(0, -1)) : null;
  let reviewerId: string | null = null;
  try {
    const screens = screenIds.flatMap((id) => {
      const screen = store.screen(designId, id);
      return screen ? [{ id, caption: screen.caption, viewport: parseViewport(screen.viewport) ?? "desktop", steps: parseSteps(screen.html), url: screenUrl(designId, id, screen.updated_at) }] : [];
    });
    const requester = await bb.sdk.threads.get({ threadId: requesterThreadId });
    const hostId = (await bb.sdk.system.config()).primaryHostId;
    if (!hostId) throw new Error("This BB server has no local machine to run the reviewer's browser on.");
    const prompt = reviewerPrompt({
      designName: displayName(row),
      designId,
      round,
      screens,
      targets: reviewTargets(bb.server.loopbackBaseUrl, screens),
      hostId,
      rules: "The \"Taste rules\" and \"Writing screens\" sections of the design skill. Read the skill first.",
    });
    const reviewer = await bb.sdk.threads.spawn({
      projectId: requester.projectId,
      environment: { type: "reuse", environmentId: requester.environmentId },
      providerId: requester.providerId,
      title: `Review: ${displayName(row)}${round ? `, round ${round}` : ""}`,
      visibility: "hidden",
      pluginMetadata: { role: "design-reviewer", designId },
      prompt,
    } as Parameters<typeof bb.sdk.threads.spawn>[0]);
    reviewerId = reviewer.id;
    const signal = AbortSignal.any([disposed, AbortSignal.timeout(REVIEW_TIMEOUT_MS)]);
    // Wait for it to start, then to finish; a fast reviewer may already be done.
    await bb.sdk.threads.wait({ threadId: reviewer.id, status: "active", timeoutMs: 60_000, signal }).catch(() => undefined);
    await bb.sdk.threads.wait({ threadId: reviewer.id, status: "idle", signal });
    const { output } = await bb.sdk.threads.output({ threadId: reviewer.id });
    const { verdict, findings } = parseVerdict(output ?? "");
    if (verdict === "needs_work") return { verdict, findings };
    if (verdict === "done") return { verdict };
    throw new Error(`The reviewer ended without a verdict (expected "${VERDICT_DONE}" or "needs_work").`);
  } finally {
    // Hidden workers must always be released, or the agent process lingers.
    if (reviewerId) {
      await bb.sdk.threads.archive({ threadId: reviewerId }).catch(() => undefined);
      await bb.sdk.threads.stop({ threadId: reviewerId }).catch(() => undefined);
    }
  }
}

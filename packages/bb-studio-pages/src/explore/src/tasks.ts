import { z } from "zod";
import { explainerKey } from "./store";

export interface TaskFinding { threadId: string; messageId: string; label: string; parentId?: string | null; create?: boolean }
export interface TaskTrackingDeps {
  callRpc<T>(pluginId: string, method: string, input: unknown, schema: z.ZodType<T>): Promise<T>;
  pageId(key: string, parentId?: string | null): string | null;
}
const resultSchema = z.object({ task: z.object({ id: z.string(), title: z.string() }).nullable() });

/** Task-side source keys survive retries and Explore reloads without duplicate work. */
export function exploreTasks(deps: TaskTrackingDeps) {
  return async (input: TaskFinding) => {
    const key = explainerKey(input);
    try {
      const result = await deps.callRpc("studio-tasks", "trackFinding", {
        key: `explore:${key}`, threadId: input.threadId, messageId: input.messageId,
        title: input.label, pageId: deps.pageId(key, input.parentId), create: input.create ?? false,
      }, resultSchema);
      return { available: true, task: result.task };
    } catch (cause) {
      // An unavailable optional plugin must not block reading or exploring findings.
      if (!input.create) return { available: false, task: null };
      throw new Error(`Could not track this finding. Check that Studio Tasks is installed and running, then retry. ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
}

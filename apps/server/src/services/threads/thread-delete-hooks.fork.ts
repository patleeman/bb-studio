import type { ExperimentalBeforeThreadDeleteHandler } from "@get-bb/plugin-sdk";
import { ApiError } from "../../errors.js";

const HANDLER_TIMEOUT_MS = 5 * 60_000;
const handlers = new Map<string, ExperimentalBeforeThreadDeleteHandler>();

export function registerBeforeThreadDelete(
  pluginId: string,
  handler: ExperimentalBeforeThreadDeleteHandler,
): () => void {
  handlers.set(pluginId, handler);
  return () => {
    if (handlers.get(pluginId) === handler) handlers.delete(pluginId);
  };
}

async function withTimeout(
  work: Promise<void>,
  pluginId: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${pluginId} did not answer in time`)),
          HANDLER_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function askBeforeThreadDelete(
  threadIds: readonly string[],
): Promise<void> {
  for (const [pluginId, handler] of handlers) {
    for (const threadId of threadIds) {
      try {
        await withTimeout(Promise.resolve(handler({ threadId })), pluginId);
      } catch (error) {
        throw new ApiError(
          409,
          "invalid_request",
          `The ${pluginId} plugin stopped the deletion: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

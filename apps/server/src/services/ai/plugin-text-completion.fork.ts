import type {
  ExperimentalTextCompletionRequest,
  ExperimentalTextCompletionResult,
} from "@get-bb/plugin-sdk";
import { runTextAiTask } from "./ai-tasks.js";

/**
 * Plugins' one-line model calls (`experimental_completeText`): bb's own title
 * task, on the AI service the user picked for thread titles. No tools, no
 * thread, no workspace. The server registers its deps at startup.
 */
type TextTaskDeps = Parameters<typeof runTextAiTask>[0];

export const TEXT_COMPLETION_MAX_PROMPT = 32_000;
export const TEXT_COMPLETION_MAX_MS = 8_000;
const TEXT_COMPLETION_MIN_MS = 500;

let registered: TextTaskDeps | null = null;

export function registerForkTextCompletion(deps: TextTaskDeps): void {
  registered = deps;
}

export async function completeTextForPlugin(
  pluginId: string,
  request: ExperimentalTextCompletionRequest,
  deps: TextTaskDeps | null = registered,
): Promise<ExperimentalTextCompletionResult> {
  const prompt =
    typeof request?.prompt === "string" ? request.prompt.trim() : "";
  if (deps === null || prompt === "") {
    return {
      ok: false,
      reason: "unavailable",
      message:
        deps === null ? "Text completion is not available" : "Empty prompt",
      ms: 0,
    };
  }
  const timeoutMs = Math.min(
    TEXT_COMPLETION_MAX_MS,
    Math.max(
      TEXT_COMPLETION_MIN_MS,
      typeof request.timeoutMs === "number" &&
        Number.isFinite(request.timeoutMs)
        ? request.timeoutMs
        : TEXT_COMPLETION_MAX_MS,
    ),
  );
  const outcome = await runTextAiTask(deps, {
    task: "thread-title",
    label: "Plugin text completion",
    prompt: prompt.slice(0, TEXT_COMPLETION_MAX_PROMPT),
    timeoutMs,
    logContext: { pluginId },
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  return outcome.ok
    ? {
        ok: true,
        text: outcome.value,
        service: outcome.service.displayName,
        ms: outcome.durationMs,
      }
    : {
        ok: false,
        reason: outcome.reason,
        message: outcome.message,
        ms: outcome.durationMs,
      };
}

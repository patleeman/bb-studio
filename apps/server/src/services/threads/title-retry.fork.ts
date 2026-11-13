import { getEnvironment, getThread } from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type {
  LoggedPendingInteractionWorkSessionDeps,
  LoggedWorkSessionDeps,
} from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import {
  applyGeneratedThreadTitle,
  generateThreadMetadataWithOutcome,
  type ThreadMetadataGenerationOutcome,
} from "./title-generation.js";
import { dispatchThreadRenameCommand } from "./thread-commands.js";
import {
  dropTitleRetry,
  queueTitleRetry,
  type TitleRetryResult,
} from "./title-retry-queue.fork.js";

function retriable(outcome: ThreadMetadataGenerationOutcome): boolean {
  return (
    !outcome.metadata?.title &&
    (outcome.reason === "inference-unavailable" ||
      outcome.reason === "failed" ||
      outcome.reason === "timeout")
  );
}

function canDispatchCommands(
  deps: LoggedWorkSessionDeps,
): deps is LoggedPendingInteractionWorkSessionDeps {
  return "pendingInteractions" in deps && "terminalSessions" in deps;
}

function renameInProvider(
  deps: LoggedWorkSessionDeps,
  threadId: string,
  title: string,
): void {
  if (!canDispatchCommands(deps)) return;
  const thread = getThread(deps.db, threadId);
  const environment = thread?.environmentId
    ? getEnvironment(deps.db, thread.environmentId)
    : null;
  if (
    !thread ||
    !environment ||
    (thread.status !== "active" && thread.status !== "idle")
  ) {
    return;
  }
  dispatchThreadRenameCommand(deps, {
    environment: { id: environment.id, hostId: environment.hostId },
    providerId: thread.providerId,
    threadId: thread.id,
    title,
  });
}

async function retryTitle(
  deps: LoggedWorkSessionDeps,
  args: { threadId: string; input: PromptInput[] },
): Promise<TitleRetryResult> {
  const thread = getThread(deps.db, args.threadId);
  if (thread === null || thread.title) return "done";
  try {
    const outcome = await generateThreadMetadataWithOutcome(deps, args);
    const title = outcome.metadata?.title;
    if (title) {
      if (applyGeneratedThreadTitle(deps, { threadId: args.threadId, title })) {
        renameInProvider(deps, args.threadId, title);
      }
      return "done";
    }
    return retriable(outcome) ? "again" : "done";
  } catch (error) {
    deps.logger.warn(
      {
        threadId: args.threadId,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Thread title retry failed",
    );
    return "again";
  }
}

export function noteTitleOutcome(
  deps: LoggedWorkSessionDeps,
  args: { threadId: string; input: PromptInput[] },
  outcome: ThreadMetadataGenerationOutcome,
): void {
  if (!retriable(outcome)) {
    dropTitleRetry(args.threadId);
    return;
  }
  queueTitleRetry(args.threadId, () => retryTitle(deps, args));
}

import {
  getThread,
  listStoredEventRows,
  threads,
  type DbConnection,
  type DbNotifier,
  type DbTransaction,
} from "@bb/db";
import type { PromptInput, ResolvedThreadExecutionOptions } from "@bb/domain";
import { eq, sql } from "drizzle-orm";
import type {
  CommandResultReportForType,
  CommandResultSideEffectsResult,
  HostDaemonCommandExecutionRecord,
  HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../hosts/live-command.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "./lifecycle-outcome.js";
import { parseStoredEventPayload } from "./thread-data.js";
import { appendClientTurnEventInTransaction } from "./thread-events.js";
import {
  persistedThreadProvisionContextSchema,
  readThreadStartupContextOfKind,
} from "./thread-startup-store.js";

const SEED_MAX_CHARS = 60_000;
const SEED_HEADER =
  "This thread continues an earlier conversation whose session could not be copied. Here it is, up to where this thread starts:";

type LifecycleDeps = Parameters<
  typeof applyLoggedThreadLifecycleEventInTransaction
>[0];

export interface ForkStartFallbackArgs {
  command: HostDaemonCommandForType<"thread.start">;
  deps: LifecycleDeps & { db: DbTransaction; hub: DbNotifier };
  execution: HostDaemonCommandExecutionRecord;
  report: CommandResultReportForType<"thread.start">;
}

interface TranscriptItem {
  type?: string;
  text?: unknown;
  content?: ({ type?: string; text?: unknown } | null)[];
  parentToolCallId?: string;
}

function readItem(
  row: Parameters<typeof parseStoredEventPayload>[0],
): TranscriptItem | null {
  try {
    const item = parseStoredEventPayload(row).item;
    return item !== null && typeof item === "object"
      ? (item as TranscriptItem)
      : null;
  } catch {
    return null;
  }
}

export function sourceForkEndSequence(
  db: DbTransaction,
  sourceThreadId: string,
  checkpointId: string | undefined,
): number | null {
  if (checkpointId === undefined) return null;
  for (const row of listStoredEventRows(db as unknown as DbConnection, {
    threadId: sourceThreadId,
    types: ["turn/completed"],
  })) {
    try {
      if (parseStoredEventPayload(row).providerCheckpointId === checkpointId) {
        return row.sequence;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function forkTranscriptSeed(
  db: DbTransaction,
  threadId: string,
  endSequence: number | null = null,
): PromptInput | null {
  const lines: string[] = [];
  for (const row of listStoredEventRows(db as unknown as DbConnection, {
    threadId,
    types: ["item/completed"],
  })) {
    if (endSequence !== null && row.sequence > endSequence) break;
    const item = readItem(row);
    if (!item || item.parentToolCallId !== undefined) continue;
    if (item.type === "userMessage" && Array.isArray(item.content)) {
      const text = item.content
        .flatMap((part) =>
          part?.type === "text" && typeof part.text === "string"
            ? [part.text]
            : [],
        )
        .join("\n")
        .trim();
      if (text) lines.push(`User: ${text}`);
    } else if (
      item.type === "agentMessage" &&
      typeof item.text === "string" &&
      item.text.trim()
    ) {
      lines.push(`Assistant: ${item.text.trim()}`);
    }
  }
  if (lines.length === 0) return null;
  let transcript = lines.join("\n\n");
  if (transcript.length > SEED_MAX_CHARS) {
    transcript = `…\n\n${transcript.slice(transcript.length - SEED_MAX_CHARS)}`;
  }
  return {
    type: "text",
    text: `${SEED_HEADER}\n\n${transcript}`,
    mentions: [],
    visibility: "agent-only",
  } as PromptInput;
}

function forgetDispatchedFork(
  db: DbTransaction,
  threadId: string,
): ResolvedThreadExecutionOptions | null {
  const dispatched = readThreadStartupContextOfKind(
    db,
    threadId,
    "dispatched",
    persistedThreadProvisionContextSchema,
  );
  if (dispatched === null) return null;
  db.update(threads)
    .set({
      startupContext: sql`json_set(${threads.startupContext}, '$.request.fork', json('null'))`,
    })
    .where(eq(threads.id, threadId))
    .run();
  return dispatched.request.execution;
}

export function isSessionCopyFailure(
  errorMessage: string,
  sourceProviderThreadId: string,
): boolean {
  return (
    errorMessage.includes(sourceProviderThreadId) &&
    /not found|fork/i.test(errorMessage)
  );
}

export function restartForkFromTranscript(
  args: ForkStartFallbackArgs,
): CommandResultSideEffectsResult | null {
  const { command, deps } = args;
  if (args.report.ok || command.fork === undefined) return null;
  if (
    !isSessionCopyFailure(
      args.report.errorMessage,
      command.fork.sourceProviderThreadId,
    )
  ) {
    return null;
  }
  const db = deps.db;
  const thread = getThread(db, command.threadId);
  if (
    !thread ||
    thread.deletedAt !== null ||
    thread.archivedAt !== null ||
    thread.status !== "starting"
  ) {
    return null;
  }
  const seed =
    forkTranscriptSeed(db, thread.id) ??
    (thread.sourceThreadId === null
      ? null
      : forkTranscriptSeed(
          db,
          thread.sourceThreadId,
          sourceForkEndSequence(
            db,
            thread.sourceThreadId,
            command.fork.sourceProviderCheckpointId,
          ),
        ));
  const contextExecution = forgetDispatchedFork(db, thread.id);
  deps.logger.warn(
    { threadId: thread.id, detail: args.report.errorMessage },
    "Fork session copy failed; starting from the transcript",
  );
  if (command.input.length > 0) {
    const { fork: _fork, ...rest } = command;
    const retry: HostDaemonCommandForType<"thread.start"> = {
      ...rest,
      input: seed ? [seed, ...command.input] : command.input,
      ...(command.inputGroups !== undefined
        ? {
            inputGroups: seed
              ? [
                  [seed, ...command.inputGroups[0]!],
                  ...command.inputGroups.slice(1),
                ]
              : command.inputGroups,
          }
        : {}),
    };
    return {
      postCommitActions: [
        {
          run: (runDeps) =>
            runLiveHostCommand(runDeps, {
              command: retry,
              hostId: args.execution.hostId,
              timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
            }).then(
              () => undefined,
              (error: unknown) => {
                runDeps.logger.warn(
                  { err: error, threadId: thread.id },
                  "Fork restart from the transcript failed",
                );
              },
            ),
        },
      ],
    };
  }
  const execution = contextExecution;
  if (seed && execution) {
    appendClientTurnEventInTransaction(db, {
      threadId: thread.id,
      environmentId: thread.environmentId,
      type: "client/turn/requested",
      input: [seed],
      execution,
      initiator: "agent",
      originPluginId: null,
      senderThreadId: thread.sourceThreadId ?? thread.id,
      requestMethod: "thread/start",
      source: "spawn",
      target: { kind: "thread-start" },
    });
  }
  const outcome = applyLoggedThreadLifecycleEventInTransaction(deps, {
    event: { type: "run.succeeded" },
    threadId: thread.id,
  });
  if (outcome.applied) deps.hub.notifyThread(thread.id, ["status-changed"]);
  return { postCommitActions: [] };
}

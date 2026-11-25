import {
  createEventId,
  getThread,
  listQueuedThreadMessages,
  threads,
  type DbTransaction,
} from "@bb/db";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  THREAD_CONTEXT_CLEARED_DETAIL,
  THREAD_SESSION_OPTIONS_STATE_KIND,
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
  permissionModeRank,
  threadScope,
  type AvailableModel,
  type PermissionMode,
  type ReasoningLevel,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  getHostPermissionCeiling,
  resolveEnvironmentHostId,
} from "../hosts/permission-ceiling.js";
import { resolveSystemExecutionOptionsForValidation } from "../system/execution-options.js";
import { loadThreadExecutionDefaults } from "./project-execution-defaults.js";
import {
  DEFAULT_PROVIDER_MOVE_HISTORY_TOKENS,
  PROVIDER_MOVE_OPERATION,
  getLatestProviderMove,
  getPendingProviderMove,
  noteProviderMove,
  type ProviderMoveRecord,
} from "./provider-move-state.fork.js";
import { clearThreadContext } from "./thread-context-clear.js";
import { withThreadContextClearGuard } from "./thread-context-mutation-guard.js";
import { hasProviderMoveHandler } from "./turn-context.fork.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import { normalizeRecordedPermissionMode } from "./thread-default-policy.js";
import {
  appendThreadEvent,
  appendThreadEventInTransaction,
  getLastExecutionOptions,
} from "./thread-events.js";
import { buildThreadStatusChangeMetadata } from "./thread-runtime-display.js";

type ThreadRow = NonNullable<ReturnType<typeof getThread>>;

// Moves a thread to another provider in place: same thread id, timeline,
// environment and links. The provider session is dropped exactly like a
// context clear, and in the same transaction the thread's provider, model and
// reasoning change and a system/operation "thread/provider-move" event
// records { from, to, historyTokens, at, by }. The next turn starts a new
// session on the target; turn-context.fork.ts hands plugins the move so they
// can rebuild history for that first turn.

export const MAX_PROVIDER_MOVE_HISTORY_TOKENS = 1_000_000;

export interface MoveThreadProviderRequest {
  providerId: string;
  model?: string | undefined;
  permissionMode?: PermissionMode | undefined;
  historyTokens?: number | undefined;
  dryRun?: boolean | undefined;
  includeArchived?: boolean | undefined;
  /**
   * Move even when no plugin handles provider moves. The first turn then
   * starts with no history (the move records handoff "none").
   */
  force?: boolean | undefined;
}

export interface MoveThreadProviderSide {
  providerId: string;
  model: string | null;
  permissionMode: PermissionMode | null;
}

export interface MoveThreadProviderResult {
  status: "moved" | "already-moved" | "would-move";
  threadId: string;
  from: MoveThreadProviderSide;
  to: MoveThreadProviderSide & {
    model: string;
    permissionMode: PermissionMode;
  };
  historyTokens: number;
  handoff: "required" | "none";
}

function refuse(
  status: 409 | 422,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ApiError(
    status,
    code,
    message,
    details !== undefined ? { details } : undefined,
  );
}

/** The thread's current effective permission mode for its next turn. */
export function currentThreadPermissionMode(
  deps: Pick<
    LoggedPendingInteractionWorkSessionDeps,
    "db" | "providerRegistry"
  >,
  thread: ThreadRow,
): PermissionMode {
  const last = getLastExecutionOptions(deps, thread.id);
  return last !== null
    ? normalizeRecordedPermissionMode(last.permissionMode)
    : loadThreadExecutionDefaults(deps, thread).permissionMode;
}

function currentThreadModel(
  deps: Pick<
    LoggedPendingInteractionWorkSessionDeps,
    "db" | "providerRegistry"
  >,
  thread: ThreadRow,
): string | null {
  if (thread.modelOverride !== null) return thread.modelOverride;
  const last = getLastExecutionOptions(deps, thread.id);
  return last?.model ?? loadThreadExecutionDefaults(deps, thread).model ?? null;
}

/**
 * The permission the moved thread runs with. Never above the current mode
 * unless `full` is asked for explicitly; never above the host's ceiling; and
 * one the target provider supports.
 */
export function resolveMovePermissionMode(args: {
  current: PermissionMode;
  requested: PermissionMode | undefined;
  supported: readonly PermissionMode[] | null;
  ceiling: PermissionMode;
}): PermissionMode {
  const supported =
    args.supported && args.supported.length > 0 ? args.supported : null;
  if (args.requested !== undefined) {
    if (
      permissionModeRank(args.requested) > permissionModeRank(args.current) &&
      args.requested !== "full"
    ) {
      refuse(
        422,
        "permission_widening",
        `Permission ${args.requested} is wider than the thread's current ${args.current}. Only an explicit full may widen it.`,
      );
    }
    if (permissionModeRank(args.requested) > permissionModeRank(args.ceiling)) {
      refuse(
        422,
        "permission_widening",
        `This machine limits permission mode to ${args.ceiling}.`,
      );
    }
    if (supported !== null && !supported.includes(args.requested)) {
      refuse(
        422,
        "permission_unsupported",
        `The target provider supports ${supported.join(", ")}, not ${args.requested}.`,
      );
    }
    return args.requested;
  }
  const limit =
    permissionModeRank(args.ceiling) < permissionModeRank(args.current)
      ? args.ceiling
      : args.current;
  const candidates = (supported ?? [limit])
    .filter((mode) => permissionModeRank(mode) <= permissionModeRank(limit))
    .sort((a, b) => permissionModeRank(b) - permissionModeRank(a));
  const chosen = candidates[0];
  if (chosen === undefined) {
    refuse(
      422,
      "permission_unsupported",
      `The target provider supports only ${(supported ?? []).join(", ")}, which is wider than the thread's ${limit}. Pass permissionMode full explicitly to allow it.`,
    );
  }
  return chosen;
}

function pickReasoning(
  model: AvailableModel | undefined,
  current: ReasoningLevel | null,
): ReasoningLevel {
  const supported = (model?.supportedReasoningEfforts ?? []).map(
    (effort) => effort.reasoningEffort,
  );
  if (current !== null && supported.includes(current)) return current;
  return model?.defaultReasoningEffort ?? current ?? "medium";
}

function assertMovable(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: ThreadRow,
  includeArchived: boolean,
  waivingHandoff: boolean,
): void {
  if (thread.deletedAt !== null) {
    refuse(409, "thread_busy", "Thread is deleted", { reason: "deleted" });
  }
  if (thread.archivedAt !== null && !includeArchived) {
    refuse(409, "thread_busy", "Thread is archived", { reason: "archived" });
  }
  if (thread.status !== "idle" && thread.status !== "error") {
    refuse(
      409,
      "thread_busy",
      `Thread is ${thread.status}; move it when it is idle or failed`,
      { reason: "running" },
    );
  }
  if (
    deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(thread.id)
  ) {
    refuse(409, "thread_busy", "Thread has a pending interaction", {
      reason: "pending-interaction",
    });
  }
  // A waiver may run while a queued message waits on the very handoff it
  // waives (that send failed with handoff_unavailable); the clear's closing
  // queued dispatch then sends it on.
  if (
    !waivingHandoff &&
    listQueuedThreadMessages(deps.db, thread.id).length > 0
  ) {
    refuse(409, "thread_busy", "Thread has queued messages", {
      reason: "queued-messages",
    });
  }
}

export async function moveThreadProvider(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    thread: ThreadRow;
    request: MoveThreadProviderRequest;
    by: string;
    now?: () => Date;
  },
): Promise<MoveThreadProviderResult> {
  const { request } = args;
  const thread = getThread(deps.db, args.thread.id) ?? args.thread;
  const historyTokens = Math.min(
    Math.max(
      Math.floor(request.historyTokens ?? DEFAULT_PROVIDER_MOVE_HISTORY_TOKENS),
      0,
    ),
    MAX_PROVIDER_MOVE_HISTORY_TOKENS,
  );
  const fromModel = currentThreadModel(deps, thread);
  const fromPermission = currentThreadPermissionMode(deps, thread);
  const from: MoveThreadProviderSide = {
    providerId: thread.providerId,
    model: fromModel,
    permissionMode: fromPermission,
  };

  // --force on a thread whose newest move is still pending to this same
  // target waives its history: it moves again in place with handoff "none".
  const pendingMove = getPendingProviderMove(deps.db, thread.id);
  const waiveHandoff =
    request.force === true &&
    pendingMove !== null &&
    pendingMove.handoff === "required" &&
    pendingMove.to.providerId === request.providerId &&
    (request.model === undefined || request.model === pendingMove.to.model);
  if (
    !waiveHandoff &&
    thread.providerId === request.providerId &&
    (request.model === undefined || request.model === fromModel) &&
    fromModel !== null &&
    (request.permissionMode === undefined ||
      request.permissionMode === fromPermission)
  ) {
    return {
      status: "already-moved",
      threadId: thread.id,
      from,
      to: { ...from, model: fromModel, permissionMode: fromPermission },
      historyTokens:
        getLatestProviderMove(deps.db, thread.id)?.historyTokens ??
        historyTokens,
      handoff: getLatestProviderMove(deps.db, thread.id)?.handoff ?? "none",
    };
  }

  assertMovable(deps, thread, request.includeArchived === true, waiveHandoff);
  // Without a plugin that rebuilds history, a move would silently drop the
  // conversation from the agent's view. Refuse unless forced.
  const handlerReady = hasProviderMoveHandler();
  if (!handlerReady && request.force !== true) {
    refuse(
      422,
      "no_handoff_handler",
      "No plugin handles provider moves, so the new provider would start with no history. Install or enable one (BB Studio), or force the move.",
    );
  }
  const handoff: "required" | "none" =
    handlerReady && !waiveHandoff ? "required" : "none";

  // The target must be registered, enabled and available on this thread's
  // machine, and the model must be in its catalog there.
  const options = await resolveSystemExecutionOptionsForValidation(
    deps,
    {
      providerId: request.providerId,
      ...(thread.environmentId !== null
        ? { environmentId: thread.environmentId }
        : { projectId: thread.projectId }),
    },
    request.model ?? null,
  );
  const provider = options.providers.find(
    (candidate) => candidate.id === request.providerId,
  );
  if (
    !provider ||
    !provider.available ||
    deps.providerRegistry.disabledProviderIds().has(request.providerId)
  ) {
    refuse(
      422,
      "provider_unavailable",
      `Provider ${request.providerId} is not available on this thread's machine`,
    );
  }
  if (options.modelLoadError !== null) {
    refuse(
      422,
      "provider_unavailable",
      `Unable to load ${request.providerId} models on this thread's machine`,
    );
  }
  const catalog = [...options.models, ...options.selectedOnlyModels];
  const targetModel =
    request.model !== undefined
      ? catalog.find(
          (model) =>
            model.model === request.model || model.id === request.model,
        )
      : (catalog.find((model) => model.isDefault) ?? catalog[0]);
  if (!targetModel) {
    refuse(
      422,
      "model_unavailable",
      request.model !== undefined
        ? `Model ${request.model} is not available for ${request.providerId} on this thread's machine`
        : `${request.providerId} lists no models on this thread's machine`,
    );
  }

  const hostId = resolveEnvironmentHostId(deps, thread.environmentId);
  const permissionMode = resolveMovePermissionMode({
    current: fromPermission,
    requested: request.permissionMode,
    supported:
      deps.providerRegistry.getSupportedPermissionModes(request.providerId) ??
      null,
    ceiling: getHostPermissionCeiling(deps, hostId),
  });
  const reasoningLevel = pickReasoning(
    targetModel,
    thread.reasoningLevelOverride ??
      getLastExecutionOptions(deps, thread.id)?.reasoningLevel ??
      null,
  );
  const to = {
    providerId: request.providerId,
    model: targetModel.model,
    permissionMode,
  };
  // A live thread needs a usable environment to stop and clear; check it
  // before a dry run answers so the dry run matches the real run.
  const environment =
    thread.archivedAt === null
      ? await requireThreadCommandEnvironment(deps, { thread })
      : null;
  if (request.dryRun === true) {
    return {
      status: "would-move",
      threadId: thread.id,
      from,
      to,
      historyTokens,
      handoff,
    };
  }

  const record: ProviderMoveRecord = {
    from: { providerId: from.providerId, model: from.model },
    to: { ...to, reasoningLevel },
    historyTokens,
    at: (args.now?.() ?? new Date()).toISOString(),
    by: args.by,
    handoff,
  };
  const swapInTransaction = ({ tx }: { tx: DbTransaction }) => {
    // Everything above ran outside this transaction, some of it after
    // awaits. Refuse if the thread changed meanwhile.
    const current = tx
      .select()
      .from(threads)
      .where(eq(threads.id, thread.id))
      .get();
    if (
      !current ||
      current.deletedAt !== null ||
      current.providerId !== from.providerId ||
      (current.status !== "idle" && current.status !== "error") ||
      current.archivedAt !== thread.archivedAt ||
      currentThreadModel(deps, current) !== from.model ||
      currentThreadPermissionMode(deps, current) !== from.permissionMode
    ) {
      refuse(
        409,
        "thread_busy",
        "The thread changed while it was being moved",
        {
          reason: "changed",
        },
      );
    }
    const now = Date.now();
    tx.update(threads)
      .set({
        providerId: to.providerId,
        modelOverride: to.model,
        reasoningLevelOverride: reasoningLevel,
        // A failed turn from before the move must not be retried on the new
        // provider with the old provider's execution.
        ...(current.status === "error"
          ? { status: "idle" as const, statusChangedAt: now }
          : {}),
        updatedAt: now,
      })
      .where(eq(threads.id, thread.id))
      .run();
    // The old provider's session options mean nothing to the new one: reset
    // both states so the first session gets no stale selections.
    const resets: Array<
      [
        (
          | typeof THREAD_SESSION_OPTIONS_STATE_KIND
          | typeof THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND
        ),
        { options: [] } | { selections: Record<string, never> },
      ]
    > = [
      [THREAD_SESSION_OPTIONS_STATE_KIND, { options: [] }],
      [THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND, { selections: {} }],
    ];
    for (const [kind, payload] of resets) {
      appendThreadEventInTransaction(tx, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        type: "thread/extensionState/updated",
        scope: threadScope(),
        data: { providerThreadId: "", kind, payload },
      });
    }
    noteProviderMove(thread.id);
    appendThreadEventInTransaction(tx, {
      threadId: thread.id,
      environmentId: thread.environmentId,
      type: "system/operation",
      scope: threadScope(),
      data: {
        operation: PROVIDER_MOVE_OPERATION,
        operationId: createEventId(),
        status: "completed",
        message: `Moved to ${to.providerId} · ${to.model}`,
        metadata: record as unknown as Record<string, never>,
      },
    });
  };

  if (thread.archivedAt !== null) {
    // No runtime to stop on an archived thread: write the swap, the move
    // and the context-clear marker directly, under the same guard a clear
    // takes so no send or clear runs meanwhile.
    await withThreadContextClearGuard(thread.id, async () => {
      appendThreadEvent(
        deps,
        {
          threadId: thread.id,
          environmentId: thread.environmentId,
          type: "system/operation",
          scope: threadScope(),
          data: {
            operation: THREAD_CONTEXT_CLEAR_OPERATION,
            operationId: createEventId(),
            status: "completed",
            message: THREAD_CONTEXT_CLEARED_DETAIL,
          },
        },
        swapInTransaction,
      );
    });
  } else if (environment !== null) {
    try {
      await clearThreadContext(deps, {
        environment,
        thread,
        beforeCommitInTransaction: swapInTransaction,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.body.code !== "thread_busy"
      ) {
        refuse(409, "thread_busy", error.body.message, {
          reason:
            error.body.code === "awaiting_user_interaction"
              ? "pending-interaction"
              : /became active/.test(error.body.message)
                ? "running"
                : "busy",
        });
      }
      throw error;
    }
  }
  const moved = getThread(deps.db, thread.id);
  if (moved) {
    deps.hub.notifyThread(
      thread.id,
      ["history-rewritten", "status-changed", "title-changed"],
      buildThreadStatusChangeMetadata(deps, moved),
    );
  }
  return {
    status: "moved",
    threadId: thread.id,
    from,
    to,
    historyTokens,
    handoff,
  };
}

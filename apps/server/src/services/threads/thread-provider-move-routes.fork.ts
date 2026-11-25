import { threads } from "@bb/db";
import { permissionModeSchema } from "@bb/domain";
import type { ExperimentalMoveThreadProviderResult } from "@get-bb/plugin-sdk";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  resolveRequestSource,
  type ResolvePluginRpcCaller,
} from "../../request-context.js";
import { requirePublicThread } from "../lib/entity-lookup.js";
import {
  getLatestProviderMove,
  providerMoveState,
  registerProviderMoveDb,
} from "./provider-move-state.fork.js";
import {
  MAX_PROVIDER_MOVE_HISTORY_TOKENS,
  moveThreadProvider,
} from "./thread-provider-move.fork.js";

// HTTP for thread-provider-move.fork.ts. Registered from server.ts.
//   POST /threads/:id/move-provider          move one thread (or dry run)
//   GET  /threads/:id/move-provider          its newest move and state
//   GET  /fork/provider-move/threads         select threads (?from, ?projectId, ?includeArchived)
//   GET  /fork/provider-move/status          every moved thread (?projectId)

export const moveProviderBodySchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1).optional(),
    permissionMode: permissionModeSchema.optional(),
    historyTokens: z
      .number()
      .int()
      .min(0)
      .max(MAX_PROVIDER_MOVE_HISTORY_TOKENS)
      .optional(),
    dryRun: z.boolean().optional(),
    includeArchived: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict();

function callerOf(
  context: Context,
  resolveRpcCaller: ResolvePluginRpcCaller,
): string {
  const source = resolveRequestSource(context, resolveRpcCaller);
  switch (source.kind) {
    case "plugin":
      return `plugin:${source.pluginId}`;
    case "cli":
      return source.callerThreadId === null
        ? "cli"
        : `thread:${source.callerThreadId}`;
    case "app":
      return `app:${source.surface}`;
    case "api":
      return "api";
  }
}

async function readBody(context: Context) {
  let raw: unknown;
  try {
    raw = await context.req.json();
  } catch {
    throw new ApiError(400, "invalid_request", "Body must be JSON");
  }
  const parsed = moveProviderBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      describeIssues(parsed.error.issues),
    );
  }
  return parsed.data;
}

function threadMoveStatus(deps: AppDeps, threadId: string) {
  const move = getLatestProviderMove(deps.db, threadId);
  if (move === null) return { threadId, state: "none" as const, move: null };
  return {
    threadId,
    state: providerMoveState(deps.db, threadId, move),
    move: {
      operationId: move.operationId,
      from: move.from,
      to: move.to,
      historyTokens: move.historyTokens,
      at: move.at,
      by: move.by,
      handoff: move.handoff,
    },
  };
}

let registeredDeps: AppDeps | null = null;

/**
 * bb.experimental_hooks.experimental_moveThreadProvider: the route's
 * validation and service, in process. Refusals come back as { ok: false }
 * with the route's status and code; nothing throws.
 */
export async function moveThreadProviderForPlugin(
  pluginId: string,
  threadId: string,
  request: unknown,
): Promise<ExperimentalMoveThreadProviderResult> {
  const fail = (
    httpStatus: number,
    code: string,
    message: string,
    reason: string | null = null,
  ): ExperimentalMoveThreadProviderResult => ({
    ok: false,
    threadId,
    httpStatus,
    code,
    message,
    reason,
  });
  const deps = registeredDeps;
  if (deps === null) {
    return fail(503, "unavailable", "Provider moves are not available yet");
  }
  if (typeof threadId !== "string" || threadId === "") {
    return fail(400, "invalid_request", "threadId is required");
  }
  const parsed = moveProviderBodySchema.safeParse(request);
  if (!parsed.success) {
    return fail(400, "invalid_request", describeIssues(parsed.error.issues));
  }
  try {
    const thread = requirePublicThread(deps.db, threadId);
    const result = await moveThreadProvider(deps, {
      thread,
      request: parsed.data,
      by: `plugin:${pluginId}`,
    });
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof ApiError) {
      const details = error.body.details as { reason?: unknown } | undefined;
      return fail(
        error.status,
        error.body.code,
        error.body.message,
        typeof details?.reason === "string" ? details.reason : null,
      );
    }
    return fail(
      500,
      "error",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function describeIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "body"}: ${issue.message}`,
    )
    .join("; ");
}

export function registerForkProviderMoveRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: { resolveRpcCaller: ResolvePluginRpcCaller },
): void {
  registeredDeps = deps;
  registerProviderMoveDb(deps.db);

  app.post("/threads/:id/move-provider", async (context) => {
    const body = await readBody(context);
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const result = await moveThreadProvider(deps, {
      thread,
      request: body,
      by: callerOf(context, plugins.resolveRpcCaller),
    });
    return context.json(result);
  });

  app.get("/threads/:id/move-provider", (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(threadMoveStatus(deps, thread.id));
  });

  app.get("/fork/provider-move/threads", (context) => {
    const from = context.req.query("from");
    const projectId = context.req.query("projectId");
    const includeArchived = context.req.query("includeArchived") === "true";
    const rows = deps.db
      .select({
        id: threads.id,
        title: threads.title,
        providerId: threads.providerId,
        projectId: threads.projectId,
        status: threads.status,
        archivedAt: threads.archivedAt,
      })
      .from(threads)
      .where(
        and(
          isNull(threads.deletedAt),
          from !== undefined && from.length > 0
            ? eq(threads.providerId, from)
            : undefined,
          projectId !== undefined && projectId.length > 0
            ? eq(threads.projectId, projectId)
            : undefined,
          includeArchived ? undefined : isNull(threads.archivedAt),
        ),
      )
      .all();
    return context.json({ threads: rows });
  });

  app.get("/fork/provider-move/status", (context) => {
    // Operator command: walk the live threads and use the indexed per-thread
    // lookup, rather than scanning every event for move operations.
    const projectId = context.req.query("projectId");
    const ids = deps.db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          isNull(threads.deletedAt),
          projectId !== undefined && projectId.length > 0
            ? eq(threads.projectId, projectId)
            : undefined,
        ),
      )
      .all();
    return context.json({
      threads: ids
        .map((row) => threadMoveStatus(deps, row.id))
        .filter((status) => status.state !== "none"),
    });
  });
}

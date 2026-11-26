import { Command, InvalidArgumentError } from "commander";
import {
  CALLER_THREAD_HEADER_NAME,
  CLI_REQUEST_HEADER_NAME,
} from "@bb/config/app-surface";
import { action, CliExitError } from "../../action.js";
import { cliFetch } from "../../client.js";
import { resolveContextThreadId } from "../../context-env.js";
import {
  passThroughExitCode,
  reportCommandResult,
} from "../../command-result.js";

// `bbs thread move-provider`: move threads to another provider in place
// (apps/server/src/services/threads/thread-provider-move.fork.ts). Never
// prompts. Exit 0 when every selected thread is moved, already moved or (dry
// run) would move; 2 when any failed or was skipped; 1 on bad input.

const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;
type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface MoveProviderOptions {
  to?: string;
  model?: string;
  permission?: PermissionMode;
  historyTokens?: number;
  from?: string;
  project?: string;
  includeArchived?: boolean;
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
}

interface Side {
  providerId: string;
  model: string | null;
  permissionMode: string | null;
}

export interface MoveProviderThreadResult {
  threadId: string;
  title: string | null;
  result: "moved" | "already-moved" | "would-move" | "failed";
  reason: string | null;
  message: string | null;
  from: Side | null;
  to: Side | null;
  historyTokens: number | null;
  handoff: "required" | "none" | null;
}

interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

async function request(
  getUrl: () => string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<HttpResult> {
  const headers = new Headers({ [CLI_REQUEST_HEADER_NAME]: "1" });
  const caller = resolveContextThreadId();
  if (caller !== undefined) headers.set(CALLER_THREAD_HEADER_NAME, caller);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await cliFetch(
    `${getUrl().replace(/\/$/u, "")}/api/v1${path}`,
    {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
  const parsed = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, body: parsed };
}

function failureReason(status: number, body: Record<string, unknown>): string {
  const details = body.details as { reason?: unknown } | undefined;
  if (typeof details?.reason === "string") return details.reason;
  switch (body.code) {
    case "provider_unavailable":
      return "provider-unavailable-on-machine";
    case "model_unavailable":
      return "model-unavailable";
    case "permission_widening":
      return "permission-widening";
    case "permission_unsupported":
      return "permission-unsupported";
    case "no_handoff_handler":
      return "no-handoff-handler";
    case "thread_not_found":
      return "not-found";
    default:
      return typeof body.code === "string" ? body.code : `http-${status}`;
  }
}

export function toThreadResult(
  threadId: string,
  title: string | null,
  http: HttpResult,
): MoveProviderThreadResult {
  const body = http.body;
  if (http.status >= 200 && http.status < 300) {
    const status = body.status;
    return {
      threadId,
      title,
      result:
        status === "moved" ||
        status === "already-moved" ||
        status === "would-move"
          ? status
          : "failed",
      reason: null,
      message: null,
      from: (body.from as Side | undefined) ?? null,
      to: (body.to as Side | undefined) ?? null,
      historyTokens:
        typeof body.historyTokens === "number" ? body.historyTokens : null,
      handoff:
        body.handoff === "required" || body.handoff === "none"
          ? body.handoff
          : null,
    };
  }
  return {
    threadId,
    title,
    result: "failed",
    reason: failureReason(http.status, body),
    message: typeof body.message === "string" ? body.message : null,
    from: null,
    to: null,
    historyTokens: null,
    handoff: null,
  };
}

export function summarize(results: readonly MoveProviderThreadResult[]) {
  const count = (result: MoveProviderThreadResult["result"]) =>
    results.filter((entry) => entry.result === result).length;
  return {
    total: results.length,
    moved: count("moved"),
    alreadyMoved: count("already-moved"),
    wouldMove: count("would-move"),
    failed: count("failed"),
  };
}

export function exitCodeFor(
  results: readonly MoveProviderThreadResult[],
): number {
  return results.some((entry) => entry.result === "failed") ? 2 : 0;
}

async function selectThreads(
  getUrl: () => string,
  ids: readonly string[],
  opts: MoveProviderOptions,
): Promise<Array<{ id: string; title: string | null }>> {
  if (ids.length > 0) return ids.map((id) => ({ id, title: null }));
  if (opts.from === undefined && opts.project === undefined) {
    throw new CliExitError(
      "Name thread ids, or select with --from <provider> and/or --project <id>.",
      1,
      { code: "invalid_request", hint: null },
    );
  }
  const query = new URLSearchParams();
  if (opts.from !== undefined) query.set("from", opts.from);
  if (opts.project !== undefined) query.set("projectId", opts.project);
  if (opts.includeArchived === true) query.set("includeArchived", "true");
  const http = await request(
    getUrl,
    "GET",
    `/fork/provider-move/threads?${query.toString()}`,
  );
  if (http.status !== 200) {
    throw new CliExitError(
      typeof http.body.message === "string"
        ? http.body.message
        : `The server answered ${String(http.status)}`,
      1,
    );
  }
  const rows = (http.body.threads ?? []) as Array<{
    id: string;
    title: string | null;
  }>;
  return rows.map((row) => ({ id: row.id, title: row.title }));
}

function describeSide(side: Side | null): string {
  if (side === null) return "?";
  return `${side.providerId}/${side.model ?? "?"} (${side.permissionMode ?? "?"})`;
}

export async function runMoveProvider(
  getUrl: () => string,
  ids: readonly string[],
  opts: MoveProviderOptions,
): Promise<{
  results: MoveProviderThreadResult[];
  summary: ReturnType<typeof summarize>;
  exitCode: number;
}> {
  if (opts.to === undefined || opts.to.length === 0) {
    throw new CliExitError("--to <provider> is required.", 1, {
      code: "invalid_request",
      hint: null,
    });
  }
  const selected = await selectThreads(getUrl, ids, opts);
  if (selected.length === 0) {
    throw new CliExitError("No threads matched the selection.", 1, {
      code: "invalid_request",
      hint: null,
    });
  }
  const results: MoveProviderThreadResult[] = [];
  for (const thread of selected) {
    const http = await request(
      getUrl,
      "POST",
      `/threads/${encodeURIComponent(thread.id)}/move-provider`,
      {
        providerId: opts.to,
        ...(opts.model !== undefined ? { model: opts.model } : {}),
        ...(opts.permission !== undefined
          ? { permissionMode: opts.permission }
          : {}),
        ...(opts.historyTokens !== undefined
          ? { historyTokens: opts.historyTokens }
          : {}),
        ...(opts.dryRun === true ? { dryRun: true } : {}),
        ...(opts.includeArchived === true ? { includeArchived: true } : {}),
        ...(opts.force === true ? { force: true } : {}),
      },
    );
    results.push(toThreadResult(thread.id, thread.title, http));
  }
  return {
    results,
    summary: summarize(results),
    exitCode: exitCodeFor(results),
  };
}

function parsePermission(value: string): PermissionMode {
  if ((PERMISSION_MODES as readonly string[]).includes(value)) {
    return value as PermissionMode;
  }
  throw new InvalidArgumentError(
    `Expected one of ${PERMISSION_MODES.join(", ")}.`,
  );
}

function parseTokens(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a whole number of tokens.");
  }
  return parsed;
}

export function registerMoveProviderCommand(
  parent: Command,
  getUrl: () => string,
): void {
  const command = parent
    .command("move-provider")
    .description(
      "Move threads to another provider in place (same thread, history kept; the provider session is dropped)",
    )
    .argument("[ids...]", "Thread ids to move")
    .option("--to <provider>", "Target provider id")
    .option("--model <model>", "Target model (default: the provider's default)")
    .option(
      "--permission <mode>",
      "Permission on the target (default: the thread's current mode, lowered to what the target supports; never widened unless full is passed)",
      parsePermission,
    )
    .option(
      "--history-tokens <n>",
      "History budget for the first turn after the move (default 150000). Lower it for a target whose context window is smaller, or the first turn is rejected and the history is sent again on each try",
      parseTokens,
    )
    .option("--from <provider>", "Select every thread on this provider")
    .option("--project <id>", "Select threads in this project")
    .option("--include-archived", "Include archived threads in the selection")
    .option("--dry-run", "Report what would happen; change nothing")
    .option(
      "--force",
      "Move even when no plugin rebuilds history (the new provider starts with none)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (ids: string[], opts: MoveProviderOptions) => {
        const outcome = await runMoveProvider(getUrl, ids, opts);
        const s = outcome.summary;
        reportCommandResult(opts, outcome, {
          text: [
            ...outcome.results.map((entry) => {
              const detail =
                entry.result === "failed"
                  ? `${entry.reason ?? "failed"}${entry.message ? `: ${entry.message}` : ""}`
                  : `${describeSide(entry.from)} -> ${describeSide(entry.to)}`;
              return `${entry.threadId}  ${entry.result}  ${detail}`;
            }),
            `${String(s.total)} threads: ${String(s.moved)} moved, ${String(s.alreadyMoved)} already moved, ${String(s.wouldMove)} would move, ${String(s.failed)} failed`,
          ],
          failure: null,
        });
        if (outcome.exitCode !== 0) passThroughExitCode(outcome.exitCode);
      }),
    );

  command
    .command("status")
    .description(
      "Show moved threads: pending (the new provider has not yet accepted a real turn since the move), rebuilt (it has, with the history), started (it has, after a move forced without history), or cleared",
    )
    .argument("[ids...]", "Only these threads")
    .option("--project <id>", "Only threads in this project")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (ids: string[], _opts: unknown, subcommand: Command) => {
        // The parent also takes --json and --project; read both levels.
        const opts = subcommand.optsWithGlobals<{
          project?: string;
          json?: boolean;
        }>();
        let threads: Array<Record<string, unknown>>;
        if (ids.length > 0) {
          threads = [];
          for (const id of ids) {
            const http = await request(
              getUrl,
              "GET",
              `/threads/${encodeURIComponent(id)}/move-provider`,
            );
            if (http.status !== 200) {
              throw new CliExitError(
                typeof http.body.message === "string"
                  ? http.body.message
                  : `The server answered ${String(http.status)}`,
                1,
              );
            }
            threads.push(http.body);
          }
        } else {
          const query = new URLSearchParams();
          if (opts.project !== undefined) query.set("projectId", opts.project);
          const http = await request(
            getUrl,
            "GET",
            `/fork/provider-move/status?${query.toString()}`,
          );
          if (http.status !== 200) {
            throw new CliExitError(
              typeof http.body.message === "string"
                ? http.body.message
                : `The server answered ${String(http.status)}`,
              1,
            );
          }
          threads = (http.body.threads ?? []) as Array<Record<string, unknown>>;
        }
        const summary = {
          total: threads.length,
          pending: threads.filter((t) => t.state === "pending").length,
          rebuilt: threads.filter((t) => t.state === "rebuilt").length,
          started: threads.filter((t) => t.state === "started").length,
          cleared: threads.filter((t) => t.state === "cleared").length,
        };
        reportCommandResult(opts, { threads, summary }, {
          text: [
            ...threads.map((thread) => {
              const move = thread.move as {
                to?: { providerId?: string; model?: string };
                at?: string;
              } | null;
              return `${String(thread.threadId)}  ${String(thread.state)}${move ? `  ${move.to?.providerId ?? "?"}/${move.to?.model ?? "?"}  ${move.at ?? ""}` : ""}`;
            }),
            `${String(summary.total)} moved threads: ${String(summary.pending)} pending, ${String(summary.rebuilt)} rebuilt, ${String(summary.started)} started, ${String(summary.cleared)} cleared`,
          ],
          failure: null,
        });
      }),
    );
}

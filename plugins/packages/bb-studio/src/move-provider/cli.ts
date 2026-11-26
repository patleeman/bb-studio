// `bbs studio move-provider …`, `bbs studio bot set-model …`,
// `bbs studio runner move-provider …` and `bbs studio tool-delivery …`.
// Non-interactive: nothing prompts. Every command has --json. Exit codes:
// 0 all done, 2 something skipped, deferred or failed (the output says why),
// 1 bad input.
import { parseCliArgs, type CliSpec } from "../cli-args";
import { isToolDeliveryMode, TOOL_DELIVERY_MODES, type ToolDeliveryStore } from "../tool-delivery";
import { exitCodeFor, isPermissionMode, MAX_HISTORY_TOKENS, PERMISSION_MODES, type ThreadItem } from "./core";
import { MoveInputError, type MoveOptions, type MoveProviderService, type MoveReport, type Selection, type StatusRow, type VerifyRow } from "./service";

type CliResult = { exitCode: number; stdout?: string; stderr?: string };

export const MOVE_USAGE = [
  "bb studio move-provider [<thread-id>…] [--from <provider>] [--project <id>] [--bot <id|name>] [--include-archived] [--runners] [--exclude-main]",
  "    --to <provider> [--model <model>] [--permission accept-edits|auto|full] [--history-tokens <n>]",
  "    [--automations] [--bot-defaults] [--router-rules] [--no-defer] [--dry-run] [--json]",
  "bb studio move-provider status [<thread-id>…] [--json]",
  "bb studio move-provider verify <thread-id>…|--all [--probe \"<question>\"] [--json]",
  "bb studio move-provider cancel <thread-id>…|--all-deferred [--json]",
].join("\n");
export const BOT_USAGE = "bb studio bot set-model <bot id|name> --provider <provider> [--model <model>] [--dry-run] [--json]";
export const RUNNER_USAGE = "bb studio runner move-provider <runner id|name>…|--all [--bot <id|name>] --to <provider> [--model <model>] [--permission <mode>] [--history-tokens <n>] [--dry-run] [--json]";
export const TOOL_DELIVERY_USAGE = `bb studio tool-delivery [<provider> ${TOOL_DELIVERY_MODES.join("|")}] [--json]`;

const MOVE_SPEC: CliSpec = {
  flags: ["--include-archived", "--runners", "--exclude-main", "--automations", "--bot-defaults", "--router-rules", "--no-defer", "--dry-run", "--json"],
  options: ["--from", "--project", "--bot", "--to", "--model", "--permission", "--history-tokens"],
};

export interface MoveCliDeps {
  service: MoveProviderService;
  toolDelivery: ToolDeliveryStore;
  /** The thread the command runs in, never moved by it. */
  callerThreadId: string | null;
}

const bad = (usage: string, error: string): CliResult => ({ exitCode: 1, stderr: `${error}\nusage: ${usage}\n` });
const json = (value: unknown, exitCode = 0): CliResult => ({ exitCode, stdout: `${JSON.stringify(value, null, 2)}\n` });

function moveOptions(parsed: Extract<ReturnType<typeof parseCliArgs>, { ok: true }>, callerThreadId: string | null): MoveOptions | string {
  const to = parsed.options.get("--to");
  if (!to) return "--to <provider> is required.";
  const permission = parsed.options.get("--permission");
  if (permission !== undefined && !isPermissionMode(permission)) return `--permission is one of ${PERMISSION_MODES.join(", ")}.`;
  const tokens = parsed.options.get("--history-tokens");
  const historyTokens = tokens === undefined ? undefined : Number(tokens);
  // One rule in every layer (the CLI, the handoff RPC, core): at least 1 token.
  if (historyTokens !== undefined && (!Number.isInteger(historyTokens) || historyTokens < 1 || historyTokens > MAX_HISTORY_TOKENS)) return `--history-tokens is a whole number from 1 to ${MAX_HISTORY_TOKENS}.`;
  return {
    to, model: parsed.options.get("--model"), permission: permission as MoveOptions["permission"], historyTokens,
    dryRun: parsed.flags.has("--dry-run"), automations: parsed.flags.has("--automations"), botDefaults: parsed.flags.has("--bot-defaults"),
    routerRules: parsed.flags.has("--router-rules"), noDefer: parsed.flags.has("--no-defer"), callerThreadId,
  };
}

export async function moveProviderCli(argv: readonly string[], deps: MoveCliDeps): Promise<CliResult> {
  if (argv[0] === "status") return statusCli(argv.slice(1), deps);
  if (argv[0] === "verify") return verifyCli(argv.slice(1), deps);
  if (argv[0] === "cancel") return cancelCli(argv.slice(1), deps);
  if (argv[0] === "help" || argv.includes("--help")) return { exitCode: 0, stdout: `usage: ${MOVE_USAGE}\n` };
  const parsed = parseCliArgs(argv, MOVE_SPEC);
  if (!parsed.ok) return bad(MOVE_USAGE, parsed.error);
  const options = moveOptions(parsed, deps.callerThreadId);
  if (typeof options === "string") return bad(MOVE_USAGE, options);
  const selection: Selection = {
    ids: parsed.positional, from: parsed.options.get("--from"), projectId: parsed.options.get("--project"), bot: parsed.options.get("--bot"),
    includeArchived: parsed.flags.has("--include-archived"), runners: parsed.flags.has("--runners"), excludeMain: parsed.flags.has("--exclude-main"),
  };
  return runMove(deps, selection, options, parsed.flags.has("--json"));
}

async function runMove(deps: MoveCliDeps, selection: Selection, options: MoveOptions, asJson: boolean): Promise<CliResult> {
  let report: MoveReport;
  try {
    report = await deps.service.move(selection, options);
  } catch (error) {
    if (error instanceof MoveInputError) return { exitCode: 1, stderr: `${error.message}\n` };
    throw error;
  }
  const exitCode = exitCodeFor(report);
  return asJson ? json(report, exitCode) : { exitCode, stdout: formatReport(report) };
}

export function formatReport(report: MoveReport): string {
  const lines = [`${report.dryRun ? "Dry run: " : ""}to ${report.to.providerId} · ${report.to.model}${report.to.permission ? ` · ${report.to.permission}` : ""} · history ${report.to.historyTokens} tokens`];
  if (!report.threads.length) lines.push("No threads selected.");
  for (const item of report.threads) lines.push(threadLine(item));
  for (const each of report.automations) lines.push(`  automation ${each.automationId} (${each.kind}) ${JSON.stringify(each.name)} → ${each.result}${each.reason ? ` (${each.reason})` : ""}`);
  for (const each of report.botDefaults) lines.push(`  bot default ${each.name}: ${each.from.providerId ?? "none"}/${each.from.model ?? "none"} → ${each.to.providerId}/${each.to.model} ${each.result}${each.reason ? ` (${each.reason})` : ""}`);
  if (report.router) lines.push(`  router rules: ${report.router.result}${report.router.targetsChanged ? ` (${report.router.targetsChanged} targets)` : ""}${report.router.reason ? ` (${report.router.reason})` : ""}`);
  const s = report.summary;
  lines.push(`moved ${s.moved}, already moved ${s.alreadyMoved}, would move ${s.wouldMove}, deferred ${s.deferred}, skipped ${s.skipped}, failed ${s.failed}`);
  return `${lines.join("\n")}\n`;
}

function threadLine(item: ThreadItem): string {
  const permission = item.from.permission === item.to.permission ? item.to.permission ?? "?" : `${item.from.permission ?? "?"}→${item.to.permission ?? "?"}`;
  const why = item.reason ? ` (${item.reason}${item.detail ? `: ${item.detail}` : ""})` : "";
  return `${item.result.padEnd(13)} ${item.threadId} [${item.role}] ${JSON.stringify(item.title)} ${item.from.providerId}/${item.from.model ?? "?"} → ${item.to.providerId}/${item.to.model} · ${permission}${why}`;
}

async function statusCli(argv: readonly string[], deps: MoveCliDeps): Promise<CliResult> {
  const parsed = parseCliArgs(argv, { flags: ["--json"] });
  if (!parsed.ok) return bad(MOVE_USAGE, parsed.error);
  const rows = await deps.service.status(parsed.positional);
  const patches = await deps.service.patchLedger();
  const counts = countBy(rows, (row) => row.ledger ?? "none");
  const patchFailures = rows.reduce((sum, row) => sum + row.patchErrors.length, 0) + Object.keys(patches.botDefaults).length + (patches.router ? 1 : 0);
  // Anything still to do (a failed or deferred move, a failed patch) exits 2: "re-run until status exits 0".
  const exitCode = rows.some((row) => row.ledger === "failed" || row.ledger === "deferred") || patchFailures > 0 ? 2 : 0;
  if (parsed.flags.has("--json")) return json({ threads: rows, counts, patches: { failures: patchFailures, botDefaults: patches.botDefaults, router: patches.router } }, exitCode);
  const patchLines = [
    ...Object.entries(patches.botDefaults).map(([id, f]) => `failed patch: Bot ${id} default → ${f.providerId}/${f.model}: ${f.error}`),
    ...(patches.router ? [`failed patch: router rules ${patches.router.fromProviderId} → ${patches.router.providerId}/${patches.router.model}: ${patches.router.error}`] : []),
  ];
  if (!rows.length && !patchLines.length) return { exitCode, stdout: "No moves recorded.\n" };
  return { exitCode, stdout: `${[...rows.map(statusLine), ...patchLines].join("\n")}\n${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(", ")}${patchFailures ? `, failed patches ${patchFailures}` : ""}\n` };
}

function statusLine(row: StatusRow): string {
  const on = row.provider ? `${row.provider.providerId ?? "?"}/${row.provider.model ?? "?"}` : "gone";
  return `${(row.ledger ?? "none").padEnd(13)} ${row.threadId} ${JSON.stringify(row.title ?? "")} on ${on} · core ${row.core}${row.error ? ` · ${row.error}` : ""}${row.attempts > 1 ? ` · ${row.attempts} attempts` : ""}${row.patchErrors.map((line) => `\n    failed patch: ${line}`).join("")}`;
}

async function verifyCli(argv: readonly string[], deps: MoveCliDeps): Promise<CliResult> {
  const parsed = parseCliArgs(argv, { flags: ["--json", "--all"], options: ["--probe"] });
  const usage = "bb studio move-provider verify <thread-id>…|--all [--probe \"<question>\"] [--json]";
  if (!parsed.ok) return bad(usage, parsed.error);
  const all = parsed.flags.has("--all");
  if (!all && !parsed.positional.length) return bad(usage, "Give thread ids or --all.");
  if (all && parsed.positional.length) return bad(usage, "Give thread ids or --all, not both.");
  const probe = parsed.options.get("--probe");
  const rows = await deps.service.verify(parsed.positional, { all, callerThreadId: deps.callerThreadId, ...(probe ? { probe } : {}) });
  const exitCode = rows.every((row) => row.verdict === "ok") ? 0 : 2;
  if (parsed.flags.has("--json")) return json({ threads: rows, counts: countBy(rows, (row) => row.verdict) }, exitCode);
  if (!rows.length) return { exitCode, stdout: "Nothing to verify.\n" };
  return { exitCode, stdout: `${rows.map(verifyLine).join("\n")}\n` };
}

function verifyLine(row: VerifyRow): string {
  const probe = row.probe ? row.probe.answer !== undefined ? `\n    answer: ${row.probe.answer.replace(/\s+/g, " ").slice(0, 400)}` : ` · probe ${row.probe.skipped ? `skipped (${row.probe.skipped})` : `failed (${row.probe.error})`}` : "";
  return `${row.verdict.padEnd(15)} ${row.threadId} · move event ${row.moveEvent ? "yes" : "no"} · first turn ${row.turnStarted ? "started" : "not yet"} · handoff ${row.handoffDelivered === null ? "unknown" : row.handoffDelivered ? "delivered" : "missing"}${probe}`;
}

async function cancelCli(argv: readonly string[], deps: MoveCliDeps): Promise<CliResult> {
  const usage = "bb studio move-provider cancel <thread-id>…|--all-deferred [--json]";
  const parsed = parseCliArgs(argv, { flags: ["--json", "--all-deferred"] });
  if (!parsed.ok) return bad(usage, parsed.error);
  const all = parsed.flags.has("--all-deferred");
  if (all === !!parsed.positional.length) return bad(usage, "Give thread ids or --all-deferred.");
  const cancelled = await deps.service.cancel(parsed.positional, all);
  if (parsed.flags.has("--json")) return json({ cancelled });
  return { exitCode: 0, stdout: cancelled.length ? `Cancelled ${cancelled.length} deferred move${cancelled.length === 1 ? "" : "s"}: ${cancelled.join(", ")}\n` : "No deferred moves to cancel.\n" };
}

export async function botCli(argv: readonly string[], deps: MoveCliDeps): Promise<CliResult> {
  if (argv[0] !== "set-model") return bad(BOT_USAGE, argv[0] ? `Unknown command ${argv[0]}.` : "Give a command.");
  const parsed = parseCliArgs(argv.slice(1), { flags: ["--dry-run", "--json"], options: ["--provider", "--model"] });
  if (!parsed.ok) return bad(BOT_USAGE, parsed.error);
  const [ref, ...extra] = parsed.positional;
  const provider = parsed.options.get("--provider");
  if (!ref || extra.length) return bad(BOT_USAGE, "Give one Bot.");
  if (!provider) return bad(BOT_USAGE, "--provider is required.");
  try {
    const item = await deps.service.setBotModel(ref, provider, parsed.options.get("--model"), parsed.flags.has("--dry-run"));
    const exitCode = item.result === "failed" ? 2 : 0;
    if (parsed.flags.has("--json")) return json(item, exitCode);
    return { exitCode, stdout: `${item.name}: ${item.from.providerId ?? "none"}/${item.from.model ?? "none"} → ${item.to.providerId}/${item.to.model} ${item.result}${item.reason ? ` (${item.reason})` : ""}\n` };
  } catch (error) {
    if (error instanceof MoveInputError) return { exitCode: 1, stderr: `${error.message}\n` };
    throw error;
  }
}

/** `runner move-provider`: the same move, its threads picked by runner. Its automations always follow. */
export async function runnerCli(argv: readonly string[], deps: MoveCliDeps & { runners(botRef?: string): { id: string; name: string; threadId: string }[] | null }): Promise<CliResult> {
  if (argv[0] !== "move-provider") return bad(RUNNER_USAGE, argv[0] ? `Unknown command ${argv[0]}.` : "Give a command.");
  const parsed = parseCliArgs(argv.slice(1), { flags: ["--all", "--dry-run", "--json", "--no-defer"], options: ["--bot", "--to", "--model", "--permission", "--history-tokens"] });
  if (!parsed.ok) return bad(RUNNER_USAGE, parsed.error);
  const options = moveOptions(parsed, deps.callerThreadId);
  if (typeof options === "string") return bad(RUNNER_USAGE, options);
  const all = parsed.flags.has("--all");
  if (all === !!parsed.positional.length) return bad(RUNNER_USAGE, "Give runners or --all.");
  const runners = deps.runners(parsed.options.get("--bot"));
  if (!runners) return { exitCode: 1, stderr: `No Bot ${JSON.stringify(parsed.options.get("--bot"))}.\n` };
  const picked = all ? runners : parsed.positional.map((ref) => runners.find((runner) => runner.id === ref) ?? runners.find((runner) => runner.name.toLowerCase() === ref.toLowerCase()));
  const missing = parsed.positional.filter((_, index) => !picked[index]);
  if (missing.length) return { exitCode: 1, stderr: `No runner ${missing.join(", ")}.\n` };
  const ids = picked.map((runner) => runner!.threadId);
  if (!ids.length) return { exitCode: 1, stderr: "No runners with a thread.\n" };
  return runMove(deps, { ids, includeArchived: false, runners: false }, { ...options, automations: true }, parsed.flags.has("--json"));
}

export async function toolDeliveryCli(argv: readonly string[], deps: Pick<MoveCliDeps, "toolDelivery">): Promise<CliResult> {
  const parsed = parseCliArgs(argv, { flags: ["--json"] });
  if (!parsed.ok) return bad(TOOL_DELIVERY_USAGE, parsed.error);
  const [providerId, mode, ...extra] = parsed.positional;
  if (extra.length || (providerId && !mode)) return bad(TOOL_DELIVERY_USAGE, "Give a provider and a mode, or nothing to list.");
  if (providerId && mode) {
    if (!isToolDeliveryMode(mode)) return bad(TOOL_DELIVERY_USAGE, `The mode is one of ${TOOL_DELIVERY_MODES.join(", ")}.`);
    await deps.toolDelivery.set(providerId, mode);
  }
  const current = deps.toolDelivery.current;
  if (parsed.flags.has("--json")) return json({ providers: current });
  const lines = Object.entries(current).map(([id, each]) => `${id}\t${each}`);
  return { exitCode: 0, stdout: `${lines.length ? lines.join("\n") : "Every provider uses the default (Claude Code: all, Codex: defer, others: trio)."}\n` };
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[key(row)] = (out[key(row)] ?? 0) + 1;
  return out;
}

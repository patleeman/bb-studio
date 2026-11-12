import { authCli, type AuthCliOptions, type AuthCliService } from "../auth/cli";
import { parseCliArgs } from "../cli-args";
import type { AccountView, AccountsStatus, QuotaWindow, Warning } from "./contract";
import { resetText, sourceName } from "./warnings";

export const ACCOUNTS_USAGE = "bb studio accounts <status [--source studio|bb|local] [--json] | warnings [--json] | dismiss <warning-id> | use-other <account> | login <account> [--bb] [--no-wait] [--json]>";

type CliResult = { exitCode: number; stdout?: string; stderr?: string };

export interface AccountsCliService {
  status(refresh?: boolean): Promise<AccountsStatus>;
  dismiss(id: string): Promise<{ dismissed: boolean }>;
  useOther(accountKey: string): Promise<{ accountKey: string | null }>;
}

const SPECS = {
  status: { flags: ["--json"], options: ["--source"] },
  warnings: { flags: ["--json"] },
  dismiss: { flags: ["--json"] },
  "use-other": { flags: ["--json"] },
  login: { flags: ["--json", "--no-wait", "--bb"] },
} as const;

const STATES: Record<AccountView["state"], string> = { ready: "ready", signed_out: "signed out", error: "error", limited: "limited", disabled: "disabled" };
const ACTIONS: Record<Warning["action"], string> = { sign_in: "Sign in", use_other: "Use other account", switch_model: "Switch model" };

function windowText(window: QuotaWindow, now: number): string {
  const reset = resetText(window.resetAt, now);
  return [`${window.label} ${window.percent === null ? "-" : `${window.percent}%`}${window.rejected ? " rejected" : ""}`, reset].filter(Boolean).join(" ");
}

function accountLines(account: AccountView, now: number): string[] {
  const lines = [[`  ${account.key}`, account.name, account.label ?? "-", STATES[account.state]].join("\t")];
  if (account.message) lines.push(`    ${account.message}`);
  const quota = [...account.windows, ...account.models].map((window) => windowText(window, now));
  if (quota.length) lines.push(`    ${quota.join(" · ")}`);
  if (account.pinned.length) lines.push(`    pinned: ${account.pinned.map((thread) => `${thread.threadId} ${thread.title}`).join(", ")}`);
  return lines;
}

export function statusText(status: AccountsStatus, source?: string): string {
  const lines: string[] = [];
  for (const each of status.sources) {
    if (source && each.source !== source) continue;
    const accounts = status.accounts.filter((account) => account.source === each.source);
    lines.push(`${each.source === "local" ? "This Mac" : `${each.name} Account Pooler`}${each.state === "on" ? "" : ` (${each.state})`}`);
    if (!accounts.length) lines.push("  -");
    for (const account of accounts) lines.push(...accountLines(account, status.checkedAt));
  }
  const warnings = status.warnings.filter((warning) => !source || warning.source === source);
  if (warnings.length) {
    lines.push("Warnings");
    for (const warning of warnings) lines.push(warningLine(warning));
  }
  return `${lines.join("\n")}\n`;
}

const warningLine = (warning: Warning) => [`  ${warning.id}`, warning.title, warning.detail ?? "-", ACTIONS[warning.action]].join("\t");

export function findAccount(accounts: readonly AccountView[], raw: string): { ok: true; account: AccountView } | { ok: false; error: string } {
  const name = raw.trim().toLowerCase();
  const exact = accounts.find((account) => account.key.toLowerCase() === name);
  if (exact) return { ok: true, account: exact };
  const byId = accounts.filter((account) => account.id.toLowerCase() === name || (name.length >= 4 && account.source !== "local" && account.id.toLowerCase().startsWith(name)));
  const byLabel = accounts.filter((account) => (account.label ?? "").toLowerCase().split(" · ").includes(name) || account.name.toLowerCase() === name || account.provider === name);
  const found = byId.length ? byId : byLabel;
  if (found.length === 1) return { ok: true, account: found[0]! };
  if (found.length > 1) return { ok: false, error: `"${raw}" matches ${found.length} accounts. Use one: ${found.map((account) => account.key).join(", ")}` };
  return { ok: false, error: `No account "${raw}". See them: bb studio accounts status` };
}

export async function accountsCli(argv: readonly string[], services: { accounts: AccountsCliService; auth: AuthCliService }, options: AuthCliOptions = {}): Promise<CliResult> {
  const [first, ...more] = argv;
  const command = !first || first.startsWith("--") ? "status" : first;
  const rest = !first || first.startsWith("--") ? argv : more;
  const usage = (error?: string): CliResult => ({ exitCode: 1, stderr: `${error ? `${error}\n` : ""}usage: ${ACCOUNTS_USAGE}\n` });
  if (!Object.hasOwn(SPECS, command)) return usage(`Unknown command ${command}.`);
  const parsed = parseCliArgs(rest, SPECS[command as keyof typeof SPECS]);
  if (!parsed.ok) return usage(parsed.error);
  const json = parsed.flags.has("--json");
  const out = (value: unknown, text: string): CliResult => ({ exitCode: 0, stdout: json ? `${JSON.stringify(value, null, 2)}\n` : text });
  try {
    switch (command) {
      case "status": {
        if (parsed.positional.length) return usage();
        const source = parsed.options.get("--source");
        if (source && !["studio", "bb", "local"].includes(source)) return usage("--source is studio, bb or local.");
        const status = await services.accounts.status(true);
        const shown = source ? { ...status, accounts: status.accounts.filter((account) => account.source === source), warnings: status.warnings.filter((warning) => warning.source === source) } : status;
        return out(shown, statusText(status, source));
      }
      case "warnings": {
        if (parsed.positional.length) return usage();
        const { warnings } = await services.accounts.status(true);
        return out(warnings, warnings.length ? `${warnings.map(warningLine).join("\n")}\n` : "No warnings.\n");
      }
      case "dismiss": {
        if (parsed.positional.length !== 1) return usage();
        const result = await services.accounts.dismiss(parsed.positional[0]!);
        return { ...out(result, result.dismissed ? "Dismissed.\n" : "No open warning with that id.\n"), exitCode: result.dismissed ? 0 : 1 };
      }
      case "use-other": {
        if (parsed.positional.length !== 1) return usage();
        const status = await services.accounts.status(true);
        const found = findAccount(status.accounts, parsed.positional[0]!);
        if (!found.ok) return { exitCode: 1, stderr: `${found.error}\n` };
        const result = await services.accounts.useOther(found.account.key);
        return { ...out(result, result.accountKey ? `Now first: ${result.accountKey}\n` : "No other ready account.\n"), exitCode: result.accountKey ? 0 : 1 };
      }
      default: {
        if (parsed.positional.length !== 1) return usage();
        const status = await services.accounts.status(true);
        const found = findAccount(status.accounts, parsed.positional[0]!);
        if (!found.ok) return { exitCode: 1, stderr: `${found.error}\n` };
        const { account } = found;
        if (!account.signIn) return { exitCode: 1, stderr: `${account.name} (${sourceName(account.source)}) has no sign-in here.\n` };
        if (account.source === "bb" && !parsed.flags.has("--bb")) return { exitCode: 1, stderr: `${account.key} is bb's account. Signing in to bb needs --bb.\n` };
        const flags = [...parsed.flags].filter((flag) => flag !== "--bb");
        return authCli(["login", account.signIn, ...flags], services.auth, options);
      }
    }
  } catch (error) {
    return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
}

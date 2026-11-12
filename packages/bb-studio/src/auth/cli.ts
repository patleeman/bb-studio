import type { AuthEntry, AuthStatus, LoginSession } from "./contract";
import { parseCliArgs } from "../cli-args";

export const AUTH_USAGE = "bb studio auth <status [--json] | login <provider-or-account> [--no-wait] [--json] | complete <session> --code-stdin | cancel <session>>";

type CliResult = { exitCode: number; stdout?: string; stderr?: string };

export interface AuthCliService {
  status(refresh?: boolean): Promise<AuthStatus>;
  start(target: string): Promise<LoginSession>;
  poll(sessionId: string): Promise<LoginSession>;
  complete(sessionId: string, code: string): Promise<LoginSession>;
  cancel(sessionId: string): Promise<{ cancelled: boolean }>;
}

export interface AuthCliOptions {
  signal?: AbortSignal;
  sleep?(ms: number): Promise<void>;
  waitMs?: number;
}

const SPECS = {
  status: { flags: ["--json"] },
  login: { flags: ["--json", "--no-wait"] },
  complete: { flags: ["--json"], options: ["--code"] },
  cancel: { flags: ["--json"] },
} as const;

const REASONS: Record<NonNullable<AuthEntry["reason"]>, string> = { expired: "signed out", signed_out: "signed out", turn_error: "sign-in refused" };

function entryLine(entry: AuthEntry): string {
  const where = entry.source === "pool" ? "Account Pooler" : "local";
  const state = entry.reason ? REASONS[entry.reason] : "signed in";
  return [entry.id, entry.name, where, entry.detail ?? "-", state].join("\t");
}

function sessionLines(session: LoginSession): string[] {
  const lines = [`Session: ${session.sessionId}`, `Sign-in: ${session.name} (${session.targetId})`];
  if (session.url) lines.push(`URL: ${session.url}`);
  if (session.code) lines.push(`Code: ${session.code}`);
  if (session.acceptsCode && session.state === "waiting") lines.push(`Finish: printf '%s\\n' "$CODE" | bb studio auth complete ${session.sessionId} --code-stdin`);
  lines.push(`Status: ${session.state}${session.message ? ` (${session.message})` : ""}`);
  return lines;
}

const finished = (session: LoginSession) => session.state === "saved" || session.state === "failed" || session.state === "expired";
const exitFor = (session: LoginSession) => (session.state === "failed" || session.state === "expired" ? 1 : 0);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function authCli(argv: readonly string[], service: AuthCliService, options: AuthCliOptions = {}): Promise<CliResult> {
  const [command, ...rest] = argv;
  const usage = (error?: string): CliResult => ({ exitCode: 1, stderr: `${error ? `${error}\n` : ""}usage: ${AUTH_USAGE}\n` });
  if (!command || !Object.hasOwn(SPECS, command)) return usage(command ? `Unknown command ${command}.` : undefined);
  const parsed = parseCliArgs(rest, SPECS[command as keyof typeof SPECS]);
  if (!parsed.ok) return usage(parsed.error);
  const json = parsed.flags.has("--json");
  const print = (session: LoginSession): CliResult => ({ exitCode: exitFor(session), stdout: json ? `${JSON.stringify(session, null, 2)}\n` : `${sessionLines(session).join("\n")}\n` });
  try {
    switch (command) {
      case "status": {
        if (parsed.positional.length) return usage();
        const status = await service.status(true);
        if (json) return { exitCode: 0, stdout: `${JSON.stringify(status, null, 2)}\n` };
        if (!status.entries.length) return { exitCode: 0, stdout: "No providers or accounts with a sign-in.\n" };
        return { exitCode: 0, stdout: `${status.entries.map(entryLine).join("\n")}\n` };
      }
      case "login": {
        if (parsed.positional.length !== 1) return usage();
        let session = await service.start(parsed.positional[0]!);
        const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        const until = Date.now() + (options.waitMs ?? 15 * 60_000);
        const wait = !parsed.flags.has("--no-wait");
        const stop = () => finished(session) || (wait ? session.state === "waiting" && session.acceptsCode && session.flow === "browser" : session.state !== "starting");
        while (!stop() && Date.now() < until && !options.signal?.aborted) {
          await sleep(session.pollMs);
          session = await service.poll(session.sessionId);
        }
        return print(session);
      }
      case "complete": {
        const code = parsed.options.get("--code");
        if (parsed.positional.length !== 1 || !code) return usage("Pipe the code: --code-stdin");
        return print(await service.complete(parsed.positional[0]!, code));
      }
      default: {
        if (parsed.positional.length !== 1) return usage();
        const result = await service.cancel(parsed.positional[0]!);
        return { exitCode: result.cancelled ? 0 : 1, stdout: json ? `${JSON.stringify(result)}\n` : result.cancelled ? "Cancelled.\n" : "No open sign-in session with that id.\n" };
      }
    }
  } catch (error) {
    return { exitCode: 1, stderr: `${message(error)}\n` };
  }
}

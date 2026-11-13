import { spawn } from "node:child_process";
import os from "node:os";
import { resolveClaudeCodeExecutable } from "../bridge/session-options.js";
import type {
  ClaudeAiCompleteInput,
  ClaudeAiStatus,
  ClaudeAiTextResult,
} from "./host-contract.fork.js";

export const CLAUDE_TEXT_MODEL = "haiku";
const SYSTEM_PROMPT =
  "You answer with exactly the requested text and nothing else.";
const STATUS_TTL_MS = 60_000;
const MAX_OUTPUT_CHARS = 4_000;

export function claudeTextArgs(): string[] {
  return [
    "-p",
    "--no-session-persistence",
    "--model",
    CLAUDE_TEXT_MODEL,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--system-prompt",
    SYSTEM_PROMPT,
    "--output-format",
    "text",
  ];
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

interface RunClaudeTextArgs {
  command: string;
  input: ClaudeAiCompleteInput;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export function runClaudeText(
  args: RunClaudeTextArgs,
): Promise<ClaudeAiTextResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: ClaudeAiTextResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      args.signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const child = spawn(args.command, claudeTextArgs(), {
      cwd: os.tmpdir(),
      env: args.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stop = (message: string): void => {
      child.kill("SIGTERM");
      finish({ ok: false, message });
    };
    const onAbort = (): void => stop("Cancelled");
    const timer = setTimeout(
      () => stop(`Timed out after ${args.input.timeoutMs}ms`),
      args.input.timeoutMs,
    );
    timer.unref();
    if (args.signal.aborted) onAbort();
    else args.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk;
    });
    child.on("error", (error) => finish({ ok: false, message: error.message }));
    child.on("close", (code) => {
      const text = stdout.trim();
      if (code === 0 && text.length > 0) {
        finish({ ok: true, text });
        return;
      }
      finish({
        ok: false,
        message:
          firstLine(stdout) ||
          firstLine(stderr) ||
          `Claude Code exited with code ${String(code)}`,
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(args.input.prompt);
  });
}

export function completeClaudeText(
  input: ClaudeAiCompleteInput,
  signal: AbortSignal,
): Promise<ClaudeAiTextResult> {
  let command: string;
  try {
    command = resolveClaudeCodeExecutable({ env: process.env }) ?? "claude";
  } catch (error) {
    return Promise.resolve({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return runClaudeText({ command, input, signal });
}

export type ClaudeAuthState = "signed-in" | "signed-out" | "not-installed";

const AUTH_STATUS_TIMEOUT_MS = 4_000;

export function parseClaudeAuthStatus(stdout: string): ClaudeAuthState {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === "object" &&
      parsed !== null &&
      "loggedIn" in parsed &&
      parsed.loggedIn === true
      ? "signed-in"
      : "signed-out";
  } catch {
    return "signed-out";
  }
}

export function readClaudeAuthState(
  command: string | null = claudeCommand(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClaudeAuthState> {
  if (command === null) return Promise.resolve("not-installed");
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (state: ClaudeAuthState): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(state);
    };
    const child = spawn(command, ["auth", "status"], {
      cwd: os.tmpdir(),
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish("signed-out");
    }, AUTH_STATUS_TIMEOUT_MS);
    timer.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ENOENT" ? "not-installed" : "signed-out"),
    );
    child.on("close", () => finish(parseClaudeAuthStatus(stdout)));
  });
}

function claudeCommand(): string | null {
  try {
    return resolveClaudeCodeExecutable({ env: process.env });
  } catch {
    return null;
  }
}

function statusFromAuth(state: ClaudeAuthState): ClaudeAiStatus {
  if (state === "signed-in") return { ready: true };
  return {
    ready: false,
    message:
      state === "not-installed"
        ? "Claude Code is not installed on the primary machine"
        : "Run `claude` on the primary machine to sign in",
  };
}

let cachedStatus: { status: ClaudeAiStatus; at: number } | null = null;
let pendingStatus: Promise<ClaudeAiStatus> | null = null;

function refreshStatus(
  readAuth: () => Promise<ClaudeAuthState>,
  now: () => number,
): Promise<ClaudeAiStatus> {
  if (pendingStatus !== null) return pendingStatus;
  const request = readAuth()
    .then(statusFromAuth)
    .catch(
      (error: unknown): ClaudeAiStatus => ({
        ready: false,
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    .then((status) => {
      cachedStatus = { status, at: now() };
      return status;
    })
    .finally(() => {
      pendingStatus = null;
    });
  pendingStatus = request;
  return request;
}

export async function claudeTextStatus(
  readAuth: () => Promise<ClaudeAuthState> = () => readClaudeAuthState(),
  now: () => number = Date.now,
): Promise<ClaudeAiStatus> {
  if (cachedStatus === null) return refreshStatus(readAuth, now);
  if (now() - cachedStatus.at >= STATUS_TTL_MS) {
    void refreshStatus(readAuth, now);
  }
  return cachedStatus.status;
}

export function resetClaudeTextStatusCache(): void {
  cachedStatus = null;
  pendingStatus = null;
}

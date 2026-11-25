import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

const register: CommandRegistrar = (program) =>
  registerThreadCommands(program, () => "http://server");

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const moved = (id: string) =>
  json(200, {
    status: "moved",
    threadId: id,
    from: { providerId: "claude-code", model: "opus", permissionMode: "auto" },
    to: {
      providerId: "acp-antigravity-acp",
      model: "gemini-4-neon",
      permissionMode: "accept-edits",
    },
    historyTokens: 150000,
  });

function printedJson(): {
  results: Array<{ threadId: string; result: string; reason: string | null }>;
  summary: Record<string, number>;
  exitCode: number;
} {
  const calls = vi.mocked(console.log).mock.calls;
  return JSON.parse(String(calls.at(-1)?.[0]));
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("bbs thread move-provider", () => {
  setupCommandOutputTestEnvironment();

  it("moves each named thread with the flags as the request body", async () => {
    const calls = stubFetch((call) => moved(call.path.split("/")[4] ?? ""));
    await runCommand(
      [
        "thread",
        "move-provider",
        "thr_a",
        "thr_b",
        "--to",
        "acp-antigravity-acp",
        "--model",
        "gemini-4-neon",
        "--permission",
        "accept-edits",
        "--history-tokens",
        "90000",
        "--json",
      ],
      register,
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/threads/thr_a/move-provider",
      "POST /api/v1/threads/thr_b/move-provider",
    ]);
    expect(calls[0]?.body).toEqual({
      providerId: "acp-antigravity-acp",
      model: "gemini-4-neon",
      permissionMode: "accept-edits",
      historyTokens: 90000,
    });
    expect(calls[0]?.headers.get("x-bb-cli")).toBe("1");
    const out = printedJson();
    expect(out.summary).toMatchObject({ total: 2, moved: 2, failed: 0 });
    expect(out.exitCode).toBe(0);
    expect(process.exitCode).toBeUndefined();
  });

  it("selects by --from and --project, keeps going past failures, and exits 2", async () => {
    const calls = stubFetch((call) => {
      if (call.path.startsWith("/api/v1/fork/provider-move/threads")) {
        return json(200, {
          threads: [
            { id: "thr_ok", title: "Main" },
            { id: "thr_busy", title: "Runner" },
            { id: "thr_nomodel", title: "Lead" },
          ],
        });
      }
      if (call.path.includes("thr_busy")) {
        return json(409, {
          code: "thread_busy",
          message: "Thread is active",
          details: { reason: "running" },
        });
      }
      if (call.path.includes("thr_nomodel")) {
        return json(422, { code: "model_unavailable", message: "no model" });
      }
      return moved("thr_ok");
    });
    await runCommand(
      [
        "thread",
        "move-provider",
        "--from",
        "claude-code",
        "--project",
        "proj_1",
        "--to",
        "acp-antigravity-acp",
        "--dry-run",
        "--json",
      ],
      register,
    );
    expect(calls[0]?.path).toBe(
      "/api/v1/fork/provider-move/threads?from=claude-code&projectId=proj_1",
    );
    expect(calls.slice(1).map((call) => call.body)).toEqual([
      { providerId: "acp-antigravity-acp", dryRun: true },
      { providerId: "acp-antigravity-acp", dryRun: true },
      { providerId: "acp-antigravity-acp", dryRun: true },
    ]);
    const out = printedJson();
    expect(out.results.map((r) => [r.threadId, r.result, r.reason])).toEqual([
      ["thr_ok", "moved", null],
      ["thr_busy", "failed", "running"],
      ["thr_nomodel", "failed", "model-unavailable"],
    ]);
    expect(out.exitCode).toBe(2);
    expect(process.exitCode).toBe(2);
  });

  it("passes --force and reports no-handoff-handler refusals", async () => {
    const calls = stubFetch((call) =>
      (call.body as { force?: boolean }).force === true
        ? moved("thr_a")
        : json(422, { code: "no_handoff_handler", message: "no handler" }),
    );
    await runCommand(
      ["thread", "move-provider", "thr_a", "--to", "acp-x", "--json"],
      register,
    );
    expect(printedJson().results[0]).toMatchObject({
      result: "failed",
      reason: "no-handoff-handler",
    });
    await runCommand(
      [
        "thread",
        "move-provider",
        "thr_a",
        "--to",
        "acp-x",
        "--force",
        "--json",
      ],
      register,
    );
    expect(calls.at(-1)?.body).toEqual({ providerId: "acp-x", force: true });
    expect(printedJson().results[0]).toMatchObject({ result: "moved" });
  });

  it("exits 1 with nothing selected", async () => {
    stubFetch(() => json(200, {}));
    await expect(
      runCommand(
        ["thread", "move-provider", "--to", "acp-antigravity-acp"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
  });

  it("exits 1 without --to", async () => {
    stubFetch(() => json(200, {}));
    await expect(
      runCommand(["thread", "move-provider", "thr_a"], register),
    ).rejects.toThrow("process.exit:1");
  });

  it("status lists moved threads with pending and rebuilt counts", async () => {
    const calls = stubFetch(() =>
      json(200, {
        threads: [
          { threadId: "thr_a", state: "pending", move: { to: {} } },
          { threadId: "thr_b", state: "rebuilt", move: { to: {} } },
        ],
      }),
    );
    await runCommand(["thread", "move-provider", "status", "--json"], register);
    expect(calls[0]?.path).toBe("/api/v1/fork/provider-move/status");
    const out = JSON.parse(
      String(vi.mocked(console.log).mock.calls.at(-1)?.[0]),
    ) as { summary: unknown };
    expect(out.summary).toEqual({
      total: 2,
      pending: 1,
      rebuilt: 1,
      started: 0,
      cleared: 0,
    });
  });

  it("status for named threads asks per thread", async () => {
    const calls = stubFetch(() =>
      json(200, { threadId: "thr_a", state: "pending", move: null }),
    );
    await runCommand(
      ["thread", "move-provider", "status", "thr_a", "--json"],
      register,
    );
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/threads/thr_a/move-provider",
    ]);
  });
});

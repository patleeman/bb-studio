import { afterEach, expect, it, vi } from "vitest";
import type { PoolAccount, ProviderState } from "./contract";
import { AuthService, type AuthDeps } from "./service";

const A = "11111111-1111-4111-8111-111111111111";
const C = "33333333-3333-4333-8333-333333333333";
const TOKEN = "sk-ant-oat01-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0123456789";

function world() {
  const state = {
    now: 1_000_000,
    accounts: [
      { id: A, provider: "codex", kind: "oauth", label: "work", email: null, enabled: true, status: "error", error: "refresh_token_invalidated" },
      { id: C, provider: "claude", kind: "oauth", label: "max", email: null, enabled: true, status: "ready", error: null },
    ] as PoolAccount[] | null,
    providers: [{ providerId: "codex", displayName: "Codex", status: "ready", planLabel: "Pro", accountEmail: null, loginCommand: "codex login --device-auth" }] as ProviderState[],
    codexPoll: { status: "pending" } as { status: "pending" } | { status: "complete" } | { status: "error"; message: string },
    terminal: { chunks: [] as string[], running: true, exitCode: null as number | null, input: [] as string[], closed: 0, created: [] as string[] },
    kv: new Map<string, unknown>(),
    logs: [] as string[],
    changed: 0,
    ids: 0,
  };
  const pool = {
    list: vi.fn(async () => state.accounts),
    codexStart: vi.fn(async () => ({ sessionId: "pool-codex-1", verificationUri: "https://auth.example.test/codex/device", userCode: "ABCD-1234", expiresAt: state.now + 900_000, intervalMs: 5_000 })),
    codexPoll: vi.fn(async () => state.codexPoll),
    codexCancel: vi.fn(async () => ({ cancelled: true })),
    claudeStart: vi.fn(async () => ({ sessionId: "pool-claude-1", authorizeUrl: "https://login.example.test/oauth/authorize?code_challenge=abc&state=xyz" })),
    claudeComplete: vi.fn(async (_sessionId: string, _pasted: string): Promise<unknown> => ({ id: C })),
  };
  const deps: AuthDeps = {
    pool,
    providers: { states: async () => state.providers },
    terminal: {
      create: async ({ command }) => { state.terminal.created.push(command); return { id: "term_1" }; },
      output: async (_id, sinceSeq) => ({ text: state.terminal.chunks.slice(sinceSeq).join(""), nextSeq: state.terminal.chunks.length }),
      state: async () => ({ running: state.terminal.running, exitCode: state.terminal.exitCode }),
      input: async (_id, text) => { state.terminal.input.push(text); },
      close: async () => { state.terminal.closed += 1; },
    },
    kv: { get: async (key) => state.kv.get(key), set: async (key, value) => { state.kv.set(key, value); } },
    changed: () => { state.changed += 1; },
    log: (message) => state.logs.push(message),
    now: () => state.now,
    newId: () => `s${++state.ids}`,
  };
  return { state, pool, service: new AuthService(deps) };
}

const signedOut = async (service: AuthService) => (await service.status(true)).entries.filter((entry) => entry.signedOut).map((entry) => entry.id);

afterEach(() => vi.useRealTimers());

it("lists one signed-out entry per account and clears it after the pool saves the login", async () => {
  const { state, pool, service } = world();
  expect(await signedOut(service)).toEqual([`pool:${A}`]);
  expect(await signedOut(service)).toEqual([`pool:${A}`]);
  expect((await service.status(true)).pool).toBe("on");

  const started = await service.start(`pool:${A}`);
  expect(started).toMatchObject({ flow: "device", url: "https://auth.example.test/codex/device", code: "ABCD-1234", state: "waiting", acceptsCode: false, pollMs: 5_000 });
  expect(pool.codexStart).toHaveBeenCalledWith(A);
  expect((await service.start("codex")).sessionId).toBe(started.sessionId);
  expect(pool.codexStart).toHaveBeenCalledTimes(1);

  expect((await service.poll(started.sessionId)).state).toBe("waiting");
  state.codexPoll = { status: "complete" };
  state.accounts![0] = { ...state.accounts![0]!, status: "ready", error: null };
  const before = state.changed;
  expect((await service.poll(started.sessionId)).state).toBe("saved");
  expect(state.changed).toBeGreaterThan(before);
  expect(await signedOut(service)).toEqual([]);
  expect((await service.poll(started.sessionId)).state).toBe("saved");
  expect(pool.codexPoll).toHaveBeenCalledTimes(3);
});

it("reports a refused and an expired Codex code", async () => {
  const { state, pool, service } = world();
  const first = await service.start(`pool:${A}`);
  state.codexPoll = { status: "error", message: `Codex token exchange failed (HTTP 400). ${TOKEN} Start again.` };
  const failed = await service.poll(first.sessionId);
  expect(failed.state).toBe("failed");
  expect(failed.message).not.toContain("FAKE");

  state.codexPoll = { status: "error", message: "Code expired, start again." };
  const second = await service.start(`pool:${A}`);
  expect(second.sessionId).not.toBe(first.sessionId);
  expect((await service.poll(second.sessionId)).state).toBe("expired");

  state.codexPoll = { status: "pending" };
  const third = await service.start(`pool:${A}`);
  state.now += 901_000;
  expect(await service.poll(third.sessionId)).toMatchObject({ state: "expired", message: "Code expired." });
  expect(pool.codexCancel).toHaveBeenCalledWith("pool-codex-1");
  expect(await signedOut(service)).toEqual([`pool:${A}`]);
});

it("finishes a Claude pool login with the pasted code", async () => {
  const { pool, service, state } = world();
  const started = await service.start(`pool:${C}`);
  expect(started).toMatchObject({ flow: "browser", code: null, acceptsCode: true, state: "waiting" });
  expect(started.url).toContain("https://login.example.test/oauth/authorize");
  expect((await service.poll(started.sessionId)).state).toBe("waiting");
  const saved = await service.complete(started.sessionId, "  code-part#state-part  ");
  expect(pool.claudeComplete).toHaveBeenCalledWith("pool-claude-1", "code-part#state-part");
  expect(saved.state).toBe("saved");
  expect(JSON.stringify([saved, state.logs])).not.toContain("code-part");

  pool.claudeComplete.mockRejectedValueOnce(new Error(`Token exchange failed: refresh_token=${TOKEN}`));
  const again = await service.start(`pool:${C}`);
  const failed = await service.complete(again.sessionId, "bad");
  expect(failed.state).toBe("failed");
  expect(failed.message).not.toContain("FAKE");
  await expect(service.complete("missing", "x")).rejects.toThrow("not found");
});

it("runs a local login in a terminal and passes on only the link and the code", async () => {
  const { state, service } = world();
  state.accounts = null;
  state.providers = [{ providerId: "codex", displayName: "Codex", status: "expired", planLabel: null, accountEmail: null, loginCommand: "codex login --device-auth" }];
  expect((await service.status(true)).pool).toBe("off");
  expect(await signedOut(service)).toEqual(["provider:codex"]);

  const started = await service.start("codex");
  expect(started).toMatchObject({ state: "starting", url: null, code: null });
  expect(state.terminal.created).toEqual(["codex login --device-auth"]);

  state.terminal.chunks.push(`\u001b[2mloading auth.json access_token=${TOKEN}\u001b[0m\r\n`, "Open https://auth.example.test/codex/device\r\n", "and enter \u001b[1mABCD-1234\u001b[0m\r\n", `Bearer ${TOKEN}\r\n`);
  const waiting = await service.poll(started.sessionId);
  expect(waiting).toMatchObject({ state: "waiting", flow: "device", url: "https://auth.example.test/codex/device", code: "ABCD-1234" });
  expect(JSON.stringify(waiting)).not.toContain("FAKE");

  state.providers = [{ ...state.providers[0]!, status: "ready", planLabel: "Pro" }];
  const saved = await service.poll(started.sessionId);
  expect(saved.state).toBe("saved");
  expect(state.terminal.closed).toBe(1);
  expect(JSON.stringify([saved, state.logs, [...state.kv.entries()]])).not.toContain("FAKE");
  expect(state.logs).toEqual(["Sign-in started: provider:codex", "Sign-in saved: provider:codex"]);
  expect(await signedOut(service)).toEqual([]);
});

it("sends a pasted code to a local login and stops reading its output", async () => {
  const { state, service } = world();
  state.accounts = null;
  state.providers = [{ providerId: "claude-code", displayName: "Claude Code", status: "expired", planLabel: null, accountEmail: null, loginCommand: "claude auth login" }];
  const started = await service.start("claude");
  await expect(service.complete(started.sessionId, "x")).rejects.toThrow("no pasted code");
  state.terminal.chunks.push("Visit https://login.example.test/oauth/authorize?state=xyz\r\nPaste code here if prompted > ");
  const waiting = await service.poll(started.sessionId);
  expect(waiting).toMatchObject({ flow: "browser", acceptsCode: true, code: null });
  await service.complete(started.sessionId, "manual-code");
  expect(state.terminal.input).toEqual(["manual-code\r"]);
  state.terminal.chunks.push("manual-code\r\nWXYZ-9876 https://other.example.test/x\r\n");
  const after = await service.poll(started.sessionId);
  expect(after.url).toBe(waiting.url);
  expect(after.code).toBeNull();
  state.terminal.running = false;
  state.terminal.exitCode = 1;
  expect(await service.poll(started.sessionId)).toMatchObject({ state: "failed", message: "The sign-in command exited with code 1." });
  expect(JSON.stringify(state.logs)).not.toContain("manual-code");
});

it("shows a provider whose turns fail to authenticate until a turn succeeds", async () => {
  vi.useFakeTimers();
  const { state, service } = world();
  state.accounts = [];
  expect(await signedOut(service)).toEqual([]);
  service.noteTurn("codex", "failed", "Host daemon disconnected");
  service.noteTurn("codex", "failed", "Failed to authenticate: OAuth session expired and could not be refreshed");
  service.noteTurn("codex", "failed", "Failed to authenticate: OAuth session expired and could not be refreshed");
  await vi.advanceTimersByTimeAsync(1_100);
  expect((await service.status()).entries.filter((entry) => entry.signedOut)).toMatchObject([{ id: "provider:codex", reason: "turn_error" }]);

  const started = await service.start("provider:codex");
  state.terminal.chunks.push("https://auth.example.test/codex/device ABCD-1234");
  expect((await service.poll(started.sessionId)).state).toBe("waiting");
  state.terminal.running = false;
  state.terminal.exitCode = 0;
  expect((await service.poll(started.sessionId)).state).toBe("saved");
  expect(await signedOut(service)).toEqual([]);

  service.noteTurn("codex", "failed", "401 Unauthorized");
  service.noteTurn("codex", "ok");
  expect(await signedOut(service)).toEqual([]);
  await service.dispose();
});

it("closes the terminal and the pool session on cancel and dispose", async () => {
  const { state, pool, service } = world();
  const codex = await service.start(`pool:${A}`);
  expect(await service.cancel(codex.sessionId)).toEqual({ cancelled: true });
  expect(pool.codexCancel).toHaveBeenCalledWith("pool-codex-1");
  expect(await service.cancel(codex.sessionId)).toEqual({ cancelled: false });
  state.providers = [{ ...state.providers[0]!, status: "expired" }];
  await service.start("provider:codex");
  await service.dispose();
  expect(state.terminal.closed).toBe(1);
});

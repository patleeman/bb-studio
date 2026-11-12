import { expect, it, vi } from "vitest";
import { authCli, type AuthCliService } from "./cli";
import type { AuthStatus, LoginSession } from "./contract";

const status: AuthStatus = { checkedAt: 1, pool: "on", entries: [
  { id: "pool:aaaa", source: "pool", provider: "codex", name: "Codex", detail: "work", signedOut: true, reason: "expired" },
  { id: "provider:claude-code", source: "provider", provider: "claude", name: "Claude Code", detail: null, signedOut: false, reason: null },
] };
const session = (over: Partial<LoginSession> = {}): LoginSession => ({ sessionId: "s1", targetId: "pool:aaaa", name: "Codex", flow: "device", url: "https://auth.example.test/codex/device", code: "ABCD-1234", acceptsCode: false, expiresAt: null, pollMs: 5, state: "waiting", message: null, ...over });

function fake(polls: LoginSession[] = []): AuthCliService & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    status: async () => { calls.push("status"); return status; },
    start: async (target) => { calls.push(`start ${target}`); if (target === "nope") throw new Error('No provider or account "nope".'); return polls.shift() ?? session(); },
    poll: async (id) => { calls.push(`poll ${id}`); return polls.shift() ?? session({ state: "saved" }); },
    complete: async (id, code) => { calls.push(`complete ${id} ${code.length}`); return session({ state: "saved" }); },
    cancel: async (id) => { calls.push(`cancel ${id}`); return { cancelled: id === "s1" }; },
  };
}
const sleep = vi.fn(async () => {});

it("prints status as lines and as JSON", async () => {
  const lines = await authCli(["status"], fake());
  expect(lines.stdout).toBe("pool:aaaa\tCodex\tAccount Pooler\twork\tsigned out\nprovider:claude-code\tClaude Code\tlocal\t-\tsigned in\n");
  expect(JSON.parse((await authCli(["status", "--json"], fake())).stdout!)).toEqual(status);
});

it("starts a device login, prints the link and code, and waits until saved", async () => {
  const service = fake([session({ state: "starting", url: null, code: null }), session(), session({ state: "saved" })]);
  const result = await authCli(["login", "codex"], service, { sleep });
  expect(service.calls).toEqual(["start codex", "poll s1", "poll s1"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("URL: https://auth.example.test/codex/device");
  expect(result.stdout).toContain("Code: ABCD-1234");
  expect(result.stdout).toContain("Status: saved");
});

it("returns once the link is known with --no-wait, and fails on an expired code", async () => {
  const service = fake([session({ state: "starting", url: null, code: null }), session()]);
  const result = await authCli(["login", "codex", "--no-wait", "--json"], service, { sleep });
  expect(service.calls).toEqual(["start codex", "poll s1"]);
  expect(JSON.parse(result.stdout!).state).toBe("waiting");
  const expired = await authCli(["login", "codex"], fake([session(), session({ state: "expired", message: "Code expired." })]), { sleep });
  expect(expired.exitCode).toBe(1);
  expect(expired.stdout).toContain("Status: expired (Code expired.)");
});

it("stops at a paste prompt and completes with a piped code", async () => {
  const service = fake([session({ flow: "browser", code: null, acceptsCode: true, targetId: "pool:cccc", name: "Claude" })]);
  const result = await authCli(["login", "claude"], service, { sleep });
  expect(service.calls).toEqual(["start claude"]);
  expect(result.stdout).toContain("bb studio auth complete s1 --code-stdin");
  const done = await authCli(["complete", "s1", "--code", "secret-code"], service);
  expect(service.calls.at(-1)).toBe("complete s1 11");
  expect(done.stdout).not.toContain("secret-code");
  expect(done.stdout).toContain("Status: saved");
});

it("rejects unknown commands, flags and targets", async () => {
  expect((await authCli([], fake())).stderr).toContain("usage: bb studio auth");
  expect((await authCli(["logout"], fake())).stderr).toContain("Unknown command logout.");
  expect((await authCli(["status", "--verbose"], fake())).stderr).toContain("Unknown option --verbose.");
  expect((await authCli(["login"], fake())).exitCode).toBe(1);
  expect((await authCli(["complete", "s1"], fake())).stderr).toContain("--code-stdin");
  expect(await authCli(["login", "nope"], fake())).toEqual({ exitCode: 1, stderr: 'No provider or account "nope".\n' });
  expect((await authCli(["cancel", "s1"], fake())).stdout).toBe("Cancelled.\n");
  expect((await authCli(["cancel", "zz"], fake())).exitCode).toBe(1);
});

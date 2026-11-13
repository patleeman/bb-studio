import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerAuth } from "../auth/register";
import { accountsCli } from "./cli";
import { LiveBbPool, liveBbUrl, loopbackUrl } from "./bb-source";
import type { AccountView, QuotaWindow } from "./contract";
import { readPins, readPoolSignals } from "./local-data";
import { localAccountViews, localUsageWindows, localWindowLabel, modelWindows, poolAccountView, poolState, quotaWindows, type PoolSummary } from "./pool-view";
import { createLiveBbPool, registerAccounts } from "./register";
import { AccountsService, WarningStore, type AccountsDeps } from "./service";
import { computeWarnings, NO_PROVIDER_WARNING, popsUp } from "./warnings";

const CLAUDE = "56ef0dab-0b49-4ce3-aae4-70bb3e7c3eb4";
const CODEX = "bab2726f-30d8-49bc-887f-1dbaeeeb71d9";
const SPARE = "33333333-3333-4333-8333-333333333333";
const NOW = Date.UTC(2026, 10, 12, 16, 0);
const RESET = Date.UTC(2026, 10, 16, 9, 0);
const LEAK = "sk-ant-oat01-LEAKLEAKLEAKLEAKLEAKLEAKLEAKLEAK0123456789";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWFrIn0.c2lnbmF0dXJlbGVhaw";
const TOKEN_PATTERN = /LEAKLEAK|eyJhbGci|accessToken|refreshToken|idToken|access_token|refresh_token|apiKey|Bearer\s/;

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function summary(overrides: Partial<PoolSummary> & { id: string }): PoolSummary {
  return {
    provider: "claude", kind: "oauth", label: "Patrick", email: "me@example.test", enabled: true, status: "ready", error: null,
    heldUntil: null, usageRestriction: null, limitWindows: [], familyWeekly: {}, ...overrides,
  };
}

const window = (slot: string, minutes: number, utilization: number | null, status = "allowed", resetAt: number | null = RESET) => ({ slot, windowMinutes: minutes, utilization, resetAt, status });

describe("status mapping", () => {
  const cases: [string, Partial<PoolSummary>, string][] = [
    ["ready", {}, "ready"],
    ["disabled", { enabled: false, error: "OAuth refresh failed with HTTP 400. invalid_grant." }, "disabled"],
    ["invalid_grant", { error: "OAuth refresh failed with HTTP 400. invalid_grant.", status: "error" }, "signed_out"],
    ["refresh token reused", { error: "refresh_token_reused" }, "signed_out"],
    ["401 upstream", { error: "Anthropic returned HTTP 401." }, "signed_out"],
    ["missing secret file", { error: "ENOENT: no such file or directory, open '/x/account-a.json'" }, "signed_out"],
    ["network failure", { error: "OAuth refresh failed due to a network error or timeout.", status: "error" }, "error"],
    ["error without message", { status: "error" }, "error"],
    ["held", { status: "held", heldUntil: NOW + 60_000 }, "limited"],
    ["exhausted", { status: "exhausted" }, "limited"],
  ];
  for (const [name, overrides, expected] of cases) {
    it(`maps ${name} to ${expected}`, () => {
      expect(poolState(summary({ id: CLAUDE, ...overrides }), undefined, NOW).state).toBe(expected);
    });
  }

  it("maps a refresh rejection and a missing login file to signed out even when the quota row says ready", () => {
    expect(poolState(summary({ id: CLAUDE }), { rejected: new Set([CLAUDE]), missingLogin: new Set() }, NOW)).toEqual({ state: "signed_out", message: "Refresh refused" });
    expect(poolState(summary({ id: CLAUDE }), { rejected: new Set(), missingLogin: new Set([CLAUDE]) }, NOW)).toEqual({ state: "signed_out", message: "No saved login" });
  });

  it("removes token text from error messages", () => {
    const { message } = poolState(summary({ id: CLAUDE, error: `refresh failed: Bearer ${LEAK} ${JWT}` }), undefined, NOW);
    expect(message).not.toMatch(TOKEN_PATTERN);
  });

  it("reads the 5h and 7d windows and per-model limits with reset times", () => {
    const account = summary({ id: CLAUDE, limitWindows: [window("secondary", 10080, 0.97, "allowed_warning"), window("primary", 300, 0.12)], familyWeekly: { opus: { utilization: 0.4, resetAt: RESET, status: "allowed" }, fable: { utilization: 1, resetAt: RESET, status: "rejected" }, sonnet: null } });
    expect(quotaWindows(account)).toEqual([
      { id: "primary", label: "5h", percent: 12, resetAt: RESET, rejected: false },
      { id: "secondary", label: "7d", percent: 97, resetAt: RESET, rejected: false },
    ]);
    expect(modelWindows(account)).toEqual([
      { id: "fable", label: "Fable", percent: 100, resetAt: RESET, rejected: true },
      { id: "opus", label: "Opus", percent: 40, resetAt: RESET, rejected: false },
    ]);
  });

  it("labels each source and gives bb accounts a bb sign-in target", () => {
    expect(poolAccountView(summary({ id: CLAUDE }), "studio")).toMatchObject({ key: `studio:${CLAUDE}`, signIn: `pool:${CLAUDE}`, label: "Patrick · me@example.test" });
    expect(poolAccountView(summary({ id: CLAUDE }), "bb")).toMatchObject({ key: `bb:${CLAUDE}`, signIn: `bb:${CLAUDE}` });
    expect(poolAccountView(summary({ id: CLAUDE, kind: "api-key" }), "studio").signIn).toBeNull();
  });

  it("lists local logins that are signed in or were signed out", () => {
    const views = localAccountViews([
      { providerId: "claude-code", displayName: "Claude Code", status: "ready", planLabel: "Proxied", accountEmail: null, loginCommand: "claude auth login" },
      { providerId: "codex", displayName: "Codex", status: "expired", planLabel: null, accountEmail: "me@example.test", loginCommand: "codex login --device-auth" },
      { providerId: "gemini", displayName: "Gemini", status: "unauthenticated", planLabel: null, accountEmail: null, loginCommand: "gemini login" },
    ], new Set(["codex"]), (id) => (id === "claude-code" ? "claude" : id));
    expect(views.map((view) => [view.key, view.state, view.label, view.signIn])).toEqual([
      ["local:claude-code", "ready", "Account Pooler", "provider:claude-code"],
      ["local:codex", "signed_out", "me@example.test", "provider:codex"],
    ]);
  });

  it("shows a local login's own usage windows, not a pooled one's, and a full window as rejected", () => {
    const usage = localUsageWindows({
      codex: { status: "ok", windows: [{ label: "5 hour window", usedPercent: 41.6, resetsAt: "2026-11-12T20:00:00.000Z" }, { label: "168 hour window", usedPercent: 100, resetsAt: null }] },
      "claude-code": { status: "ok", windows: [{ label: "5 hour window", usedPercent: 10, resetsAt: null }] },
      gemini: { status: "unauthenticated" },
    });
    expect(usage.codex).toEqual([
      { id: "5 hour window", label: "5h", percent: 42, resetAt: Date.parse("2026-11-12T20:00:00.000Z"), rejected: false },
      { id: "168 hour window", label: "7d", percent: 100, resetAt: null, rejected: true },
    ]);
    expect(usage.gemini).toBeUndefined();
    expect(localWindowLabel("Tokens this month")).toBe("Tokens this month");
    const views = localAccountViews([
      { providerId: "claude-code", displayName: "Claude Code", status: "ready", planLabel: "Proxied", accountEmail: null, loginCommand: "claude auth login" },
      { providerId: "codex", displayName: "Codex", status: "ready", planLabel: "Pro", accountEmail: null, loginCommand: "codex login --device-auth" },
    ], new Set(), (id) => (id === "claude-code" ? "claude" : id), false, usage);
    expect(views.map((view) => [view.key, view.windows.map((window) => window.label)])).toEqual([
      ["local:claude-code", []],
      ["local:codex", ["5h", "7d"]],
    ]);
    expect(computeWarnings(views, NOW, "UTC").map((warning) => warning.id)).toEqual(["local:codex:window:168 hour window:rejected"]);
  });

  it("pops up a local login's window only once it is used up, and a pool account's from 90%", () => {
    const local = localAccountViews([
      { providerId: "codex", displayName: "Codex", status: "ready", planLabel: "Pro", accountEmail: null, loginCommand: "codex login --device-auth" },
    ], new Set(), (id) => id, false, { codex: [{ id: "5 hour window", label: "5h", percent: 93, resetAt: null, rejected: false }, { id: "168 hour window", label: "7d", percent: 100, resetAt: null, rejected: true }] });
    const pool = poolAccountView(summary({ id: CLAUDE, limitWindows: [window("secondary", 10080, 0.95)] }), "studio", { now: NOW });
    const warnings = computeWarnings([...local, pool], NOW, "UTC");
    expect(warnings.map((warning) => [warning.id, popsUp(warning)])).toEqual([
      ["local:codex:window:5 hour window:high", false],
      ["local:codex:window:168 hour window:rejected", true],
      [`studio:${CLAUDE}:window:secondary:high`, true],
    ]);
  });

  it("offers every local login that can sign in while nothing is connected", () => {
    const views = localAccountViews([
      { providerId: "claude-code", displayName: "Claude Code", status: "unauthenticated", planLabel: null, accountEmail: null, loginCommand: "claude auth login" },
      { providerId: "codex", displayName: "Codex", status: "expired", planLabel: null, accountEmail: null, loginCommand: "codex login --device-auth" },
      { providerId: "acp-omp", displayName: "omp", status: "unauthenticated", planLabel: null, accountEmail: null, loginCommand: null },
      { providerId: "acp-cursor", displayName: "Cursor", status: "not_installed", planLabel: null, accountEmail: null, loginCommand: "cursor login" },
    ], new Set(), (id) => id, true);
    expect(views.map((view) => [view.key, view.state, view.signIn])).toEqual([
      ["local:claude-code", "signed_out", "provider:claude-code"],
      ["local:codex", "signed_out", "provider:codex"],
    ]);
  });
});

function view(overrides: Partial<AccountView> & { key: string }): AccountView {
  const [source, id] = overrides.key.split(":") as [AccountView["source"], string];
  return { id, source, provider: "claude", name: "Claude", label: "Patrick", state: "ready", message: null, windows: [], models: [], pinned: [], signIn: `pool:${id}`, ...overrides };
}

const quota = (id: string, label: string, percent: number | null, rejected = false) => ({ id, label, percent, resetAt: RESET, rejected });

describe("warnings", () => {
  it("warns at 90% of a window and not at 89%", () => {
    const warnings = computeWarnings([
      view({ key: "studio:a", windows: [quota("primary", "5h", 89), quota("secondary", "7d", 90)] }),
    ], NOW, "UTC");
    expect(warnings.map((warning) => [warning.id, warning.title, warning.action])).toEqual([
      ["studio:a:window:secondary:high", "Claude 7d at 90%", "switch_model"],
    ]);
    expect(warnings[0]!.detail).toBe("BB Studio · Patrick · resets Nov 16, 09:00");
  });

  it("names a rejected model with Switch model, and offers Use other account when another BB Studio account is ready", () => {
    const warnings = computeWarnings([
      view({ key: "studio:a", windows: [quota("secondary", "7d", 97)], models: [quota("fable", "Fable", 100, true), quota("opus", "Opus", 40)] }),
      view({ key: "studio:b", windows: [quota("secondary", "7d", 20)] }),
    ], NOW, "UTC");
    expect(warnings.map((warning) => [warning.id, warning.title, warning.action])).toEqual([
      ["studio:a:model:fable:rejected", "Fable at 100%", "switch_model"],
      ["studio:a:window:secondary:high", "Claude 7d at 97%", "use_other"],
    ]);
  });

  it("never offers Use other account for bb's pool", () => {
    const warnings = computeWarnings([
      view({ key: "bb:a", windows: [quota("secondary", "7d", 96)] }),
      view({ key: "bb:b" }),
    ], NOW, "UTC");
    expect(warnings.map((warning) => warning.action)).toEqual(["switch_model"]);
  });

  it("reports a signed-out or failing account once, with Sign in, and no quota warnings", () => {
    const warnings = computeWarnings([
      view({ key: "studio:a", state: "signed_out", windows: [quota("secondary", "7d", 97)], models: [quota("fable", "Fable", 100, true)] }),
      view({ key: "bb:a", state: "error", message: "Upstream returned HTTP 500", signIn: "bb:a" }),
      view({ key: "studio:c", state: "disabled", windows: [quota("secondary", "7d", 100, true)] }),
    ], NOW, "UTC");
    expect(warnings.map((warning) => [warning.id, warning.title, warning.action, warning.target])).toEqual([
      ["studio:a:signed_out", "Claude signed out", "sign_in", "pool:a"],
      ["bb:a:error", "Claude error", "sign_in", "bb:a"],
    ]);
  });
});

function studioDb() {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  cleanups.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  return db;
}

function serviceOn(db: Database.Database, pool: { accounts: PoolSummary[] }, bbUp = true, extra: Partial<AccountsDeps> = {}): AccountsService {
  const deps: AccountsDeps = {
    studioPool: async () => pool,
    bbPool: { available: () => true, status: async () => { if (!bbUp) throw new Error("down"); return { accounts: [] }; } },
    studioSignals: () => ({ rejected: new Set(), missingLogin: new Set() }),
    pins: () => new Map(),
    providers: async () => [],
    auth: async () => ({ entries: [] }),
    reorder: async () => {},
    thread: async () => null,
    store: new WarningStore(db),
    changed: () => {},
    now: () => NOW,
    timeZone: "UTC",
    ...extra,
  };
  return new AccountsService(deps);
}

describe("dismissal", () => {
  it("persists per account and state, and returns when that account's state changes", async () => {
    const db = studioDb();
    const pool = { accounts: [summary({ id: CLAUDE, error: "OAuth refresh failed with HTTP 400. invalid_grant." })] };
    const first = serviceOn(db, pool);
    const id = `studio:${CLAUDE}:signed_out`;
    expect((await first.status(true)).warnings.map((warning) => warning.id)).toEqual([id]);
    expect(await first.dismiss(id)).toEqual({ dismissed: true });
    expect((await first.status(true)).warnings).toEqual([]);

    const restarted = serviceOn(db, pool);
    expect((await restarted.status(true)).warnings).toEqual([]);
    expect((await restarted.status(true)).dismissed).toEqual([id]);

    pool.accounts = [summary({ id: CLAUDE, limitWindows: [window("secondary", 10080, 0.95)] })];
    expect((await restarted.status(true)).warnings.map((warning) => warning.id)).toEqual([`studio:${CLAUDE}:window:secondary:high`]);
    pool.accounts = [summary({ id: CLAUDE, error: "OAuth refresh failed with HTTP 400. invalid_grant." })];
    expect((await restarted.status(true)).warnings.map((warning) => warning.id)).toEqual([id]);
  });

  it("keeps a dismissal while the source can't be read", async () => {
    const db = studioDb();
    const store = new WarningStore(db);
    store.dismiss(`bb:${CLAUDE}:signed_out`, NOW);
    await serviceOn(db, { accounts: [] }, false).status(true);
    expect(store.list()).toEqual([`bb:${CLAUDE}:signed_out`]);
  });

  it("keeps a local window's dismissal while its usage can't be read, and drops it once the window resets", async () => {
    const db = studioDb();
    const providers = async () => [{ providerId: "codex", displayName: "Codex", status: "ready", planLabel: "Pro", accountEmail: null, loginCommand: "codex login --device-auth" }];
    let usage: () => Promise<Record<string, QuotaWindow[]>> = async () => ({ codex: [{ id: "5 hour window", label: "5h", percent: 100, resetAt: RESET, rejected: true }] });
    const service = serviceOn(db, { accounts: [] }, true, { providers, usage: () => usage() });
    const id = "local:codex:window:5 hour window:rejected";
    expect((await service.status(true)).warnings.map((warning) => warning.id)).toEqual([id]);
    await service.dismiss(id);
    usage = async () => { throw new Error("timeout"); };
    await service.status(true);
    usage = async () => ({ codex: [{ id: "5 hour window", label: "5h", percent: 100, resetAt: RESET, rejected: true }] });
    const restarted = serviceOn(db, { accounts: [] }, true, { providers, usage: () => usage() });
    expect((await restarted.status(true)).warnings).toEqual([]);
    usage = async () => ({ codex: [{ id: "5 hour window", label: "5h", percent: 3, resetAt: RESET + 5 * 3_600_000, rejected: false }] });
    await restarted.status(true);
    usage = async () => ({ codex: [{ id: "5 hour window", label: "5h", percent: 100, resetAt: RESET + 5 * 3_600_000, rejected: true }] });
    expect((await restarted.status(true)).warnings.map((warning) => warning.id)).toEqual([id]);
  });

  it("refuses to dismiss a warning that is not open", async () => {
    const db = studioDb();
    expect(await serviceOn(db, { accounts: [] }).dismiss("studio:x:signed_out")).toEqual({ dismissed: false });
  });
});

interface World {
  root: string;
  studioDir: string;
  sourceDir: string;
  calls: string[];
  server: Server;
  url: string;
}

function sqlite(path: string, sql: string): void {
  const db = new Database(path);
  db.exec(sql);
  db.close();
}

function seedBbDir(dir: string, threadTitle: string): void {
  mkdirSync(join(dir, "plugins", "account-pool", "secrets", "accounts"), { recursive: true });
  sqlite(join(dir, "bb.db"), `
    CREATE TABLE plugin_kv (plugin_id TEXT, key TEXT, value TEXT, updated_at INTEGER, PRIMARY KEY (plugin_id, key));
    CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, title_fallback TEXT, deleted_at INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY, thread_id TEXT, type TEXT, provider_thread_id TEXT, data TEXT);
    INSERT INTO threads VALUES ('thr_pinned', '${threadTitle}', NULL, NULL), ('thr_gone', 'Gone', NULL, 1);
    INSERT INTO events (thread_id, type, provider_thread_id, data) VALUES
      ('thr_pinned', 'thread/identity', 'sess-1', '{}'),
      ('thr_gone', 'thread/identity', 'sess-2', '{}');
  `);
  sqlite(join(dir, "plugins", "account-pool", "data.db"), `
    CREATE TABLE pool_affinity (affinity_key TEXT PRIMARY KEY, account_id TEXT NOT NULL, last_used_at INTEGER NOT NULL);
    INSERT INTO pool_affinity VALUES
      ('["claude","host_a","session:sess-1"]', '${CLAUDE}', ${Date.now() - 60_000}),
      ('["claude","host_a","session:sess-2"]', '${CLAUDE}', ${Date.now() - 60_000}),
      ('["claude","host_a","session:sess-old"]', '${CLAUDE}', ${Date.now() - 2 * 60 * 60_000});
  `);
}

async function world(): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "studio-accounts-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const studioDir = join(root, "studio");
  const sourceDir = join(root, "bb");
  seedBbDir(studioDir, "Studio thread");
  seedBbDir(sourceDir, "bb thread");
  writeFileSync(join(studioDir, "plugins", "account-pool", "secrets", "accounts", `account-${CODEX}.json`), "{}");
  sqlite(join(studioDir, "bb.db"), `INSERT INTO plugin_kv VALUES ('account-pool', 'rejected-refresh:${CLAUDE}', '{}', 1)`);
  sqlite(join(studioDir, "fork-import.db"), `CREATE TABLE mirrored_threads (thread_id TEXT PRIMARY KEY, taken_over_at INTEGER); INSERT INTO mirrored_threads VALUES ('thr_mirrored', NULL);`);
  writeFileSync(join(studioDir, "fork-import.json"), JSON.stringify({ version: 1, sourceDataDir: sourceDir }));
  const calls: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const method = (request.url ?? "").split("/rpc/")[1] ?? "";
      calls.push(method);
      const reply = (result: unknown) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ ok: true, result })); };
      if (method === "status.get") {
        return reply({
          route: "/x", accessToken: LEAK, hosts: [{ hostId: "host_a", token: LEAK }], routing: { claude: true, codex: true },
          accounts: [
            { ...summary({ id: CLAUDE, limitWindows: [window("secondary", 10080, 0.96, "allowed_warning")], familyWeekly: { fable: { utilization: 1, resetAt: RESET, status: "rejected" } } }), refreshToken: LEAK, idToken: JWT },
            { ...summary({ id: CODEX, provider: "codex", limitWindows: [window("primary", 300, 0.01)] }), accessToken: LEAK },
          ],
        });
      }
      if (method === "codexLogin.start") return reply({ sessionId: "99999999-9999-4999-8999-999999999999", verificationUri: "https://auth.example.test/codex/device", userCode: "FAKE-0000", expiresAt: Date.now() + 900_000, intervalMs: 5_000, deviceAuthId: LEAK });
      if (method === "codexLogin.poll") return reply({ status: "pending" });
      if (method === "codexLogin.cancel") return reply({ cancelled: true });
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: "unknown" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(join(sourceDir, "bb-app-runtime.json"), JSON.stringify({ serverUrl: url }));
  return { root, studioDir, sourceDir, calls, server, url };
}

function host(w: World) {
  const reorders: unknown[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "studio",
    dataDir: w.studioDir,
    loopbackBaseUrl: "http://127.0.0.1:1",
    sdk: {
      plugins: {
        callRpc: (async ({ method, input }: { method: string; input: unknown }) => {
          if (method === "status.get") {
            return {
              accounts: [
                { ...summary({ id: CLAUDE, limitWindows: [window("secondary", 10080, 0.97)], familyWeekly: { fable: { utilization: 1, resetAt: RESET, status: "rejected" } } }), refreshToken: LEAK },
                summary({ id: CODEX, provider: "codex", error: `refresh failed: Bearer ${LEAK}` }),
                summary({ id: SPARE, label: "spare" }),
              ],
            };
          }
          if (method === "account.reorder") { reorders.push(input); return null; }
          if (method === "account.list") return [];
          throw new Error(`unexpected ${method}`);
        }) as never,
      },
      system: {
        config: (async () => ({ primaryHostId: "host_a" })) as never,
        providerStates: (async () => ({ providers: [
          { providerId: "claude-code", displayName: "Claude Code", status: "ready", planLabel: "Proxied", accountEmail: null, loginCommand: "claude auth login" },
          { providerId: "codex", displayName: "Codex", status: "ready", planLabel: "Pro", accountEmail: "me@example.test", loginCommand: "codex login --device-auth" },
        ] })) as never,
      },
      threads: {
        get: (async ({ threadId }: { threadId: string }) => ({ id: threadId, providerId: "claude-code" })) as never,
      },
    },
  });
  cleanups.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const live = createLiveBbPool(w.studioDir, bb.server.loopbackBaseUrl);
  const auth = registerAuth(bb, () => {}, live.signIn());
  const accounts = registerAccounts(bb, db, auth, live);
  return { harness, accounts, auth, reorders };
}

describe("Accounts over RPC", () => {
  it("lists BB Studio's pool, bb's pool and local logins, with pins, and never returns a token", async () => {
    const w = await world();
    const { harness, reorders } = host(w);
    const responses: unknown[] = [];
    const call = async (method: string, input: unknown) => {
      const result = await harness.callRpc(method, input as never);
      responses.push(result);
      return result as never;
    };

    const status = await call("accounts.status", { refresh: true }) as { sources: { source: string; state: string }[]; accounts: AccountView[]; warnings: { id: string }[] };
    expect(status.sources.map((source) => [source.source, source.state])).toEqual([["studio", "on"], ["bb", "on"], ["local", "on"]]);
    expect(status.accounts.map((account) => [account.key, account.state])).toEqual([
      [`studio:${CLAUDE}`, "signed_out"],
      [`studio:${CODEX}`, "error"],
      [`studio:${SPARE}`, "signed_out"],
      [`bb:${CLAUDE}`, "ready"],
      [`bb:${CODEX}`, "ready"],
      ["local:claude-code", "ready"],
      ["local:codex", "ready"],
    ]);
    expect(status.accounts.find((account) => account.key === `studio:${CLAUDE}`)?.pinned).toEqual([{ threadId: "thr_pinned", title: "Studio thread" }]);
    expect(status.accounts.find((account) => account.key === `bb:${CLAUDE}`)?.pinned).toEqual([{ threadId: "thr_pinned", title: "bb thread" }]);
    expect(status.warnings.map((warning) => warning.id)).toEqual(expect.arrayContaining([`studio:${CLAUDE}:signed_out`, `bb:${CLAUDE}:model:fable:rejected`, `bb:${CLAUDE}:window:secondary:high`]));
    expect(w.calls).toEqual(["status.get"]);

    await call("accounts.dismiss", { id: `bb:${CLAUDE}:model:fable:rejected` });
    await call("accounts.thread", { threadId: "thr_local" });
    await call("accounts.thread", { threadId: "thr_mirrored" });
    await call("accounts.request", { signIn: `studio:${CLAUDE}` });
    await call("auth.status", {});
    await expect(harness.callRpc("accounts.useOther", { accountKey: `bb:${CLAUDE}` } as never)).rejects.toThrow(/BB Studio's own/);
    expect(reorders).toEqual([]);
    expect(w.calls.filter((method) => method !== "status.get")).toEqual([]);

    const started = await call("auth.login.start", { target: `bb:${CODEX}` }) as { sessionId: string; code: string; url: string };
    expect(started).toMatchObject({ code: "FAKE-0000", url: "https://auth.example.test/codex/device", state: "waiting" });
    await call("auth.login.poll", { sessionId: started.sessionId });
    await call("auth.login.cancel", { sessionId: started.sessionId });
    expect(w.calls.filter((method) => method !== "status.get")).toEqual(["codexLogin.start", "codexLogin.poll", "codexLogin.cancel"]);

    for (const response of responses) expect(JSON.stringify(response)).not.toMatch(TOKEN_PATTERN);
    expect(JSON.stringify(responses)).toContain("FAKE-0000");
  });

  it("says which sign-in a thread is signed out of", async () => {
    const w = await world();
    const { harness } = host(w);
    expect(await harness.callRpc("accounts.thread", { threadId: "thr_local" } as never)).toMatchObject({ source: "studio", state: "signed_out", signIn: `pool:${CLAUDE}` });
    expect(await harness.callRpc("accounts.thread", { threadId: "thr_mirrored" } as never)).toBeNull();
  });

  it("prints accounts, warnings and pins from the CLI, and needs --bb to sign in to bb", async () => {
    const w = await world();
    const { accounts, auth } = host(w);
    const services = { accounts: accounts.service, auth };
    const text = await accountsCli(["status"], services);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("BB Studio Account Pooler");
    expect(text.stdout).toContain("bb Account Pooler");
    expect(text.stdout).toContain("This Mac");
    expect(text.stdout).toContain("7d 96% resets");
    expect(text.stdout).toContain("Fable 100% rejected");
    expect(text.stdout).toContain("pinned: thr_pinned bb thread");
    expect(text.stdout).not.toMatch(TOKEN_PATTERN);
    const json = await accountsCli(["status", "--source", "bb", "--json"], services);
    expect(JSON.parse(json.stdout!).accounts.every((account: AccountView) => account.source === "bb")).toBe(true);
    const warnings = await accountsCli(["warnings"], services);
    expect(warnings.stdout).toContain(`studio:${CLAUDE}:signed_out`);
    expect(await accountsCli(["login", `bb:${CLAUDE}`], services)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("needs --bb") });
    expect(w.calls.filter((method) => method !== "status.get")).toEqual([]);
    expect(await accountsCli(["dismiss", `studio:${CLAUDE}:signed_out`], services)).toMatchObject({ exitCode: 0, stdout: "Dismissed.\n" });
    expect(await accountsCli(["bogus"], services)).toMatchObject({ exitCode: 1 });
  });
});

describe("local data", () => {
  it("reads pins used in the last 65 minutes and skips deleted threads", async () => {
    const w = await world();
    expect(readPins(w.sourceDir)).toEqual(new Map([[CLAUDE, [{ threadId: "thr_pinned", title: "bb thread" }]]]));
  });

  it("reads refresh rejections by key and missing login files by name only", async () => {
    const w = await world();
    const signals = readPoolSignals(w.studioDir, [CLAUDE, CODEX]);
    expect([...signals.rejected]).toEqual([CLAUDE]);
    expect([...signals.missingLogin]).toEqual([CLAUDE]);
  });
});

describe("live bb", () => {
  it("reads bb's address from its own runtime file and only on loopback", async () => {
    const w = await world();
    expect(liveBbUrl(w.sourceDir, w.studioDir, null)).toBe(w.url);
    expect(liveBbUrl(w.sourceDir, w.studioDir, w.url)).toBeNull();
    expect(liveBbUrl(w.studioDir, w.studioDir, null)).toBeNull();
    expect(loopbackUrl("http://example.com:38886")).toBeNull();
    expect(loopbackUrl("https://127.0.0.1:1")).toBeNull();
    expect(loopbackUrl("http://user:pw@127.0.0.1:1")).toBeNull();
  });

  it("calls nothing on bb but its status and the sign-in methods", async () => {
    const w = await world();
    const pool = new LiveBbPool(() => w.url);
    await expect((pool as unknown as { call(method: string, input: unknown, schema: unknown): Promise<unknown> }).call("account.remove", { id: CLAUDE }, null)).rejects.toThrow(/not called/);
    await expect((pool as unknown as { call(method: string, input: unknown, schema: unknown): Promise<unknown> }).call("routing.set", { provider: "claude", enabled: false }, null)).rejects.toThrow(/not called/);
    expect(w.calls).toEqual([]);
  });
});

describe("no provider signed in", () => {
  it("asks to sign in once when no account is ready and none is already asking", () => {
    expect(computeWarnings([], NOW, "UTC")).toEqual([NO_PROVIDER_WARNING]);
    expect(computeWarnings([view({ key: "studio:c", state: "disabled" })], NOW, "UTC")).toEqual([NO_PROVIDER_WARNING]);
    expect(computeWarnings([view({ key: "studio:a", state: "signed_out" })], NOW, "UTC").map((warning) => warning.id)).toEqual(["studio:a:signed_out"]);
    expect(computeWarnings([view({ key: "local:codex", state: "ready" })], NOW, "UTC")).toEqual([]);
    expect(NO_PROVIDER_WARNING).toMatchObject({ title: "No provider signed in", action: "sign_in", target: null });
  });
});

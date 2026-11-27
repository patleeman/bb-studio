import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGED_IMPORT_FILE, ToolGatewaySecrets } from "../server/secrets";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tg-secrets-test-"));
}

describe("ToolGatewaySecrets", () => {
  it("generates and persists an approval key with 0700 dir and 0600 file modes", async () => {
    const dir = join(await tempDir(), "nested");
    const secrets = new ToolGatewaySecrets(dir);

    expect(await secrets.load()).toEqual([]);
    const key = secrets.approvalKey();
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThanOrEqual(32);
    expect(secrets.loadProblems()).toEqual([]);
    expect(secrets.stagedImportPath()).toBe(join(dir, STAGED_IMPORT_FILE));

    const dirMode = (await stat(dir)).mode & 0o777;
    const keyMode = (await stat(join(dir, "approval.key"))).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(keyMode).toBe(0o600);

    const reloaded = new ToolGatewaySecrets(dir);
    expect(await reloaded.load()).toEqual([]);
    expect(reloaded.approvalKey()).toBe(key);
  });

  it("stores, isolates, and deletes server secrets and OAuth records", async () => {
    const dir = await tempDir();
    const secrets = new ToolGatewaySecrets(dir);
    await secrets.load();

    await secrets.set("srv_alpha", {
      env: { API_TOKEN: "synthetic-alpha-env-token-001" },
      headers: { Authorization: "Bearer synthetic-alpha-hdr-001" },
    });
    const fileMode = (await stat(join(dir, "servers.json"))).mode & 0o777;
    expect(fileMode).toBe(0o600);

    // Mutating the returned copy must not affect stored state.
    const copy = secrets.get("srv_alpha");
    copy.env.API_TOKEN = "mutated";
    expect(secrets.get("srv_alpha").env.API_TOKEN).toBe("synthetic-alpha-env-token-001");

    const oauth = secrets.oauthBackend();
    expect(secrets.hasOAuth("srv_alpha")).toBe(false);
    await oauth.save({
      srv_alpha: {
        tokens: {
          access_token: "synthetic-oauth-access-token-long",
          refresh_token: "synthetic-oauth-refresh-token",
          token_type: "bearer",
        },
        state: "short",
      },
    });
    expect(secrets.hasOAuth("srv_alpha")).toBe(true);

    // values() returns secrets longest-first and ignores short (< 8 char) OAuth fields.
    const vals = secrets.values("srv_alpha");
    expect(vals).toContain("synthetic-oauth-access-token-long");
    expect(vals).toContain("synthetic-alpha-env-token-001");
    expect(vals).toContain("Bearer synthetic-alpha-hdr-001");
    expect(vals).not.toContain("short");
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i - 1]!.length).toBeGreaterThanOrEqual(vals[i]!.length);
    }

    // Reload from disk and verify both stores survived.
    const reloaded = new ToolGatewaySecrets(dir);
    await reloaded.load();
    expect(reloaded.get("srv_alpha").headers.Authorization).toBe("Bearer synthetic-alpha-hdr-001");
    expect(reloaded.hasOAuth("srv_alpha")).toBe(true);

    // delete() clears both server secrets and OAuth credentials.
    await reloaded.delete("srv_alpha");
    expect(reloaded.get("srv_alpha")).toEqual({ env: {}, headers: {} });
    expect(reloaded.hasOAuth("srv_alpha")).toBe(false);
  });

  it("masks corrupt secret files without leaking contents and refuses to overwrite them", async () => {
    const dir = await tempDir();
    const sentinel = "synthetic-do-not-quote-999999";
    await writeFile(join(dir, "approval.key"), "too-short", "utf8");
    await writeFile(join(dir, "servers.json"), `{invalid ${sentinel}`, "utf8");
    await writeFile(join(dir, "oauth.json"), `{broken ${sentinel}`, "utf8");

    const secrets = new ToolGatewaySecrets(dir);
    const problems = await secrets.load();
    expect(problems).toEqual([
      "approval.key: can't be read",
      "servers.json: can't be read",
      "oauth.json: can't be read",
    ]);
    expect(problems.join("\n")).not.toContain(sentinel);
    expect(secrets.approvalKey()).toBeNull();
    expect(secrets.get("any")).toEqual({ env: {}, headers: {} });

    expect(() =>
      secrets.set("srv_one", { env: { K: "synthetic-val" }, headers: {} }),
    ).toThrow(/servers\.json can't be read/);
    await expect(secrets.oauthBackend().save({})).rejects.toThrow(/oauth\.json can't be read/);

    // Original corrupt files are untouched.
    expect(await readFile(join(dir, "servers.json"), "utf8")).toContain(sentinel);
    expect(await readFile(join(dir, "oauth.json"), "utf8")).toContain(sentinel);
  });

  it("serializes concurrent writes atomically without leaving temp files", async () => {
    const dir = await tempDir();
    const secrets = new ToolGatewaySecrets(dir);
    await secrets.load();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        secrets.set(`srv_${i}`, {
          env: { KEY: `synthetic-concurrent-value-${i}` },
          headers: {},
        }),
      ),
    );

    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);

    const reloaded = new ToolGatewaySecrets(dir);
    await reloaded.load();
    for (let i = 0; i < 10; i++) {
      expect(reloaded.get(`srv_${i}`).env.KEY).toBe(`synthetic-concurrent-value-${i}`);
    }
  });
});

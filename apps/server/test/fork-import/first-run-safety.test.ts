import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedConnection } from "@bb/db/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  forkBeforeDatabase,
  importTimeoutMs,
  runForkFirstRunImport,
} from "../../src/services/fork-import/first-run.js";
import { snapshotChildSource } from "../../src/services/fork-import/first-run-snapshot.js";
import {
  cleanStartHasUserContent,
  FIRST_RUN_FAILED_FILE_NAME,
  FirstRunImportError,
  writeFirstRunFailure,
  FIRST_RUN_JOURNAL_FILE_NAME,
  FirstRunImportTimeoutError,
  readFirstRunFailure,
  recoverInterruptedFirstRunImport,
  sweepFirstRunStaging,
} from "../../src/services/fork-import/first-run-install.js";
import { setForkImportDataDir } from "../../src/services/fork-import/index.js";
import {
  closeForkImportDatabases,
  FORK_IMPORT_STATE_FILE_NAME,
} from "../../src/services/fork-import/state.js";
import { copyMissingAttachments } from "../../src/services/fork-import/sync.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
const logger = { info: () => {}, warn: () => {} };

async function makeSource(): Promise<{ root: string; source: string }> {
  const root = await mkdtemp(join(tmpdir(), "bb-fork-first-run-"));
  roots.push(root);
  const source = join(root, "source");
  await mkdir(source, { recursive: true });
  const memory = createMigratedConnection();
  await memory.$client.backup(join(source, "bb.db"));
  memory.$client.close();
  const db = new Database(join(source, "bb.db"));
  db.prepare(
    `INSERT INTO plugin_state_snapshots (id, plugin_id, from_artifact_id, to_artifact_id, snapshot_path, database_path, state_path, secrets_path, registration_path, status, created_at, retained_until, updated_at)
     VALUES ('snap1', 'studio', NULL, 'art2', ?, NULL, 'host-state.json', NULL, 'previous-registration.json', 'pending', 1, 2, 1)`,
  ).run(join(source, "plugins", "snapshots", "studio", "1-art2-x"));
  db.close();
  const files: Record<string, string> = {
    "config.json": '{"config":{"BB_LOG_LEVEL":"info"}}\n',
    "AGENTS.md": "rules\n",
    "telemetry-id": "source-telemetry",
    ".DS_Store": "junk",
    "skills/one/SKILL.md": "skill",
    "skills/one/.DS_Store": "junk",
    "attachments/proj_a/one.png": "png-one",
    "attachments/proj_a/two.png": "png-two",
    "plugins/studio/files/page.md": "page",
    "plugins/studio/secrets/key": "s",
    "plugins/studio/logs/host.log": "log",
    "plugins/snapshots/studio/1-art2-x/secrets/key": "old-secret",
    "plugins/mobile/secrets/apnsKey": "k",
    "plugins/account-pool/secrets/login": "l",
    "plugins/cache/npm/pkg/1.0.0/dist/index.js": "code",
    "worktrees/w1/file.txt": "w",
    "logs/server.log": "log",
  };
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(source, path, ".."), { recursive: true });
    await writeFile(join(source, path), body);
  }
  const plugin = new Database(join(source, "plugins", "studio", "data.db"));
  plugin.exec(
    "CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('hi')",
  );
  plugin.close();
  return { root, source };
}

function idOf(path: string): string {
  const stats = statSync(path, { bigint: true });
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

function listTree(root: string, prefix = ""): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      out.push(`${path}/`, ...listTree(join(root, entry.name), path));
    else out.push(path);
  }
  return out.sort();
}

function stagingDirs(root: string, name: string): string[] {
  return readdirSync(root).filter((entry) =>
    entry.startsWith(`.${name}-first-run-import-`),
  );
}

async function waitForNoStaging(root: string, name: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (stagingDirs(root, name).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await sweepFirstRunStaging(join(root, name));
}

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  closeForkImportDatabases();
  setForkImportDataDir(null);
  delete process.env.BB_STUDIO_IMPORT_FROM;
  delete process.env.BB_STUDIO_IMPORT_TIMEOUT_MS;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("first-run import safety", () => {
  it("copies what a new install needs and leaves out the rest", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");

    const state = await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: source },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });

    expect(state?.sourceDataDir).toBe(source);
    const tree = listTree(target);
    expect(tree).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "bb.db",
        "config.json",
        "fork-import.db",
        FORK_IMPORT_STATE_FILE_NAME,
        "plugins/cache/npm/pkg/1.0.0/dist/index.js",
        "plugins/studio/data.db",
        "plugins/studio/files/page.md",
        "plugins/studio/secrets/key",
        "server-connect-hold.json",
        "server-import.json",
        "skills/one/SKILL.md",
      ]),
    );
    for (const left of [
      ".DS_Store",
      "skills/one/.DS_Store",
      "telemetry-id",
      "plugins/snapshots/",
      "plugins/mobile/",
      "plugins/account-pool/",
      "plugins/studio/logs/",
      "worktrees/",
      "logs/",
      "attachments/",
      FIRST_RUN_JOURNAL_FILE_NAME,
    ]) {
      expect(tree).not.toContain(left);
    }
    const db = new Database(join(target, "bb.db"), { readonly: true });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM plugin_state_snapshots").get(),
    ).toEqual({ n: 0 });
    db.close();
    expect(stagingDirs(root, "target")).toEqual([]);

    await mkdir(join(target, "attachments", "proj_a"), { recursive: true });
    await writeFile(join(target, "attachments", "proj_a", "two.png"), "new");
    expect(await copyMissingAttachments({ dataDir: target, logger })).toEqual({
      copied: 1,
      failed: 0,
    });
    expect(
      readFileSync(join(target, "attachments", "proj_a", "one.png"), "utf8"),
    ).toBe("png-one");
    expect(
      readFileSync(join(target, "attachments", "proj_a", "two.png"), "utf8"),
    ).toBe("new");
    expect(
      await copyMissingAttachments({ dataDir: target, logger }),
    ).toBeNull();
  });

  it("leaves the data dir as it was when the move fails part way", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    await mkdir(join(target, "logs"), { recursive: true });
    await writeFile(join(target, "logs", "server.log"), "boot\n");
    await writeFile(
      join(target, "config.json"),
      '{"serverUrl":"http://127.0.0.1:1"}\n',
    );
    await writeFile(join(target, "plugins"), "not a folder");
    const before = listTree(target);

    await expect(
      runForkFirstRunImport({
        dataDir: target,
        env: { BB_STUDIO_IMPORT_FROM: source },
        logger,
        now: 1000,
        appVersion: "1.0.0",
      }),
    ).rejects.toThrow();

    expect(listTree(target)).toEqual(before);
    expect(readFileSync(join(target, "config.json"), "utf8")).toBe(
      '{"serverUrl":"http://127.0.0.1:1"}\n',
    );
    await waitForNoStaging(root, "target");
    expect(stagingDirs(root, "target")).toEqual([]);
  });

  it("takes a killed import back out on the next start, then imports", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    const staging = join(root, ".target-first-run-import-killed");
    await mkdir(join(target, "plugins", "studio"), { recursive: true });
    await writeFile(join(target, "AGENTS.md"), "half");
    await writeFile(join(target, "config.json"), '{"merged":true}\n');
    await writeFile(join(target, "plugins", "studio", "data.db"), "half");
    await mkdir(join(staging, "replaced"), { recursive: true });
    await writeFile(
      join(staging, "replaced", "config.json"),
      '{"serverUrl":"http://127.0.0.1:1"}\n',
    );
    await mkdir(join(staging, "files", "skills"), { recursive: true });
    await writeFile(
      join(target, FIRST_RUN_JOURNAL_FILE_NAME),
      JSON.stringify({
        version: 2,
        stagingDir: staging,
        added: [
          { path: "AGENTS.md", id: idOf(join(target, "AGENTS.md")) },
          { path: "config.json", id: idOf(join(target, "config.json")) },
          {
            path: "plugins/studio/data.db",
            id: idOf(join(target, "plugins", "studio", "data.db")),
          },
          { path: "skills", id: "0:1" },
          { path: "bb.db", id: "0:2" },
        ],
        replaced: ["config.json"],
      }),
    );

    expect(await recoverInterruptedFirstRunImport(target, logger)).toBe(
      "rolled-back",
    );
    expect(listTree(target)).toEqual(["config.json"]);
    expect(readFileSync(join(target, "config.json"), "utf8")).toBe(
      '{"serverUrl":"http://127.0.0.1:1"}\n',
    );

    const state = await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: source },
      logger,
      now: 1000,
      appVersion: "1.0.0",
    });
    expect(state).not.toBeNull();
    expect(existsSync(join(target, "bb.db"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(target, "config.json"), "utf8")),
    ).toEqual({
      config: { BB_LOG_LEVEL: "info" },
    });
    expect(await sweepFirstRunStaging(target)).toBe(1);
    expect(stagingDirs(root, "target")).toEqual([]);
  });

  it("only finishes the cleanup when the kill came after the commit", async () => {
    const { root } = await makeSource();
    const target = join(root, "target");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "bb.db"), "db");
    await writeFile(join(target, FORK_IMPORT_STATE_FILE_NAME), "{}");
    await writeFile(
      join(target, FIRST_RUN_JOURNAL_FILE_NAME),
      JSON.stringify({
        version: 2,
        stagingDir: "",
        added: [{ path: "bb.db", id: idOf(join(target, "bb.db")) }],
        replaced: [],
      }),
    );

    expect(await recoverInterruptedFirstRunImport(target, logger)).toBe(
      "finished",
    );
    expect(listTree(target)).toEqual(["bb.db", FORK_IMPORT_STATE_FILE_NAME]);
  });

  it("stops at its deadline and leaves the data dir untouched", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");

    await expect(
      runForkFirstRunImport({
        dataDir: target,
        env: { BB_STUDIO_IMPORT_FROM: source },
        logger,
        now: 1000,
        appVersion: "1.0.0",
        timeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(FirstRunImportTimeoutError);
    expect(listTree(target)).toEqual([]);
    await waitForNoStaging(root, "target");
    expect(stagingDirs(root, "target")).toEqual([]);
  });

  it("starts clean and records why when the import times out", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    process.env.BB_STUDIO_IMPORT_FROM = source;
    process.env.BB_STUDIO_IMPORT_TIMEOUT_MS = "1";

    await expect(
      forkBeforeDatabase(
        { BB_DATA_DIR: target, BB_APP_VERSION: "1.0.0" },
        logger,
      ),
    ).resolves.toBeUndefined();

    expect(existsSync(join(target, "bb.db"))).toBe(false);
    expect(existsSync(join(target, FORK_IMPORT_STATE_FILE_NAME))).toBe(false);
    const failure = readFirstRunFailure(target);
    expect(failure).toMatchObject({
      reason: "timed-out",
      sourceDataDir: source,
    });
    expect(failure?.message).toBe(
      `BB Studio could not copy your bb data from ${source} in time, so it started without it. Your bb data there is unchanged.`,
    );
    expect(failure?.attempts).toBe(1);
    delete process.env.BB_STUDIO_IMPORT_TIMEOUT_MS;
    expect(
      await runForkFirstRunImport({
        dataDir: target,
        env: { BB_STUDIO_IMPORT_FROM: source },
        logger,
        now: 1000,
        appVersion: "1.0.0",
      }),
    ).not.toBeNull();
    expect(existsSync(join(target, FIRST_RUN_FAILED_FILE_NAME))).toBe(false);
    await waitForNoStaging(root, "target");
  });

  it("copies the database while the old bb keeps writing to it", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    const db = new Database(join(source, "bb.db"));
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE zz_load (body BLOB)");
    const insert = db.prepare("INSERT INTO zz_load VALUES (?)");
    const blob = Buffer.alloc(64 * 1024, 1);
    db.transaction(() => {
      for (let i = 0; i < 400; i += 1) insert.run(blob);
    })();
    db.close();
    const writer = spawn(
      process.execPath,
      [
        "-e",
        `const D = require(${JSON.stringify(createRequire(import.meta.url).resolve("better-sqlite3"))});
         const db = new D(${JSON.stringify(join(source, "bb.db"))});
         db.pragma("busy_timeout = 1000");
         const s = db.prepare("INSERT INTO zz_load VALUES (randomblob(256))");
         process.stdout.write("ready\\n");
         setInterval(() => { try { s.run(); } catch {} }, 2);`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    children.push(writer);
    await new Promise<void>((resolve) =>
      writer.stdout!.once("data", () => resolve()),
    );

    const started = Date.now();
    const state = await runForkFirstRunImport({
      dataDir: target,
      env: { BB_STUDIO_IMPORT_FROM: source },
      logger,
      now: 1000,
      appVersion: "1.0.0",
      timeoutMs: 20_000,
    });

    expect(state).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(20_000);
    const copy = new Database(join(target, "bb.db"), { readonly: true });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    copy.close();
  }, 30_000);
});

describe("first-run import review fixes", () => {
  const importArgs = (target: string, source: string) => ({
    dataDir: target,
    env: { BB_STUDIO_IMPORT_FROM: source },
    logger,
    now: 1000,
    appVersion: "1.0.0",
  });

  async function cleanStart(target: string): Promise<void> {
    await mkdir(join(target, "plugins", "studio"), { recursive: true });
    const memory = createMigratedConnection();
    await memory.$client.backup(join(target, "bb.db"));
    memory.$client.close();
    await writeFile(join(target, "bb.db-wal"), "stale wal");
    await writeFile(join(target, "auth.json"), '{"hostKey":"clean"}');
    await writeFile(join(target, "host-id"), "host_clean\n");
    await writeFile(join(target, "plugins", "studio", "onboarding.json"), "{}");
    await writeFile(
      join(target, "config.json"),
      '{"serverUrl":"http://127.0.0.1:1"}\n',
    );
  }

  it("never removes a bb.db the import did not move in", async () => {
    const { root } = await makeSource();
    const target = join(root, "target");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "staged-then-replaced"), "x");
    const stagedId = idOf(join(target, "staged-then-replaced"));
    await writeFile(join(target, "bb.db"), "the user's own database");
    await writeFile(
      join(target, FIRST_RUN_JOURNAL_FILE_NAME),
      JSON.stringify({
        version: 2,
        stagingDir: "",
        added: [{ path: "bb.db", id: stagedId }],
        replaced: [],
      }),
    );

    expect(await recoverInterruptedFirstRunImport(target, logger)).toBe(
      "rolled-back",
    );
    expect(readFileSync(join(target, "bb.db"), "utf8")).toBe(
      "the user's own database",
    );
    expect(existsSync(join(target, FIRST_RUN_JOURNAL_FILE_NAME))).toBe(false);
  });

  it("keeps the launcher's config.json when the kill came before it was moved aside", async () => {
    const { root } = await makeSource();
    const target = join(root, "target");
    const staging = join(root, ".target-first-run-import-early");
    await mkdir(join(staging, "files"), { recursive: true });
    await writeFile(join(staging, "files", "config.json"), "{}");
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, "config.json"),
      '{"serverUrl":"http://127.0.0.1:1"}\n',
    );
    await writeFile(
      join(target, FIRST_RUN_JOURNAL_FILE_NAME),
      JSON.stringify({
        version: 2,
        stagingDir: staging,
        added: [
          {
            path: "config.json",
            id: idOf(join(staging, "files", "config.json")),
          },
        ],
        replaced: ["config.json"],
      }),
    );

    await recoverInterruptedFirstRunImport(target, logger);

    expect(readFileSync(join(target, "config.json"), "utf8")).toBe(
      '{"serverUrl":"http://127.0.0.1:1"}\n',
    );
  });

  it("refuses to start, and keeps staging, while an unfinished import can't be undone", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    const staging = join(root, ".target-first-run-import-stuck");
    await mkdir(join(staging, "replaced"), { recursive: true });
    await writeFile(join(staging, "replaced", "config.json"), "{}");
    await mkdir(join(target, "skills", "one"), { recursive: true });
    await writeFile(
      join(target, FIRST_RUN_JOURNAL_FILE_NAME),
      JSON.stringify({
        version: 2,
        stagingDir: staging,
        added: [
          { path: "skills/one", id: idOf(join(target, "skills", "one")) },
        ],
        replaced: ["config.json"],
      }),
    );
    process.env.BB_STUDIO_IMPORT_FROM = source;
    chmodSync(join(target, "skills"), 0o500);
    try {
      await expect(
        forkBeforeDatabase(
          { BB_DATA_DIR: target, BB_APP_VERSION: "1.0.0" },
          logger,
        ),
      ).rejects.toBeInstanceOf(FirstRunImportError);
      expect(existsSync(join(target, FIRST_RUN_JOURNAL_FILE_NAME))).toBe(true);
      expect(existsSync(join(staging, "replaced", "config.json"))).toBe(true);
      expect(existsSync(join(target, "bb.db"))).toBe(false);
    } finally {
      chmodSync(join(target, "skills"), 0o700);
    }
  });

  it("tries again on the next start while the clean start is still empty, setting it aside", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    await cleanStart(target);
    await writeFirstRunFailure(target, {
      version: 1,
      sourceDataDir: source,
      failedAt: 1,
      reason: "timed-out",
      detail: "x",
      message: "m",
      attempts: 1,
    });

    expect(
      await runForkFirstRunImport(importArgs(target, source)),
    ).not.toBeNull();

    expect(existsSync(join(target, FIRST_RUN_FAILED_FILE_NAME))).toBe(false);
    for (const gone of [
      "bb.db-wal",
      "auth.json",
      "host-id",
      "plugins/studio/onboarding.json",
    ]) {
      expect(existsSync(join(target, gone))).toBe(false);
    }
    const backup = join(target, "fork-import-retry-backup", "1000");
    for (const kept of [
      "bb.db",
      "bb.db-wal",
      "auth.json",
      "host-id",
      "plugins/studio/onboarding.json",
    ]) {
      expect(existsSync(join(backup, kept))).toBe(true);
    }
    expect(existsSync(join(target, "plugins", "studio", "data.db"))).toBe(true);
  });

  it("does not try again once BB Studio has threads of its own", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    await mkdir(target, { recursive: true });
    const own = new Database(join(target, "bb.db"));
    own.exec(
      "CREATE TABLE threads (id TEXT, deleted_at INTEGER); CREATE TABLE events (type TEXT); INSERT INTO threads VALUES ('a', NULL), ('b', NULL)",
    );
    own.close();
    await writeFirstRunFailure(target, {
      version: 1,
      sourceDataDir: source,
      failedAt: 1,
      reason: "timed-out",
      detail: "x",
      message: "m",
      attempts: 1,
      retryRequested: true,
    });

    expect(cleanStartHasUserContent(target)).toBe(true);
    expect(await runForkFirstRunImport(importArgs(target, source))).toBeNull();
    expect(existsSync(join(target, "fork-import-retry-backup"))).toBe(false);
  });

  it("gives up after three tries and says so, unless asked to try again", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    await writeFirstRunFailure(target, {
      version: 1,
      sourceDataDir: source,
      failedAt: 1,
      reason: "timed-out",
      detail: "x",
      message: "m",
      attempts: 2,
    });
    process.env.BB_STUDIO_IMPORT_FROM = source;
    process.env.BB_STUDIO_IMPORT_TIMEOUT_MS = "1";

    await forkBeforeDatabase(
      { BB_DATA_DIR: target, BB_APP_VERSION: "1.0.0" },
      logger,
    );
    const failure = readFirstRunFailure(target);
    expect(failure?.attempts).toBe(3);
    expect(failure?.message).toBe(
      `BB Studio tried 3 times to copy your bb data from ${source} and could not, so it started without it. Your bb data there is unchanged.`,
    );
    delete process.env.BB_STUDIO_IMPORT_TIMEOUT_MS;
    expect(await runForkFirstRunImport(importArgs(target, source))).toBeNull();

    await writeFirstRunFailure(target, { ...failure!, retryRequested: true });
    expect(
      await runForkFirstRunImport(importArgs(target, source)),
    ).not.toBeNull();
    await waitForNoStaging(root, "target");
  });

  it("caps the import's time limit below the launcher's", () => {
    expect(importTimeoutMs({ env: {} })).toBe(30_000);
    expect(
      importTimeoutMs({ env: { BB_STUDIO_IMPORT_TIMEOUT_MS: "90000" } }),
    ).toBe(45_000);
    expect(
      importTimeoutMs({ env: { BB_STUDIO_IMPORT_TIMEOUT_MS: "nope" } }),
    ).toBe(30_000);
  });

  it("keeps a secret from a broken env.json out of the failure record and the log", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    await writeFile(
      join(source, "env.json"),
      '{"env":{"OPENAI_API_KEY":"sk-test-secret-123"',
    );
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "env.json"), '{"env":{}}');
    process.env.BB_STUDIO_IMPORT_FROM = source;
    const lines: string[] = [];
    const capture = {
      info: (...args: unknown[]) => lines.push(JSON.stringify(args)),
      warn: (...args: unknown[]) => lines.push(JSON.stringify(args)),
    };

    await forkBeforeDatabase(
      { BB_DATA_DIR: target, BB_APP_VERSION: "1.0.0" },
      capture,
    );

    expect(readFirstRunFailure(target)?.detail).toBe(
      "bb's env.json is not valid JSON",
    );
    expect(
      readFileSync(join(target, FIRST_RUN_FAILED_FILE_NAME), "utf8"),
    ).not.toContain("sk-test");
    expect(lines.join("\n")).not.toContain("sk-test");
    await waitForNoStaging(root, "target");
  });

  it("copies attachments through a temporary name, clears leftovers, and retries failures", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    expect(
      await runForkFirstRunImport(importArgs(target, source)),
    ).not.toBeNull();
    const folder = join(target, "attachments", "proj_a");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "two.png.import-tmp"), "partial");
    chmodSync(join(source, "attachments", "proj_a", "one.png"), 0o000);
    try {
      expect(await copyMissingAttachments({ dataDir: target, logger })).toEqual(
        { copied: 1, failed: 1 },
      );
    } finally {
      chmodSync(join(source, "attachments", "proj_a", "one.png"), 0o600);
    }
    expect(readFileSync(join(folder, "two.png"), "utf8")).toBe("png-two");
    expect(existsSync(join(folder, "two.png.import-tmp"))).toBe(false);
    expect(await copyMissingAttachments({ dataDir: target, logger })).toEqual({
      copied: 1,
      failed: 0,
    });
    expect(readFileSync(join(folder, "one.png"), "utf8")).toBe("png-one");
    expect(readdirSync(folder).sort()).toEqual(["one.png", "two.png"]);
    expect(
      await copyMissingAttachments({ dataDir: target, logger }),
    ).toBeNull();
  });

  it("does not follow a symlinked attachments folder", async () => {
    const { root, source } = await makeSource();
    const target = join(root, "target");
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, "private.txt"), "p");
    await rm(join(source, "attachments"), { recursive: true });
    symlinkSync(elsewhere, join(source, "attachments"));
    expect(
      await runForkFirstRunImport(importArgs(target, source)),
    ).not.toBeNull();

    expect(await copyMissingAttachments({ dataDir: target, logger })).toEqual({
      copied: 0,
      failed: 0,
    });
    expect(existsSync(join(target, "attachments", "private.txt"))).toBe(false);
  });

  it("stops the database copy when the server that started it is gone", async () => {
    const { root, source } = await makeSource();
    const jobs = [1, 2, 3].map((n) => ({
      from: join(source, "bb.db"),
      to: join(root, `copy-${String(n)}.db`),
    }));
    const child = spawn(process.execPath, ["-e", snapshotChildSource], {
      env: {
        ...process.env,
        BB_STUDIO_SNAPSHOT_DRIVER: createRequire(import.meta.url).resolve(
          "better-sqlite3",
        ),
        BB_STUDIO_SNAPSHOT_JOBS: JSON.stringify(jobs),
      },
      stdio: ["pipe", "ignore", "ignore"],
    });
    children.push(child);
    child.stdin!.end();
    const code = await new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );

    expect(code).toBe(1);
    expect(existsSync(jobs[2]!.to)).toBe(false);
  });
});

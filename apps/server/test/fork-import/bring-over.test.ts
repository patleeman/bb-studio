import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { registerBringOverRoutes } from "../../src/services/fork-import/bring-over/routes.js";
import { resetUiTokenForTests } from "../../src/services/fork-import/bring-over/ui-token.js";
import { eventChunking } from "../../src/services/fork-import/bring-over/threads.js";
import { applySetting } from "../../src/services/fork-import/bring-over/settings.js";
import { existingSourceSnapshot } from "../../src/services/fork-import/bring-over/source.js";
import { lstatSync, symlinkSync, statSync } from "node:fs";
import type { AppDeps } from "../../src/types.js";
import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { turnScope } from "@bb/domain";
import { createConnection, listProviderLifecycleEnvironments } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  bringOverJobFinished,
  cancelBringOverJob,
  startBringOverJob,
  type BringOverRequest,
} from "../../src/services/fork-import/bring-over/job.js";
import {
  listProjects,
  listThreads,
} from "../../src/services/fork-import/bring-over/listing.js";
import {
  addPlugin,
  HIDDEN_PLUGIN_IDS,
  listPlugins,
} from "../../src/services/fork-import/bring-over/plugins.js";
import { listSettings } from "../../src/services/fork-import/bring-over/settings.js";
import {
  bringOverStudioData,
  studioDataState,
} from "../../src/services/fork-import/bring-over/studio-data.js";
import { snapshotChildSource } from "../../src/services/fork-import/bring-over/snapshot.js";
import {
  openSnapshot,
  takeSourceSnapshot,
  type SourceSnapshot,
} from "../../src/services/fork-import/bring-over/source.js";
import {
  seedEvent,
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const roots: string[] = [];
const open: Database.Database[] = [];
const children: ChildProcess[] = [];
const logger = { info: () => {}, warn: () => {} };

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const db of open.splice(0)) if (db.open) db.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function insertRow(
  db: Database.Database,
  table: string,
  values: Record<string, unknown>,
): void {
  const row: Record<string, unknown> = {};
  for (const column of db
    .prepare<
      [],
      { name: string; notnull: number; dflt_value: string | null; type: string }
    >(
      `SELECT name, "notnull", dflt_value, type FROM pragma_table_info('${table}')`,
    )
    .all()) {
    if (column.notnull === 1 && column.dflt_value === null) {
      row[column.name] = /INT/i.test(column.type) ? 1 : "x";
    }
  }
  Object.assign(row, values);
  const names = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")})`,
  ).run(row);
}

interface Fixture {
  root: string;
  source: string;
  target: string;
  db: Database.Database;
  snapshot: SourceSnapshot;
  ids: {
    p1: string;
    p2: string;
    t1: string;
    t2: string;
    t3: string;
    sourceHost: string;
    env1: string;
  };
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "bb-fork-bring-over-"));
  roots.push(root);
  const source = join(root, "home", ".bb");
  const target = join(root, "home", ".bb-studio");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  const ids = {} as Fixture["ids"];
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "host_bb" });
    const { project: p1 } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
      name: "orbital",
      path: "/tmp/p1",
    });
    const { project: p2 } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
      name: "hive",
      path: "/tmp/p2",
    });
    const env1 = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: p1.id,
      path: "/tmp/p1",
    });
    const t1 = seedThread(harness.deps, {
      projectId: p1.id,
      environmentId: env1.id,
      status: "active",
      title: "First",
    });
    const t2 = seedThread(harness.deps, {
      projectId: p1.id,
      environmentId: env1.id,
      title: "Child",
      parentThreadId: t1.id,
    });
    const t3 = seedThread(harness.deps, {
      projectId: p2.id,
      title: "Elsewhere",
    });
    for (const [thread, count] of [
      [t1, 3],
      [t2, 1],
      [t3, 2],
    ] as const) {
      for (let sequence = 1; sequence <= count; sequence += 1) {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: thread.environmentId,
          providerThreadId: `provider-${thread.id}`,
          scope: turnScope("turn-1"),
          sequence,
          type: "item/completed",
          data: {
            item: { type: "agentMessage", id: `m${sequence}`, text: "hi" },
          },
        });
      }
    }
    Object.assign(ids, {
      p1: p1.id,
      p2: p2.id,
      t1: t1.id,
      t2: t2.id,
      t3: t3.id,
      sourceHost: host.id,
      env1: env1.id,
    });
    await harness.db.$client.backup(join(source, "bb.db"));
  });
  const bb = new Database(join(source, "bb.db"));
  insertRow(bb, "project_attachments", {
    id: "att_1",
    project_id: ids.p1,
    stored_path: "one.png",
    size_bytes: 3,
    deletion_claimed_at: null,
  });
  insertRow(bb, "project_attachment_threads", {
    attachment_id: "att_1",
    thread_id: ids.t1,
  });
  insertRow(bb, "ui_preferences", {
    key: "sidebar.sort",
    value_json: '"recent"',
    revision: 1,
    updated_at: 1,
  });
  insertRow(bb, "ui_preferences", {
    key: "sidebar.visiblePluginPanels",
    value_json: "[]",
    revision: 1,
    updated_at: 1,
  });
  const toolDir = join(root, "plugins-src", "acme-tool");
  await mkdir(toolDir, { recursive: true });
  for (const [id, kind, path] of [
    ["acme-tool", "path", toolDir],
    ["gone-tool", "path", join(root, "nowhere")],
    ["remote-thing", "git", "github:acme/remote-thing"],
    ["future-tool", "path", join(root, "plugins-src", "future-tool")],
    ["pinned-git", "git", "github:acme/pinned"],
    ["pinned-npm", "npm", "npm:acme-np"],
    ["studio", "path", "/old/studio"],
    ["bundled-x", "builtin", "builtin:x"],
  ] as const) {
    insertRow(bb, "plugins", {
      id,
      source: path,
      root_dir: path,
      enabled: 1,
      source_kind: kind,
      source_path: kind === "path" ? path : null,
      version: "1.0.0",
      removed_at: null,
    });
  }
  bb.prepare(
    "UPDATE plugins SET source_git_url = 'https://github.com/acme/pinned', git_resolved_commit = 'abc1234567890abc1234567890abc1234567890a' WHERE id = 'pinned-git'",
  ).run();
  bb.prepare(
    "UPDATE plugins SET source_npm_package = 'acme-np', npm_resolved_version = '2.1.0' WHERE id = 'pinned-npm'",
  ).run();
  insertRow(bb, "plugin_kv", {
    plugin_id: "acme-tool",
    key: "k",
    value: '"v"',
    updated_at: 1,
  });
  insertRow(bb, "plugin_settings", {
    plugin_id: "acme-tool",
    key: "s",
    value: '"w"',
    updated_at: 1,
  });
  bb.close();
  await writeFile(join(source, "host-id"), `${ids.sourceHost}\n`);
  await mkdir(join(source, "thread-storage", ids.t1), { recursive: true });
  await writeFile(join(source, "thread-storage", ids.t1, "note.txt"), "n");
  await mkdir(join(source, "attachments", ids.p1), { recursive: true });
  await writeFile(join(source, "attachments", ids.p1, "one.png"), "png");
  await mkdir(join(source, "plugins", "acme-tool"), { recursive: true });
  const toolData = new Database(
    join(source, "plugins", "acme-tool", "data.db"),
  );
  toolData.exec(
    "CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('kept')",
  );
  toolData.close();
  await writeFile(join(source, "AGENTS.md"), "rules");
  await mkdir(join(root, "plugins-src", "future-tool"), { recursive: true });
  await writeFile(
    join(root, "plugins-src", "future-tool", "package.json"),
    JSON.stringify({
      name: "bb-plugin-future-tool",
      engines: { bb: ">=99.0.0" },
    }),
  );
  for (const name of ["auth-secret", "auth.json", "telemetry-id"])
    await writeFile(join(source, name), `bb-${name}`);
  await mkdir(join(source, "pi-bridge-sessions"), { recursive: true });
  await writeFile(join(source, "pi-bridge-sessions", "thr_x.json"), "pi");
  await writeFile(
    join(source, "env.json"),
    JSON.stringify({ env: { OPENAI_API_KEY: "sk-test" } }),
  );

  const memory = createMigratedConnection();
  await memory.$client.backup(join(target, "bb.db"));
  memory.$client.close();
  const db = new Database(join(target, "bb.db"));
  db.pragma("foreign_keys = ON");
  open.push(db);
  insertRow(db, "hosts", {
    id: "host_here",
    name: "This Mac",
    type: "persistent",
  });
  await writeFile(join(target, "host-id"), "host_here\n");
  const snapshot = await takeSourceSnapshot({
    dataDir: target,
    sourceDataDir: source,
    now: 5000,
  });
  return { root, source, target, db, snapshot, ids };
}

async function run(f: Fixture, request: Partial<BringOverRequest>) {
  const snapshot = existsSync(f.snapshot.snapshotPath)
    ? f.snapshot
    : await takeSourceSnapshot({
        dataDir: f.target,
        sourceDataDir: f.source,
        now: 6000,
      });
  const job = startBringOverJob({
    dataDir: f.target,
    snapshot,
    target: f.db,
    request: { picks: [], attachments: true, settings: [], ...request },
    logger,
    now: 6000,
  });
  expect(job).not.toBeNull();
  await bringOverJobFinished(f.target);
  return job!;
}

function count(
  db: Database.Database,
  sql: string,
  ...params: unknown[]
): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("bring things over from bb", () => {
  it("lists projects, threads, settings and the plugins that can be added", async () => {
    const f = await fixture();
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    const hosts = { sourceHostId: f.ids.sourceHost, ourHostId: "host_here" };
    expect(
      listProjects(snap, f.db, hosts)
        .map(({ name, threads, threadsHere }) => ({
          name,
          threads,
          threadsHere,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "hive", threads: 1, threadsHere: 0 },
      { name: "orbital", threads: 2, threadsHere: 0 },
    ]);
    expect(
      listThreads(snap, f.db, f.ids.p1)
        .map(({ title, attachments, here }) => ({ title, attachments, here }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    ).toEqual([
      { title: "Child", attachments: 0, here: false },
      { title: "First", attachments: 1, here: false },
    ]);
    const settings = await listSettings(snap, f.source);
    expect(settings.find((item) => item.id === "env")).toMatchObject({
      secret: true,
      count: 1,
    });
    expect(settings.find((item) => item.id === "env")).toMatchObject({
      names: ["OPENAI_API_KEY"],
      alreadyHere: [],
    });
    await writeFile(
      join(f.target, "env.json"),
      JSON.stringify({ env: { OPENAI_API_KEY: "mine" } }),
    );
    expect(
      (await listSettings(snap, f.source, f.target)).find(
        (item) => item.id === "env",
      ),
    ).toMatchObject({ alreadyHere: ["OPENAI_API_KEY"] });
    expect(settings.map((item) => item.id)).toContain("instructions");
    const plugins = await listPlugins(snap, f.db, f.source, "1.0.0");
    expect(
      plugins.map(({ id, hasData, sourceMissing, here, needsNewer }) => ({
        id,
        hasData,
        sourceMissing,
        here,
        needsNewer,
      })),
    ).toEqual([
      {
        id: "acme-tool",
        hasData: true,
        sourceMissing: false,
        here: false,
        needsNewer: null,
      },
      {
        id: "future-tool",
        hasData: false,
        sourceMissing: false,
        here: false,
        needsNewer: ">=99.0.0",
      },
      {
        id: "gone-tool",
        hasData: false,
        sourceMissing: true,
        here: false,
        needsNewer: null,
      },
      {
        id: "pinned-git",
        hasData: false,
        sourceMissing: false,
        here: false,
        needsNewer: null,
      },
      {
        id: "pinned-npm",
        hasData: false,
        sourceMissing: false,
        here: false,
        needsNewer: null,
      },
      {
        id: "remote-thing",
        hasData: false,
        sourceMissing: false,
        here: false,
        needsNewer: null,
      },
    ]);
  });

  it("brings a project over with the same ids, its folders on this Mac, files and attachments, and never touches bb", async () => {
    const f = await fixture();
    const before = hashOf(join(f.source, "bb.db"));

    const job = await run(f, { picks: [{ kind: "project", id: f.ids.p1 }] });

    expect(job).toMatchObject({
      state: "done",
      threadsImported: 2,
      threadsSkipped: 0,
    });
    const thread = f.db
      .prepare(
        "SELECT project_id, environment_id, status FROM threads WHERE id = ?",
      )
      .get(f.ids.t1) as Record<string, unknown>;
    expect(thread).toEqual({
      project_id: f.ids.p1,
      environment_id: f.ids.env1,
      status: "idle",
    });
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM events WHERE thread_id = ?",
        f.ids.t1,
      ),
    ).toBe(3);
    expect(
      f.db
        .prepare("SELECT host_id FROM environments WHERE id = ?")
        .get(f.ids.env1),
    ).toEqual({ host_id: "host_here" });
    expect(
      f.db
        .prepare(
          "SELECT host_id, path FROM project_sources WHERE project_id = ?",
        )
        .all(f.ids.p1),
    ).toEqual([{ host_id: "host_here", path: "/tmp/p1" }]);
    expect(
      f.db
        .prepare("SELECT parent_thread_id FROM threads WHERE id = ?")
        .get(f.ids.t2),
    ).toEqual({ parent_thread_id: f.ids.t1 });
    expect(
      readFileSync(
        join(f.target, "thread-storage", f.ids.t1, "note.txt"),
        "utf8",
      ),
    ).toBe("n");
    expect(
      readFileSync(join(f.target, "attachments", f.ids.p1, "one.png"), "utf8"),
    ).toBe("png");
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM project_attachment_threads WHERE thread_id = ?",
        f.ids.t1,
      ),
    ).toBe(1);
    expect(
      count(f.db, "SELECT COUNT(*) AS n FROM threads WHERE id = ?", f.ids.t3),
    ).toBe(0);
    expect(f.db.pragma("foreign_key_check")).toEqual([]);
    expect(hashOf(join(f.source, "bb.db"))).toBe(before);
  });

  it("skips what is already here when run again, with no duplicates", async () => {
    const f = await fixture();
    await run(f, { picks: [{ kind: "project", id: f.ids.p1 }] });
    const events = count(f.db, "SELECT COUNT(*) AS n FROM events");

    const again = await run(f, {
      picks: [
        { kind: "project", id: f.ids.p1 },
        { kind: "thread", id: f.ids.t1 },
      ],
    });

    expect(again).toMatchObject({
      state: "done",
      threadsImported: 0,
      threadsSkipped: 2,
    });
    expect(
      JSON.parse(
        readFileSync(
          join(f.target, "fork-bring-over", "last-job.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ id: again.id, threadsSkipped: 2 });
    expect(count(f.db, "SELECT COUNT(*) AS n FROM events")).toBe(events);
    const snap = openSnapshot(
      await takeSourceSnapshot({
        dataDir: f.target,
        sourceDataDir: f.source,
        now: 7000,
      }),
    );
    open.push(snap);
    expect(
      listThreads(snap, f.db, f.ids.p1).every((thread) => thread.here),
    ).toBe(true);
  });

  it("joins a project BB Studio already has for the same folder", async () => {
    const f = await fixture();
    insertRow(f.db, "projects", {
      id: "proj_mine",
      name: "hive here",
      kind: "standard",
      deleted_at: null,
    });
    insertRow(f.db, "project_sources", {
      id: "src_mine",
      project_id: "proj_mine",
      type: "local_path",
      host_id: "host_here",
      path: "/tmp/p2",
      is_default: 1,
    });
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    expect(
      listProjects(snap, f.db, {
        sourceHostId: f.ids.sourceHost,
        ourHostId: "host_here",
      }).find((project) => project.id === f.ids.p2)?.joins,
    ).toEqual({ id: "proj_mine", name: "hive here" });

    await run(f, { picks: [{ kind: "thread", id: f.ids.t3 }] });

    expect(
      f.db.prepare("SELECT project_id FROM threads WHERE id = ?").get(f.ids.t3),
    ).toEqual({ project_id: "proj_mine" });
    expect(
      count(f.db, "SELECT COUNT(*) AS n FROM projects WHERE id = ?", f.ids.p2),
    ).toBe(0);
  });

  it("clears a link to a thread that is not brought over", async () => {
    const f = await fixture();
    await run(f, { picks: [{ kind: "thread", id: f.ids.t2 }] });
    expect(
      f.db
        .prepare("SELECT parent_thread_id FROM threads WHERE id = ?")
        .get(f.ids.t2),
    ).toEqual({ parent_thread_id: null });
  });

  it("leaves nothing of a thread that fails, and keeps the ones that finished", async () => {
    const f = await fixture();
    f.db.exec(
      `CREATE TRIGGER fail_first BEFORE INSERT ON events WHEN NEW.thread_id = '${f.ids.t1}' BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );

    const job = await run(f, { picks: [{ kind: "project", id: f.ids.p1 }] });

    expect(job.state).toBe("failed");
    expect(job.failures.map((failure) => failure.item)).toEqual([f.ids.t1]);
    expect(
      count(f.db, "SELECT COUNT(*) AS n FROM threads WHERE id = ?", f.ids.t1),
    ).toBe(0);
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM events WHERE thread_id = ?",
        f.ids.t1,
      ),
    ).toBe(0);
    expect(
      existsSync(join(f.target, "thread-storage", f.ids.t1, "note.txt")),
    ).toBe(false);
    expect(existsSync(join(f.target, "attachments", f.ids.p1, "one.png"))).toBe(
      false,
    );
    expect(
      f.db
        .prepare("SELECT parent_thread_id FROM threads WHERE id = ?")
        .get(f.ids.t2),
    ).toEqual({ parent_thread_id: null });
    expect(f.db.pragma("foreign_key_check")).toEqual([]);
  });

  it("stops when cancelled", async () => {
    const f = await fixture();
    startBringOverJob({
      dataDir: f.target,
      snapshot: f.snapshot,
      target: f.db,
      request: {
        picks: [
          { kind: "project", id: f.ids.p1 },
          { kind: "project", id: f.ids.p2 },
        ],
        attachments: true,
        settings: [],
      },
      logger,
      now: 1,
    });
    cancelBringOverJob(f.target);
    await bringOverJobFinished(f.target);
    expect(cancelBringOverJob(f.target)?.state).toBe("cancelled");
    expect(f.db.pragma("foreign_key_check")).toEqual([]);
  });

  it("brings settings only when picked, filling what is missing unless told to replace", async () => {
    const f = await fixture();
    insertRow(f.db, "ui_preferences", {
      key: "sidebar.sort",
      value_json: '"mine"',
      revision: 1,
      updated_at: 1,
    });

    await run(f, {
      settings: [
        { id: "preferences", replace: false },
        { id: "instructions", replace: false },
      ],
    });

    expect(
      f.db
        .prepare(
          "SELECT value_json FROM ui_preferences WHERE key = 'sidebar.sort'",
        )
        .get(),
    ).toEqual({ value_json: '"mine"' });
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM ui_preferences WHERE key = 'sidebar.visiblePluginPanels'",
      ),
    ).toBe(0);
    expect(readFileSync(join(f.target, "AGENTS.md"), "utf8")).toBe("rules");
    expect(existsSync(join(f.target, "env.json"))).toBe(false);

    await run(f, {
      settings: [
        { id: "preferences", replace: true },
        { id: "env", replace: false },
      ],
    });

    expect(
      f.db
        .prepare(
          "SELECT value_json FROM ui_preferences WHERE key = 'sidebar.sort'",
        )
        .get(),
    ).toEqual({ value_json: '"recent"' });
    expect(
      JSON.parse(readFileSync(join(f.target, "env.json"), "utf8")),
    ).toEqual({ env: { OPENAI_API_KEY: "sk-test" } });
  });

  it("adds one plugin with its data, and changes nothing when its source is gone or it fails to install", async () => {
    const f = await fixture();
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    const installed: string[] = [];
    const installer = {
      install: async (source: string) => {
        if (source.startsWith("github:"))
          throw new Error("repository not found");
        installed.push(source);
        return { id: source };
      },
      installPath: async (path: string) => {
        installed.push(path);
        insertRow(f.db, "plugins", {
          id: "acme-tool",
          source: path,
          root_dir: path,
          enabled: 1,
          source_kind: "path",
          source_path: path,
          removed_at: null,
        });
        return { id: "acme-tool" };
      },
      reload: async () => undefined,
      remove: async () => true,
    };
    const args = {
      source: snap,
      target: f.db,
      sourceDataDir: f.source,
      dataDir: f.target,
      installer,
      appVersion: "1.0.0",
    };

    await expect(addPlugin({ ...args, id: "gone-tool" })).rejects.toThrow(
      /not found here/u,
    );
    await expect(addPlugin({ ...args, id: "remote-thing" })).rejects.toThrow(
      /did not record which commit of remote-thing/u,
    );
    expect(existsSync(join(f.target, "plugins"))).toBe(false);
    await expect(addPlugin({ ...args, id: "studio" })).rejects.toThrow(
      /no plugin studio/u,
    );

    expect(await addPlugin({ ...args, id: "acme-tool" })).toEqual({
      id: "acme-tool",
      data: true,
    });
    expect(installed).toEqual([join(f.root, "plugins-src", "acme-tool")]);
    const data = new Database(
      join(f.target, "plugins", "acme-tool", "data.db"),
      { readonly: true },
    );
    expect(data.prepare("SELECT body FROM notes").all()).toEqual([
      { body: "kept" },
    ]);
    data.close();
    expect(
      f.db
        .prepare(
          "SELECT key, value FROM plugin_kv WHERE plugin_id = 'acme-tool'",
        )
        .all(),
    ).toEqual([{ key: "k", value: '"v"' }]);
    expect(
      f.db
        .prepare(
          "SELECT key, value FROM plugin_settings WHERE plugin_id = 'acme-tool'",
        )
        .all(),
    ).toEqual([{ key: "s", value: '"w"' }]);
    await expect(addPlugin({ ...args, id: "acme-tool" })).rejects.toThrow(
      /already installed/u,
    );
  });

  it("never brings a plugin row for an id BB Studio bundles or removes, such as a dead path install of studio", async () => {
    const f = await fixture();
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    expect(
      snap
        .prepare(
          "SELECT source_kind, source_path FROM plugins WHERE id = 'studio'",
        )
        .get(),
    ).toEqual({ source_kind: "path", source_path: "/old/studio" });
    expect(
      (await listPlugins(snap, f.db, f.source, "1.0.0")).map(
        (plugin) => plugin.id,
      ),
    ).not.toContain("studio");
    const installer = {
      install: async () => ({ id: "x" }),
      installPath: async () => ({ id: "x" }),
      reload: async () => undefined,
      remove: async () => true,
    };
    for (const id of [
      "studio",
      "studio-visual-chat",
      "mobile",
      "workflows",
      "bundled-x",
    ]) {
      await expect(
        addPlugin({
          id,
          source: snap,
          target: f.db,
          sourceDataDir: f.source,
          dataDir: f.target,
          installer,
          appVersion: "1.0.0",
        }),
      ).rejects.toThrow(/no plugin/u);
    }

    await run(f, {
      picks: [
        { kind: "project", id: f.ids.p1 },
        { kind: "project", id: f.ids.p2 },
      ],
      settings: [
        "preferences",
        "app-settings",
        "theme",
        "instructions",
        "skills",
        "custom-models",
        "env",
      ].map((id) => ({ id: id as "preferences", replace: true })),
    });

    expect(count(f.db, "SELECT COUNT(*) AS n FROM plugins")).toBe(0);
    expect(count(f.db, "SELECT COUNT(*) AS n FROM plugin_kv")).toBe(0);
    expect(
      count(f.db, "SELECT COUNT(*) AS n FROM thread_plugin_metadata"),
    ).toBe(0);
    expect(existsSync(join(f.target, "plugins"))).toBe(false);
  });

  it("adds no row for a folder plugin whose folder is not here, or one that needs a newer BB Studio", async () => {
    const f = await fixture();
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    let calls = 0;
    const installer = {
      install: async () => {
        calls += 1;
        return { id: "x" };
      },
      installPath: async () => {
        calls += 1;
        return { id: "x" };
      },
      reload: async () => undefined,
      remove: async () => true,
    };
    const args = {
      source: snap,
      target: f.db,
      sourceDataDir: f.source,
      dataDir: f.target,
      installer,
      appVersion: "1.0.0",
    };
    await expect(addPlugin({ ...args, id: "gone-tool" })).rejects.toThrow(
      /not found here/u,
    );
    await expect(addPlugin({ ...args, id: "future-tool" })).rejects.toThrow(
      /needs a newer BB Studio \(it asks for bb >=99\.0\.0\)/u,
    );
    expect(calls).toBe(0);
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM plugins WHERE id IN ('gone-tool', 'future-tool')",
      ),
    ).toBe(0);
    expect(
      await addPlugin({
        ...args,
        id: "future-tool",
        appVersion: "99.1.0",
      }).then(
        () => "added",
        (error: Error) => error.message,
      ),
    ).not.toMatch(/newer/u);
  });

  it("never copies bb's identity, sign-in secret or telemetry id, and leaves bb's files where they are", async () => {
    const f = await fixture();
    for (const name of ["auth-secret", "auth.json", "telemetry-id"]) {
      await writeFile(join(f.target, name), `studio-${name}`);
    }

    await run(f, {
      picks: [
        { kind: "project", id: f.ids.p1 },
        { kind: "project", id: f.ids.p2 },
      ],
      settings: [
        "preferences",
        "app-settings",
        "theme",
        "instructions",
        "skills",
        "custom-models",
        "env",
      ].map((id) => ({ id: id as "preferences", replace: true })),
    });

    for (const name of ["auth-secret", "auth.json", "telemetry-id"]) {
      expect(readFileSync(join(f.target, name), "utf8")).toBe(`studio-${name}`);
    }
    expect(readFileSync(join(f.target, "host-id"), "utf8")).toBe("host_here\n");
    expect(
      readFileSync(join(f.source, "pi-bridge-sessions", "thr_x.json"), "utf8"),
    ).toBe("pi");
    expect(existsSync(join(f.target, "pi-bridge-sessions"))).toBe(false);
  });

  it("never hands BB Studio bb's worktrees, so its cleanup can't touch them", async () => {
    const f = await fixture();
    const worktree = join(
      f.source,
      "plugins",
      "environment-git-worktree",
      "host-data",
      "worktrees",
      "k1",
      "repo",
    );
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, "work.txt"), "unsaved work");
    const bb = new Database(join(f.source, "bb.db"));
    const env = bb
      .prepare("SELECT * FROM environments WHERE id = ?")
      .get(f.ids.env1) as Record<string, unknown>;
    const managed = {
      ...env,
      id: "env_worktree",
      path: worktree,
      is_worktree: 1,
      provider_owns_path: 1,
      environment_provider_id: "git-worktree",
      environment_provider_plugin_id: "environment-git-worktree",
      owner_thread_id: f.ids.t3,
    };
    const names = Object.keys(managed);
    bb.prepare(
      `INSERT INTO environments (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")})`,
    ).run(managed);
    bb.prepare(
      "UPDATE threads SET environment_id = 'env_worktree', archived_at = 1 WHERE id = ?",
    ).run(f.ids.t3);
    bb.prepare(
      "UPDATE events SET environment_id = 'env_worktree' WHERE thread_id = ?",
    ).run(f.ids.t3);
    bb.close();
    const snapshot = await takeSourceSnapshot({
      dataDir: f.target,
      sourceDataDir: f.source,
      now: 9000,
    });

    await run(
      { ...f, snapshot },
      { picks: [{ kind: "thread", id: f.ids.t3 }] },
    );

    expect(
      f.db
        .prepare("SELECT environment_id FROM threads WHERE id = ?")
        .get(f.ids.t3),
    ).toEqual({ environment_id: null });
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM events WHERE thread_id = ? AND environment_id IS NOT NULL",
        f.ids.t3,
      ),
    ).toBe(0);
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM environments WHERE path LIKE ?",
        `${f.source}%`,
      ),
    ).toBe(0);
    const connection = createConnection(join(f.target, "bb.db"));
    try {
      for (const providerId of ["git-worktree", "environment-git-worktree"]) {
        expect(
          listProviderLifecycleEnvironments(connection, providerId, {
            pluginId: "environment-git-worktree",
            teardownMessage: "x",
          }),
        ).toEqual([]);
      }
    } finally {
      connection.$client.close();
    }
    expect(readFileSync(join(worktree, "work.txt"), "utf8")).toBe(
      "unsaved work",
    );
  });

  it("brings a plain project folder over as a folder BB Studio does not manage", async () => {
    const f = await fixture();
    await run(f, { picks: [{ kind: "thread", id: f.ids.t1 }] });
    expect(
      f.db
        .prepare(
          "SELECT environment_provider_id, provider_owns_path, owner_thread_id, retire_at, teardown_status FROM environments WHERE id = ?",
        )
        .get(f.ids.env1),
    ).toEqual({
      environment_provider_id: null,
      provider_owns_path: 0,
      owner_thread_id: null,
      retire_at: null,
      teardown_status: null,
    });
  });

  it("installs bb's exact git commit or npm version, and checks the manifest that was installed", async () => {
    const f = await fixture();
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    const fresh = join(f.root, "installed");
    await mkdir(fresh, { recursive: true });
    await writeFile(
      join(fresh, "package.json"),
      JSON.stringify({ engines: { bb: ">=0.1.0" } }),
    );
    const later = join(f.root, "installed-later");
    await mkdir(later, { recursive: true });
    await writeFile(
      join(later, "package.json"),
      JSON.stringify({ engines: { bb: ">=99.0.0" } }),
    );
    const sources: string[] = [];
    const removed: string[] = [];
    let answer: { id: string; rootDir: string } = {
      id: "pinned-git",
      rootDir: fresh,
    };
    let fail: Error | null = null;
    const installer = {
      install: async (source: string) => {
        if (fail) throw fail;
        sources.push(source);
        return answer;
      },
      installPath: async () => ({ id: "x" }),
      reload: async () => undefined,
      remove: async (id: string) => {
        removed.push(id);
        return true;
      },
    };
    const args = {
      source: snap,
      target: f.db,
      sourceDataDir: f.source,
      dataDir: f.target,
      installer,
      appVersion: "1.0.0",
    };

    expect(await addPlugin({ ...args, id: "pinned-git" })).toMatchObject({
      id: "pinned-git",
    });
    answer = { id: "pinned-npm", rootDir: fresh };
    expect(await addPlugin({ ...args, id: "pinned-npm" })).toMatchObject({
      id: "pinned-npm",
    });
    expect(sources).toEqual([
      "git:https://github.com/acme/pinned@abc1234567890abc1234567890abc1234567890a",
      "npm:acme-np@2.1.0",
    ]);

    const g = await fixture();
    const gsnap = openSnapshot(g.snapshot);
    open.push(gsnap);
    const gargs = {
      ...args,
      source: gsnap,
      target: g.db,
      sourceDataDir: g.source,
      dataDir: g.target,
    };
    answer = { id: "pinned-git", rootDir: later };
    await expect(addPlugin({ ...gargs, id: "pinned-git" })).rejects.toThrow(
      /was not added: it needs a newer BB Studio/u,
    );
    answer = { id: "tasks", rootDir: fresh };
    await expect(addPlugin({ ...gargs, id: "pinned-npm" })).rejects.toThrow(
      /installs as tasks, not pinned-npm/u,
    );
    expect(removed).toEqual(["pinned-git", "tasks"]);
    fail = new Error("reference is not a tree");
    await expect(addPlugin({ ...gargs, id: "pinned-git" })).rejects.toThrow(
      /bb's version of pinned-git \(commit abc123456789\) can't be installed: reference is not a tree/u,
    );
  });

  it("keeps BB Studio's own values for a plugin it had before, even when adding fails", async () => {
    const f = await fixture();
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    insertRow(f.db, "plugin_kv", {
      plugin_id: "acme-tool",
      key: "k",
      value: '"mine"',
      updated_at: 1,
    });
    insertRow(f.db, "plugin_kv", {
      plugin_id: "acme-tool",
      key: "only-mine",
      value: '"x"',
      updated_at: 1,
    });
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const installer = {
      install: async () => ({ id: "x" }),
      installPath: async () => {
        await gate;
        throw new Error("offline");
      },
      reload: async () => undefined,
      remove: async () => true,
    };
    const args = {
      source: snap,
      target: f.db,
      sourceDataDir: f.source,
      dataDir: f.target,
      installer,
      appVersion: "1.0.0",
      id: "acme-tool",
    };

    const first = addPlugin(args);
    await expect(addPlugin(args)).rejects.toThrow(/already being added/u);
    release();
    await expect(first).rejects.toThrow(/offline/u);

    expect(
      f.db
        .prepare(
          "SELECT key, value FROM plugin_kv WHERE plugin_id = 'acme-tool' ORDER BY key",
        )
        .all(),
    ).toEqual([
      { key: "k", value: '"mine"' },
      { key: "only-mine", value: '"x"' },
    ]);
  });

  it("hides every plugin the fork removed", () => {
    const removed = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../../scripts/fork/removed-plugins.json",
        ),
        "utf8",
      ),
    ) as { pluginId: string }[];
    for (const { pluginId } of removed)
      expect(HIDDEN_PLUGIN_IDS.has(pluginId)).toBe(true);
  });

  it("reads bb's database while bb keeps writing to it", async () => {
    const f = await fixture();
    const writer = spawn(
      process.execPath,
      [
        "-e",
        `const D = require(${JSON.stringify(createRequire(import.meta.url).resolve("better-sqlite3"))});
         const db = new D(${JSON.stringify(join(f.source, "bb.db"))});
         db.pragma("journal_mode = WAL"); db.pragma("busy_timeout = 1000");
         db.exec("CREATE TABLE IF NOT EXISTS zz_load (body BLOB)");
         const s = db.prepare("INSERT INTO zz_load VALUES (randomblob(4096))");
         for (let i = 0; i < 2000; i += 1) s.run();
         process.stdout.write("ready\\n");
         setInterval(() => { try { s.run(); } catch {} }, 2);`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    children.push(writer);
    await new Promise<void>((done) =>
      writer.stdout!.once("data", () => done()),
    );
    const snapshot = await takeSourceSnapshot({
      dataDir: f.target,
      sourceDataDir: f.source,
      now: 7000,
    });
    const copy = openSnapshot(snapshot);
    open.push(copy);
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
  }, 30_000);

  it("stops the database copy when the server that started it is gone", async () => {
    const f = await fixture();
    const jobs = [1, 2, 3].map((n) => ({
      from: join(f.source, "bb.db"),
      to: join(f.root, `copy-${String(n)}.db`),
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
    expect(
      await new Promise<number | null>((done) => child.once("exit", done)),
    ).toBe(1);
    expect(existsSync(jobs[2]!.to)).toBe(false);
    expect(readdirSync(f.root)).not.toContain("copy-3.db");
  });
});

describe("BB Studio data from bb", () => {
  const STUDIO_SCHEMA = `
    CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT, state TEXT, heartbeat_was_on INTEGER, thread_id TEXT, memory_page_id TEXT);
    CREATE TABLE pages (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE bot_runners (id TEXT PRIMARY KEY, state TEXT, thread_id TEXT);
    CREATE TABLE bot_automations (id TEXT PRIMARY KEY, state TEXT);
    CREATE TABLE bot_cache_settings (bot_id TEXT PRIMARY KEY, enabled INTEGER);
    CREATE TABLE memory_records (id TEXT PRIMARY KEY, text TEXT);
  `;

  async function studioFixture() {
    const f = await fixture();
    const bbStudio = join(f.source, "plugins", "studio");
    await mkdir(join(bbStudio, "artifacts"), { recursive: true });
    await mkdir(join(bbStudio, "secrets"), { recursive: true });
    await writeFile(join(bbStudio, "artifacts", "chart.png"), "png");
    await writeFile(join(bbStudio, "secrets", "key"), "bb-secret");
    const bb = new Database(join(bbStudio, "data.db"));
    bb.exec(STUDIO_SCHEMA);
    bb.prepare(
      "INSERT INTO bots VALUES ('bot_bb', 'Ada', 'active', 1, ?, 'pg_core_bb')",
    ).run(f.ids.t1);
    bb.prepare("INSERT INTO bot_runners VALUES ('run_1', 'active', ?)").run(
      f.ids.t2,
    );
    bb.exec(
      "INSERT INTO pages VALUES ('pg_core_bb', 'Ada core'), ('pg_notes', 'Notes'); INSERT INTO bot_automations VALUES ('auto_1', 'active'); INSERT INTO bot_cache_settings VALUES ('bot_bb', 1); INSERT INTO memory_records VALUES ('mem_1', 'likes tea')",
    );
    bb.close();
    const sourceDb = new Database(join(f.source, "bb.db"));
    insertRow(sourceDb, "plugin_kv", {
      plugin_id: "studio",
      key: "theme",
      value: '"forest"',
      updated_at: 1,
    });
    insertRow(sourceDb, "plugin_settings", {
      plugin_id: "studio",
      key: "loopsEnabled",
      value: "true",
      updated_at: 1,
    });
    sourceDb.close();
    const ours = join(f.target, "plugins", "studio");
    await mkdir(join(ours, "secrets"), { recursive: true });
    await writeFile(join(ours, "secrets", "key"), "studio-secret");
    const fresh = new Database(join(ours, "data.db"));
    fresh.exec(STUDIO_SCHEMA);
    fresh.exec(
      "INSERT INTO bots VALUES ('bot_new', 'Assistant', 'active', 0, NULL, 'pg_core_new'); INSERT INTO pages VALUES ('pg_core_new', 'Assistant core')",
    );
    fresh.close();
    insertRow(f.db, "plugin_kv", {
      plugin_id: "studio",
      key: "theme",
      value: '"default"',
      updated_at: 1,
    });
    const snapshot = await takeSourceSnapshot({
      dataDir: f.target,
      sourceDataDir: f.source,
      now: 8000,
    });
    const calls: string[] = [];
    let open = true;
    const controller = {
      setEnabled: async (id: string, enabled: boolean) => {
        calls.push(`${id}:${String(enabled)}`);
        open = enabled;
      },
      databaseOpen: () => open,
    };
    return { ...f, snapshot, ours, calls, controller, bbStudio };
  }

  const studioRows = (path: string, sql: string) => {
    const db = new Database(path, { readonly: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  };

  it("is offered only while BB Studio has no Bots, pages or tasks of its own", async () => {
    const f = await studioFixture();
    expect(await studioDataState(f.target, f.source)).toMatchObject({
      inBb: true,
      offered: true,
      reason: null,
      bots: 1,
      pages: 2,
    });
    const ours = new Database(join(f.ours, "data.db"));
    ours.exec("INSERT INTO pages VALUES ('pg_mine', 'Mine')");
    ours.close();
    expect(await studioDataState(f.target, f.source)).toMatchObject({
      offered: false,
      reason: "BB Studio already has Bots, pages or tasks of its own",
    });
    await expect(
      bringOverStudioData({
        dataDir: f.target,
        snapshot: f.snapshot,
        target: f.db,
        ourHostId: "host_here",
        controller: f.controller,
        now: 9000,
      }),
    ).rejects.toThrow(/of its own/u);
    expect(f.calls).toEqual([]);
  });

  it("brings bb's Studio data over whole, with its Bots' threads, stopped, and keeps BB Studio's secrets", async () => {
    const f = await studioFixture();

    const result = await bringOverStudioData({
      dataDir: f.target,
      snapshot: f.snapshot,
      target: f.db,
      ourHostId: "host_here",
      controller: f.controller,
      now: 9000,
    });

    expect(result).toEqual({ threads: 2, threadsHere: 0, bots: 1 });
    expect(f.calls).toEqual(["studio:false", "studio:true"]);
    const db = join(f.ours, "data.db");
    expect(
      studioRows(db, "SELECT id, state, heartbeat_was_on FROM bots"),
    ).toEqual([{ id: "bot_bb", state: "stopped", heartbeat_was_on: 0 }]);
    expect(studioRows(db, "SELECT state FROM bot_runners")).toEqual([
      { state: "paused" },
    ]);
    expect(studioRows(db, "SELECT state FROM bot_automations")).toEqual([
      { state: "paused" },
    ]);
    expect(studioRows(db, "SELECT enabled FROM bot_cache_settings")).toEqual([
      { enabled: 0 },
    ]);
    expect(readFileSync(join(f.ours, "artifacts", "chart.png"), "utf8")).toBe(
      "png",
    );
    expect(readFileSync(join(f.ours, "secrets", "key"), "utf8")).toBe(
      "studio-secret",
    );
    expect(
      JSON.parse(readFileSync(join(f.ours, "onboarding.json"), "utf8")),
    ).toMatchObject({ state: "done" });
    for (const id of [f.ids.t1, f.ids.t2]) {
      expect(
        count(f.db, "SELECT COUNT(*) AS n FROM threads WHERE id = ?", id),
      ).toBe(1);
    }
    expect(
      f.db
        .prepare("SELECT key, value FROM plugin_kv WHERE plugin_id = 'studio'")
        .all(),
    ).toEqual([{ key: "theme", value: '"forest"' }]);
    expect(
      f.db
        .prepare(
          "SELECT value FROM plugin_settings WHERE plugin_id = 'studio' AND key = 'loopsEnabled'",
        )
        .get(),
    ).toEqual({ value: "false" });
    const before = readdirSync(join(f.target, "fork-bring-over")).find((name) =>
      name.startsWith("studio-"),
    )!;
    expect(
      studioRows(
        join(f.target, "fork-bring-over", before, "before", "data.db"),
        "SELECT id FROM bots",
      ),
    ).toEqual([{ id: "bot_new" }]);
    expect(await studioDataState(f.target, f.source)).toMatchObject({
      offered: false,
    });
  });

  it("changes nothing when BB Studio's data does not close, and turns Studio back on", async () => {
    const f = await studioFixture();
    const stuck = { ...f.controller, databaseOpen: () => true };

    await expect(
      bringOverStudioData({
        dataDir: f.target,
        snapshot: f.snapshot,
        target: f.db,
        ourHostId: "host_here",
        controller: stuck,
        now: 9000,
      }),
    ).rejects.toThrow(/did not close in time/u);

    expect(f.calls).toEqual(["studio:false", "studio:true"]);
    expect(studioRows(join(f.ours, "data.db"), "SELECT id FROM bots")).toEqual([
      { id: "bot_new" },
    ]);
    expect(existsSync(join(f.ours, "artifacts"))).toBe(false);
    expect(
      f.db
        .prepare("SELECT value FROM plugin_kv WHERE plugin_id = 'studio'")
        .all(),
    ).toEqual([{ value: '"default"' }]);
    expect(
      readdirSync(join(f.target, "fork-bring-over")).filter((name) =>
        name.startsWith("studio-"),
      ),
    ).toEqual([]);
  }, 20_000);

  it("changes nothing in Studio when a Bot's thread can't come over", async () => {
    const f = await studioFixture();
    f.db.exec(
      `CREATE TRIGGER fail_bot_thread BEFORE INSERT ON events WHEN NEW.thread_id = '${f.ids.t1}' BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );

    await expect(
      bringOverStudioData({
        dataDir: f.target,
        snapshot: f.snapshot,
        target: f.db,
        ourHostId: "host_here",
        controller: f.controller,
        now: 9000,
      }),
    ).rejects.toThrow(/could not be brought over/u);

    expect(f.calls).toEqual([]);
    expect(studioRows(join(f.ours, "data.db"), "SELECT id FROM bots")).toEqual([
      { id: "bot_new" },
    ]);
    expect(existsSync(join(f.ours, "artifacts"))).toBe(false);
  });
});

describe("bring-over API and review fixes", () => {
  const TOKEN = "t".repeat(40);
  afterEach(() => {
    resetUiTokenForTests();
    delete process.env.BB_STUDIO_IMPORT_FROM;
    eventChunking.threshold = 5_000;
    eventChunking.size = 2_000;
  });

  function app(f: Fixture, lines: unknown[] = []) {
    process.env.BB_STUDIO_IMPORT_FROM = f.source;
    const hono = new Hono();
    hono.onError((error) =>
      error instanceof HTTPException
        ? error.getResponse()
        : new Response(String(error), { status: 500 }),
    );
    const deps = {
      db: { $client: f.db },
      logger: {
        info: (...args: unknown[]) => lines.push(args),
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      config: { appVersion: "1.0.0" },
    } as unknown as AppDeps;
    const installer = {
      install: async () => ({ id: "x" }),
      installPath: async () => ({ id: "x" }),
      reload: async () => undefined,
      remove: async () => true,
      setEnabled: async () => undefined,
      listOpenPluginDatabases: () => [],
    };
    registerBringOverRoutes(hono, deps, () => f.target, installer);
    return hono;
  }
  const post = (body: unknown, headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  it("takes the app's token once, and refuses agents and calls without it", async () => {
    const f = await fixture();
    const lines: unknown[] = [];
    const api = app(f, lines);
    expect(
      (await api.request("/fork/bring-over/ui-token", post({ token: "short" })))
        .status,
    ).toBe(409);
    expect(
      (await api.request("/fork/bring-over/ui-token", post({ token: TOKEN })))
        .status,
    ).toBe(204);
    expect(
      (
        await api.request(
          "/fork/bring-over/ui-token",
          post({ token: "u".repeat(40) }),
        )
      ).status,
    ).toBe(409);
    const pick = { picks: [{ kind: "project", id: f.ids.p1 }] };

    expect(
      (await api.request("/fork/bring-over/jobs", post(pick))).status,
    ).toBe(403);
    expect(
      (
        await api.request(
          "/fork/bring-over/jobs",
          post(pick, { "x-bb-studio-ui-token": "u".repeat(40) }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api.request(
          "/fork/bring-over/jobs",
          post(pick, {
            "x-bb-studio-ui-token": TOKEN,
            "x-bb-caller-thread": "thr_agent",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api.request(
          "/fork/bring-over/jobs",
          post(pick, { "x-bb-studio-ui-token": TOKEN, "x-bb-cli": "1" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await api.request("/fork/bring-over/plugins/acme-tool/add", post({})))
        .status,
    ).toBe(403);
    expect(
      (await api.request("/fork/bring-over/studio-data", post({}))).status,
    ).toBe(403);
    expect(count(f.db, "SELECT COUNT(*) AS n FROM threads")).toBe(0);
    expect(
      lines.filter(
        (line) => (line as [unknown, string])[1] === "Bring-over request",
      ),
    ).toHaveLength(6);
    expect((lines[0] as [{ allowed: boolean }])[0].allowed).toBe(false);

    expect(
      (
        await api.request(
          "/fork/bring-over/jobs",
          post({ picks: "all" }, { "x-bb-studio-ui-token": TOKEN }),
        )
      ).status,
    ).toBe(400);
    const [first, second] = await Promise.all([
      api.request(
        "/fork/bring-over/jobs",
        post(pick, { "x-bb-studio-ui-token": TOKEN }),
      ),
      api.request(
        "/fork/bring-over/jobs",
        post(pick, { "x-bb-studio-ui-token": TOKEN }),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    await bringOverJobFinished(f.target);
    expect(count(f.db, "SELECT COUNT(*) AS n FROM threads")).toBe(2);
  });

  it("answers a light summary without reading bb's listing", async () => {
    const f = await fixture();
    const body = (await (
      await app(f).request("/fork/bring-over?summary=1")
    ).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      available: true,
      sourceDataDir: f.source,
      job: null,
    });
    expect(body.projects).toBeUndefined();
  });

  it("fails a job whose copy of bb can't be opened, and lets the next one start", async () => {
    const f = await fixture();
    await rm(f.snapshot.snapshotPath, { force: true });
    const job = startBringOverJob({
      dataDir: f.target,
      snapshot: f.snapshot,
      target: f.db,
      request: { picks: [], attachments: true, settings: [] },
      logger,
      now: 1,
    });
    await bringOverJobFinished(f.target);
    expect(job).toMatchObject({ state: "failed" });
    expect(job!.failures[0]!.detail).toMatch(/could not be opened/u);
    const next = await run(f, { picks: [{ kind: "thread", id: f.ids.t1 }] });
    expect(next.state).toBe("done");
  });

  it("keeps the copy of bb's database private and short-lived", async () => {
    const f = await fixture();
    expect(statSync(f.snapshot.snapshotPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(f.target, "fork-bring-over")).mode & 0o777).toBe(
      0o700,
    );
    expect(
      await existingSourceSnapshot(
        f.target,
        f.source,
        Date.now() + 2 * 60 * 60_000,
      ),
    ).toBeNull();
    expect(existsSync(f.snapshot.snapshotPath)).toBe(false);
    const again = await takeSourceSnapshot({
      dataDir: f.target,
      sourceDataDir: f.source,
      now: 2,
    });
    await run(
      { ...f, snapshot: again },
      { picks: [{ kind: "thread", id: f.ids.t1 }] },
    );
    expect(existsSync(again.snapshotPath)).toBe(false);
  });

  it("copies a large thread's events in chunks, and takes a failed one back out", async () => {
    eventChunking.threshold = 1;
    eventChunking.size = 1;
    const f = await fixture();
    await run(f, { picks: [{ kind: "thread", id: f.ids.t1 }] });
    expect(
      count(
        f.db,
        "SELECT COUNT(*) AS n FROM events WHERE thread_id = ?",
        f.ids.t1,
      ),
    ).toBe(3);
    expect(
      f.db.prepare("SELECT deleted_at FROM threads WHERE id = ?").get(f.ids.t1),
    ).toEqual({ deleted_at: null });

    const g = await fixture();
    const sequence = (g.db.prepare("SELECT 1").get(), 2);
    g.db.exec(
      `CREATE TRIGGER fail_late BEFORE INSERT ON events WHEN NEW.thread_id = '${g.ids.t1}' AND NEW.sequence = ${String(sequence)} BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );
    const job = await run(g, { picks: [{ kind: "thread", id: g.ids.t1 }] });
    expect(job.state).toBe("failed");
    expect(
      count(g.db, "SELECT COUNT(*) AS n FROM threads WHERE id = ?", g.ids.t1),
    ).toBe(0);
    expect(
      count(
        g.db,
        "SELECT COUNT(*) AS n FROM events WHERE thread_id = ?",
        g.ids.t1,
      ),
    ).toBe(0);
    expect(
      existsSync(join(g.target, "thread-storage", g.ids.t1, "note.txt")),
    ).toBe(false);
  });

  it("skips an attachment whose project id would leave the attachments folder", async () => {
    const f = await fixture();
    const bb = new Database(join(f.source, "bb.db"));
    bb.pragma("foreign_keys = OFF");
    insertRow(bb, "project_attachments", {
      id: "att_bad",
      project_id: "../../escape",
      stored_path: "x.png",
      size_bytes: 1,
      deletion_claimed_at: null,
    });
    insertRow(bb, "project_attachment_threads", {
      attachment_id: "att_bad",
      thread_id: f.ids.t1,
    });
    bb.close();
    await mkdir(join(f.source, "escape"), { recursive: true });
    await writeFile(join(f.source, "escape", "x.png"), "x");
    const snapshot = await takeSourceSnapshot({
      dataDir: f.target,
      sourceDataDir: f.source,
      now: 3,
    });
    await run(
      { ...f, snapshot },
      { picks: [{ kind: "thread", id: f.ids.t1 }] },
    );
    expect(
      existsSync(join(f.target, "attachments", "..", "..", "escape", "x.png")),
    ).toBe(false);
    expect(
      readFileSync(join(f.target, "attachments", f.ids.p1, "one.png"), "utf8"),
    ).toBe("png");
  });

  it("brings only well-formed custom models and leaves this Mac's update and safe-mode state", async () => {
    const f = await fixture();
    await writeFile(
      join(f.source, "config.json"),
      JSON.stringify({
        customModels: [
          { providerId: "codex", model: "gpt-x" },
          { providerId: "codex", model: "gpt-y", apiKey: "sk-nope" },
        ],
      }),
    );
    const bb = new Database(join(f.source, "bb.db"));
    insertRow(bb, "app_settings_values", {
      key: "pluginSafeMode",
      value: "true",
      updated_at: 1,
    });
    insertRow(bb, "app_settings_values", {
      key: "keybindingOverrides",
      value: "{}",
      updated_at: 1,
    });
    bb.close();
    const snapshot = await takeSourceSnapshot({
      dataDir: f.target,
      sourceDataDir: f.source,
      now: 4,
    });
    const snap = openSnapshot(snapshot);
    open.push(snap);
    for (const id of ["custom-models", "app-settings"] as const) {
      await applySetting({
        id,
        replace: false,
        source: snap,
        target: f.db,
        sourceDataDir: f.source,
        dataDir: f.target,
      });
    }
    expect(
      JSON.parse(readFileSync(join(f.target, "config.json"), "utf8"))
        .customModels,
    ).toEqual([{ providerId: "codex", model: "gpt-x" }]);
    expect(
      f.db
        .prepare(
          "SELECT key FROM app_settings_values WHERE key IN ('pluginSafeMode', 'keybindingOverrides')",
        )
        .all(),
    ).toEqual([{ key: "keybindingOverrides" }]);
  });

  it("says a linked skills folder is not copied, and copies nothing from it", async () => {
    const f = await fixture();
    const elsewhere = join(f.root, "my-skills");
    await mkdir(join(elsewhere, "one"), { recursive: true });
    await writeFile(join(elsewhere, "one", "SKILL.md"), "s");
    symlinkSync(elsewhere, join(f.source, "skills"));
    expect(lstatSync(join(f.source, "skills")).isSymbolicLink()).toBe(true);
    const snap = openSnapshot(f.snapshot);
    open.push(snap);
    expect(
      (await listSettings(snap, f.source)).find((item) => item.id === "skills"),
    ).toMatchObject({ count: 0, detail: expect.stringContaining("is a link") });
    await expect(
      applySetting({
        id: "skills",
        replace: false,
        source: snap,
        target: f.db,
        sourceDataDir: f.source,
        dataDir: f.target,
      }),
    ).rejects.toThrow(/is a link/u);
    expect(existsSync(join(f.target, "skills"))).toBe(false);
  });
});

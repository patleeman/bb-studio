import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { turnScope } from "@bb/domain";
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
  const job = startBringOverJob({
    dataDir: f.target,
    snapshot: f.snapshot,
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
    expect(settings.map((item) => item.id)).toContain("instructions");
    const plugins = await listPlugins(snap, f.db, f.source);
    expect(
      plugins.map(({ id, hasData, sourceMissing, here }) => ({
        id,
        hasData,
        sourceMissing,
        here,
      })),
    ).toEqual([
      { id: "acme-tool", hasData: true, sourceMissing: false, here: false },
      { id: "gone-tool", hasData: false, sourceMissing: true, here: false },
      { id: "remote-thing", hasData: false, sourceMissing: false, here: false },
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
    expect(count(f.db, "SELECT COUNT(*) AS n FROM events")).toBe(events);
    const snap = openSnapshot(f.snapshot);
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
    };
    const args = {
      source: snap,
      target: f.db,
      sourceDataDir: f.source,
      dataDir: f.target,
      installer,
    };

    await expect(addPlugin({ ...args, id: "gone-tool" })).rejects.toThrow(
      /not there any more/u,
    );
    await expect(addPlugin({ ...args, id: "remote-thing" })).rejects.toThrow(
      /could not be installed from github:acme\/remote-thing: repository not found/u,
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
      (await listPlugins(snap, f.db, f.source)).map((plugin) => plugin.id),
    ).not.toContain("studio");
    const installer = {
      install: async () => ({ id: "x" }),
      installPath: async () => ({ id: "x" }),
      reload: async () => undefined,
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

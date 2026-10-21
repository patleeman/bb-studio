import Database from "better-sqlite3";
import { mkdtemp, mkdir, writeFile, readFile, readlink, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS, WorkspaceStore } from "./store";
import { copyCodeFiles, rebuildPaths } from "./import-files";
import { registerCodeImport } from "./migration";
import { workspaceRow, commentRow } from "../../kit/code-import-contract";

vi.mock("@bb-studio/kit/code-handover", () => ({ quiesceCode: vi.fn(async () => {}) }));
vi.mock("../../kit/code-handover", () => ({ quiesceCode: vi.fn(async () => {}) }));

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "code-upgrade-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "studio-code"), target = join(directory, "studio", "code");
  await mkdir(source, { recursive: true }); await mkdir(dirname(target), { recursive: true });
  return { directory, source, target };
}
const caller = { experimental_caller: { kind: "plugin" as const, pluginId: "studio-code" } };
async function setup() {
  const files = await fixture();
  const host = createFakePluginHost({ pluginId: "studio", sdk: { plugins: { list: async () => ({ plugins: [{ id: "studio-code", version: "0.2.0", enabled: true }] }) as never } } });
  const db = new Database(join(files.directory, "studio", "plugin.sqlite"));
  for (const sql of MIGRATIONS) db.exec(sql);
  cleanup.push(async () => { db.close(); await host.harness.lifecycle.dispose(); });
  const refreshed = vi.fn(async () => {});
  const migration = registerCodeImport(host.bb, db, files.target, refreshed);
  const call = (method: string, input: unknown) => host.harness.behavior.callRpc(method, input, caller);
  return { ...files, ...host, db, migration, refreshed, call };
}

test("copies tables and theme with ids, review associations and times intact; retries keep destination data", async () => {
  const { call, migration, db, source, bb, refreshed } = await setup();
  const inputDb = new Database(":memory:");
  for (const sql of MIGRATIONS) inputDb.exec(sql);
  const store = new WorkspaceStore(inputDb);
  const row = store.create({ title: "Workspace", folders: ["/project"], projectId: "proj_1", threadId: "thr_1" });
  store.setReviewThread(row.id, "thr_review"); store.markOpened(row.id);
  const workspace = workspaceRow.parse(inputDb.prepare("SELECT * FROM code_workspaces").get()); inputDb.close();
  const comment = commentRow.parse({ id: "comment1", workspace_id: row.id, parent_id: null, path: "/project/a.ts", start_line: 1, end_line: 2, line_text: "saved", author: "user", body: "Review", sent_to: "thr_1", sent_at: 20, resolved_at: 30, created_at: 10 });
  await expect(migration.requireReady()).rejects.toThrow("not finished");
  await expect(call("code.importRows", { workspaces: [workspace], comments: [comment] })).rejects.toThrow("files before");
  await bb.storage.kv.set("code:theme", { destination: true });
  await call("code.importFiles", { sourceRoot: source, theme: null });
  expect(refreshed).toHaveBeenCalledOnce();
  expect(await call("code.importRows", { workspaces: [workspace], comments: [comment] })).toEqual({ workspaces: [row.id], comments: ["comment1"] });
  expect(db.prepare("SELECT * FROM code_workspaces").get()).toEqual(workspace);
  expect(db.prepare("SELECT * FROM code_comments").get()).toEqual(comment);
  db.prepare("UPDATE code_workspaces SET title='Studio choice'").run();
  await call("code.importRows", { workspaces: [workspace], comments: [comment] });
  expect(new WorkspaceStore(db).get(row.id)?.title).toBe("Studio choice");
  await call("code.finishImport", null);
  await expect(migration.requireReady()).resolves.toBeUndefined();
  expect(await bb.storage.kv.get("code:theme")).toEqual({ destination: true });
});

test("only the bridge may copy, and it cannot name another source directory", async () => {
  const { harness, call, source, target } = await setup();
  await expect(harness.behavior.callRpc("code.importFiles", { sourceRoot: source, theme: null })).rejects.toThrow("Only the Studio Code");
  await expect(call("code.importFiles", { sourceRoot: target, theme: null })).rejects.toThrow("Unexpected");
  await expect(call("code.finishImport", null)).rejects.toThrow("not been copied");
});

test("retries a partial file import before acknowledging; existing files and source recovery stay untouched", async () => {
  const { source, target, call, bb, migration } = await setup();
  await mkdir(join(source, "workspaces", "cws_1"), { recursive: true });
  await writeFile(join(source, "workspaces", "cws_1", "draft"), "unsaved");
  await symlink("/outside", join(source, "workspaces", "cws_1", "external"));
  const reference = join(source, "workspaces", "cws_1", "linked-extension");
  const external = join(dirname(source), "local-extension");
  await symlink(relative(dirname(reference), external), reference);
  const set = bb.storage.kv.set.bind(bb.storage.kv);
  let interrupted = true;
  vi.spyOn(bb.storage.kv, "set").mockImplementation(async (key, value) => {
    if (key === "code:files-imported" && interrupted) { interrupted = false; throw new Error("temporary failure"); }
    return set(key, value);
  });
  await expect(call("code.importFiles", { sourceRoot: source, theme: null })).rejects.toThrow("temporary failure");
  await expect(migration.requireReady()).rejects.toThrow();
  expect(await bb.storage.kv.get("code:files-imported")).toBeUndefined();
  expect(await readlink(join(target, "workspaces", "cws_1", "external"))).toBe("/outside");
  const copiedReference = reference.replace(source, target);
  expect(resolve(dirname(copiedReference), await readlink(copiedReference))).toBe(external);
  await mkdir(join(target, "workspaces", "cws_1"), { recursive: true });
  await writeFile(join(target, "workspaces", "cws_1", "draft"), "destination draft");
  await call("code.importFiles", { sourceRoot: source, theme: null });
  expect(await readFile(join(target, "workspaces", "cws_1", "draft"), "utf8")).toBe("destination draft");
  expect(await readFile(join(source, "workspaces", "cws_1", "draft"), "utf8")).toBe("unsaved");
});

test("rebuilds recovery paths, SQLite state, workspace-storage identity and runtime symlinks, keeping modes and binary bytes", async () => {
  const { source, target } = await fixture();
  const oldFile = join(source, "workspaces", "cws_1", "Repo.code-workspace");
  const uri = pathToFileURL(oldFile).href;
  const storage = join(source, "workspaces", "cws_1", "user-data", "User", "workspaceStorage", createHash("md5").update(uri).digest("hex"));
  await mkdir(storage, { recursive: true });
  await writeFile(join(storage, "workspace.json"), JSON.stringify({ workspace: uri }));
  await writeFile(oldFile, JSON.stringify({ folders: [{ path: "/project" }] }));
  const state = new Database(join(storage, "state.vscdb"));
  state.pragma("journal_mode=WAL"); state.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  state.prepare("INSERT INTO ItemTable VALUES (?, ?)").run("editor", Buffer.from(JSON.stringify({ resource: uri })));
  state.prepare("INSERT INTO ItemTable VALUES (?, ?)").run("binary", Buffer.from([0, 255, 42]));
  const recovery = join(source, "workspaces", "cws_1", "user-data", "Backups");
  const backupId = createHash("md5").update(oldFile.toLowerCase()).digest("hex");
  await mkdir(join(recovery, backupId), { recursive: true });
  await writeFile(join(recovery, backupId, "draft"), "untitled draft");
  await writeFile(join(recovery, "workspaces.json"), JSON.stringify({ id: backupId, path: oldFile, uri, encoded: encodeURIComponent(oldFile) }));
  await mkdir(join(source, "code-server", "bin"), { recursive: true });
  const binary = Buffer.from([0, 255, 1, 42]);
  await writeFile(join(source, "code-server", "bin", "node"), binary, { mode: 0o755 });
  await symlink("bin/node", join(source, "code-server", "node"));
  try { await copyCodeFiles(source, target); } finally { state.close(); }
  const newUri = uri.replace(source, target);
  const newStorage = storage.replace(source, target).replace(createHash("md5").update(uri).digest("hex"), createHash("md5").update(newUri).digest("hex"));
  expect(JSON.parse(await readFile(join(newStorage, "workspace.json"), "utf8"))).toEqual({ workspace: newUri });
  const copied = new Database(join(newStorage, "state.vscdb"));
  expect((copied.prepare("SELECT value FROM ItemTable WHERE key='editor'").get() as { value: Buffer }).value.toString()).toContain(newUri);
  expect((copied.prepare("SELECT value FROM ItemTable WHERE key='binary'").get() as { value: Buffer }).value).toEqual(Buffer.from([0, 255, 42])); copied.close();
  expect(await readFile(join(target, "code-server", "node"))).toEqual(binary);
  expect((await stat(join(target, "code-server", "node"))).mode & 0o777).toBe(0o755);
  const backupMetadata = await readFile(join(recovery.replace(source, target), "workspaces.json"), "utf8");
  expect(backupMetadata).not.toContain(source);
  const rebuiltBackupId = createHash("md5").update(oldFile.replace(source, target).toLowerCase()).digest("hex");
  expect(JSON.parse(backupMetadata).id).toBe(rebuiltBackupId);
  expect(await readFile(join(recovery.replace(source, target), rebuiltBackupId, "draft"), "utf8")).toBe("untitled draft");
  await writeFile(join(target, "code-server", "bin", "node"), "new runtime");
  await copyCodeFiles(source, target);
  expect(await readFile(join(target, "code-server", "bin", "node"), "utf8")).toBe("new runtime");
});

test("does not rewrite similarly named roots or project paths", () => {
  expect(rebuildPaths('/old/code/workspaces/x /old/code-other /project/a', '/old/code', '/new/code')).toBe('/new/code/workspaces/x /old/code-other /project/a');
});

test("copies the old theme once and preserves the user's Studio theme on retry", async () => {
  const { source, call, bb } = await setup();
  const { BB_THEME_VARIABLES } = await import("../../kit/code-theme");
  const theme = { mode: "dark", colors: Object.fromEntries(BB_THEME_VARIABLES.map((name) => [name, "#123456"])) };
  await call("code.importFiles", { sourceRoot: source, theme });
  expect(await bb.storage.kv.get("code:theme")).toEqual(theme);
  const chosen = { ...theme, mode: "light" };
  await bb.storage.kv.set("code:theme", chosen);
  await call("code.importFiles", { sourceRoot: source, theme });
  expect(await bb.storage.kv.get("code:theme")).toEqual(chosen);
});

test("the real bridge and Studio importer complete a path upgrade together", async () => {
  const destination = await setup();
  const { source, target, db, harness, migration } = destination;
  const sourceDb = new Database(join(source, "plugin.sqlite"));
  const bridge = createFakePluginHost({ pluginId: "studio-code", sdk: { plugins: {
    callRpc: async ({ method, input }) => harness.behavior.callRpc(method, input, caller) as never,
  } } });
  cleanup.push(async () => { sourceDb.close(); await bridge.harness.lifecycle.dispose(); });
  vi.spyOn(bridge.bb.storage, "database").mockReturnValue(sourceDb);
  // Import as a separate package, as two independent Git installs do.
  const { default: registerBridge } = await import("../../../../bb-studio-code/server");
  registerBridge(bridge.bb);
  const original = new WorkspaceStore(sourceDb).create({ title: "Repo", folders: ["/project"], projectId: "proj_1", threadId: "thr_1" });
  await mkdir(join(source, "workspaces", original.id, "user-data"), { recursive: true });
  await writeFile(join(source, "workspaces", original.id, "user-data", "draft"), "unsaved text");
  await expect(migration.requireReady()).rejects.toThrow();
  expect(await bridge.harness.behavior.runCli(["migrate"])).toMatchObject({ exitCode: 0 });
  await expect(migration.requireReady()).resolves.toBeUndefined();
  expect(new WorkspaceStore(db).get(original.id)).toEqual(original);
  expect(await readFile(join(target, "workspaces", original.id, "user-data", "draft"), "utf8")).toBe("unsaved text");
  expect(await bridge.harness.behavior.callRpc("migrationStatus", null)).toEqual({ complete: true });
});

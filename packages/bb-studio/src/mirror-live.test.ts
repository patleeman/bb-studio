import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { workerStatus, type ThreadFacts } from "./bot-threads";
import { overlayMirrorLive, readMirrorLive } from "./mirror-live";
import { waitingOn, type Interaction } from "./worker-approvals";

let root: string;
let dataDir: string;
let sourceDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mirror-live-"));
  dataDir = join(root, "studio");
  sourceDir = join(root, "bb");
  mkdirSync(dataDir);
  mkdirSync(sourceDir);
  writeFileSync(join(dataDir, "fork-import.json"), JSON.stringify({ version: 1, sourceDataDir: sourceDir, importedAt: 1 }));
  const fork = new Database(join(dataDir, "fork-import.db"));
  fork.exec("CREATE TABLE mirrored_threads (thread_id TEXT PRIMARY KEY, source_updated_at INTEGER NOT NULL, source_status TEXT NOT NULL, taken_over_at INTEGER)");
  const mirror = fork.prepare("INSERT INTO mirrored_threads VALUES (?, 1, 'idle', ?)");
  for (const id of ["running", "approval", "question", "failed", "done"]) mirror.run(id, null);
  mirror.run("taken", 5);
  fork.close();
  const bb = new Database(join(sourceDir, "bb.db"));
  bb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE pending_interactions (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL)");
  const thread = bb.prepare("INSERT INTO threads VALUES (?, ?, ?)");
  thread.run("running", "active", 900);
  thread.run("approval", "active", 900);
  thread.run("question", "idle", 900);
  thread.run("failed", "error", 900);
  thread.run("done", "idle", 50);
  thread.run("taken", "active", 900);
  const pending = bb.prepare("INSERT INTO pending_interactions VALUES (?, ?, ?, ?)");
  pending.run("int_a", "approval", "pending", JSON.stringify({ kind: "approval", subject: { kind: "command", command: "make" } }));
  pending.run("int_q", "question", "pending", JSON.stringify({ kind: "question" }));
  pending.run("int_old", "done", "resolved", JSON.stringify({ kind: "question" }));
  bb.close();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const copy = (id: string): ThreadFacts => ({ id, status: "idle", hasPendingInteraction: false, updatedAt: 100 });

it("reads bb's live state of mirrored threads only, and the copies show it: running, waiting, failed, done", () => {
  const ids = ["running", "approval", "question", "failed", "done", "taken", "local"];
  const live = readMirrorLive(dataDir, ids);
  expect([...live.keys()].sort()).toEqual(["approval", "done", "failed", "question", "running"]);
  const threads = overlayMirrorLive(new Map(ids.map((id) => [id, copy(id)])), live);
  expect(Object.fromEntries(ids.map((id) => [id, workerStatus(threads.get(id))]))).toEqual({
    running: "running", approval: "needs-you", question: "needs-you", failed: "failed", done: "done", taken: "done", local: "done",
  });
  expect(waitingOn(threads.get("approval")!.mirroredPending as Interaction[])).toBe("approval");
  expect(waitingOn(threads.get("question")!.mirroredPending as Interaction[])).toBe("question");
  // bb's newer change counts as activity; an older one doesn't move the copy back.
  expect(threads.get("running")!.updatedAt).toBe(900);
  expect(threads.get("done")!.updatedAt).toBe(100);
});

it("is empty without an import or when bb's data is gone", () => {
  expect(readMirrorLive(join(root, "nowhere"), ["running"]).size).toBe(0);
  rmSync(join(sourceDir, "bb.db"));
  expect(readMirrorLive(dataDir, ["running"]).size).toBe(0);
});

it("the store's facts carry bb's live state, so the sidebar and a worker's page agree with bb", async () => {
  const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
  const { BotThreads } = await import("./bot-threads");
  const { MIGRATIONS } = await import("./migrations");
  const copies = ["running", "local"].map(copy);
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: (async () => copies) as never } } });
  try {
    const db = bb.storage.database();
    bb.storage.migrate(db, MIGRATIONS);
    const signals = { bots: [], focusedBotId: null, sideThread: () => null, runnerBot: () => null, leadThreads: new Set<string>(), internal: new Set<string>(), managedBot: () => null };
    const store = new BotThreads({ db, sdk: bb.sdk, signals: () => signals, changed: () => {}, mirrorLive: (ids) => readMirrorLive(dataDir, ids) });
    const facts = await store.facts(["running", "local"]);
    expect(facts.get("running")?.status).toBe("active");
    expect(facts.get("local")?.status).toBe("idle");
  } finally {
    await harness.lifecycle.dispose();
  }
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runBackup, runRestore } from "../../kit/server/index";
import { applyOps } from "../ops";
import { memoryStore } from "../test/host";
import { createDashboardBackup } from "./backup";
import { scriptHash } from "./sources";

it("restores version 1 backups through source cleanup without importing approval or losing pushed values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-backup-"));
  const source = memoryStore(() => 1000);
  const target = memoryStore(() => 2000);
  try {
    const row = source.store.create({ name: "Ops", by: "user" });
    let n = 0;
    const doc = applyOps(source.store.doc(row.id), [
      { op: "add", type: "stat", source: { kind: "url", url: "https://example.com/a" } },
      { op: "add", type: "stat", source: { kind: "script", command: "echo 7" } },
      { op: "add", type: "stat", source: { kind: "push" } },
    ], { newId: () => `w${++n}`, hasType: () => false }).doc;
    source.store.write(row.id, doc, "agent", "seed");
    source.store.setValue(row.id, "w1", "fetched A");
    source.store.setValue(row.id, "w3", 42);
    source.store.approve(row.id, "w2", scriptHash({ command: "echo 7" }), "echo 7", null);
    const handlers = (t: typeof source) => createDashboardBackup({ ...t, changed: () => {} });
    const backupDir = join(dir, "backup");
    await runBackup(backupDir, handlers(source));
    const restore = () => runRestore(backupDir, handlers(target), { version: 1, dryRun: false, projects: {} });
    expect(await restore()).toMatchObject({ created: 1, failed: 0 });
    expect(target.store.dataFor(row.id, "w1")).toBeNull();
    expect(target.store.dataFor(row.id, "w3")?.value).toBe("42");
    expect(target.store.commandApproved(row.id, scriptHash({ command: "echo 7" }))).toBe(false);

    const local = target.store.doc(row.id);
    local.widgets[0]!.source = { kind: "url", url: "https://example.com/b" };
    local.widgets[1]!.source = { kind: "script", command: "echo 8" };
    target.store.write(row.id, local, "agent", "edit");
    target.store.setValue(row.id, "w1", "fetched B");
    target.db.prepare("UPDATE dashboards SET updated_at = 1 WHERE id = ?").run(row.id);
    expect(await restore()).toMatchObject({ updated: 1, failed: 0 });
    expect(target.store.dataFor(row.id, "w1")).toBeNull();
    expect(target.store.proposal(row.id, "w2", scriptHash({ command: "echo 7" }))).toMatchObject({ actor: "user", thread_id: null });
    expect(target.store.dataFor(row.id, "w3")?.value).toBe("42");
  } finally {
    source.db.close(); target.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

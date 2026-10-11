import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackup, runRestore } from "@bb-studio/kit/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { bytes, memoryStore } from "../test/db";
import { artifactBackupHandlers } from "./backup";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "artifacts-backup-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const file = (text: string, extra: Record<string, unknown> = {}) => ({
  name: "report.md",
  mime: "text/markdown",
  bytes: bytes(text),
  projectId: "proj_a",
  sourceThreadId: "thr_1",
  sourcePath: "/work/report.md",
  by: "agent" as const,
  ...extra,
});

function setup(now?: () => number) {
  const { db, store } = memoryStore(now);
  const changed: string[] = [];
  return { db, store, changed, handlers: artifactBackupHandlers(z, { db, store, changed: (id) => changed.push(id) }) };
}

/** A source store with one two-version artifact and one global image. */
async function backedUp() {
  let clock = 1_000;
  const source = setup(() => (clock += 10));
  const first = source.store.save(file("one", { title: "Report" })).artifact;
  source.store.save(file("two"));
  const image = source.store.save(file("\u0089PNG", { name: "a.png", mime: "image/png", projectId: null, sourceThreadId: null, sourcePath: null })).artifact;
  source.store.setArchived(image.id, true);
  const dir = join(root, "section");
  const result = await runBackup(dir, source.handlers);
  return { dir, result, source, reportId: first.id, imageId: image.id };
}

const restore = (dir: string, handlers: ReturnType<typeof setup>["handlers"], options: { dryRun?: boolean; projects?: Record<string, string | null> } = {}) =>
  runRestore(dir, handlers, { dryRun: options.dryRun ?? false, version: 1, projects: options.projects ?? { proj_a: "proj_b" } });

describe("artifacts backup", () => {
  it("writes one JSON per artifact and one file per version", async () => {
    const { dir, result, reportId } = await backedUp();
    expect(result).toMatchObject({ version: 1, counts: { artifacts: 2, versions: 3 }, files: 5 });
    expect(result.notes.join(" ")).toMatch(/thread/);
    expect((await readdir(join(dir, "items"))).length).toBe(2);
    const item = JSON.parse(await readFile(join(dir, "items", `${reportId}.json`), "utf8"));
    expect(item).toMatchObject({ id: reportId, title: "Report", projectId: "proj_a", sourceThreadId: "thr_1" });
    expect(item.versions.map((v: { number: number }) => v.number)).toEqual([1, 2]);
    expect(await readFile(join(dir, "files", reportId, item.versions[1].id), "utf8")).toBe("two");
  });

  it("round-trips into an empty store, then a second run changes nothing", async () => {
    const { dir, source, reportId, imageId } = await backedUp();
    const target = setup();
    const report = await restore(dir, target.handlers);
    expect(report).toMatchObject({ created: 2, updated: 0, failed: 0, unmapped: 0 });
    const restored = target.store.get(reportId)!;
    const original = source.store.get(reportId)!;
    expect(restored).toMatchObject({ title: "Report", project_id: "proj_b", updated_at: original.updated_at, versions: 2 });
    expect(target.store.versions(reportId).map((v) => [v.id, v.number])).toEqual(source.store.versions(reportId).map((v) => [v.id, v.number]));
    for (const version of target.store.versions(reportId)) expect(target.store.bytes(version.sha256)).toEqual(source.store.bytes(version.sha256));
    expect(target.store.get(imageId)).toMatchObject({ project_id: null, archived_at: source.store.get(imageId)!.archived_at });
    expect(target.changed.sort()).toEqual([reportId, imageId].sort());

    const again = await restore(dir, target.handlers);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, failed: 0 });
    expect((target.db.prepare("SELECT COUNT(*) AS n FROM artifact_versions").get() as { n: number }).n).toBe(3);
  });

  it("keeps a newer copy here and updates an older one", async () => {
    const { dir, reportId, imageId } = await backedUp();
    const target = setup();
    await restore(dir, target.handlers);
    target.db.prepare("UPDATE artifacts SET title = 'Mine', updated_at = updated_at + 1000 WHERE id = ?").run(reportId);
    target.db.prepare("UPDATE artifacts SET title = 'Old', updated_at = 1 WHERE id = ?").run(imageId);
    target.db.prepare("DELETE FROM artifact_versions WHERE artifact_id = ?").run(imageId);
    target.db.prepare("INSERT INTO artifact_versions (id, artifact_id, number, name, mime, size, sha256, created_at) VALUES ('local-v', ?, 1, 'x.txt', 'text/plain', 1, 'abc', 1)").run(imageId);

    const report = await restore(dir, target.handlers);
    expect(report).toMatchObject({ kept: 1, updated: 1, failed: 0 });
    expect(report.problems).toEqual([expect.objectContaining({ id: reportId, title: "Report" })]);
    expect(target.store.get(reportId)!.title).toBe("Mine");
    expect(target.store.get(imageId)!.title).toBe("");
    // The backup's version joins the local one without a number clash.
    expect(target.store.versions(imageId).map((v) => [v.id === "local-v", v.number])).toEqual([[false, 2], [true, 1]]);
  });

  it("writes nothing on a dry run but reports the same counts", async () => {
    const { dir } = await backedUp();
    const target = setup();
    const dry = await restore(dir, target.handlers, { dryRun: true, projects: {} });
    expect(dry).toMatchObject({ created: 2, unmapped: 1 });
    expect(target.store.list({ includeArchived: true })).toEqual([]);
    expect((target.db.prepare("SELECT COUNT(*) AS n FROM artifact_blobs").get() as { n: number }).n).toBe(0);
    expect(target.changed).toEqual([]);
    const real = await restore(dir, target.handlers, { projects: {} });
    expect(real).toEqual(dry);
  });

  it("restores an artifact whose project isn't here as a global item", async () => {
    const { dir, reportId } = await backedUp();
    const target = setup();
    const report = await restore(dir, target.handlers, { projects: { proj_a: null } });
    expect(report.unmapped).toBe(1);
    expect(target.store.get(reportId)!.project_id).toBeNull();
  });

  it("fails a malformed item or bad content and restores the rest", async () => {
    const { dir, reportId, imageId } = await backedUp();
    await writeFile(join(dir, "items", "art_bad.json"), JSON.stringify({ id: "art_bad", title: 3 }));
    await writeFile(join(dir, "items", "art_junk.json"), "{not json");
    const image = JSON.parse(await readFile(join(dir, "items", `${imageId}.json`), "utf8"));
    await writeFile(join(dir, "files", imageId, image.versions[0].id), "tampered");
    const target = setup();
    const report = await restore(dir, target.handlers);
    expect(report).toMatchObject({ created: 1, failed: 3 });
    expect(report.problems.map((p) => p.id).sort()).toEqual(["art_bad", "art_junk", imageId].sort());
    expect(target.store.get(reportId)).not.toBeNull();
    expect(target.store.get(imageId)).toBeNull();
  });
});

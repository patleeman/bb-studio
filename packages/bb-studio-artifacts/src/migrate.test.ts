import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
// Studio's real store, so the copy is checked against what Studio does with it.
import { ARTIFACT_TABLES, ArtifactStore } from "../../bb-studio/src/artifacts/server/store";
import { MIGRATED, MIGRATIONS, migrate, type Markers, type StudioImport } from "./migrate";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function oldPlugin() {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  const add = (id: string, versions: { text: string; name?: string }[], extra: Record<string, unknown> = {}) => {
    db.prepare(`INSERT INTO artifacts (id, title, description, project_id, source_thread_id, source_path, created_at, updated_at, updated_by, archived_at)
      VALUES (@id, @title, '', @project, @thread, @path, 10, 20, 'agent', @archived)`).run({ id, title: `Title ${id}`, project: "proj_1", thread: "thr_1", path: `/work/${id}.md`, archived: null, ...extra });
    versions.forEach((version, index) => {
      db.prepare("INSERT OR IGNORE INTO artifact_blobs (sha256, bytes) VALUES (?, ?)").run(sha(version.text), Buffer.from(version.text));
      db.prepare("INSERT INTO artifact_versions (id, artifact_id, number, name, mime, size, sha256, created_at) VALUES (?, ?, ?, ?, 'text/markdown', ?, ?, ?)")
        .run(`${id}-v${index + 1}`, id, index + 1, version.name ?? `${id}.md`, version.text.length, sha(version.text), 10 + index);
    });
  };
  return { db, add };
}

function studio(options: { failRows?: number } = {}) {
  const db = new Database(":memory:");
  db.exec(ARTIFACT_TABLES);
  const store = new ArtifactStore(db);
  const calls = { blobs: 0, rows: 0 };
  let failRows = options.failRows ?? 0;
  const api: StudioImport = {
    missingBlobs: async (hashes) => store.missingBlobs(hashes),
    importBlob: async (hash, bytes) => { calls.blobs++; store.putBlob(hash, bytes); },
    importRows: async (artifacts) => {
      calls.rows++;
      if (failRows-- > 0) throw new Error("Studio isn't running");
      const result = { imported: [] as string[], existing: [] as string[], skipped: [] as { id: string; reason: string }[] };
      for (const item of artifacts) {
        const outcome = store.importArtifact(item);
        if (outcome.outcome === "skipped") result.skipped.push({ id: item.id, reason: outcome.reason });
        else result[outcome.outcome].push(item.id);
      }
      return result;
    },
  };
  return { store, api, calls };
}

function markers(): Markers & { keys(): string[] } {
  const map = new Map<string, unknown>();
  return { get: async (key) => map.get(key), set: async (key, value) => { map.set(key, value); }, keys: () => [...map.keys()] };
}

describe("copying the old Artifacts plugin into Studio", () => {
  it("copies every artifact with its versions, ids, times and bytes, once", async () => {
    const old = oldPlugin();
    old.add("art_aaaaaaaaaaaaaaaa", [{ text: "# One" }, { text: "# One, again" }]);
    old.add("art_bbbbbbbbbbbbbbbb", [{ text: "# One" }], { source_path: null, archived: 30, project: null });
    const target = studio();
    const marks = markers();

    expect(await migrate(old.db, target.api, marks)).toEqual({ complete: true, total: 2, copied: 2, skipped: [] });
    const first = target.store.get("art_aaaaaaaaaaaaaaaa")!;
    expect(first).toMatchObject({ title: "Title art_aaaaaaaaaaaaaaaa", project_id: "proj_1", source_thread_id: "thr_1", created_at: 10, updated_at: 20, versions: 2 });
    expect(first.version).toMatchObject({ id: "art_aaaaaaaaaaaaaaaa-v2", number: 2 });
    expect(target.store.bytes(first.version.sha256)!.toString()).toBe("# One, again");
    expect(target.store.get("art_bbbbbbbbbbbbbbbb")).toMatchObject({ archived_at: 30, project_id: null });
    // Shared bytes are sent once.
    expect(target.calls.blobs).toBe(2);
    expect(marks.keys().sort()).toEqual([`${MIGRATED}art_aaaaaaaaaaaaaaaa`, `${MIGRATED}art_bbbbbbbbbbbbbbbb`]);

    // A rerun sends nothing.
    const before = { ...target.calls };
    expect(await migrate(old.db, target.api, marks)).toMatchObject({ complete: true, copied: 2 });
    expect(target.calls).toEqual(before);
  });

  it("lists malformed rows and rows Studio refuses, keeps them, and still completes", async () => {
    const old = oldPlugin();
    old.add("art_cccccccccccccccc", [{ text: "fine" }]);
    old.add("art_dddddddddddddddd", []);
    old.add("art_eeeeeeeeeeeeeeee", [{ text: "lost" }]);
    old.db.prepare("DELETE FROM artifact_blobs WHERE sha256 = ?").run(sha("lost"));
    old.add("art_ffffffffffffffff", [{ text: "dup" }], { path: "/work/same.md" });
    const target = studio();
    // Saved again in Studio after the update, from the same file.
    target.store.save({ name: "same.md", mime: "text/markdown", bytes: new Uint8Array(Buffer.from("new")), projectId: null, sourceThreadId: "thr_1", sourcePath: "/work/same.md", by: "agent" });

    const result = await migrate(old.db, target.api, markers());
    expect(result).toMatchObject({ complete: true, total: 4, copied: 1 });
    expect(result.skipped.map((each) => each.id).sort()).toEqual(["art_dddddddddddddddd", "art_eeeeeeeeeeeeeeee", "art_ffffffffffffffff"]);
    expect(result.skipped.find((each) => each.id === "art_ffffffffffffffff")!.reason).toContain("saved again in Studio");
    expect(old.db.prepare("SELECT COUNT(*) AS n FROM artifacts").get()).toEqual({ n: 4 });
  });

  it("fails while Studio can't take rows, and resumes where it stopped", async () => {
    const old = oldPlugin();
    for (let index = 0; index < 150; index++) old.add(`art_${String(index).padStart(16, "0")}`, [{ text: `text ${index}` }]);
    const target = studio({ failRows: 1 });
    const marks = markers();
    await expect(migrate(old.db, target.api, marks)).rejects.toThrow("Studio isn't running");
    expect(marks.keys()).toHaveLength(0);
    expect(await migrate(old.db, target.api, marks)).toMatchObject({ complete: true, total: 150, copied: 150 });
    expect(target.store.list({ includeArchived: true })).toHaveLength(150);
  });
});

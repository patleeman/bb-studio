// Studio Artifacts' section of a BB Studio backup (the contract is in
// @bb-studio/kit/backup). Layout, version 1:
//
//   items/<artifact id>.json            the artifact row and its versions' metadata
//   files/<artifact id>/<version id>    each version's bytes, as saved
//
// Content lives in the plugin database as blobs, so backup writes one artifact
// at a time and restore reads one file at a time: memory stays bounded by the
// largest single version (MAX_ARTIFACT_BYTES).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mapProject, restoreDecision } from "@bb-studio/kit/backup";
import { fileSafeId, type BackupHandlers, type BackupReader } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";
import type { z as Zod } from "zod";
import { MAX_ARTIFACT_BYTES } from "../shared";
import type { ArtifactRow, ArtifactStore, VersionRow } from "./store";

export const ARTIFACTS_BACKUP_VERSION = 1;

export const BACKUP_NOTES = [
  "Source thread ids and file paths are kept with each artifact, but they don't point at threads on another BB.",
  "Not included: Studio spaces and tags (Studio's own section), and artifact cards already posted in threads.",
];

const RESTORE_NOTE = "Restored artifacts keep their source thread ids and paths as data; on another BB, those threads aren't there.";

export interface ArtifactBackupDeps {
  db: Database.Database;
  store: ArtifactStore;
  /** Tells viewers and Studio an artifact changed, after a real restore. */
  changed?: (id: string) => void;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

function itemSchema(z: typeof Zod) {
  const id = z.string().regex(ID).refine((value) => !value.includes(".."), "Not a valid id.");
  const time = z.number().int().min(0);
  const version = z.object({
    id,
    number: z.number().int().min(1),
    name: z.string().min(1).max(1000),
    mime: z.string().min(1).max(300),
    size: z.number().int().min(0).max(MAX_ARTIFACT_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: time,
  });
  return z.object({
    id,
    title: z.string().max(10_000),
    description: z.string().max(100_000),
    projectId: z.string().min(1).max(200).nullable(),
    sourceThreadId: z.string().min(1).max(500).nullable(),
    sourcePath: z.string().min(1).max(10_000).nullable(),
    createdAt: time,
    updatedAt: time,
    updatedBy: z.string().max(50).nullable(),
    archivedAt: time.nullable(),
    versions: z.array(version).min(1).max(10_000),
  });
}

export type BackupItem = Zod.infer<ReturnType<typeof itemSchema>>;
type BackupVersion = BackupItem["versions"][number];

const itemPath = (id: string) => `items/${fileSafeId(id)}.json`;
const contentPath = (artifactId: string, versionId: string) => `files/${fileSafeId(artifactId)}/${fileSafeId(versionId)}`;

function toItem(row: ArtifactRow, versions: VersionRow[]): BackupItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    sourceThreadId: row.source_thread_id,
    sourcePath: row.source_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    versions: versions.map((version) => ({
      id: version.id,
      number: version.number,
      name: version.name,
      mime: version.mime,
      size: version.size,
      sha256: version.sha256,
      createdAt: version.created_at,
    })),
  };
}

/** What a real restore writes for one item, worked out before any write. */
interface Plan {
  decision: "create" | "update";
  item: BackupItem;
  projectId: string | null;
  sourcePath: string | null;
  /** Versions not here yet, with the number they get. */
  versions: Array<BackupVersion & { assigned: number }>;
}

export function artifactBackupHandlers(z: typeof Zod, deps: ArtifactBackupDeps): BackupHandlers {
  const { db, store } = deps;
  const schema = itemSchema(z);

  return {
    version: ARTIFACTS_BACKUP_VERSION,

    async backup(writer) {
      const ids = (db.prepare("SELECT id FROM artifacts ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
      let artifacts = 0;
      let versions = 0;
      let missing = 0;
      for (const id of ids) {
        const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
        if (!row) continue;
        const saved: VersionRow[] = [];
        for (const version of store.versions(id).reverse()) {
          const bytes = store.bytes(version.sha256);
          if (!bytes) {
            missing += 1;
            continue;
          }
          await writer.bytesAt(contentPath(id, version.id), bytes);
          saved.push(version);
        }
        if (!saved.length) continue;
        await writer.json(itemPath(id), toItem(row, saved));
        artifacts += 1;
        versions += saved.length;
      }
      const notes = [...BACKUP_NOTES];
      if (missing) notes.push(`${missing} version${missing === 1 ? "" : "s"} had no stored content and ${missing === 1 ? "was" : "were"} left out.`);
      return { counts: { artifacts, versions }, notes };
    },

    async restore(reader, { dryRun, projects, tally }) {
      const plans: Plan[] = [];
      const files = (await reader.list("items")).filter((name) => name.endsWith(".json"));
      // Source pairs claimed by items planned in this run, so two can't collide.
      const claimed = new Set<string>();
      for (const name of files) {
        const fallback = { id: name.slice(0, -".json".length) };
        let item: BackupItem;
        try {
          const parsed = schema.safeParse(await reader.json<unknown>(`items/${name}`));
          if (!parsed.success) {
            tally.record("failed", fallback, `Not a valid artifact: ${parsed.error.issues[0]?.message ?? "unknown problem"}.`);
            continue;
          }
          item = parsed.data;
          if (itemPath(item.id) !== `items/${name}`) throw new Error("Its file name doesn't match its id.");
          const ids = new Set(item.versions.map((version) => version.id));
          if (ids.size !== item.versions.length) throw new Error("It lists a version twice.");
        } catch (error) {
          tally.record("failed", fallback, error instanceof Error ? error.message : String(error));
          continue;
        }

        try {
          const local = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(item.id) as ArtifactRow | undefined;
          const decision = restoreDecision(local?.updated_at ?? null, item.updatedAt);
          if (decision === "keep" || decision === "unchanged") {
            tally.decided(decision, item);
            continue;
          }
          // Versions already here (by id) are left alone; the rest are checked now.
          const known = new Set(
            (db.prepare("SELECT id FROM artifact_versions WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(item.versions.map((v) => v.id))) as Array<{ id: string }>).map((row) => row.id),
          );
          const elsewhere = db
            .prepare("SELECT id FROM artifact_versions WHERE id IN (SELECT value FROM json_each(?)) AND artifact_id != ?")
            .get(JSON.stringify(item.versions.map((v) => v.id)), item.id) as { id: string } | undefined;
          if (elsewhere) throw new Error(`Version ${elsewhere.id} belongs to another artifact here.`);
          const taken = new Set((local ? store.versions(item.id) : []).map((version) => version.number));
          let next = Math.max(0, ...taken);
          const versions: Plan["versions"] = [];
          for (const version of [...item.versions].sort((a, b) => a.number - b.number)) {
            if (known.has(version.id)) continue;
            await checkContent(reader, item.id, version);
            const assigned = taken.has(version.number) ? ++next : version.number;
            taken.add(assigned);
            next = Math.max(next, assigned);
            versions.push({ ...version, assigned });
          }

          const mapped = mapProject(projects, item.projectId);
          const projectId = mapped.unmapped && local ? local.project_id : mapped.projectId;
          let sourcePath = item.sourcePath;
          if (item.sourceThreadId && sourcePath) {
            const key = JSON.stringify([item.sourceThreadId, sourcePath]);
            const owner = store.findBySource(item.sourceThreadId, sourcePath);
            if ((owner && owner.id !== item.id) || claimed.has(key)) sourcePath = null;
            else claimed.add(key);
          }
          plans.push({ decision, item, projectId, sourcePath, versions });
          tally.decided(decision, item);
          if (mapped.unmapped && !local) tally.unmapped(item);
          if (item.sourceThreadId) tally.note(RESTORE_NOTE);
        } catch (error) {
          tally.record("failed", item, error instanceof Error ? error.message : String(error));
        }
      }

      if (dryRun || !plans.length) return;
      // One transaction for every row: the section restores whole or not at all.
      db.transaction(() => {
        for (const plan of plans) writePlan(db, reader, plan);
      })();
      for (const plan of plans) deps.changed?.(plan.item.id);
    },
  };
}

/** Confirms a version's file is there, not too large, and matches its hash. */
async function checkContent(reader: BackupReader, artifactId: string, version: BackupVersion): Promise<void> {
  const rel = contentPath(artifactId, version.id);
  if (!(await reader.exists(rel))) throw new Error(`The content of version ${version.number} is missing.`);
  const size = await reader.size(rel);
  if (size > MAX_ARTIFACT_BYTES || size !== version.size) throw new Error(`The content of version ${version.number} isn't the size it should be.`);
  const sha = createHash("sha256").update(await reader.bytes(rel)).digest("hex");
  if (sha !== version.sha256) throw new Error(`The content of version ${version.number} doesn't match its hash.`);
}

function writePlan(db: Database.Database, reader: BackupReader, plan: Plan): void {
  const { item } = plan;
  if (plan.decision === "create") {
    db.prepare(
      `INSERT INTO artifacts (id, title, description, project_id, source_thread_id, source_path, created_at, updated_at, updated_by, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(item.id, item.title, item.description, plan.projectId, item.sourceThreadId, plan.sourcePath, item.createdAt, item.updatedAt, item.updatedBy, item.archivedAt);
  } else {
    db.prepare(
      `UPDATE artifacts SET title = ?, description = ?, project_id = ?, source_thread_id = ?, source_path = ?, created_at = ?, updated_at = ?, updated_by = ?, archived_at = ?
       WHERE id = ?`,
    ).run(item.title, item.description, plan.projectId, item.sourceThreadId, plan.sourcePath, item.createdAt, item.updatedAt, item.updatedBy, item.archivedAt, item.id);
  }
  for (const version of plan.versions) {
    // Read again, one version at a time, inside the transaction; re-hash so a
    // file changed since it was checked can't slip in.
    const bytes = readFileSync(reader.path(contentPath(item.id, version.id)));
    if (createHash("sha256").update(bytes).digest("hex") !== version.sha256) throw new Error(`The content of ${item.id} changed during the restore.`);
    db.prepare("INSERT OR IGNORE INTO artifact_blobs (sha256, bytes) VALUES (?, ?)").run(version.sha256, bytes);
    db.prepare(
      `INSERT OR IGNORE INTO artifact_versions (id, artifact_id, number, name, mime, size, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(version.id, item.id, version.assigned, version.name, version.mime, version.size, version.sha256, version.createdAt);
  }
}

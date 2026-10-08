// Studio's own section of a backup (docs/backup.md): tags and which items
// have them, saved views, Spaces with their projects, threads, leads and
// check-in settings, the Chief of Staff, and the item services (links, item chats, comments,
// versions, activity). Items keep their add-on ids across a restore, so these
// rows still point at the right items.
//
// Restore runs every write in one transaction; a dry run runs the same
// transaction and rolls it back, so its counts are what a real run would do,
// except for links and activity that a real run's add-ons record for their
// restored items first: those then count as already here.
import { createHash } from "node:crypto";
import { newId } from "@bb-studio/kit/ids";
import type { RestoreTally } from "@bb-studio/kit/backup";
import type { BackupHandlers } from "@bb-studio/kit/server";
import type Database from "better-sqlite3";
import { z } from "zod";
import { CHIEF } from "../space-lead";
import { PERSONAL_PROJECT_ID } from "../spaces";

const text = z.string().max(100_000);
const id = z.string().min(1).max(300);
const time = z.number().int();
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

const tagRow = z.object({ id, name: z.string().min(1).max(100), color: z.string().max(50), created_at: time });
const itemTagRow = z.object({ plugin_id: id, item_id: id, tag_id: id, created_at: time });
const viewRow = z.object({ id, name: z.string().min(1).max(60), query: z.string().max(500), position: z.number(), created_at: time });
const runRow = z.object({ cadence: z.string().max(50), time: z.string().max(50), cron: nullable(z.string().max(200)) });
const spaceRow = z.object({
  id, name: z.string().min(1).max(100), color: z.string().max(50), icon: nullable(z.string().max(50)), description: z.string().max(500),
  default_project_id: nullable(id), page_id: nullable(id), page_template: nullable(z.number().int()), is_default: z.number().int(),
  created_at: time, updated_at: time,
  projects: z.array(z.object({ project_id: id, created_at: time })),
  threads: z.array(z.object({ thread_id: id, added_at: time })),
  lead: nullable(z.object({ lead_thread_id: nullable(id), created_at: time, updated_at: time })),
  run: nullable(runRow),
});
const chiefRow = z.object({ thread_id: id, origin_space_id: nullable(id), updated_at: time, run: nullable(runRow) });
const linkRow = z.object({ from_plugin: id, from_id: id, to_plugin: id, to_id: id, kind: z.string().max(50), source: z.string().max(300) });
const threadRow = z.object({ thread_id: id, plugin_id: id, item_id: id, role: z.string().max(50), state: z.string().max(50), created_at: time, updated_at: time, metadata: text });
const commentRow = z.object({ id, plugin_id: id, item_id: id, parent_id: nullable(id), anchor: nullable(text), actor: text, body: text, created_at: time, resolved_at: nullable(time) });
const versionRow = z.object({ id, plugin_id: id, item_id: id, sha256: z.string().regex(/^[a-f0-9]{64}$/), label: z.string().max(1000), actor: text, created_at: time });
const activityRow = z.object({ plugin_id: id, item_id: id, actor: text, verb: z.string().max(100), at: time, summary: text });

const FILES = {
  tags: ["tags.json", z.array(tagRow)],
  itemTags: ["item-tags.json", z.array(itemTagRow)],
  views: ["views.json", z.array(viewRow)],
  spaces: ["spaces.json", z.array(spaceRow)],
  links: ["links.json", z.array(linkRow)],
  threads: ["item-chats.json", z.array(threadRow)],
  comments: ["comments.json", z.array(commentRow)],
  versions: ["versions.json", z.array(versionRow)],
  activity: ["activity.json", z.array(activityRow)],
  chief: ["chief-of-staff.json", z.array(chiefRow).max(1)],
} as const;

type Data = { [K in keyof typeof FILES]: z.infer<(typeof FILES)[K][1]> };

export const STUDIO_EXCLUDED = [
  "Open tabs, saved thread titles and the search index: they're rebuilt on the new BB.",
  "Space folders under ~/Spaces: a space makes its folder again when it next needs one.",
  "Item chats, space threads, space leads and the Chief of Staff point at BB threads; they're restored only when that thread exists on this BB.",
  "A Chief of Staff in the backup is restored only when this BB has none.",
  "Space and Chief of Staff check-ins come back switched off; turn them on again.",
];

class DryRun extends Error {}

export interface StudioDataDeps {
  /** Whether a BB thread exists here (and isn't deleted). */
  threadExists(threadId: string): Promise<boolean>;
  /** Called after a real restore. */
  changed?(): void;
}

export function studioDataBackup(db: Database.Database, deps: StudioDataDeps): BackupHandlers {
  return {
    version: 1,
    async backup(writer) {
      const all = <T>(sql: string) => db.prepare(sql).all() as T[];
      const spaces = all<Record<string, unknown> & { id: string }>("SELECT * FROM spaces ORDER BY created_at, id").map((space) => ({
        ...space,
        projects: db.prepare("SELECT project_id, created_at FROM space_projects WHERE space_id = ? ORDER BY created_at, project_id").all(space.id),
        threads: db.prepare("SELECT thread_id, added_at FROM space_threads WHERE space_id = ? ORDER BY added_at, thread_id").all(space.id),
        lead: db.prepare("SELECT lead_thread_id, created_at, updated_at FROM space_leads WHERE space_id = ?").get(space.id) ?? null,
        run: db.prepare("SELECT cadence, time, cron FROM space_runs WHERE space_id = ?").get(space.id) ?? null,
      }));
      const data: Data = {
        tags: all("SELECT id, name, color, created_at FROM tags ORDER BY created_at, id"),
        itemTags: all("SELECT plugin_id, item_id, tag_id, created_at FROM item_tags ORDER BY plugin_id, item_id, tag_id"),
        views: all("SELECT id, name, query, position, created_at FROM views ORDER BY position, id"),
        spaces: spaces as Data["spaces"],
        links: all("SELECT * FROM item_links ORDER BY from_plugin, from_id, to_plugin, to_id"),
        threads: all("SELECT * FROM item_threads ORDER BY created_at, thread_id"),
        comments: all("SELECT * FROM item_comments ORDER BY created_at, id"),
        versions: all("SELECT * FROM item_versions ORDER BY created_at, id"),
        activity: all("SELECT plugin_id, item_id, actor, verb, at, summary FROM item_activity ORDER BY id"),
        chief: all<{ thread_id: string; origin_space_id: string | null; updated_at: number }>("SELECT thread_id, origin_space_id, updated_at FROM chief_of_staff")
          .map((row) => ({ ...row, run: (db.prepare("SELECT cadence, time, cron FROM space_runs WHERE space_id = ?").get(CHIEF) as Data["chief"][number]["run"] | undefined) ?? null })),
      };
      for (const key of Object.keys(FILES) as (keyof Data)[]) await writer.json(FILES[key][0], data[key]);
      const blobs = db.prepare("SELECT sha256 FROM item_blobs WHERE sha256 IN (SELECT sha256 FROM item_versions) ORDER BY sha256").all() as { sha256: string }[];
      const read = db.prepare("SELECT bytes FROM item_blobs WHERE sha256 = ?");
      for (const { sha256 } of blobs) await writer.bytesAt(`blobs/${sha256}`, (read.get(sha256) as { bytes: Buffer }).bytes);
      return {
        counts: { tags: data.tags.length, taggings: data.itemTags.length, views: data.views.length, spaces: data.spaces.length, links: data.links.length, itemChats: data.threads.length, comments: data.comments.length, versions: data.versions.length, activity: data.activity.length },
        notes: STUDIO_EXCLUDED,
      };
    },
    async restore(reader, { dryRun, projects, tally }) {
      const data = {} as Data;
      for (const key of Object.keys(FILES) as (keyof Data)[]) {
        const [name, schema] = FILES[key];
        if (!(await reader.exists(name))) {
          (data as Record<string, unknown>)[key] = [];
          continue;
        }
        const parsed = schema.safeParse(await reader.json(name));
        if (!parsed.success) throw new Error(`Studio's ${name} in this backup isn't valid: ${parsed.error.issues[0]?.message ?? "invalid"}`);
        (data as Record<string, unknown>)[key] = parsed.data;
      }
      // Blobs and thread checks are async; read them before the transaction.
      const blobs = new Map<string, Buffer>();
      for (const version of data.versions) {
        if (blobs.has(version.sha256) || db.prepare("SELECT 1 FROM item_blobs WHERE sha256 = ?").get(version.sha256)) continue;
        const rel = `blobs/${version.sha256}`;
        if (!(await reader.exists(rel))) continue;
        const bytes = await reader.bytes(rel);
        if (createHash("sha256").update(bytes).digest("hex") === version.sha256) blobs.set(version.sha256, bytes);
      }
      const threadIds = new Set([
        ...data.threads.map((row) => row.thread_id),
        ...data.spaces.flatMap((space) => [...space.threads.map((row) => row.thread_id), ...(space.lead?.lead_thread_id ? [space.lead.lead_thread_id] : [])]),
        ...data.chief.map((row) => row.thread_id),
      ]);
      const existing = new Set<string>();
      for (const threadId of threadIds) if (await deps.threadExists(threadId).catch(() => false)) existing.add(threadId);
      try {
        db.transaction(() => {
          apply(db, data, { projects, blobs, threads: existing, tally });
          if (dryRun) throw new DryRun();
        })();
      } catch (error) {
        if (!(error instanceof DryRun)) throw error;
      }
      const missing = threadIds.size - existing.size;
      if (missing) tally.note(`${missing} BB thread${missing === 1 ? "" : "s"} from the backup ${missing === 1 ? "isn't" : "aren't"} on this BB; item chats, space threads and leads for ${missing === 1 ? "it" : "them"} were left out.`);
      if (!dryRun) deps.changed?.();
    },
  };
}

function apply(
  db: Database.Database,
  data: Data,
  context: { projects: Readonly<Record<string, string | null>>; blobs: Map<string, Buffer>; threads: Set<string>; tally: RestoreTally },
): void {
  const { projects, blobs, threads, tally } = context;
  const counted = (changes: number, item?: { id: string; title?: string }) => tally.record(changes ? "created" : "unchanged", item);

  // Tags: the same id, else the same name, else a new tag with the backup's id.
  const tagIds = new Map<string, string>();
  for (const tag of data.tags) {
    const local = (db.prepare("SELECT id FROM tags WHERE id = ?").get(tag.id) ?? db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(tag.name)) as { id: string } | undefined;
    if (local) {
      tagIds.set(tag.id, local.id);
      tally.record("unchanged");
      continue;
    }
    db.prepare("INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)").run(tag.id, tag.name, tag.color, tag.created_at);
    tagIds.set(tag.id, tag.id);
    tally.record("created");
  }
  const tagItem = db.prepare("INSERT OR IGNORE INTO item_tags (plugin_id, item_id, tag_id, created_at) VALUES (?, ?, ?, ?)");
  for (const row of data.itemTags) {
    const tagId = tagIds.get(row.tag_id);
    if (tagId) counted(tagItem.run(row.plugin_id, row.item_id, tagId, row.created_at).changes);
  }

  for (const view of data.views) {
    if (db.prepare("SELECT 1 FROM views WHERE id = ? OR name = ? COLLATE NOCASE").get(view.id, view.name)) {
      tally.record("unchanged");
      continue;
    }
    const position = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM views").get() as { next: number }).next;
    db.prepare("INSERT INTO views (id, name, query, position, created_at) VALUES (?, ?, ?, ?, ?)").run(view.id, view.name, view.query, position, view.created_at);
    tally.record("created");
  }

  // Spaces: the same id, else the default space for the default, else the same name.
  type LocalSpace = { id: string; name: string; is_default: number; updated_at: number; default_project_id: string | null };
  const spaceById = db.prepare("SELECT id, name, is_default, updated_at, default_project_id FROM spaces WHERE id = ?");
  const defaultSpace = () => db.prepare("SELECT id FROM spaces WHERE is_default = 1").get() as { id: string } | undefined;
  const restoredSpaces = new Map<string, string>();
  for (const space of data.spaces) {
    const item = { id: space.id, title: space.name };
    let local = spaceById.get(space.id) as LocalSpace | undefined;
    if (!local && space.is_default) local = spaceById.get(defaultSpace()?.id ?? "") as LocalSpace | undefined;
    if (!local) local = db.prepare("SELECT id, name, is_default, updated_at, default_project_id FROM spaces WHERE name = ? COLLATE NOCASE").get(space.name) as LocalSpace | undefined;
    const defaultProject = space.default_project_id === PERSONAL_PROJECT_ID ? PERSONAL_PROJECT_ID : space.default_project_id ? projects[space.default_project_id] ?? null : null;
    let spaceId: string;
    if (!local) {
      spaceId = db.prepare("SELECT 1 FROM spaces WHERE id = ?").get(space.id) ? newId("spc") : space.id;
      db.prepare(`INSERT INTO spaces (id, name, color, icon, description, default_project_id, page_id, page_template, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(spaceId, space.name, space.color, space.icon, space.description, defaultProject, space.page_id, space.page_template, space.created_at, space.updated_at);
      tally.record("created");
    } else {
      spaceId = local.id;
      if (space.updated_at > local.updated_at) {
        const clash = db.prepare("SELECT 1 FROM spaces WHERE name = ? COLLATE NOCASE AND id <> ?").get(space.name, local.id);
        db.prepare("UPDATE spaces SET name = ?, color = ?, icon = ?, description = ?, default_project_id = ?, page_id = COALESCE(?, page_id), page_template = COALESCE(?, page_template), updated_at = ? WHERE id = ?")
          .run(clash ? local.name : space.name, space.color, space.icon, space.description, defaultProject ?? local.default_project_id, space.page_id, space.page_template, space.updated_at, local.id);
        tally.record("updated");
      } else tally.decided(space.updated_at === local.updated_at ? "unchanged" : "keep", item);
    }
    restoredSpaces.set(space.id, spaceId);
    // A project joins the restored space unless the user has put it in another space here.
    for (const project of space.projects) {
      if (project.project_id === PERSONAL_PROJECT_ID) continue;
      const mapped = projects[project.project_id];
      if (!mapped) {
        tally.note(`Some projects in space ${space.name} aren't on this BB; add them to the space once they are.`);
        continue;
      }
      const owner = db.prepare("SELECT space_id FROM space_projects WHERE project_id = ?").get(mapped) as { space_id: string } | undefined;
      const ownerIsDefault = owner && (db.prepare("SELECT is_default FROM spaces WHERE id = ?").get(owner.space_id) as { is_default: number } | undefined)?.is_default === 1;
      if (owner?.space_id === spaceId) tally.record("unchanged");
      else if (owner && !ownerIsDefault) tally.record("kept", { id: mapped, title: `Project in ${space.name}` }, "This project is in another space here; it stayed there.");
      else {
        db.prepare("INSERT INTO space_projects (project_id, space_id, created_at) VALUES (?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET space_id = excluded.space_id").run(mapped, spaceId, project.created_at);
        tally.record("created");
      }
    }
    for (const thread of space.threads) {
      if (threads.has(thread.thread_id)) counted(db.prepare("INSERT OR IGNORE INTO space_threads (thread_id, space_id, added_at) VALUES (?, ?, ?)").run(thread.thread_id, spaceId, thread.added_at).changes);
    }
    const lead = space.lead?.lead_thread_id;
    if (space.lead && lead && threads.has(lead)) counted(db.prepare("INSERT OR IGNORE INTO space_leads (space_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?)").run(spaceId, lead, space.lead.created_at, space.lead.updated_at).changes);
    if (space.run) counted(db.prepare("INSERT OR IGNORE INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, 0, ?, ?, ?, NULL, NULL)").run(spaceId, space.run.cadence, space.run.time, space.run.cron).changes);
  }

  // The Chief of Staff, only into an empty slot. It is above every space, and its heartbeat comes back off.
  for (const chief of data.chief) {
    const item = { id: chief.thread_id, title: "Chief of Staff" };
    if (!threads.has(chief.thread_id)) continue;
    const local = db.prepare("SELECT thread_id FROM chief_of_staff WHERE id = 1").get() as { thread_id: string } | undefined;
    if (local) {
      if (local.thread_id === chief.thread_id) tally.record("unchanged", item);
      else tally.record("kept", item, "This BB already has a Chief of Staff; it stayed.");
      continue;
    }
    if (db.prepare("SELECT 1 FROM space_leads WHERE lead_thread_id = ?").get(chief.thread_id)) {
      tally.record("kept", item, "That thread leads a space here; it stayed the lead.");
      continue;
    }
    const origin = chief.origin_space_id ? restoredSpaces.get(chief.origin_space_id) ?? (db.prepare("SELECT id FROM spaces WHERE id = ?").get(chief.origin_space_id) as { id: string } | undefined)?.id ?? null : null;
    db.prepare("DELETE FROM space_threads WHERE thread_id = ?").run(chief.thread_id);
    db.prepare("INSERT INTO chief_of_staff (id, thread_id, origin_space_id, updated_at) VALUES (1, ?, ?, ?)").run(chief.thread_id, origin, chief.updated_at);
    if (chief.run) db.prepare("INSERT OR IGNORE INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, 0, ?, ?, ?, NULL, NULL)").run(CHIEF, chief.run.cadence, chief.run.time, chief.run.cron);
    tally.record("created", item);
  }

  const link = db.prepare("INSERT OR IGNORE INTO item_links VALUES (?, ?, ?, ?, ?, ?)");
  for (const row of data.links) counted(link.run(row.from_plugin, row.from_id, row.to_plugin, row.to_id, row.kind, row.source).changes);
  const chat = db.prepare("INSERT OR IGNORE INTO item_threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const row of data.threads) if (threads.has(row.thread_id)) counted(chat.run(row.thread_id, row.plugin_id, row.item_id, row.role, row.state, row.created_at, row.updated_at, row.metadata).changes);
  // A comment is keyed by its id; one edited here keeps its local text.
  const comment = db.prepare("INSERT OR IGNORE INTO item_comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const row of data.comments) counted(comment.run(row.id, row.plugin_id, row.item_id, row.parent_id, row.anchor, row.actor, row.body, row.created_at, row.resolved_at).changes);
  const blob = db.prepare("INSERT OR IGNORE INTO item_blobs VALUES (?, ?)");
  const version = db.prepare("INSERT OR IGNORE INTO item_versions VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const row of data.versions) {
    const bytes = blobs.get(row.sha256);
    if (bytes) blob.run(row.sha256, bytes);
    if (!db.prepare("SELECT 1 FROM item_blobs WHERE sha256 = ?").get(row.sha256)) {
      tally.record("failed", { id: row.id, title: row.label }, "This version's content is missing from the backup.");
      continue;
    }
    counted(version.run(row.id, row.plugin_id, row.item_id, row.sha256, row.label, row.actor, row.created_at).changes);
  }
  const seen = db.prepare("SELECT 1 FROM item_activity WHERE plugin_id = ? AND item_id = ? AND actor = ? AND verb = ? AND at = ? AND summary = ?");
  const activity = db.prepare("INSERT INTO item_activity (plugin_id, item_id, actor, verb, at, summary) VALUES (?, ?, ?, ?, ?, ?)");
  for (const row of data.activity) {
    const args = [row.plugin_id, row.item_id, row.actor, row.verb, row.at, row.summary] as const;
    counted(seen.get(...args) ? 0 : activity.run(...args).changes);
  }
}

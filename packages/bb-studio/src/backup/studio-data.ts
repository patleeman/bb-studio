// Studio's own section of a backup (docs/backup.md): tags and which items
// have them, saved views, project leads and their heartbeat settings (the
// personal project's lead is the Chief of Staff), and the item services
// (links, item chats, comments, versions, activity). Older backups' Spaces
// are ignored. Items keep their add-on ids across a restore, so these
// rows still point at the right items.
//
// Restore runs every write in one transaction; a dry run runs the same
// transaction and rolls it back, so its counts are what a real run would do,
// except for links and activity that a real run's add-ons record for their
// restored items first: those then count as already here.
import { createHash } from "node:crypto";
import type { RestoreTally } from "../kit/backup";
import type { BackupHandlers } from "../kit/server/index";
import type Database from "better-sqlite3";
import { z } from "zod";
import { BOT_ID } from "../bot";
import { PERSONAL_PROJECT_ID } from "../project-lead";

const text = z.string().max(100_000);
const id = z.string().min(1).max(300);
const time = z.number().int();
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

const tagRow = z.object({ id, name: z.string().min(1).max(100), color: z.string().max(50), created_at: time });
const itemTagRow = z.object({ plugin_id: id, item_id: id, tag_id: id, created_at: time });
const viewRow = z.object({ id, name: z.string().min(1).max(60), query: z.string().max(500), position: z.number(), created_at: time });
const runRow = z.object({ cadence: z.string().max(50), time: z.string().max(50), cron: nullable(z.string().max(200)) });
const leadRow = z.object({ project_id: id, lead_thread_id: nullable(id), created_at: time, updated_at: time, run: nullable(runRow) });
const chiefRow = z.object({ thread_id: id, origin_space_id: nullable(id), updated_at: time, run: nullable(runRow) });
// Version 1 omitted thread/provider fields; only its primary can inherit the personal lead.
const botRow = z.object({ id, name: z.string().min(1).max(60), avatar: z.string().min(1).max(16), state: z.enum(["active", "paused", "stopped"]), thread_id: nullable(id).optional(), provider_id: nullable(id).optional(), memory_page_id: nullable(id), shape: z.string().max(20).nullable().optional(), color: z.string().max(20).nullable().optional(), role: z.string().max(400).nullable().optional(), created_at: time, updated_at: time });
const botSkillRow = z.object({ bot_id: id, name: z.string().min(1).max(64), description: z.string().max(500), body: z.string().max(20_000), created_at: time, updated_at: time });
const linkRow = z.object({ from_plugin: id, from_id: id, to_plugin: id, to_id: id, kind: z.string().max(50), source: z.string().max(300) });
const threadRow = z.object({ thread_id: id, plugin_id: id, item_id: id, role: z.string().max(50), state: z.string().max(50), created_at: time, updated_at: time, metadata: text });
const commentRow = z.object({ id, plugin_id: id, item_id: id, parent_id: nullable(id), anchor: nullable(text), actor: text, body: text, created_at: time, resolved_at: nullable(time) });
const versionRow = z.object({ id, plugin_id: id, item_id: id, sha256: z.string().regex(/^[a-f0-9]{64}$/), label: z.string().max(1000), actor: text, created_at: time });
const activityRow = z.object({ plugin_id: id, item_id: id, actor: text, verb: z.string().max(100), at: time, summary: text });

const FILES = {
  tags: ["tags.json", z.array(tagRow)],
  itemTags: ["item-tags.json", z.array(itemTagRow)],
  views: ["views.json", z.array(viewRow)],
  leads: ["project-leads.json", z.array(leadRow)],
  /** Each Bot's conversation, provider identity and own skills. */
  bots: ["bots.json", z.array(botRow).max(10)],
  botSkills: ["bot-skills.json", z.array(botSkillRow)],
  links: ["links.json", z.array(linkRow)],
  threads: ["item-chats.json", z.array(threadRow)],
  comments: ["comments.json", z.array(commentRow)],
  versions: ["versions.json", z.array(versionRow)],
  activity: ["activity.json", z.array(activityRow)],
  /** Written by older Studios; restored into the personal project's lead. Their spaces.json is ignored. */
  chief: ["chief-of-staff.json", z.array(chiefRow).max(1)],
} as const;

type Data = { [K in keyof typeof FILES]: z.infer<(typeof FILES)[K][1]> };

export const STUDIO_EXCLUDED = [
  "Open tabs, saved thread titles and the search index: they're rebuilt on the new BB.",
  "Item chats and project leads (the Chief of Staff is the personal project's lead) point at BB threads; they're restored only when that thread exists on this BB.",
  "A project's lead, and the Chief of Staff, is restored only when that project has none on this BB.",
  "Heartbeats come back switched off; turn them on again.",
  "The Bot (name, avatar, state, Memory page and its skills) is restored only when this BB has no Bot.",
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
    version: 2,
    async backup(writer) {
      const all = <T>(sql: string) => db.prepare(sql).all() as T[];
      const data: Data = {
        tags: all("SELECT id, name, color, created_at FROM tags ORDER BY created_at, id"),
        itemTags: all("SELECT plugin_id, item_id, tag_id, created_at FROM item_tags ORDER BY plugin_id, item_id, tag_id"),
        views: all("SELECT id, name, query, position, created_at FROM views ORDER BY position, id"),
        leads: all<{ project_id: string; lead_thread_id: string | null; created_at: number; updated_at: number }>("SELECT project_id, lead_thread_id, created_at, updated_at FROM project_leads ORDER BY project_id")
          .map((lead) => ({ ...lead, run: (db.prepare("SELECT cadence, time, cron FROM project_runs WHERE project_id = ?").get(lead.project_id) as Data["leads"][number]["run"] | undefined) ?? null })),
        bots: all("SELECT id, name, avatar, state, thread_id, provider_id, memory_page_id, shape, color, role, created_at, updated_at FROM bots ORDER BY created_at, id"),
        botSkills: all("SELECT bot_id, name, description, body, created_at, updated_at FROM bot_skills ORDER BY bot_id, name"),
        links: all("SELECT * FROM item_links ORDER BY from_plugin, from_id, to_plugin, to_id"),
        threads: all("SELECT * FROM item_threads ORDER BY created_at, thread_id"),
        comments: all("SELECT * FROM item_comments ORDER BY created_at, id"),
        versions: all("SELECT * FROM item_versions ORDER BY created_at, id"),
        activity: all("SELECT plugin_id, item_id, actor, verb, at, summary FROM item_activity ORDER BY id"),
        // The Chief of Staff is saved as the personal project's lead.
        chief: [],
      };
      for (const key of Object.keys(FILES) as (keyof Data)[]) await writer.json(FILES[key][0], data[key]);
      const blobs = db.prepare("SELECT sha256 FROM item_blobs WHERE sha256 IN (SELECT sha256 FROM item_versions) ORDER BY sha256").all() as { sha256: string }[];
      const read = db.prepare("SELECT bytes FROM item_blobs WHERE sha256 = ?");
      for (const { sha256 } of blobs) await writer.bytesAt(`blobs/${sha256}`, (read.get(sha256) as { bytes: Buffer }).bytes);
      return {
        counts: { tags: data.tags.length, taggings: data.itemTags.length, views: data.views.length, leads: data.leads.length, bots: data.bots.length, botSkills: data.botSkills.length, links: data.links.length, itemChats: data.threads.length, comments: data.comments.length, versions: data.versions.length, activity: data.activity.length },
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
        ...data.leads.flatMap((lead) => (lead.lead_thread_id ? [lead.lead_thread_id] : [])),
        ...data.chief.map((row) => row.thread_id),
        ...data.bots.flatMap((bot) => bot.thread_id ? [bot.thread_id] : []),
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
      if (missing) tally.note(`${missing} BB thread${missing === 1 ? "" : "s"} from the backup ${missing === 1 ? "isn't" : "aren't"} on this BB; item chats, leads and Bot conversation links for ${missing === 1 ? "it" : "them"} were left out.`);
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

  // Leads go only into an empty slot, and a thread leads one project. An older
  // backup's Chief of Staff goes first, as the personal project's lead.
  const leads = [
    ...data.chief.map((chief) => ({ project_id: PERSONAL_PROJECT_ID, lead_thread_id: chief.thread_id, created_at: chief.updated_at, updated_at: chief.updated_at, run: chief.run })),
    ...data.leads,
  ];
  for (const lead of leads) {
    const projectId = lead.project_id === PERSONAL_PROJECT_ID ? PERSONAL_PROJECT_ID : projects[lead.project_id] ?? null;
    const item = { id: lead.lead_thread_id ?? lead.project_id, title: projectId === PERSONAL_PROJECT_ID ? "Chief of Staff" : "Project lead" };
    if (!projectId) {
      tally.note("Some project leads are for projects that aren't on this BB; they were left out.");
      continue;
    }
    if (lead.run) counted(db.prepare("INSERT OR IGNORE INTO project_runs (project_id, enabled, cadence, time, cron, automation_id, automation_project_id) VALUES (?, 0, ?, ?, ?, NULL, NULL)").run(projectId, lead.run.cadence, lead.run.time, lead.run.cron).changes);
    if (!lead.lead_thread_id || !threads.has(lead.lead_thread_id)) continue;
    const local = (db.prepare("SELECT lead_thread_id FROM project_leads WHERE project_id = ?").get(projectId) as { lead_thread_id: string | null } | undefined)?.lead_thread_id;
    if (local) {
      if (local === lead.lead_thread_id) tally.record("unchanged", item);
      else tally.record("kept", item, "This project already has a lead here; it stayed.");
      continue;
    }
    if (db.prepare("SELECT 1 FROM project_leads WHERE lead_thread_id = ?").get(lead.lead_thread_id)) {
      tally.record("kept", item, "That thread leads another project here; it stayed the lead there.");
      continue;
    }
    db.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET lead_thread_id = excluded.lead_thread_id, updated_at = excluded.updated_at")
      .run(projectId, lead.lead_thread_id, lead.created_at, lead.updated_at);
    tally.record("created", item);
  }

  // Bots come back only when there are none here. Only the primary follows the personal lead.
  // A paused Bot stays paused; an active one's check-ins come back off, as Heartbeats do.
  const hasBot = !!db.prepare("SELECT 1 FROM bots").get();
  const primary = data.bots.find((bot) => bot.id === BOT_ID) ?? [...data.bots].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))[0];
  for (const bot of data.bots) {
    const item = { id: bot.id, title: bot.name };
    if (hasBot) {
      tally.record(db.prepare("SELECT 1 FROM bots WHERE id = ?").get(bot.id) ? "unchanged" : "kept", item, "This BB already has a Bot; it stayed.");
      continue;
    }
    let thread = bot.thread_id && threads.has(bot.thread_id) ? bot.thread_id : null;
    if (bot.id === primary?.id) {
      const lead = (db.prepare("SELECT lead_thread_id FROM project_leads WHERE project_id = ?").get(PERSONAL_PROJECT_ID) as { lead_thread_id: string | null } | undefined)?.lead_thread_id;
      if (lead) thread = lead;
      else if (thread) {
        if (db.prepare("SELECT 1 FROM project_leads WHERE lead_thread_id = ?").get(thread)) {
          thread = null;
          tally.note("The primary Bot's conversation already leads another project here; it was left unattached.");
        } else {
          db.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET lead_thread_id = excluded.lead_thread_id, updated_at = excluded.updated_at")
            .run(PERSONAL_PROJECT_ID, thread, bot.created_at, bot.updated_at);
        }
      }
    }
    db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, provider_id, heartbeat_was_on, memory_page_id, shape, color, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)")
      .run(bot.id, bot.name, bot.avatar, bot.state, thread, bot.provider_id ?? null, bot.memory_page_id, bot.shape ?? null, bot.color ?? null, bot.role ?? null, bot.created_at, bot.updated_at);
    tally.record("created", item);
  }
  const skill = db.prepare("INSERT OR IGNORE INTO bot_skills (bot_id, name, description, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const row of data.botSkills) {
    if (!db.prepare("SELECT 1 FROM bots WHERE id = ?").get(row.bot_id)) continue;
    counted(skill.run(row.bot_id, row.name, row.description, row.body, row.created_at, row.updated_at).changes, { id: `${row.bot_id}:${row.name}`, title: row.name });
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

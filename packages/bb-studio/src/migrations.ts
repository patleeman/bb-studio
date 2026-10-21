import { ARTIFACT_TABLES } from "./artifacts/server/store";
import { ARTIFACT_LIVE_TABLES } from "./artifacts/live/store";
import { DRAWING_TABLES } from "./draw/server/store";
import { DESIGN_MIGRATIONS } from "./design/server/store";
import { TALK_MIGRATIONS } from "./talk/server/store";
import { MIGRATIONS as PAGE_MIGRATIONS } from "./pages/store";
import { PAGE_NOTES_TABLE } from "./pages/notes";
import { SIDE_THREADS_MANY, SIDE_THREADS_TABLE } from "./bot-side-threads";
import { NEXT_LOG_MIGRATIONS } from "./explore/store";
import { DASHBOARD_PROPOSALS_TABLE, DASHBOARD_TABLES } from "./dashboards/server/store";
// Studio's own tables: tags (src/tags.ts), saved views (src/views.ts),
// sidebar tabs (src/tabs.ts), item services (src/services.ts), search
// (src/search-index.ts) and project leads (src/project-lead.ts). The space
// tables are no longer used; they stay because migrations are append-only.

/**
 * Append-only: statement index is the migration id, and BB checks each
 * statement against the hash it recorded, so never edit one (not even its
 * whitespace). Add a new statement for every schema change.
 */
export const MIGRATIONS = [
  `CREATE TABLE tags (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       color TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX tags_name ON tags (name COLLATE NOCASE);
   CREATE TABLE item_tags (
       plugin_id TEXT NOT NULL,
       item_id TEXT NOT NULL,
       tag_id TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (plugin_id, item_id, tag_id)
     );
   CREATE INDEX item_tags_tag ON item_tags (tag_id);
   CREATE TABLE tabs (
       plugin_id TEXT NOT NULL,
       item_id TEXT NOT NULL,
       position INTEGER NOT NULL,
       opened_at INTEGER NOT NULL,
       PRIMARY KEY (plugin_id, item_id)
     );
   CREATE TABLE views (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       query TEXT NOT NULL,
       position INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX views_name ON views (name COLLATE NOCASE);
   CREATE VIRTUAL TABLE studio_search_fts USING fts5(
       plugin_id UNINDEXED, item_id UNINDEXED, kind UNINDEXED,
       project_id UNINDEXED, href UNINDEXED, updated_at UNINDEXED,
       title, body, tokenize='unicode61 remove_diacritics 2'
     );
   CREATE TABLE item_links (
       from_plugin TEXT NOT NULL, from_id TEXT NOT NULL,
       to_plugin TEXT NOT NULL, to_id TEXT NOT NULL,
       kind TEXT NOT NULL, source TEXT NOT NULL,
       PRIMARY KEY (from_plugin, from_id, to_plugin, to_id, kind, source)
     );
   CREATE INDEX item_links_to ON item_links (to_plugin, to_id);
   CREATE TABLE item_threads (
       thread_id TEXT NOT NULL, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       role TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL, metadata TEXT NOT NULL,
       PRIMARY KEY (thread_id, plugin_id, item_id)
     );
   CREATE INDEX item_threads_item ON item_threads (plugin_id, item_id, created_at);
   CREATE INDEX item_threads_thread ON item_threads (thread_id);
   CREATE TABLE item_activity (
       id INTEGER PRIMARY KEY AUTOINCREMENT, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       actor TEXT NOT NULL, verb TEXT NOT NULL, at INTEGER NOT NULL, summary TEXT NOT NULL
     );
   CREATE INDEX item_activity_item ON item_activity (plugin_id, item_id, id);
   CREATE TABLE item_comments (
       id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       parent_id TEXT, anchor TEXT, actor TEXT NOT NULL, body TEXT NOT NULL,
       created_at INTEGER NOT NULL, resolved_at INTEGER
     );
   CREATE INDEX item_comments_item ON item_comments (plugin_id, item_id, created_at);
   CREATE TABLE item_blobs (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL);
   CREATE TABLE item_versions (
       id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, item_id TEXT NOT NULL,
       sha256 TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
     );
   CREATE INDEX item_versions_item ON item_versions (plugin_id, item_id, created_at);
   CREATE TABLE spaces (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL COLLATE NOCASE UNIQUE,
       color TEXT NOT NULL,
       icon TEXT,
       description TEXT NOT NULL DEFAULT '',
       default_project_id TEXT,
       page_id TEXT,
       page_template INTEGER,
       is_default INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
   CREATE UNIQUE INDEX spaces_one_default ON spaces (is_default) WHERE is_default = 1;
   CREATE TABLE space_projects (
       project_id TEXT PRIMARY KEY,
       space_id TEXT NOT NULL REFERENCES spaces (id),
       created_at INTEGER NOT NULL
     );
   CREATE INDEX space_projects_space ON space_projects (space_id);
   CREATE TABLE space_folders (
       space_id TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, path TEXT NOT NULL UNIQUE,
       project_id TEXT, PRIMARY KEY (space_id, name)
     );
   CREATE TABLE space_threads (
       thread_id TEXT PRIMARY KEY, space_id TEXT NOT NULL, added_at INTEGER NOT NULL
     );
   CREATE INDEX space_threads_space ON space_threads (space_id, added_at);
   CREATE TABLE space_leads (
       space_id TEXT PRIMARY KEY, lead_thread_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );
   CREATE TABLE space_runs (
       space_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, cadence TEXT NOT NULL, time TEXT NOT NULL,
       automation_id TEXT, automation_project_id TEXT
     );
   CREATE TABLE space_thread_handoffs (
       old_thread_id TEXT PRIMARY KEY, new_thread_id TEXT NOT NULL, space_id TEXT,
       lead INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
     );`,
  `ALTER TABLE space_runs ADD COLUMN cron TEXT;`,
  `ALTER TABLE tabs ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE thread_titles (
       thread_id TEXT PRIMARY KEY, title TEXT, prompts INTEGER NOT NULL, locked INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );`,
  `CREATE TABLE chief_of_staff (
       id INTEGER PRIMARY KEY CHECK (id = 1), thread_id TEXT NOT NULL, origin_space_id TEXT, updated_at INTEGER NOT NULL
     );`,
  // The Chief of Staff becomes the default space's lead (docs/spaces.md): it wins over
  // that space's old lead, which stays an ordinary thread. Its heartbeat settings move to
  // the default space; the old automations are retired and an enabled heartbeat is
  // provisioned again at startup (SpaceRuns.repair).
  `CREATE TABLE space_retired_automations (automation_id TEXT PRIMARY KEY, automation_project_id TEXT);
   INSERT OR IGNORE INTO space_retired_automations (automation_id, automation_project_id)
     SELECT automation_id, automation_project_id FROM space_runs WHERE automation_id IS NOT NULL
       AND (space_id = 'chief-of-staff' OR (space_id IN (SELECT id FROM spaces WHERE is_default = 1) AND EXISTS (SELECT 1 FROM chief_of_staff)));
   DELETE FROM space_runs WHERE space_id IN (SELECT id FROM spaces WHERE is_default = 1) AND EXISTS (SELECT 1 FROM chief_of_staff);
   INSERT INTO space_runs (space_id, enabled, cadence, time, cron, automation_id, automation_project_id)
     SELECT s.id, r.enabled, r.cadence, r.time, r.cron, NULL, NULL FROM space_runs r, spaces s
     WHERE r.space_id = 'chief-of-staff' AND s.is_default = 1 AND EXISTS (SELECT 1 FROM chief_of_staff);
   DELETE FROM space_runs WHERE space_id = 'chief-of-staff';
   DELETE FROM space_leads WHERE lead_thread_id IN (SELECT thread_id FROM chief_of_staff);
   INSERT INTO space_leads (space_id, lead_thread_id, created_at, updated_at)
     SELECT s.id, c.thread_id, c.updated_at, c.updated_at FROM chief_of_staff c, spaces s WHERE s.is_default = 1
     ON CONFLICT (space_id) DO UPDATE SET lead_thread_id = excluded.lead_thread_id, updated_at = excluded.updated_at;
   INSERT INTO space_threads (thread_id, space_id, added_at)
     SELECT c.thread_id, s.id, c.updated_at FROM chief_of_staff c, spaces s WHERE s.is_default = 1
     ON CONFLICT (thread_id) DO UPDATE SET space_id = excluded.space_id;
   DROP TABLE chief_of_staff;`,
  // Artifacts are built in (src/artifacts): the old plugin's tables.
  ARTIFACT_TABLES,
  // Spaces are gone; leads and heartbeats belong to BB projects (src/project-lead.ts).
  // Each Space's lead and heartbeat is queued here and put on its main project at
  // startup (ProjectLeads.finishMoves), which needs BB to say where the lead thread
  // is. The fallback is the Space's default project unless that's its ~/Spaces
  // catch-all, then its first other project, then the catch-all; the default Space
  // always moves to the personal project. Old heartbeat automations are retired
  // (ProjectRuns.repair) and enabled ones provisioned again. Space tables stay.
  `CREATE TABLE project_leads (
       project_id TEXT PRIMARY KEY, lead_thread_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );
   CREATE TABLE project_runs (
       project_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, cadence TEXT NOT NULL, time TEXT NOT NULL, cron TEXT,
       automation_id TEXT, automation_project_id TEXT
     );
   CREATE TABLE project_thread_handoffs (
       old_thread_id TEXT PRIMARY KEY, new_thread_id TEXT NOT NULL, project_id TEXT,
       lead INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
     );
   INSERT INTO project_thread_handoffs (old_thread_id, new_thread_id, project_id, lead, archived)
     SELECT old_thread_id, new_thread_id, NULL, 0, archived FROM space_thread_handoffs;
   CREATE TABLE space_lead_moves (
       space_id TEXT PRIMARY KEY, is_default INTEGER NOT NULL, lead_thread_id TEXT, lead_updated_at INTEGER NOT NULL,
       fallback_project_id TEXT, enabled INTEGER, cadence TEXT, time TEXT, cron TEXT
     );
   INSERT INTO space_lead_moves (space_id, is_default, lead_thread_id, lead_updated_at, fallback_project_id, enabled, cadence, time, cron)
     SELECT s.id, s.is_default, l.lead_thread_id, COALESCE(l.updated_at, 0),
       CASE WHEN s.default_project_id IS NOT NULL AND s.default_project_id NOT IN (SELECT project_id FROM space_folders WHERE project_id IS NOT NULL)
         THEN s.default_project_id
         ELSE COALESCE(
           (SELECT p.project_id FROM space_projects p WHERE p.space_id = s.id
              AND p.project_id NOT IN (SELECT project_id FROM space_folders WHERE project_id IS NOT NULL)
              ORDER BY p.created_at, p.project_id LIMIT 1),
           s.default_project_id) END,
       r.enabled, r.cadence, r.time, r.cron
     FROM spaces s LEFT JOIN space_leads l ON l.space_id = s.id LEFT JOIN space_runs r ON r.space_id = s.id
     WHERE l.lead_thread_id IS NOT NULL OR r.space_id IS NOT NULL;
   INSERT OR IGNORE INTO space_retired_automations (automation_id, automation_project_id)
     SELECT automation_id, automation_project_id FROM space_runs WHERE automation_id IS NOT NULL;
   UPDATE space_runs SET enabled = 0, automation_id = NULL, automation_project_id = NULL;`,
  // Drawings are built in (src/draw): the Draw plugin's tables.
  DRAWING_TABLES,
  // Designs are built in (src/design): the Design plugin's statements in order.
  ...DESIGN_MIGRATIONS,
  // Recordings are built in (src/talk): the Talk plugin's statements in order.
  ...TALK_MIGRATIONS,
  // Pages are built in (src/pages): the Pages plugin's statements in order.
  ...PAGE_MIGRATIONS,
  // Explore's Next row click log, which Pages kept in explore.db.
  ...NEXT_LOG_MIGRATIONS,
  // The user's Bot (src/bot.ts): an always-on agent with a name and avatar.
  // Its thread is the personal project's lead; an existing lead (the Chief of
  // Staff) becomes the Bot, keeping its thread and heartbeat.
  `CREATE TABLE bots (
       id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL, state TEXT NOT NULL,
       thread_id TEXT, heartbeat_was_on INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );
   INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at)
     SELECT 'bot_main', 'Chief of Staff', '🧭', 'active', lead_thread_id, 0, created_at, updated_at
     FROM project_leads WHERE project_id = 'proj_personal' AND lead_thread_id IS NOT NULL;`,
  // Step 2 (src/bot.ts): the Bot's Memory page, and skills only its thread loads.
  `ALTER TABLE bots ADD COLUMN memory_page_id TEXT;
   CREATE TABLE bot_skills (
       bot_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, body TEXT NOT NULL,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (bot_id, name)
     );`,
  // Step 3 (src/bot.ts): a drawn avatar (shape and color; the emoji stays as
  // a fallback for clients that predate it) and a short role it's given.
  `ALTER TABLE bots ADD COLUMN shape TEXT;
   ALTER TABLE bots ADD COLUMN color TEXT;
   ALTER TABLE bots ADD COLUMN role TEXT;`,
  // Runners (src/runners.ts): long-lived threads a Bot keeps on a schedule,
  // quiet unless they report. Studio's table is the source of truth: runner
  // threads have no BB parent, so BB posts no child notices to the Bot.
  `CREATE TABLE bot_runners (
       id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, name TEXT NOT NULL, job TEXT NOT NULL,
       thread_id TEXT UNIQUE, project_id TEXT NOT NULL,
       state TEXT NOT NULL, cadence TEXT NOT NULL, time TEXT NOT NULL, cron TEXT,
       automation_id TEXT, automation_project_id TEXT, adopted INTEGER NOT NULL DEFAULT 0,
       last_run_at INTEGER, last_level TEXT, last_report TEXT, last_report_at INTEGER, urgent INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );`,
  // External bots (src/bot.ts): a Bot whose thread runs on an external agent
  // provider (Studio Agents: Hermes, OpenClaw, Grok, Dot), with its model.
  `ALTER TABLE bots ADD COLUMN kind TEXT NOT NULL DEFAULT 'studio';
   ALTER TABLE bots ADD COLUMN provider_id TEXT;
   ALTER TABLE bots ADD COLUMN model TEXT;`,
  // A bot's provider and model are its own and swappable (bot_set_model); its
  // kind is derived from the provider. Imported bots so far ran with full
  // permission; Studio bots' provider and model fill in from their thread.
  `ALTER TABLE bots ADD COLUMN permission_mode TEXT;
   ALTER TABLE bots ADD COLUMN reasoning_level TEXT;
   UPDATE bots SET permission_mode = 'full' WHERE kind = 'external';`,  // The model is the thread's, not the bot's: a bot follows its current
  // thread, and its kind comes from that thread's provider (provider_id only
  // caches it). The stored kind, model and execution settings go.
  `ALTER TABLE bots DROP COLUMN kind;
   ALTER TABLE bots DROP COLUMN model;
   ALTER TABLE bots DROP COLUMN permission_mode;
   ALTER TABLE bots DROP COLUMN reasoning_level;`,
  // What a Bot's Stop paused (src/bot.ts): its automations and runners, so
  // Resume turns back on exactly those and leaves ones already off alone.
  `CREATE TABLE bot_stop_paused (
       bot_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, project_id TEXT,
       PRIMARY KEY (bot_id, kind, item_id)
     );`,
  // Bot automations (src/automations.ts): check-ins, reminders and watchers,
  // each one or more BB automations (bb_ids) Studio keeps as one.
  `CREATE TABLE bot_automations (
       id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, instruction TEXT NOT NULL DEFAULT '',
       script TEXT, interpreter TEXT, timeout_ms INTEGER, env_json TEXT, working_dir TEXT,
       target TEXT NOT NULL DEFAULT 'main', schedule_json TEXT NOT NULL,
       provider_id TEXT, model TEXT, reasoning TEXT,
       state TEXT NOT NULL, project_id TEXT NOT NULL, bb_ids TEXT NOT NULL DEFAULT '[]', target_thread_id TEXT,
       seen_until INTEGER NOT NULL DEFAULT 0, last_fired_at INTEGER, last_fire TEXT,
       created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );
   CREATE INDEX bot_automations_bot ON bot_automations (bot_id);`,
  // Skills that learn (src/skill-learning.ts): a skill's state (active, stale,
  // archived; the curator moves unused ones, never deletes), pin and last use;
  // each Bot's learning settings and counters, its review forks, and review
  // changes waiting for approval.
  `ALTER TABLE bot_skills ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
   ALTER TABLE bot_skills ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE bot_skills ADD COLUMN used_at INTEGER;
   CREATE TABLE bot_learning (
       bot_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, every_turns INTEGER NOT NULL DEFAULT 10, review_model TEXT,
       approval INTEGER NOT NULL DEFAULT 0, consolidate INTEGER NOT NULL DEFAULT 0, curator_paused INTEGER NOT NULL DEFAULT 0,
       thread_id TEXT, seen_seq INTEGER NOT NULL DEFAULT 0, tool_turns INTEGER NOT NULL DEFAULT 0, user_turns INTEGER NOT NULL DEFAULT 0,
       last_review_at INTEGER, last_review_result TEXT, curator_since INTEGER, curator_last_at INTEGER, curator_last_result TEXT
     );
   CREATE TABLE bot_skill_reviews (
       thread_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
       saved INTEGER NOT NULL DEFAULT 0, staged INTEGER NOT NULL DEFAULT 0, memory INTEGER NOT NULL DEFAULT 0,
       started_at INTEGER NOT NULL, finished_at INTEGER, result TEXT
     );
   CREATE INDEX bot_skill_reviews_bot ON bot_skill_reviews (bot_id, status);
   CREATE TABLE bot_skill_pending (
       id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL,
       description TEXT, body TEXT, review_thread_id TEXT, created_at INTEGER NOT NULL
     );`,
  // Skills saved before use was tracked count as used at upgrade, so the
  // curator gives them the full 30 and 90 days instead of archiving at once.
  `UPDATE bot_skills SET used_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE used_at IS NULL;`,
  // Runner threads live under their Bot, out of BB's thread list: `hidden` is
  // set once Studio made the thread hidden. Rows from before start at 0, so
  // the startup step (Runners.hideThreads) hides them once.
  `ALTER TABLE bot_runners ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`,
  // Threads Studio hid because a Bot owns them (src/bot-owned.ts; runners
  // too): each is hidden once, so one the user shows again stays visible.
  `CREATE TABLE bot_hidden_threads (
       thread_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, reason TEXT NOT NULL, hidden_at INTEGER NOT NULL
     );
   CREATE INDEX bot_hidden_threads_bot ON bot_hidden_threads (bot_id);`,
  // Studio's auto-resumes of runner and Bot automations BB turned off after a
  // transient failure (src/auto-resume.ts). Append-only: a resume, the cap
  // reached (once per failed run) and cleared once it's on again; the cap
  // counts resumes in the last 24 hours.
  `CREATE TABLE automation_auto_resumes (
       id INTEGER PRIMARY KEY AUTOINCREMENT, automation_id TEXT NOT NULL, bot_id TEXT NOT NULL, owner TEXT NOT NULL, owner_id TEXT NOT NULL,
       event TEXT NOT NULL, reason TEXT, run_id TEXT, message TEXT, at INTEGER NOT NULL
     );
   CREATE INDEX automation_auto_resumes_automation ON automation_auto_resumes (automation_id, at);`,
  // A Bot's image avatar (src/bot-avatar.ts): generated by the Bot
  // (bot_avatar_generate) or uploaded in Bot info → Profile. avatar_image_id is
  // the one shown (NULL: the drawn avatar); avatar_image_prev is what it
  // replaced, for Revert ('' for the drawn avatar, NULL for nothing). A Bot
  // keeps its last few images.
  `ALTER TABLE bots ADD COLUMN avatar_image_id TEXT;
   ALTER TABLE bots ADD COLUMN avatar_image_prev TEXT;
   CREATE TABLE bot_avatar_images (
       id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
       source TEXT NOT NULL, prompt TEXT, provider TEXT, created_at INTEGER NOT NULL
     );
   CREATE INDEX bot_avatar_images_bot ON bot_avatar_images (bot_id, created_at);`,
  // Edits a Bot made to its own profile (bot_profile_update, bot_set and
  // bot_avatar_generate from its thread), and the user's reverts of them
  // (`reverts` names the change undone). Append-only: triggers refuse
  // updates and deletes, so the record can't be rewritten.
  `CREATE TABLE bot_profile_changes (
       id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, actor_bot_id TEXT, thread_id TEXT,
       field TEXT NOT NULL, old_value TEXT, new_value TEXT, reverts INTEGER, at INTEGER NOT NULL
     );
   CREATE INDEX bot_profile_changes_bot ON bot_profile_changes (bot_id, id);
   CREATE TRIGGER bot_profile_changes_no_update BEFORE UPDATE ON bot_profile_changes
     BEGIN SELECT RAISE(ABORT, 'bot_profile_changes is append-only'); END;
   CREATE TRIGGER bot_profile_changes_no_delete BEFORE DELETE ON bot_profile_changes
     BEGIN SELECT RAISE(ABORT, 'bot_profile_changes is append-only'); END;`,
  // Prompt-cache warming for Bot chats (src/bot-cache.ts): each Bot's
  // settings (no row: the defaults), the pings Studio sent (quiet_since is
  // the chat's updatedAt before them, for the skill curator's idle wait), and
  // chats where the user turned the cold-send banner off.
  `CREATE TABLE bot_cache_settings (
       bot_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, threshold_tokens INTEGER NOT NULL, idle_hours REAL NOT NULL,
       wake_start INTEGER NOT NULL, wake_end INTEGER NOT NULL, updated_at INTEGER NOT NULL
     );
   CREATE TABLE bot_cache_pings (
       id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, sent_at INTEGER NOT NULL, quiet_since INTEGER
     );
   CREATE INDEX bot_cache_pings_thread ON bot_cache_pings (thread_id, sent_at);
   CREATE TABLE bot_cache_banner_off (thread_id TEXT PRIMARY KEY, at INTEGER NOT NULL);`,
  // Dashboards (src/dashboards): dashboards, their widgets and layouts, the
  // custom widget library, widget data, script approvals and versions.
  DASHBOARD_TABLES,
  // Who proposed each script widget's command, for the approval prompt.
  DASHBOARD_PROPOSALS_TABLE,
  // Notes (src/pages/notes.ts): pages made from a thread's draft, and their thread.
  PAGE_NOTES_TABLE,
  // Side threads on a Bot's replies (src/bot-side-threads.ts): each fork and the reply it answers.
  SIDE_THREADS_TABLE,
  // Side threads are BB side chats now, a new one each time: a reply can have several.
  SIDE_THREADS_MANY,
  // Live HTML artifacts (src/artifacts/live): shared state, event log and takes.
  ARTIFACT_LIVE_TABLES,
  // Spaces are gone and nothing reads their folders any more.
  `DROP TABLE IF EXISTS space_folders`,
  // Prompt cache (src/bot-cache.ts): compaction before expiry, per Bot (on by
  // default), and the compactions Studio ran (once per idle stretch). Waking
  // hours are gone; wake_start/wake_end stay, unread.
  `ALTER TABLE bot_cache_settings ADD COLUMN compact_before_expiry INTEGER NOT NULL DEFAULT 1;
   CREATE TABLE bot_cache_compactions (
       id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, at INTEGER NOT NULL, tokens INTEGER
     );
   CREATE INDEX bot_cache_compactions_thread ON bot_cache_compactions (thread_id, at);`,
  // Threads Studio resumed after a host restart cut them off
  // (src/thread-resume.ts). Append-only: a resume, the cap reached, a failed
  // send and cleared (the thread went idle after the cap), each tied to the
  // interrupt event it answers (one resume per interrupt); the cap counts
  // resumes per thread in the last hour.
  `CREATE TABLE thread_auto_resumes (
       id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, event_id TEXT NOT NULL, event TEXT NOT NULL,
       bot_id TEXT, title TEXT, reason TEXT, message TEXT, at INTEGER NOT NULL
     );
   CREATE INDEX thread_auto_resumes_thread ON thread_auto_resumes (thread_id, at);
   CREATE INDEX thread_auto_resumes_event ON thread_auto_resumes (thread_id, event_id);`,
  // Retired voice calls: keep this unused migration in place because migration
  // statements are append-only and BB checks their stored hashes.
  `CREATE TABLE voice_calls (
       id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, bot_name TEXT NOT NULL, thread_id TEXT, model TEXT NOT NULL,
       voice TEXT NOT NULL, transcribe_model TEXT, started_at INTEGER NOT NULL
     );
   CREATE INDEX voice_calls_started ON voice_calls (started_at);
   CREATE TABLE voice_call_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT, call_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL,
       role TEXT, text TEXT, data TEXT
     );
   CREATE INDEX voice_call_events_call ON voice_call_events (call_id, id);`,
  // Skill content history is append-only, including deletes and reverts.
  // Triggers also cover imports and the pending saves applied during upgrade.
  `ALTER TABLE bot_skills ADD COLUMN lint_warnings TEXT NOT NULL DEFAULT '[]';
   CREATE TABLE bot_skill_versions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, name TEXT NOT NULL,
     description TEXT, body TEXT, old_body TEXT NOT NULL, warnings TEXT NOT NULL, at INTEGER NOT NULL
   );
   CREATE INDEX bot_skill_versions_skill ON bot_skill_versions(bot_id, name, id);
   INSERT INTO bot_skill_versions(bot_id, name, description, body, old_body, warnings, at)
     SELECT bot_id, name, description, body, '', lint_warnings, updated_at FROM bot_skills;
   CREATE TRIGGER bot_skill_versions_insert AFTER INSERT ON bot_skills BEGIN
     INSERT INTO bot_skill_versions(bot_id, name, description, body, old_body, warnings, at)
       VALUES (NEW.bot_id, NEW.name, NEW.description, NEW.body, '', NEW.lint_warnings, NEW.updated_at);
   END;
   CREATE TRIGGER bot_skill_versions_write AFTER UPDATE OF body, description ON bot_skills BEGIN
     INSERT INTO bot_skill_versions(bot_id, name, description, body, old_body, warnings, at)
       VALUES (NEW.bot_id, NEW.name, NEW.description, NEW.body, OLD.body, NEW.lint_warnings, NEW.updated_at);
   END;
   CREATE TRIGGER bot_skill_versions_delete AFTER DELETE ON bot_skills BEGIN
     INSERT INTO bot_skill_versions(bot_id, name, description, body, old_body, warnings, at)
       VALUES (OLD.bot_id, OLD.name, NULL, NULL, OLD.body, '[]', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
   END;
   CREATE TRIGGER bot_skill_versions_no_update BEFORE UPDATE ON bot_skill_versions
     BEGIN SELECT RAISE(ABORT, 'bot_skill_versions is append-only'); END;
   CREATE TRIGGER bot_skill_versions_no_delete BEFORE DELETE ON bot_skill_versions
     BEGIN SELECT RAISE(ABORT, 'bot_skill_versions is append-only'); END;
   CREATE TABLE bot_skill_lints (
     id INTEGER PRIMARY KEY AUTOINCREMENT, version_id INTEGER NOT NULL REFERENCES bot_skill_versions(id),
     warning TEXT NOT NULL
   );
   CREATE TRIGGER bot_skill_lints_no_update BEFORE UPDATE ON bot_skill_lints
     BEGIN SELECT RAISE(ABORT, 'bot_skill_lints is append-only'); END;
   CREATE TRIGGER bot_skill_lints_no_delete BEFORE DELETE ON bot_skill_lints
     BEGIN SELECT RAISE(ABORT, 'bot_skill_lints is append-only'); END;
   INSERT INTO bot_skills(bot_id, name, description, body, created_at, updated_at, state, used_at)
     SELECT bot_id, name, COALESCE(description, name), COALESCE(body, ''), created_at, created_at, 'active', created_at
     FROM bot_skill_pending WHERE action = 'write' ORDER BY created_at, id
     ON CONFLICT(bot_id, name) DO UPDATE SET description = excluded.description, body = excluded.body,
       updated_at = excluded.updated_at, state = 'active', used_at = excluded.used_at, lint_warnings = '[]';
   DELETE FROM bot_skills WHERE EXISTS (
     SELECT 1 FROM bot_skill_pending p WHERE p.bot_id = bot_skills.bot_id AND p.name = bot_skills.name AND p.action = 'delete'
   );
   DELETE FROM bot_skill_pending;
   UPDATE bot_learning SET approval = 0;`,
];

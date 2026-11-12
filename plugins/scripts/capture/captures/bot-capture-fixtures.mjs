import { createRequire } from "node:module";
import { join } from "node:path";

import { readStagedInstance } from "../../staged-instance.mjs";

const require = createRequire(import.meta.url);
const DAY = 86_400_000;

function openStagedDb(name) {
  const { dataDir } = readStagedInstance();
  const Database = require("../../../packages/bb-studio/node_modules/better-sqlite3");
  return new Database(join(dataDir, name), { timeout: 5000 });
}

/** Backdate only the staged BB's persisted thread timestamp for age-gated fixtures. */
export function backdateThread(threadId, days) {
  const db = openStagedDb("bb.db");
  try {
    const at = Date.now() - days * DAY;
    const changed = db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(at, threadId).changes;
    if (changed !== 1) throw new Error(`Could not backdate staged thread ${threadId}`);
    return at;
  } finally {
    db.close();
  }
}

/** Keep the prompt-cache UI deterministic without waiting an hour. */
export function backdateLatestTokenUsage(threadId, milliseconds) {
  const db = openStagedDb("bb.db");
  try {
    const event = db.prepare("SELECT sequence FROM events WHERE thread_id = ? AND type = 'thread/tokenUsage/updated' ORDER BY sequence DESC LIMIT 1").get(threadId);
    if (!event) throw new Error(`Staged thread ${threadId} has no token-usage event to clock-shift`);
    const at = Date.now() - milliseconds;
    db.prepare("UPDATE events SET created_at = ? WHERE thread_id = ? AND sequence = ?").run(at, threadId, event.sequence);
    return at;
  } finally {
    db.close();
  }
}

/** Advance only the staged fixture's append-only setting row past its dry-run day. */
export function advanceMaintenanceWindow(botId) {
  const db = openStagedDb("plugins/studio/data.db");
  try {
    const row = db.prepare("SELECT settings FROM bot_maintenance_settings WHERE bot_id = ? ORDER BY id DESC LIMIT 1").get(botId);
    if (!row) throw new Error(`Bot ${botId} has no staged maintenance setting to advance`);
    const settings = JSON.parse(row.settings);
    if (!settings.enabled || settings.enabledAt == null) throw new Error("The staged maintenance window is not enabled");
    settings.enabledAt = Date.now() - DAY - 1000;
    db.prepare("INSERT INTO bot_maintenance_settings (bot_id, at, settings) VALUES (?, ?, ?)").run(botId, Date.now(), JSON.stringify(settings));
    return settings.enabledAt;
  } finally {
    db.close();
  }
}

/** Read an assertion from the staged BB database without changing app state. */
export function stagedThread(threadId) {
  const db = openStagedDb("bb.db");
  try {
    return db.prepare("SELECT id, title, status, archived_at, updated_at, environment_id FROM threads WHERE id = ?").get(threadId) ?? null;
  } finally {
    db.close();
  }
}

export function stagedPendingInteraction(threadId) {
  const db = openStagedDb("bb.db");
  try {
    return db.prepare("SELECT id, status FROM pending_interactions WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1").get(threadId) ?? null;
  } finally {
    db.close();
  }
}

export function stagedAutomation(id) {
  const db = openStagedDb("plugins/studio/data.db");
  try {
    return db.prepare("SELECT id, name, kind, state, bb_ids, project_id FROM bot_automations WHERE id = ?").get(id) ?? null;
  } finally {
    db.close();
  }
}


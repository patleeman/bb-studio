import type Database from "better-sqlite3";

export const PERSONAL_LEAD_PROJECT = "proj_personal";

export function storedLeadThread(db: Database.Database, projectId: string): string | null {
  return (db.prepare("SELECT lead_thread_id FROM project_leads WHERE project_id = ?").get(projectId) as { lead_thread_id: string | null } | undefined)?.lead_thread_id ?? null;
}

export function primaryBotThread(db: Database.Database): string | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_leads'").get()) return null;
  return storedLeadThread(db, PERSONAL_LEAD_PROJECT);
}

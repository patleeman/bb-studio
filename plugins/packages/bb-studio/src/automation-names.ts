import type Database from "better-sqlite3";

const builtins = [{ id: "heartbeat", name: "Check-in" }, { id: "maintenance", name: "Maintenance" }];

/** Shared name policy for the unified list, including direct runner commands. */
export function automationName(db: Database.Database, botId: string, name: string, exceptId?: string): void {
  if (!name.trim()) throw new Error("Give it a name.");
  const entries = [...builtins, ...stored(db, botId)];
  if (entries.some((e) => e.id !== exceptId && (e.name.toLowerCase() === name.toLowerCase() || e.id.toLowerCase() === name.toLowerCase()))) {
    throw new Error(`There's already an automation named "${name}" (or that name is reserved).`);
  }
}

function stored(db: Database.Database, botId: string): { id: string; name: string }[] {
  return db.prepare("SELECT id, name FROM bot_automations WHERE bot_id = ? UNION ALL SELECT id, name FROM bot_runners WHERE bot_id = ?").all(botId, botId) as { id: string; name: string }[];
}

/** Exact IDs win. Legacy duplicate names require the caller to supply an ID. */
export function automationId(db: Database.Database, botId: string, value: string): string {
  const entries = [...builtins, ...stored(db, botId)];
  const exact = entries.find((e) => e.id === value);
  if (exact) return exact.id;
  const matches = entries.filter((e) => e.name.toLowerCase() === value.toLowerCase());
  if (matches.length > 1) throw new Error(`Automation name "${value}" is ambiguous; use its ID.`);
  if (!matches.length) throw new Error(`No automation "${value}".`);
  return matches[0]!.id;
}

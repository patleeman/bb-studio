// The Bot's Automations table (`bot_automation_table`, design 7b): every
// automation that belongs to one Bot in one list. Built on the server by
// src/automation-table.ts; the desktop page (src/ui/automations/) and the
// iOS app read the same rows. Zod only, so the UI can import it.
import { z } from "zod";

/** Studio's own kinds, plus "schedule" (the Bot's heartbeat check-in and maintenance) and "bb" (a bb core automation Studio didn't make). */
export const automationTableKind = z.enum(["watcher", "checkin", "schedule", "reminder", "runner", "bb"]);
export type AutomationTableKind = z.infer<typeof automationTableKind>;

export const automationTableRow = z.object({
  /** The row's id: the Studio automation's (`aut_…`, `heartbeat`, `maintenance`), the runner's (`run_…`), or the bb automation's (`auto_…`) for kind "bb". */
  id: z.string(),
  kind: automationTableKind,
  name: z.string(),
  /** The schedule in a few words, 24-hour: "Daily 07:45", "Every 2 h, 08:00–23:00", "Weekdays 09:00", "Sun 10:15". */
  when: z.string(),
  lastRunAt: z.number().nullable(),
  /** How the latest run went: "ok" (ran or had nothing to do), "failed", or null when unknown or never run. */
  lastRun: z.enum(["ok", "failed"]).nullable(),
  /** "active"; "paused" (paused, disabled, or imported paused); "off" (a reminder or one-shot that is done). */
  status: z.enum(["active", "paused", "off"]),
  /** On a mirrored install: imported from bb and paused here so it doesn't run twice. The UI says "Paused · in bb". */
  inBb: z.boolean(),
  /** No pause, resume, edit or delete here. True exactly when inBb. */
  readOnly: z.boolean(),
  /** The linked bb core automation, when there is one (a watcher's, a runner's, or the row itself for kind "bb"). */
  bb: z.object({ id: z.string(), projectId: z.string() }).nullable(),
  /** The thread it wakes or runs in, when known. */
  threadId: z.string().nullable(),
  /** What it does: the instruction, runner job or agent prompt. */
  instruction: z.string().nullable(),
  /** A watcher's script. */
  script: z.string().nullable(),
  /**
   * Why it belongs to this Bot: "studio" (a Studio row of the Bot's), "thread"
   * (a bb automation whose target or creating thread is the Bot's), "primary"
   * (a bb automation with no link to any Bot, on the primary Bot).
   */
  via: z.enum(["studio", "thread", "primary"]),
});
export type AutomationTableRow = z.infer<typeof automationTableRow>;

export const automationTable = z.object({
  botId: z.string(),
  /** This install is a BB Studio copy with the one-way import from bb (`fork-import.json`). */
  mirrored: z.boolean(),
  /** Whether bb's automations plugin answered. When "off", bb rows were read from its data file and have no bb detail page. */
  bbPlugin: z.enum(["on", "off"]),
  /** Active first, then by name. */
  rows: z.array(automationTableRow),
});
export type AutomationTable = z.infer<typeof automationTable>;

export const automationRefId = (botId: string, rowId: string): string => `${botId}:${rowId}`;

export function parseAutomationRefId(id: string | null | undefined): { botId: string; rowId: string } | null {
  const at = id ? id.indexOf(":") : -1;
  if (!id || at <= 0 || at === id.length - 1) return null;
  return { botId: id.slice(0, at), rowId: id.slice(at + 1) };
}

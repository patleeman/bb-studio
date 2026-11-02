// What the Bot page remembers beyond the Bot's jobs (src/ui/bot/BotPage.tsx):
//
// - Calendar group names. Runs that start within 15 minutes of each other
//   form one block, named from its time ("5 AM checks") until Patrick or the
//   Bot renames it ("Area sweep"). A name is saved under the group's key
//   (src/calendar-group-key.ts): its window's clock times and its jobs, so it
//   holds on every day the group runs and lapses when the group changes.
//   The Bot renames one with bot_calendar_group_rename.
// - Dismissed failures. A failed run sits in Needs you until a later run of
//   the job succeeds or Patrick dismisses it; a dismissal is that one run.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { clockMinute, groupKey } from "./calendar-group-key";

export const GROUP_NAME_MAX = 60;

export class BotPageState {
  constructor(private readonly db: Database.Database) {}

  /** The Bot's group names, by key. */
  groupNames(botId: string): Record<string, string> {
    const rows = this.db.prepare("SELECT key, name FROM bot_group_names WHERE bot_id = ?").all(botId) as { key: string; name: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, row.name]));
  }

  /** Names a group; an empty name goes back to the automatic one. `by`: "user" or the Bot. */
  renameGroup(botId: string, key: string, name: string | null, by: "user" | "bot", now = Date.now()): Record<string, string> {
    const text = (name ?? "").replace(/\s+/g, " ").trim().slice(0, GROUP_NAME_MAX);
    if (!/^\d\d:\d\d-\d\d:\d\d\|.+$/.test(key)) throw new Error("That isn't a calendar group.");
    if (!text) this.db.prepare("DELETE FROM bot_group_names WHERE bot_id = ? AND key = ?").run(botId, key);
    else this.db.prepare("INSERT INTO bot_group_names (bot_id, key, name, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (bot_id, key) DO UPDATE SET name = excluded.name, by = excluded.by, at = excluded.at").run(botId, key, text, by, now);
    return this.groupNames(botId);
  }

  /** Dismissed failed runs, as "<automationId>:<runId>". */
  dismissed(botId: string): string[] {
    return (this.db.prepare("SELECT automation_id, run_id FROM bot_run_dismissals WHERE bot_id = ? ORDER BY at DESC LIMIT 500").all(botId) as { automation_id: string; run_id: string }[])
      .map((row) => `${row.automation_id}:${row.run_id}`);
  }

  dismiss(botId: string, automationId: string, runId: string, now = Date.now()): string[] {
    this.db.prepare("INSERT OR IGNORE INTO bot_run_dismissals (bot_id, automation_id, run_id, at) VALUES (?, ?, ?, ?)").run(botId, automationId, runId, now);
    return this.dismissed(botId);
  }
}

export interface GroupToolDeps {
  state: BotPageState;
  /** The Bot a thread works for; null outside a Bot's threads. */
  acting(threadId: string | undefined): Promise<{ botId: string; via: "own" | "runner" | "started" } | null>;
  /** The Bot's jobs, to find the ones named. */
  jobs(botId: string): Promise<{ id: string; name: string }[]>;
}

export const groupRenameParams = z.object({
  start: z.string().describe("When the group's first run starts, 24-hour HH:MM, e.g. \"05:00\""),
  end: z.string().describe("When its last run starts, HH:MM, e.g. \"05:15\""),
  jobs: z.array(z.string().min(1).max(200)).min(2).max(50).describe("The jobs in it, by name (or id)"),
  name: z.string().max(GROUP_NAME_MAX).describe("The block's new name, e.g. \"Area sweep\"; empty goes back to the automatic name"),
});

/** Resolves a rename to its group key, or says what's wrong. */
export function groupRenameKey(input: z.infer<typeof groupRenameParams>, jobs: { id: string; name: string }[]): { key: string } | { error: string } {
  const from = clockMinute(input.start), to = clockMinute(input.end);
  if (from === null || to === null || to < from) return { error: "start and end are clock times (HH:MM), end not before start." };
  const ids: string[] = [];
  for (const wanted of input.jobs) {
    const match = jobs.find((job) => job.id === wanted) ?? jobs.find((job) => job.name.toLowerCase() === wanted.trim().toLowerCase());
    if (!match) return { error: `No job named "${wanted}". Your jobs: ${jobs.map((job) => job.name).join(", ") || "none"}.` };
    ids.push(match.id);
  }
  return { key: groupKey(from, to, ids) };
}

export function registerGroupTool(bb: Pick<BbPluginApi, "agents">, deps: GroupToolDeps): void {
  bb.agents.registerTool({
    name: "bot_calendar_group_rename",
    description: "Name a block on your Bot page's week. Runs that start within 15 minutes of each other show as one block, named from its time (\"5 AM checks\"); give it a name that says what it is (\"Area sweep\"). The name holds every day the same jobs run in that window. Give the window and the jobs in it; an empty name goes back to the automatic one.",
    parameters: groupRenameParams,
    execute: async (input, ctx) => {
      const self = await deps.acting(ctx.threadId);
      if (!self || self.via === "runner") return "Only a Bot (in its own thread or one it started) can name its calendar groups.";
      const resolved = groupRenameKey(input, await deps.jobs(self.botId));
      if ("error" in resolved) return resolved.error;
      deps.state.renameGroup(self.botId, resolved.key, input.name, "bot");
      return input.name.trim() ? `The ${input.start}–${input.end} block is now "${input.name.trim()}".` : `The ${input.start}–${input.end} block is back to its automatic name.`;
    },
  });
}

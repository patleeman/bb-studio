import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAINTENANCE_ID, type AutomationTableRow } from "../automation-table-contract";
import type { BotAutomationView } from "../contract";
import type { Loop } from "./contract";

export const REMINDER_LOOP_PREFIX = "loop_reminder_";
export const reminderLoopId = (automationId: string) => `${REMINDER_LOOP_PREFIX}${automationId}`;

export const scheduledItem = z.object({
  key: z.string(),
  source: z.enum(["todo", "automation"]),
  id: z.string(),
  botId: z.string().nullable(),
  botName: z.string().nullable(),
  kind: z.enum(["todo", "checkin", "reminder", "watcher", "runner", "schedule", "bb"]),
  title: z.string(),
  nextAt: z.number().nullable(),
  state: z.enum(["active", "paused"]),
  scheduleText: z.string(),
  threadId: z.string().nullable(),
  link: z.string(),
});
export type ScheduledItem = z.infer<typeof scheduledItem>;

export const scheduledContract = defineRpcContract({
  "loops.scheduled": {
    input: z.object({ threadId: z.string().min(1).max(200).optional() }),
    output: z.object({ items: z.array(scheduledItem) }),
  },
});

export interface ScheduledBot {
  id: string;
  name: string;
  threadId: string | null;
  primary: boolean;
  automations: readonly BotAutomationView[];
  table?: readonly AutomationTableRow[];
}

const ownerThread = (owner: string, primaryThread: string | null): string | null =>
  owner.startsWith("thread:") ? owner.slice("thread:".length) : owner === "cos" ? primaryThread : null;

export function scheduledItems(input: { loops: readonly Loop[]; bots: readonly ScheduledBot[]; threadId?: string | null }): ScheduledItem[] {
  const primary = input.bots.find((bot) => bot.primary) ?? null;
  const loopIds = new Set(input.loops.map((loop) => loop.id));
  const items: ScheduledItem[] = [];
  for (const loop of input.loops) {
    if (loop.closedAt || (loop.status !== "queued" && loop.status !== "snoozed") || loop.trigger.type !== "time") continue;
    items.push({
      key: `todo:${loop.id}`, source: "todo", id: loop.id, botId: primary?.id ?? null, botName: primary?.name ?? null, kind: "todo",
      title: loop.title, nextAt: loop.trigger.at ?? null, state: "active", scheduleText: loop.status === "snoozed" ? "Snoozed" : "Once",
      threadId: ownerThread(loop.owner, primary?.threadId ?? null), link: `bb://todo/${loop.id}`,
    });
  }
  for (const bot of input.bots) {
    for (const view of bot.automations) {
      if (view.id === MAINTENANCE_ID || (view.state !== "active" && view.state !== "paused")) continue;
      if (view.kind === "reminder" && loopIds.has(reminderLoopId(view.id))) continue;
      items.push({
        key: `automation:${bot.id}:${view.id}`, source: "automation", id: view.id, botId: bot.id, botName: bot.name, kind: view.kind,
        title: view.name, nextAt: view.state === "active" ? view.nextRunAt : null, state: view.state, scheduleText: view.scheduleText,
        threadId: view.threadId ?? (view.target === "main" ? bot.threadId : null), link: `bb://automation/${encodeURIComponent(`${bot.id}:${view.id}`)}`,
      });
    }
    const listed = new Set(bot.automations.map((view) => view.id));
    for (const row of bot.table ?? []) {
      if (row.id === MAINTENANCE_ID || listed.has(row.id) || row.status === "off") continue;
      if (row.kind === "reminder" && loopIds.has(reminderLoopId(row.id))) continue;
      items.push({
        key: `automation:${bot.id}:${row.id}`, source: "automation", id: row.id, botId: bot.id, botName: bot.name, kind: row.kind,
        title: row.name, nextAt: null, state: row.status, scheduleText: row.when, threadId: row.threadId, link: `bb://automation/${encodeURIComponent(`${bot.id}:${row.id}`)}`,
      });
    }
  }
  const shown = input.threadId ? items.filter((item) => item.threadId === input.threadId) : items;
  return shown.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.title.localeCompare(b.title));
}

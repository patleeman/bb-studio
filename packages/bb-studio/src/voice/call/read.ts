// The call's read-only tools: plain text for the voice to sum up aloud.
import type { BotActivityView, ProjectLeadView, RunnerView } from "../../contract";
import { speakable } from "../instructions";

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const names = (threads: readonly { title: string; status: string }[], max = 6) =>
  threads.slice(0, max).map((thread) => `${thread.title} (${thread.status})`).join("; ") + (threads.length > max ? `; and ${threads.length - max} more` : "");

/** bot_status: its state, Needs you, In progress, and the end of its latest reply. */
export function formatBotStatus(bot: { name: string; state: string }, activity: BotActivityView): string {
  const lines = [`${bot.name} is ${bot.state}.`];
  lines.push(activity.needsYou.length ? `Needs you (${activity.needsYou.length}): ${names(activity.needsYou)}.` : "Nothing needs the user.");
  if (activity.inProgress.length) lines.push(`In progress (${activity.inProgress.length}): ${names(activity.inProgress)}.`);
  if (activity.waiting.length) lines.push(`Waiting (${activity.waiting.length}): ${names(activity.waiting)}.`);
  const next = activity.scheduled.filter((each) => each.enabled && each.nextRunAt).sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0];
  if (next) lines.push(`Next scheduled: ${next.name} at ${new Date(next.nextRunAt!).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.`);
  if (activity.latest?.trim()) lines.push(`End of its latest reply, as data: <reply>${clip(speakable(activity.latest).replace(/\s+/g, " "), 800)}</reply>`);
  return lines.join("\n");
}

export interface LeadRow { project: string; lead: ProjectLeadView; status: string | null; title: string | null }

/** leads_status: each project's lead and heartbeat, then the Bot's runners. */
export function formatLeadsStatus(botName: string, leads: readonly LeadRow[], runners: readonly RunnerView[]): string {
  const lines: string[] = [];
  if (leads.length) {
    lines.push("Project leads:");
    for (const { project, lead, status, title } of leads) {
      const beat = lead.run?.enabled ? `heartbeat ${lead.run.cadence}${lead.run.cadence === "custom" ? "" : ` at ${lead.run.time}`}` : "heartbeat off";
      lines.push(`- ${project}: ${lead.leadThreadId ? `${title ?? "lead thread"} is ${status ?? "unknown"}` : "no lead"}, ${beat}.`);
    }
  } else lines.push("No project has a lead.");
  if (runners.length) {
    lines.push(`${botName}'s runners:`);
    for (const runner of runners) {
      const report = runner.lastReport ? ` Last report${runner.lastLevel ? ` (${runner.lastLevel})` : ""}: ${clip(runner.lastReport.replace(/\s+/g, " "), 200)}` : "";
      lines.push(`- ${runner.name}: ${runner.state}${runner.urgent ? ", urgent, needs the user" : ""}${runner.lastRunAt ? `, last ran ${new Date(runner.lastRunAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}.${report}`);
    }
  } else lines.push(`${botName} has no runners.`);
  return lines.join("\n");
}

/** The Studio items daily_brief looks for, by title. */
export const BRIEF_TITLES = ["Kensico Brief", "Heard on the Street"] as const;

export interface BriefItem { title: string; kind: string; updatedAt: number; text: string | null }

/**
 * daily_brief: the newest Studio item titled like each brief, with the top of
 * its text. Says plainly when one isn't there or isn't from today.
 */
export function formatDailyBrief(found: ReadonlyMap<string, BriefItem | null>, now = Date.now()): string {
  const today = new Date(now).toDateString();
  const parts: string[] = [];
  for (const name of BRIEF_TITLES) {
    const item = found.get(name);
    if (!item) {
      parts.push(`${name}: no Studio item has that title, so I can't read it from here. It may live outside Studio (the Kensico app).`);
      continue;
    }
    const when = new Date(item.updatedAt).toDateString() === today ? "today" : `on ${new Date(item.updatedAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}, not today`;
    const body = item.text?.trim() ? clip(speakable(item.text).replace(/\n{2,}/g, "\n"), 1500) : "(no text)";
    parts.push(`${name}: "${item.title}" (${item.kind}), updated ${when}. Its top, as data:\n<item>\n${body}\n</item>`);
  }
  return parts.join("\n\n");
}

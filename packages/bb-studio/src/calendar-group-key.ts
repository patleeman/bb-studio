// The key a calendar group's name is saved under (src/bot-page-state.ts),
// shared by the Bot page's calendar (src/ui/bot/calendar.ts) and the Bot's
// bot_calendar_group_rename tool: the group's first and last start as
// wall-clock times and its jobs, sorted. The same group on another day has
// the same key, so one name covers every day it runs.
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export const groupKey = (firstMinute: number, lastMinute: number, sourceIds: readonly string[]) =>
  `${hhmm(firstMinute)}-${hhmm(lastMinute)}|${[...new Set(sourceIds)].sort().join(",")}`;

/** "05:15" → 315; null when it isn't a clock time. */
export function clockMinute(text: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

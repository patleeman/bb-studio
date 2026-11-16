import { dayNumber } from "../../loops/clock";
import type { AreaRun, AreaStatus, AreaView, OpenItem } from "../contract";

export const RUN_BARS = 7;
export const OPEN_SHOWN = 3;

export const STATUS_LABEL: Record<AreaStatus, string> = { broken: "Broken", flagged: "Needs a look", ok: "Fine", unknown: "No report yet" };
export const OUTCOME_LABEL: Record<AreaRun["outcome"], string> = { ok: "fine", flagged: "flagged", broken: "broken" };

const RANK: Record<AreaStatus, number> = { broken: 0, flagged: 1, ok: 2, unknown: 3 };

export function areaOrder<T extends Pick<AreaView, "status" | "name">>(areas: readonly T[]): T[] {
  return [...areas].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
}

export function runBars(runs: readonly AreaRun[], count = RUN_BARS): AreaRun[] {
  return runs.slice(0, count).reverse();
}

export function openItems(items: readonly OpenItem[], shown = OPEN_SHOWN): { shown: OpenItem[]; more: number } {
  const ordered = [...items].sort((a, b) => Number(b.needsUser) - Number(a.needsUser));
  return { shown: ordered.slice(0, shown), more: Math.max(0, ordered.length - shown) };
}

export function itemAge(item: Pick<OpenItem, "since" | "sinceAt">, now: number, zone?: string): string {
  if (item.sinceAt !== null) {
    const days = dayNumber(now, zone) - dayNumber(item.sinceAt, zone);
    if (days <= 0) return "today";
    if (days === 1) return "1 day";
    if (days < 7) return `${days} days`;
    return new Date(item.sinceAt).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(zone ? { timeZone: zone } : {}) });
  }
  return item.since?.trim() || "";
}

export function areaWho(area: Pick<AreaView, "ownerName" | "cadence">, workers = 0): string {
  const how = workers > 0 ? `${workers} worker${workers === 1 ? "" : "s"}` : area.cadence;
  return [area.ownerName, how].filter(Boolean).join(" · ");
}

export function runWhen(at: number, now: number, zone?: string): string {
  const days = Math.abs(dayNumber(at, zone) - dayNumber(now, zone));
  const opts = zone ? { timeZone: zone } : {};
  const time = new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...opts });
  if (days === 0) return time;
  if (days < 7) return `${new Date(at).toLocaleDateString("en-US", { weekday: "short", ...opts })} ${time}`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", ...opts });
}

export function areaWhen(area: Pick<AreaView, "lastRun" | "nextRun" | "nextLabel" | "paused">, now: number, zone?: string): { last: string | null; next: string | null; nextLabel: string } {
  return {
    last: area.lastRun !== null ? runWhen(area.lastRun, now, zone) : null,
    next: area.paused ? "Paused" : area.nextRun !== null ? runWhen(area.nextRun, now, zone) : null,
    nextLabel: area.nextLabel ?? "Next",
  };
}

export function isProblem(status: AreaStatus): boolean {
  return status === "broken" || status === "flagged";
}

import type { PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import type { RoomWork, ThreadStatusView } from "./contract";
import { directStatusPresentation } from "./direct-status";

type Presentation = ReturnType<typeof directStatusPresentation>;
type Candidate = Presentation & { rank: number };

const rank: Record<ThreadStatusView["indicator"], number> = {
  "unread-error": 100,
  "waiting-for-input": 95,
  "working-draft": 85,
  "plan-mode": 85,
  goal: 84,
  runtime: 83,
  workflow: 82,
  "background-agent": 81,
  "background-command": 80,
  "queued-failed": 70,
  "queued-waiting": 45,
  draft: 0,
  "unread-success": 0,
  none: 0,
};

export function channelStatusPresentation({
  threads, work, active, unread, draft, needsAttention, rowStatuses,
}: {
  threads: readonly ThreadStatusView[];
  work: RoomWork | undefined;
  active: boolean;
  unread: boolean;
  draft: boolean;
  needsAttention: boolean;
  rowStatuses: ReadonlyMap<string, PluginSidebarThreadRowStatus>;
}): Presentation {
  const candidates: Candidate[] = [];
  if (needsAttention) candidates.push({
    icon: "BellDot", label: "Channel needs your attention", shortLabel: "Needs you",
    tone: "paused", motion: null, rank: 110,
  });
  for (const thread of threads) {
    const rowStatus = rowStatuses.get(thread.threadId) ?? null;
    if (!rank[thread.indicator] && !rowStatus) continue;
    const status = directStatusPresentation(thread, false, rowStatus);
    const overridden = rowStatus &&
      !["runtime", "unread-error", "waiting-for-input"].includes(thread.indicator);
    const statusRank = overridden
      ? rowStatus.tone === "error" ? 98 : rowStatus.tone === "running" ? 88 : 35
      : rank[thread.indicator];
    candidates.push({ ...status,
      label: status.label.replace("Direct message", "Channel"), rank: statusRank });
  }
  if ((work?.running || (active && !work?.queued)) &&
    !candidates.some((candidate) => candidate.tone === "working")) candidates.push({
    icon: "Loading", label: "Bot work running in channel", shortLabel: "Working",
    tone: "working", motion: "spin", rank: 75,
  });
  if (work?.queued) candidates.push({
    icon: "Clock", label: "Bot work queued in channel", shortLabel: "Queued",
    tone: "paused", motion: null, rank: 40,
  });
  if (draft) candidates.push({
    icon: "Edit", label: "Channel has an unsent draft", shortLabel: "Draft",
    tone: "paused", motion: null, rank: 20,
  });
  if (unread) candidates.push({
    icon: null, label: "Unread channel messages", shortLabel: "Unread",
    tone: "ready", motion: null, rank: 10,
  });
  candidates.sort((a, b) => b.rank - a.rank);
  const first = candidates[0];
  if (!first) return { icon: null, label: "Channel ready", shortLabel: "Ready",
    tone: "ready", motion: null };
  const counts = new Map<string, number>();
  for (const candidate of candidates)
    counts.set(candidate.label, (counts.get(candidate.label) ?? 0) + 1);
  const details = [...counts].map(([label, count]) =>
    count > 1 ? `${count} × ${label}` : label);
  return {
    icon: first.icon,
    label: details.join(" · "),
    shortLabel: draft && first.tone === "working"
      ? `${first.shortLabel} · Draft` : first.shortLabel,
    tone: first.tone,
    motion: first.motion,
  };
}

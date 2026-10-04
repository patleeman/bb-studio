import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { OverviewThread } from "./data";

export const RUNNING = new Set(["running", "starting", "active", "stopping", "provisioning"]);

export function stateOf(thread: OverviewThread, live: PluginSidebarThread | undefined) {
  if (live?.hasPendingInteraction) return { label: "Needs you", order: 0, tone: "text-warning-foreground", reason: thread.blockedReason ?? "Waiting for your answer or approval." };
  if (live?.runtimeStatus === "waiting-for-host" || live?.runtimeStatus === "host-reconnecting") return { label: "Blocked", order: 0, tone: "text-warning-foreground", reason: "Waiting for the thread’s machine to reconnect." };
  const status = live?.status ?? thread.status;
  if (status === "error" || status === "failed" || live?.queuedWork === "failed") return { label: "Failed", order: 0, tone: "text-destructive", reason: thread.failureReason ?? thread.blockedReason ?? "The last run failed. Open the thread to inspect it." };
  if (live ? RUNNING.has(live.runtimeStatus) || live.activity.backgroundAgents > 0 || live.activity.backgroundCommands > 0 : RUNNING.has(status)) return { label: "Working", order: 1, tone: "text-foreground", reason: thread.progress ?? "Work is in progress." };
  return { label: "Idle", order: 2, tone: "text-muted-foreground", reason: thread.progress ?? "No active run." };
}


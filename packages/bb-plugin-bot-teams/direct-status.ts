import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PluginSidebarThreadRowStatus } from "@get-bb/plugin-sdk/app";
import type { DirectThreadView } from "./contract";

type ListedThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

export function directThreadIndicator(thread: ListedThread): DirectThreadView["indicator"] {
  const unreadDone = thread.parentThreadId === null &&
    (thread.status === "idle" || thread.status === "error") &&
    thread.latestAttentionAt > (thread.lastReadAt ?? 0);
  if (unreadDone && thread.status === "error") return "unread-error";
  if (thread.hasPendingInteraction) return "waiting-for-input";
  if (thread.activity.activePlanModeCount > 0) return "plan-mode";
  if (thread.activity.activeGoalCount > 0) return "goal";
  if (["active", "host-reconnecting", "provisioning", "starting", "stopping"]
    .includes(thread.runtime.displayStatus)) return "runtime";
  if (thread.activity.activeWorkflowCount > 0) return "workflow";
  if (thread.activity.activeBackgroundAgentCount > 0) return "background-agent";
  if (thread.activity.activeBackgroundCommandCount > 0) return "background-command";
  if (thread.queuedWork === "failed") return "queued-failed";
  if (unreadDone) return "unread-success";
  if (thread.queuedWork === "waiting") return "queued-waiting";
  return "none";
}

type DirectStatus = {
  icon: PluginSidebarThreadRowStatus["icon"] | null;
  label: string;
  shortLabel: string;
  tone: "ready" | "working" | "paused" | "error";
  motion: "spin" | "shine" | null;
};

export function directStatusPresentation(
  thread: Pick<DirectThreadView, "indicator">,
  hasDraft: boolean,
  rowStatus: PluginSidebarThreadRowStatus | null,
): DirectStatus {
  let indicator = thread.indicator;
  const active = [
    "runtime", "workflow", "background-agent", "background-command",
    "plan-mode", "goal",
  ].includes(indicator);
  if (hasDraft && active) indicator = "working-draft";
  else if (hasDraft && indicator === "none")
    indicator = "draft";

  if (rowStatus && !["runtime", "unread-error", "waiting-for-input"].includes(indicator))
    return {
      icon: rowStatus.icon,
      label: rowStatus.label,
      shortLabel: rowStatus.label,
      tone: rowStatus.tone === "error" ? "error" :
        rowStatus.tone === "running" ? "working" :
        rowStatus.tone === "success" ? "ready" : "paused",
      motion: rowStatus.tone === "running" ? "shine" : null,
    };

  switch (indicator) {
    case "unread-error":
      return { icon: "CircleX", label: "Unread direct message failed",
        shortLabel: "Failed", tone: "error", motion: null };
    case "waiting-for-input":
      return { icon: "CircleQuestion", label: "Direct message needs your input",
        shortLabel: "Needs input", tone: "paused", motion: null };
    case "working-draft":
      return { icon: "Edit", label: "Direct message working with an unsent draft",
        shortLabel: "Working · Draft", tone: "working", motion: "shine" };
    case "workflow":
      return { icon: "Workflow", label: "Workflow running",
        shortLabel: "Workflow", tone: "working", motion: "shine" };
    case "background-agent":
      return { icon: "UserRoundPlus", label: "Background agent running",
        shortLabel: "Agent running", tone: "working", motion: "shine" };
    case "background-command":
      return { icon: "Terminal", label: "Background command running",
        shortLabel: "Command running", tone: "working", motion: "shine" };
    case "plan-mode":
      return { icon: "ListTodo", label: "Plan mode active",
        shortLabel: "Plan mode", tone: "working", motion: "shine" };
    case "goal":
      return { icon: "Target", label: "Goal active",
        shortLabel: "Goal active", tone: "working", motion: "shine" };
    case "runtime":
      return { icon: "Loading", label: "Direct message working",
        shortLabel: "Working", tone: "working", motion: "spin" };
    case "draft":
      return { icon: "Edit", label: "Direct message has an unsent draft",
        shortLabel: "Draft", tone: "paused", motion: null };
    case "unread-success":
      return { icon: null, label: "Unread direct message reply",
        shortLabel: "Unread", tone: "ready", motion: null };
    case "queued-failed":
      return { icon: "CircleX", label: "Direct message failed to send",
        shortLabel: "Send failed", tone: "error", motion: null };
    case "queued-waiting":
      return { icon: "Clock", label: "Direct message queued",
        shortLabel: "Queued", tone: "paused", motion: null };
    case "none":
      return { icon: null, label: "Direct message ready",
        shortLabel: "Ready", tone: "ready", motion: null };
    default:
      return { icon: null, label: "Direct message ready",
        shortLabel: "Ready", tone: "ready", motion: null };
  }
}

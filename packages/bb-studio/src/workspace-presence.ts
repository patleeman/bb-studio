// What the user has open in Studio's workspace, for agents. Each BB window's
// workspace reports its panes and tabs here (the `workspaceReport` RPC) and
// listens on WORKSPACE_CHANNEL for tabs an agent opens or closes. Reports live
// in memory: the workspace itself is stored in the browser.

export interface WorkspaceTabReport { href: string; title: string }
export interface WorkspacePaneReport { id: string; focused: boolean; active: string | null; tabs: WorkspaceTabReport[] }
export interface WorkspaceReport {
  /** One BB window, for as long as it's open. */
  client: string;
  /** The window has focus. */
  focused: boolean;
  /** The window shows the workspace, not another BB page. */
  showing: boolean;
  panes: WorkspacePaneReport[];
}

/** A command for one window's workspace, published on WORKSPACE_CHANNEL. */
export type WorkspaceCommand =
  | { client: string; action: "open"; items: WorkspaceTabReport[]; placement: "tab" | "right" | "bottom"; show: boolean }
  | { client: string; action: "close"; hrefs: string[] };

const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 20;
/** The new tab page's href, which isn't an item. */
const BROWSE_HREF = "/plugins/studio/studio/browse";

export class WorkspacePresence {
  private readonly reports = new Map<string, WorkspaceReport & { at: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  report(report: WorkspaceReport): void {
    const at = this.now();
    this.reports.delete(report.client);
    this.reports.set(report.client, { ...report, at });
    for (const [client, each] of this.reports) {
      if (at - each.at > KEEP_MS || this.reports.size > MAX_CLIENTS) this.reports.delete(client);
    }
  }

  /** The window the user is most likely in: the focused one, else the last to report. */
  current(): (WorkspaceReport & { at: number }) | null {
    const all = [...this.reports.values()].sort((a, b) => b.at - a.at);
    return all.find((each) => each.focused) ?? all[0] ?? null;
  }
}

function ago(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/** The workspace as agents read it: each pane's tabs, and the one in front. */
export function formatWorkspace(report: (WorkspaceReport & { at: number }) | null, now: number): string {
  if (!report) return "No BB window has reported a Studio workspace. The user may not have BB open, or Studio isn't installed in it.";
  const where = report.showing
    ? report.focused ? "The user is looking at it now." : "It's on screen in BB, which isn't the focused app."
    : "The user is elsewhere in BB right now; these tabs are kept for when they come back.";
  const lines = [`The user's Studio workspace (updated ${ago(now - report.at)}). ${where}`];
  const tabs = report.panes.reduce((sum, pane) => sum + pane.tabs.length, 0);
  if (!tabs) {
    lines.push("No tabs are open.");
    return lines.join("\n");
  }
  report.panes.forEach((pane, index) => {
    if (report.panes.length > 1) lines.push("", `Pane ${index + 1}${pane.focused ? " (focused)" : ""}:`);
    for (const tab of pane.tabs) {
      const front = tab.href === pane.active;
      const label = tab.href === BROWSE_HREF ? "New tab (Studio's item list)" : `${tab.title} — ${tab.href}`;
      lines.push(`${front ? "▸" : "·"} ${label}${front ? (pane.focused ? " (in front, focused)" : " (in front)") : ""}`);
    }
  });
  return lines.join("\n");
}

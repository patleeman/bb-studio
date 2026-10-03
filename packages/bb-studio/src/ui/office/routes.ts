// Office routes. Each top-level view is its own Studio panel, so BB's tab
// header names it (Home, Inbox, Team, Space settings):
//   office                    Home of the current Space
//   office-inbox[/all]        this Space's Inbox, or every Space's
//   office-team/<botId>[/tab] a bot's desk; office-team/new adds a bot
//   office-settings           the current Space's settings
//   office-spaces/new         create a Space
// Callers use the old sub-paths ("inbox", "team/<id>", ...); officePath maps them.
import { openAppPath, panelHref } from "@bb-studio/kit/app";

export const OFFICE_PLUGIN_ID = "studio";
export const OFFICE_PANEL_PATH = "office";
export const OFFICE_NAV_ITEM_ID = `${OFFICE_PLUGIN_ID}/office`;

/** Sub-path heads that have their own panel, and the panel's path and title. */
export const OFFICE_PANELS = {
  inbox: { path: "office-inbox", title: "Inbox", icon: "studio/inbox" },
  team: { path: "office-team", title: "Team", icon: "UserRound" },
  settings: { path: "office-settings", title: "Space settings", icon: "SlidersHorizontal" },
  spaces: { path: "office-spaces", title: "New space", icon: "Plus" },
} as const;
type PanelHead = keyof typeof OFFICE_PANELS;

export function officePath(subPath = ""): string {
  const parts = subPath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const head = parts[0] as PanelHead | undefined;
  if (head && head in OFFICE_PANELS) return panelHref(OFFICE_PLUGIN_ID, OFFICE_PANELS[head].path, parts.slice(1).join("/"));
  return panelHref(OFFICE_PLUGIN_ID, OFFICE_PANEL_PATH, subPath);
}

export function openOffice(subPath = ""): void {
  openAppPath(officePath(subPath), { main: true });
}

export type OfficeRoute =
  | { view: "home" }
  | { view: "inbox"; scope: "space" | "all" }
  | { view: "bot"; botId: string; tab: "chat" | "tasks" | "profile" }
  | { view: "settings" }
  | { view: "new-space" }
  | { view: "new-bot" };

export function parseOfficeRoute(subPath: string): OfficeRoute {
  const parts = subPath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [head, second, third] = parts;
  if (head === "inbox") return { view: "inbox", scope: second === "all" ? "all" : "space" };
  if (head === "team" && second === "new") return { view: "new-bot" };
  if (head === "team" && second) {
    const tab = third === "tasks" || third === "profile" ? third : "chat";
    return { view: "bot", botId: second, tab };
  }
  if (head === "settings") return { view: "settings" };
  if (head === "spaces" && second === "new") return { view: "new-space" };
  return { view: "home" };
}

/** The office sub-path the browser is on ("", "inbox/all", "team/<id>"), or null outside the office. */
export function currentOfficeSubPath(pathname = globalThis.location?.pathname ?? ""): string | null {
  for (const [head, panel] of Object.entries(OFFICE_PANELS)) {
    const root = panelHref(OFFICE_PLUGIN_ID, panel.path);
    if (pathname === root) return head;
    if (pathname.startsWith(`${root}/`)) return `${head}/${pathname.slice(root.length + 1)}`;
  }
  const root = officePath();
  if (pathname === root) return "";
  if (pathname.startsWith(`${root}/`)) return pathname.slice(root.length + 1);
  return null;
}

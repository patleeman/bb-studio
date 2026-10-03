// Office routes live under Studio's "office" panel:
//   ""            Home of the current Space
//   inbox         this Space's Inbox; inbox/all for every Space
//   team/<botId>  a bot's desk; team/<botId>/<tab>
//   settings      the current Space's settings
//   spaces/new    create a Space
import { openAppPath, panelHref } from "@bb-studio/kit/app";

export const OFFICE_PLUGIN_ID = "studio";
export const OFFICE_PANEL_PATH = "office";
export const OFFICE_NAV_ITEM_ID = `${OFFICE_PLUGIN_ID}/office`;

export function officePath(subPath = ""): string {
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

/** The office sub-path the browser is on, or null outside the office panel. */
export function currentOfficeSubPath(pathname = globalThis.location?.pathname ?? ""): string | null {
  const root = officePath();
  if (pathname === root) return "";
  if (pathname.startsWith(`${root}/`)) return pathname.slice(root.length + 1);
  return null;
}

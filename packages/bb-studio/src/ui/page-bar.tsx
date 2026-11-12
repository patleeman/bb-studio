// One header row per Studio page (UX review 2, items 7 and 12; mockups 6e
// and 6f): the page's own title row lives in BB's title bar, in place of the
// panel's "Library" label (StudioBar, src/kit/app/item-header.tsx), so the
// Library, Memory and the older-conversations page show one row, not BB's
// row with Studio's below it. Where BB lends no title bar, the same row sits
// at the top of the page. The title never shrinks; the secondary text
// truncates first.
import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { StudioBar } from "../kit/app/index";
import { useHostTabWindow } from "../kit/app/host-sdk";
import { usePortalScopeProps } from "../kit/ui/portal-scope";

export interface PageBarProps { icon?: ReactNode; title: string; detail?: ReactNode; actions?: ReactNode }

export function PageBar({ icon, title, detail, actions, column = false }: PageBarProps & { column?: boolean }) {
  const tabWindow = useHostTabWindow();
  const scope = usePortalScopeProps();
  if (tabWindow) return actions && tabWindow.toolbar
    ? createPortal(<div {...scope} data-testid="page-bar" className="flex items-center gap-1.5">{actions}</div>, tabWindow.toolbar)
    : null;
  return (
    <StudioBar>
      <div data-testid="page-bar" data-studio-page-bar={column ? "column" : undefined} data-studio-no-drag="controls" className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-1">
        {icon ? <span aria-hidden className="shrink-0 text-muted-foreground">{icon}</span> : null}
        <h1 data-testid="page-bar-title" className="shrink-0 whitespace-nowrap text-sm font-semibold text-foreground">{title}</h1>
        {detail ? <><span aria-hidden className="-mx-1 shrink-0 text-sm text-muted-foreground">·</span><span data-testid="page-bar-detail" className="min-w-0 truncate text-sm text-muted-foreground">{detail}</span></> : null}
        <span className="min-w-0 flex-1" />
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
    </StudioBar>
  );
}

/** The name of an automation, a todo or a memory record opened as a page. */
export const ENTRY_TITLE = { automation: "Automation", todo: "Todo", record: "Memory record" } as const;
export type EntryKind = keyof typeof ENTRY_TITLE;
const isEntryKind = (segment: string): segment is EntryKind => Object.hasOwn(ENTRY_TITLE, segment);

const botNames = new Map<string, string>();
const botNameListeners = new Set<() => void>();
const subscribeBotNames = (listener: () => void) => { botNameListeners.add(listener); return () => { botNameListeners.delete(listener); }; };

/** A Bot's Info page tells its Bot's name, once loaded and whenever it changes. */
export function noteBotName(id: string, name: string): void {
  if (botNames.get(id) === name) return;
  botNames.set(id, name);
  botNameListeners.forEach((listener) => listener());
}

/** The Bot whose Info page the sub-path shows (`bot/<id>`); null for anything else. */
export function botInfoAt(subPath: string): string | null {
  const parts = subPath.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || parts[0] !== "bot" || !parts[1] || parts[1] === "new") return null;
  try { return decodeURIComponent(parts[1]); } catch { return null; }
}

/** The Studio panel's `experimental_usePageTitle`: a Bot's Info page is titled with the Bot's name once known; the rest as botPageTitle. */
export function useStudioPageTitle({ subPath }: { subPath: string }): { title: string; windowTitle: string } | null {
  const id = botInfoAt(subPath);
  const name = useSyncExternalStore(subscribeBotNames, () => (id ? botNames.get(id) ?? "" : ""), () => "");
  if (id) return name ? { title: name, windowTitle: name } : { title: "Bot", windowTitle: "Bot" };
  return botPageTitle(subPath);
}

/** The window's title on the Bot's own pages under the Studio panel (the bar names the page itself); null keeps "Library". */
export function botPageTitle(subPath: string): { title: string; windowTitle: string } | null {
  const parts = subPath.replace(/^\/+|\/+$/g, "").split("/");
  const title = parts[0] === "memory" ? "Memory"
    : parts[0] === "conversations" ? "Archive"
      : parts[0] === "new-conversation" ? "New conversation"
        : parts[0] === "bot" && parts.length === 3 && parts[2] === "loops" ? "Todos"
          : parts.length === 2 && isEntryKind(parts[0]!) ? ENTRY_TITLE[parts[0]]
            : null;
  return title ? { title, windowTitle: title } : null;
}

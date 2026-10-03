// The top of the sidebar: the Space switcher, then four rows (Home, Inbox,
// Search, New thread). Every other navigation row, from BB or a plugin, is
// reachable from the switcher menu or ⌘K, never as its own row: plugins add
// types, not places.
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_useSidebarNavigation as useSidebarNavigation,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import type { ReactNode } from "react";
import { usePathname } from "./location";
import { requestCount, useInboxCounts, useSpaces } from "./model";
import { currentOfficeSubPath, openOffice } from "./routes";
import { SpaceSwitcher, type SwitcherExtra } from "./SpaceSwitcher";
import { COUNT_HOT, ROW, ROW_ACTIVE, ROW_GLYPH, ROW_LABEL, SHORTCUT, cn } from "./styles";

/** BB's own rows the office keeps as rows. Matched by id, then label. */
function findHostItem(items: readonly ExperimentalSidebarNavigationItem[], key: "new-thread" | "search") {
  const pattern = key === "search" ? /search/i : /new[-_ ]?thread/i;
  return items.find((item) => item.pluginId === null && (pattern.test(item.id) || pattern.test(item.label))) ?? null;
}

/** Rows that move into the switcher menu: BB's settings-like rows. */
const MENU_ROWS = /plugins|skills|automations/i;

function NavRow({ icon, label, active, onClick, trailing, shortcutLabel }: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
  shortcutLabel?: string | null;
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={cn(ROW, active && ROW_ACTIVE)}>
      <span className={ROW_GLYPH}>{icon}</span>
      <span className={ROW_LABEL}>{label}</span>
      {trailing}
      {shortcutLabel ? <span className={SHORTCUT}>{shortcutLabel}</span> : null}
    </button>
  );
}

export function OfficeNavigation(_props: ExperimentalSidebarNavigationProps) {
  const { items, isShortcutModifierHeld, actions } = useSidebarNavigation();
  const pathname = usePathname();
  const sub = currentOfficeSubPath(pathname);
  const { current } = useSpaces();
  const counts = useInboxCounts();
  const waiting = current ? requestCount(counts.data, current.id) : 0;

  const newThread = findHostItem(items, "new-thread");
  const search = findHostItem(items, "search");
  const extras: SwitcherExtra[] = items
    .filter((item) => item.pluginId === null && MENU_ROWS.test(item.id) && !item.isDisabled)
    .map((item) => ({ id: item.id, label: item.label, icon: "Settings2", run: () => actions.activate(item.id, { openInSplit: false }) }));

  const shortcut = (item: ExperimentalSidebarNavigationItem | null) => (isShortcutModifierHeld ? item?.shortcut?.label ?? null : null);

  return (
    <nav aria-label="Office" className="relative shrink-0 space-y-0.5 px-2 pt-1 pb-2">
      <SpaceSwitcher extras={extras} />
      <div className="h-1" />
      <NavRow icon={<Icon name="Home" />} label="Home" active={sub === ""} onClick={() => openOffice("")} />
      <NavRow
        icon={<Icon name="Inbox" />}
        label="Inbox"
        active={sub === "inbox"}
        onClick={() => openOffice("inbox")}
        trailing={waiting > 0 ? <span className={COUNT_HOT} aria-label={`${waiting} waiting on you`}>{waiting}</span> : null}
      />
      {search
        ? <NavRow icon={<NavigationIcon icon={search.icon} />} label="Search" onClick={() => actions.activate(search.id, { openInSplit: false })} shortcutLabel={shortcut(search)} />
        : null}
      {newThread
        ? <NavRow icon={<NavigationIcon icon={newThread.icon} />} label="New thread" onClick={() => actions.activate(newThread.id, { openInSplit: false })} shortcutLabel={shortcut(newThread)} />
        : null}
    </nav>
  );
}

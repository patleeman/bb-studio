// The top of the sidebar: BB's own navigation, drawn the way BB draws it, with
// one change. Studio registers a panel for every kind of item so their links
// open, and each would be a row here; only Inbox, Projects and Library are
// places you go, so the rest stay reachable by link but out of the list.
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_useSidebarNavigation as useSidebarNavigation,
  experimental_useSidebarNavigationSplit as useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { ROW, ROW_ACTIVE, ROW_GLYPH, ROW_LABEL, cn } from "./styles";

/** Studio's panels that are places; every other Studio panel only serves links. */
const STUDIO_PLACES = new Set(["office-inbox", "projects", "studio"]);

export function isShown(item: Pick<ExperimentalSidebarNavigationItem, "isVisible" | "action">): boolean {
  if (!item.isVisible) return false;
  if (item.action.kind !== "open-plugin-panel" || item.action.pluginId !== "studio") return true;
  return STUDIO_PLACES.has(item.action.panelId);
}

function NavRow({ item, active, shortcutHeld, onActivate }: {
  item: ExperimentalSidebarNavigationItem;
  active: boolean;
  shortcutHeld: boolean;
  onActivate: (split: boolean) => void;
}) {
  const split = useSidebarNavigationSplit(item.id);
  const Accessory = item.experimental_Accessory;
  return (
    <button
      type="button"
      disabled={item.isDisabled}
      aria-current={active ? "page" : undefined}
      onPointerDown={split.splitProps.onPointerDown}
      onClick={(event) => onActivate(event.metaKey || event.ctrlKey)}
      className={cn(ROW, active && ROW_ACTIVE, item.isDisabled && "opacity-50")}
    >
      <span className={ROW_GLYPH}><NavigationIcon icon={item.icon} /></span>
      <span className={ROW_LABEL}>{item.label}</span>
      {shortcutHeld && item.shortcut ? <span className="shrink-0 text-xs text-subtle-foreground">{item.shortcut.label}</span> : Accessory ? <Accessory /> : null}
    </button>
  );
}

export function Navigation(_props: ExperimentalSidebarNavigationProps) {
  const { items, activeItemId, isShortcutModifierHeld, actions } = useSidebarNavigation();
  return (
    <nav aria-label="Navigation" className="shrink-0 space-y-px px-2 pt-1 pb-2">
      {items.filter(isShown).map((item) => (
        <NavRow
          key={item.id}
          item={item}
          active={item.id === activeItemId}
          shortcutHeld={isShortcutModifierHeld}
          onActivate={(split) => actions.activate(item.id, { openInSplit: split })}
        />
      ))}
    </nav>
  );
}

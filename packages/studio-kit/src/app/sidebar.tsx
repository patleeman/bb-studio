// Studio apps' sections in the sidebar, above the threads (see
// sidebar-registry.ts for how they get there).
//
// An app renders <SidebarPortal> from an `experimental_appOverlay`, with a
// <SidebarSection> inside it. The host, Studio Sidebar, renders
// <SidebarAnchors> at the top of its thread list. Sections never scroll on
// their own: the sidebar scrolls as one.
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import {
  anchorFor,
  canMove,
  host,
  isCollapsed,
  moveSection,
  publishAnchor,
  registerSection,
  revision,
  sectionKey,
  sections,
  setCollapsed,
  setHost,
  setSectionHidden,
  subscribe,
  type SidebarHost,
  type SidebarSectionInfo,
} from "./sidebar-registry";

function useRevision(): number {
  return useSyncExternalStore(subscribe, revision, revision);
}

// App side ---------------------------------------------------------------------

const SectionKeyContext = createContext<string | null>(null);

/**
 * Registers a section and renders `children` in the sidebar, in the app's own
 * React tree. Renders nothing while no sidebar shows the section (Studio
 * Sidebar isn't the thread list, or the user hid the section).
 */
export function SidebarPortal({ id, title, order = 100, children }: { id: string; title: string; order?: number; children: ReactNode }) {
  const pluginId = experimental_usePluginId();
  const key = sectionKey(pluginId, id);
  useEffect(() => registerSection({ pluginId, id, title, order }), [pluginId, id, title, order]);
  useRevision();
  const anchor = anchorFor(key);
  if (!anchor) return null;
  // The anchor sits in the host's tree. Mark the section as this plugin's
  // portal, as BB marks its own, so the plugin's CSS and route links apply.
  return createPortal(
    <div data-bb-portaled-overlay="" data-bb-plugin-root="" data-bb-plugin={pluginId}>
      <SectionKeyContext.Provider value={key}>{children}</SectionKeyContext.Provider>
    </div>,
    anchor,
    key,
  );
}

/** Whether a sidebar is showing sections at all, e.g. to skip loading data for one. */
export function useSidebarHosted(): boolean {
  useRevision();
  return host() !== null;
}

/** Expands one of this plugin's sections, e.g. when its search opens. */
export function useExpandSidebarSection(id: string): () => void {
  const pluginId = experimental_usePluginId();
  return () => {
    const key = sectionKey(pluginId, id);
    if (isCollapsed(key)) setCollapsed(key, false);
  };
}

/** Call after a sidebar row navigates: closes the sidebar on phones. */
export function useSidebarNavigated(): () => void {
  return () => host()?.navigate();
}

export const SIDEBAR_ROW =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:h-9";
export const SIDEBAR_ROW_SELECTED = "bg-sidebar-accent text-sidebar-accent-foreground";
const CONTROL =
  "relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-state-active data-[state=open]:text-muted-foreground max-md:pointer-coarse:size-9";

export interface SidebarSectionAction {
  label: string;
  icon: string;
  onClick(): void;
  pressed?: boolean;
}

/**
 * A section as BB draws its own: a small label that collapses the section,
 * then buttons and a ⋯ menu that show on hover. `menu` goes above the menu's
 * own Move and Hide rows.
 */
export function SidebarSection({
  title,
  label = title,
  actions = [],
  trailing,
  menu,
  menuLabel = `${title} list options`,
  children,
}: {
  title: string;
  /** The heading when it differs from the section's name, e.g. "Archived channels". */
  label?: string;
  actions?: readonly SidebarSectionAction[];
  /** Controls after the action buttons, e.g. a menu button of the section's own. */
  trailing?: ReactNode;
  menu?: ReactNode;
  /** The ⋯ button's label, "<title> list options" by default. */
  menuLabel?: string;
  children: ReactNode;
}) {
  const key = useContext(SectionKeyContext) ?? title;
  useRevision();
  const collapsed = isCollapsed(key);
  const [menuOpen, setMenuOpen] = useState(false);
  const bodyId = useId();
  return (
    <section aria-label={title} className="group/studio-section mb-2 min-w-0" data-studio-sidebar-section={key}>
      <div className="bb-sidebar-hover-actions-row flex h-7 min-w-0 items-center pl-2 text-xs leading-5 font-normal text-muted-foreground max-md:pointer-coarse:h-9">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 truncate text-subtle-foreground/75" title={label}>
            {label}
          </span>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? `Expand ${title} section` : `Collapse ${title} section`}
            className={cn(
              CONTROL,
              "size-6 max-md:pointer-coarse:size-6",
              !collapsed && "opacity-0 group-hover/studio-section:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            )}
            onClick={() => setCollapsed(key, !collapsed)}
          >
            <Icon name="ChevronRight" aria-hidden className={cn("size-3 transition-transform duration-150", !collapsed && "rotate-90")} />
          </button>
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/studio-section:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              aria-label={action.label}
              title={action.label}
              aria-pressed={action.pressed}
              className={cn(CONTROL, action.pressed && "bg-state-active text-muted-foreground")}
              onClick={action.onClick}
            >
              <Icon name={action.icon} className="size-4" />
            </button>
          ))}
          {trailing}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={menuLabel} className={CONTROL}>
                <Icon name="MoreHorizontal" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label={menuLabel}>
              {menu}
              {menu ? <DropdownMenuSeparator /> : null}
              <SectionPlacementItems sectionKey={key} title={title} />
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div id={bodyId} className={cn("flex min-w-0 flex-col gap-px", collapsed && "hidden")}>
        {children}
      </div>
    </section>
  );
}

function SectionPlacementItems({ sectionKey: key, title }: { sectionKey: string; title: string }) {
  return (
    <>
      {canMove(key, -1) ? (
        <DropdownMenuItem onSelect={() => moveSection(key, -1)}>
          <Icon name="ArrowUp" />
          Move up
        </DropdownMenuItem>
      ) : null}
      {canMove(key, 1) ? (
        <DropdownMenuItem onSelect={() => moveSection(key, 1)}>
          <Icon name="ArrowDown" />
          Move down
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem aria-label={`Hide ${title}`} onSelect={() => setSectionHidden(key, true)}>
        <Icon name="EyeOff" />
        Hide section
      </DropdownMenuItem>
    </>
  );
}

/** A quiet line in a section: empty, loading, or a failure. */
export function SidebarNote({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  return <p className={cn("m-0 px-2 py-1 text-xs", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>{children}</p>;
}

/** A group heading inside a section, e.g. "Needs you". */
export function SidebarGroupHeading({ children }: { children: ReactNode }) {
  return <p className="m-0 mt-1.5 px-2 text-xs leading-5 text-muted-foreground">{children}</p>;
}

// Organize and sort, the same for every section --------------------------------

export type SidebarDirection = "ascending" | "descending";
export interface SidebarDisplay<Organize extends string, Sort extends string> {
  organization: Organize;
  sort: Sort;
  direction: SidebarDirection;
}

/** A section's organize and sort choice, kept per browser. */
export function useSidebarDisplay<Organize extends string, Sort extends string>(
  storageKey: string,
  defaults: SidebarDisplay<Organize, Sort>,
  allowed: { organization: readonly Organize[]; sort: readonly Sort[] },
): [SidebarDisplay<Organize, Sort>, (next: SidebarDisplay<Organize, Sort>) => void] {
  const [display, setDisplay] = useState<SidebarDisplay<Organize, Sort>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<SidebarDisplay<Organize, Sort>> | null;
      return {
        organization: allowed.organization.includes(value?.organization as Organize) ? value!.organization! : defaults.organization,
        sort: allowed.sort.includes(value?.sort as Sort) ? value!.sort! : defaults.sort,
        direction: value?.direction === "ascending" || value?.direction === "descending" ? value.direction : defaults.direction,
      };
    } catch {
      return defaults;
    }
  });
  const update = (next: SidebarDisplay<Organize, Sort>) => {
    setDisplay(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  };
  return [display, update];
}

/** "Organize by" and "Sort by" submenus for a section's ⋯ menu. */
export function SidebarDisplayMenuItems<Organize extends string, Sort extends string>({
  noun,
  display,
  onChange,
  organize,
  sort,
}: {
  /** Plural, lower case: "channels". */
  noun: string;
  display: SidebarDisplay<Organize, Sort>;
  onChange(next: SidebarDisplay<Organize, Sort>): void;
  organize: readonly (readonly [Organize, string])[];
  sort: readonly (readonly [Sort, string, SidebarDirection])[];
}) {
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger aria-label="Organize by">
          <Icon name="Layers" />
          Organize by
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent aria-label={`Organize ${noun}`}>
          {organize.map(([value, label]) => (
            <DropdownMenuItem
              key={value}
              role="menuitemradio"
              aria-checked={display.organization === value}
              aria-label={label}
              onSelect={(event) => {
                event.preventDefault();
                onChange({ ...display, organization: value });
              }}
            >
              {label}
              {display.organization === value ? <Icon name="Check" className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger aria-label="Sort by">
          <Icon name="ArrowUpDown" />
          Sort by
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent aria-label={`Sort ${noun}`}>
          {sort.map(([value, label, defaultDirection]) => {
            const selected = display.sort === value;
            const direction = selected ? display.direction : defaultDirection;
            const nextDirection: SidebarDirection = selected ? (direction === "ascending" ? "descending" : "ascending") : defaultDirection;
            return (
              <DropdownMenuItem
                key={value}
                role="menuitemradio"
                aria-checked={selected}
                aria-label={selected ? `${label}, ${direction}. Sort ${nextDirection}` : label}
                onSelect={(event) => {
                  event.preventDefault();
                  onChange({ ...display, sort: value, direction: nextDirection });
                }}
              >
                {label}
                {selected ? <Icon name={direction === "ascending" ? "ArrowUp" : "ArrowDown"} className="ml-auto" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

// Host side --------------------------------------------------------------------

/**
 * The sections' places, for the host to render at the top of its scroll
 * area. Each is an empty element the section's app portals into.
 */
export function SidebarAnchors({ onNavigate }: { onNavigate(): void }) {
  useRevision();
  const { visible } = sections();
  const [navigate] = useState(() => ({ current: onNavigate }));
  navigate.current = onNavigate;
  useEffect(() => {
    const sidebarHost: SidebarHost = { navigate: () => navigate.current() };
    setHost(sidebarHost);
    return () => setHost(null);
  }, [navigate]);
  if (!visible.length) return null;
  return (
    <div className="px-2 pt-1" data-studio-sidebar-sections="">
      {visible.map((section) => (
        <Anchor key={section.key} sectionKey={section.key} />
      ))}
    </div>
  );
}

function Anchor({ sectionKey: key }: { sectionKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    publishAnchor(key, ref.current);
    return () => publishAnchor(key, null);
  }, [key]);
  return <div ref={ref} data-studio-sidebar-anchor={key} />;
}

/** Sections the user hid, for the host's menu to bring back. */
export function useHiddenSidebarSections(): SidebarSectionInfo[] {
  useRevision();
  return sections().hidden;
}

export function showSidebarSection(key: string): void {
  setSectionHidden(key, false);
}

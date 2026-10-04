// The Spaces section of the sidebar: one row per Space, with a dot when one of
// its threads needs you or a spinner while one runs. A row opens the Space
// (its lead, with the page beside it); + makes a new one.
import {
  SIDEBAR_ROW,
  SIDEBAR_ROW_SELECTED,
  SidebarNote,
  SidebarPortal,
  SidebarSection,
  cn,
  useSidebarHosted,
  useSidebarNavigated,
  usePathname,
} from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRealtime,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { useMemo, useSyncExternalStore } from "react";
import { NEW_SPACE_EVENT } from "../../ids";
import { useSpaceOf, useSpaces } from "./data";
import { RUNNING } from "./Overview";
import { SPACES_PANEL, spaceViewHref } from "./routes";

function Status({ threads }: { threads: readonly PluginSidebarThread[] }) {
  if (threads.some((thread) => thread.hasPendingInteraction)) return <span aria-label="Needs you" className="size-2 shrink-0 rounded-full bg-warning-foreground" />;
  if (threads.some((thread) => RUNNING.has(thread.runtimeStatus))) return <span aria-label="Running" className="size-3 shrink-0 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  return null;
}

function SpacesList() {
  const { spaces, error } = useSpaces();
  const spaceOf = useSpaceOf();
  const { threads } = useSidebarThreads();
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  const navigated = useSidebarNavigated();
  const pathname = usePathname();
  const bySpace = useMemo(() => {
    const map = new Map<string, PluginSidebarThread[]>();
    for (const thread of threads) {
      if (thread.isArchived) continue;
      const spaceId = spaceOf(thread.id);
      if (spaceId) map.set(spaceId, [...(map.get(spaceId) ?? []), thread]);
    }
    return map;
  }, [threads, spaceOf]);
  const activeSpace = spaceOf(threadId);
  return (
    <SidebarSection title="Spaces" actions={[{ label: "New Space", icon: "Plus", onClick: () => window.dispatchEvent(new CustomEvent(NEW_SPACE_EVENT, { cancelable: true })) }]}>
      <div className="space-y-px px-1">
        {(spaces ?? []).map((space) => {
          const active = pathname === spaceViewHref(space.id) || activeSpace === space.id;
          return (
            <button
              key={space.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => { navigate.toPluginPanel(SPACES_PANEL, { subPath: space.id }); navigated(); }}
              className={cn(SIDEBAR_ROW, active && SIDEBAR_ROW_SELECTED)}
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center">
                {space.icon ? <span className="text-sm leading-none">{space.icon}</span> : <span aria-hidden className="size-2.5 rounded-full" style={{ background: space.color }} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              <Status threads={bySpace.get(space.id) ?? []} />
            </button>
          );
        })}
        {spaces && !spaces.length ? <SidebarNote>No Spaces yet. Press + to make one.</SidebarNote> : null}
        {error && !spaces ? <SidebarNote>Couldn't load Spaces.</SidebarNote> : null}
      </div>
    </SidebarSection>
  );
}

// Shared with Studio Sidebar without the kit (see its studioSpaces.ts): the
// sidebar writes its organization here, and its By space lists every Space
// itself, so this section steps aside. The same window hears the event,
// other windows the storage event. Studio's changes go the other way as a
// window event, since this plugin's realtime channel doesn't reach the sidebar.
const ORGANIZATION_KEY = "bb-studio:sidebar-organization";
const ORGANIZATION_EVENT = "bb-studio:sidebar-organization";
const STUDIO_CHANGED_EVENT = "bb-studio:studio-changed";

function subscribeOrganization(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === ORGANIZATION_KEY) onChange(); };
  window.addEventListener(ORGANIZATION_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ORGANIZATION_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function readOrganization(): string | null {
  try { return localStorage.getItem(ORGANIZATION_KEY); } catch { return null; }
}

/** Renders nothing itself; portals the Spaces section into the Studio Sidebar, above the tabs. */
export function SidebarSpacesSection() {
  const hosted = useSidebarHosted();
  const bySpace = useSyncExternalStore(subscribeOrganization, readOrganization, () => null) === "space";
  useRealtime(STUDIO_REALTIME_CHANNEL, () => window.dispatchEvent(new CustomEvent(STUDIO_CHANGED_EVENT)));
  if (bySpace) return null;
  return (
    <SidebarPortal id="spaces" title="Spaces" order={-10}>
      {hosted ? <SpacesList /> : null}
    </SidebarPortal>
  );
}


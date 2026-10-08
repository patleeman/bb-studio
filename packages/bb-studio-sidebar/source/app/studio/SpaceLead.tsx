import { errorMessage } from "@bb-studio/kit/format";
import { createContext, useContext } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import { Icon } from "@/components/ui/icon";
import { ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { ActionMenuItem } from "../ui/action-menu-items.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { beginPendingChiefOfStaff, beginPendingLead, STUDIO_CHANGED_EVENT, studioSpacesAtom, withPendingChiefOfStaff, withPendingLeads, type StudioSpacesState } from "./studioSpaces.js";

/** By space only: which Space each thread is in, and each Space's lead. */
export interface SpaceLeadState {
  spaceIdOf(thread: SidebarThread): string | null;
  leads: Readonly<Record<string, string | null>>;
}

export const SpaceLeadContext = createContext<SpaceLeadState | null>(null);

/**
 * Whether the thread leads any Space, in every organization mode: Studio's
 * leads load with its Spaces whatever the sidebar shows.
 */
export function isSpaceLeadThread(state: StudioSpacesState, threadId: string): boolean {
  return state.status === "ready" && Object.values(state.leads).includes(threadId);
}

/** Whether the thread leads its Space. A lead can't be archived until it's demoted. */
export function useIsSpaceLead(thread: SidebarThread): boolean {
  return isSpaceLeadThread(useAtomValue(studioSpacesAtom), thread.id);
}

/**
 * The threads an archive of `threads` may take when one of them leads a
 * Space, or null when none does. Leads and their ancestors stay, since
 * archiving a parent archives its children; only the top of each remaining
 * subtree is listed, so each thread is archived once.
 */
export function leadSafeArchiveIds(
  threads: readonly Pick<SidebarThread, "id" | "parentThreadId" | "archivedAt">[],
  isLead: (threadId: string) => boolean,
): string[] | null {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const keep = new Set<string>();
  for (const thread of threads) {
    if (!isLead(thread.id)) continue;
    for (let id: string | null = thread.id; id !== null && !keep.has(id); id = byId.get(id)?.parentThreadId ?? null) keep.add(id);
  }
  if (keep.size === 0) return null;
  const take = new Set(threads.filter((thread) => !keep.has(thread.id) && thread.archivedAt === null).map((thread) => thread.id));
  return [...take].filter((id) => {
    const parent = byId.get(id)?.parentThreadId ?? null;
    return parent === null || !take.has(parent);
  });
}

/** The Chief of Staff thread while By space shows it, else null. */
export function chiefOfStaffOf(state: StudioSpacesState): string | null {
  return state.status === "ready" ? state.chiefOfStaff : null;
}

/**
 * Promote ▸ in a thread's menu while By space shows: Space lead and Chief of
 * Staff, the role the thread holds checked; choosing a checked role removes
 * it. The Chief of Staff leads no Space, so Space lead is off for it. The
 * phone drawer has no submenus, so it lists the two items flat.
 */
export function SpaceLeadItem({ thread, surface }: {
  thread: SidebarThread;
  surface: "context" | "dropdown";
}) {
  const state = useContext(SpaceLeadContext);
  const chief = chiefOfStaffOf(useAtomValue(studioSpacesAtom));
  const compact = useIsCompactViewport();
  const setLead = useSetLead();
  const setChief = useSetChief();
  if (!state) return null;
  const spaceId = state.spaceIdOf(thread);
  const isChief = chief === thread.id;
  const isLead = spaceId !== null && state.leads[spaceId] === thread.id;
  const toggleLead = () => { if (spaceId) setLead(spaceId, isLead ? null : thread.id); };
  const toggleChief = () => setChief(isChief ? null : thread.id);

  if (surface === "dropdown" && compact) {
    return (
      <>
        {isChief || !spaceId ? null : (
          <ActionMenuItem surface={surface} icon={isLead ? "Minus" : "Star"} onSelect={toggleLead}>
            {isLead ? "Remove as Space lead" : "Make Space lead"}
          </ActionMenuItem>
        )}
        <ActionMenuItem surface={surface} icon={isChief ? "Minus" : "Star"} onSelect={toggleChief}>
          {isChief ? "Remove as Chief of Staff" : "Make Chief of Staff"}
        </ActionMenuItem>
      </>
    );
  }

  const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger = surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent = surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  const role = (label: string, checked: boolean, onSelect: () => void, disabled = false) => (
    <Item aria-checked={checked} disabled={disabled} className="flex items-center gap-2" onSelect={onSelect}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? <Icon name="Check" className="ml-auto" aria-hidden="true" /> : null}
    </Item>
  );
  return (
    <Sub>
      <SubTrigger>
        <Icon name="Star" aria-hidden="true" />
        Promote
      </SubTrigger>
      <SubContent className="min-w-44">
        {role("Space lead", isLead, toggleLead, isChief || !spaceId)}
        {role("Chief of Staff", isChief, toggleChief)}
      </SubContent>
    </Sub>
  );
}

/** Sets or clears the Chief of Staff, shown at once and kept over refetches that started before Studio answered. */
function useSetChief() {
  const sdk = useSdk();
  const setSpaces = useSetAtom(studioSpacesAtom);
  return (threadId: string | null) => {
    const settle = beginPendingChiefOfStaff(threadId);
    setSpaces((current) => current.status === "ready" ? { ...current, chiefOfStaff: withPendingChiefOfStaff(current.chiefOfStaff) } : current);
    void sdk.plugins.callRpc({
      pluginId: "studio",
      method: "chief_of_staff_set",
      input: { threadId } as never,
      outputSchema: z.unknown(),
      signal: AbortSignal.timeout(15_000),
    }).then(
      () => {
        settle();
        window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
      },
      (cause: unknown) => {
        settle();
        window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
        toast.error(`Couldn't change the Chief of Staff: ${errorMessage(cause)}`);
      },
    );
  };
}

/** Sets or clears a Space's lead, shown at once and kept over refetches that started before Studio answered. */
function useSetLead() {
  const sdk = useSdk();
  const setSpaces = useSetAtom(studioSpacesAtom);
  return (spaceId: string, threadId: string | null) => {
    const settle = beginPendingLead(spaceId, threadId);
    setSpaces((current) => current.status === "ready" ? { ...current, leads: withPendingLeads(current.leads) } : current);
    void sdk.plugins.callRpc({
      pluginId: "studio",
      method: "space_set_lead",
      input: { spaceId, threadId } as never,
      outputSchema: z.unknown(),
      signal: AbortSignal.timeout(15_000),
    }).then(
      () => {
        settle();
        window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
      },
      (cause: unknown) => {
        settle();
        window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
        toast.error(`Couldn't change the lead: ${errorMessage(cause)}`);
      },
    );
  };
}

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
import { beginPendingLead, STUDIO_CHANGED_EVENT, studioSpacesAtom, withPendingLeads, type StudioSpacesState } from "./studioSpaces.js";

/** By space only: which Space each thread is in, and each Space's lead. */
export interface SpaceLeadState {
  spaceIdOf(thread: SidebarThread): string | null;
  leads: Readonly<Record<string, string | null>>;
}

export const SpaceLeadContext = createContext<SpaceLeadState | null>(null);

/**
 * Whether the thread leads any Space, the Chief of Staff (the default
 * Space's lead) included, in every organization mode: Studio's leads load
 * with its Spaces whatever the sidebar shows. A lead can't be archived until
 * it's removed.
 */
export function isSpaceLeadThread(state: StudioSpacesState, threadId: string): boolean {
  return state.status === "ready" && Object.values(state.leads).includes(threadId);
}

/** Whether the thread leads its Space or is the Chief of Staff. It can't be archived until it's demoted. */
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

/** Window event that opens Studio's Chief of Staff heartbeat dialog. */
export const CHIEF_DIALOG_EVENT = "studio:chief-dialog";

/** Opens Studio's Chief of Staff heartbeat dialog; tells the user when Studio didn't. */
export function openChiefHeartbeat() {
  const event = new Event(CHIEF_DIALOG_EVENT, { cancelable: true });
  if (window.dispatchEvent(event)) toast.error("Open Studio to set the Chief of Staff's heartbeat.");
}

/** The Chief of Staff: the lead of the default Space, the top level. Null until Studio's Spaces load. */
export function chiefOfStaffOf(state: StudioSpacesState): string | null {
  if (state.status !== "ready") return null;
  const top = state.spaces.find((space) => space.isDefault);
  return top ? state.leads[top.id] ?? null : null;
}

/**
 * Whether Promote ▸ is offered: not for an archived thread (it would lead from
 * out of sight) or a sub-thread, unless it already holds a role, so it can
 * still be removed.
 */
export function canPromoteThread(thread: Pick<SidebarThread, "parentThreadId" | "archivedAt">, holdsRole: boolean): boolean {
  return holdsRole || (thread.archivedAt === null && thread.parentThreadId === null);
}

/**
 * Promote ▸ in a thread's menu while By space shows: Space lead and Chief of
 * Staff, the role the thread holds checked; choosing a checked role removes
 * it. Chief of Staff is the top level's (the default Space's) lead; Space
 * lead is for the other Spaces, so it's off for a top-level thread and for
 * the Chief of Staff. Removing the Chief of Staff leaves it a top-level
 * thread. The phone drawer has no submenus, so it lists the items flat.
 */
export function SpaceLeadItem({ thread, surface }: {
  thread: SidebarThread;
  surface: "context" | "dropdown";
}) {
  const state = useContext(SpaceLeadContext);
  const spaces = useAtomValue(studioSpacesAtom);
  const topId = spaces.status === "ready" ? spaces.spaces.find((space) => space.isDefault)?.id ?? null : null;
  const compact = useIsCompactViewport();
  const setLead = useSetLead();
  if (!state) return null;
  const spaceId = state.spaceIdOf(thread);
  const isChief = topId !== null && state.leads[topId] === thread.id;
  // Space lead is for the other Spaces; the top level's lead is the Chief of Staff.
  const leadSpaceId = spaceId !== null && spaceId !== topId ? spaceId : null;
  const isLead = leadSpaceId !== null && state.leads[leadSpaceId] === thread.id;
  if (!canPromoteThread(thread, isChief || isLead)) return null;
  const toggleLead = () => { if (leadSpaceId) setLead(leadSpaceId, isLead ? null : thread.id); };
  const toggleChief = () => { if (topId) setLead(topId, isChief ? null : thread.id); };

  if (surface === "dropdown" && compact) {
    return (
      <>
        {isChief || !leadSpaceId ? null : (
          <ActionMenuItem surface={surface} icon={isLead ? "Minus" : "Star"} onSelect={toggleLead}>
            {isLead ? "Remove as Space lead" : "Make Space lead"}
          </ActionMenuItem>
        )}
        <ActionMenuItem surface={surface} icon={isChief ? "Minus" : "Star"} onSelect={toggleChief}>
          {isChief ? "Remove as Chief of Staff" : "Make Chief of Staff"}
        </ActionMenuItem>
        {isChief ? (
          <ActionMenuItem surface={surface} icon="Clock" onSelect={openChiefHeartbeat}>
            Heartbeat…
          </ActionMenuItem>
        ) : null}
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
    <>
    <Sub>
      <SubTrigger>
        <Icon name="Star" aria-hidden="true" />
        Promote
      </SubTrigger>
      <SubContent className="min-w-44">
        {role("Space lead", isLead, toggleLead, isChief || !leadSpaceId)}
        {role("Chief of Staff", isChief, toggleChief, !topId)}
      </SubContent>
    </Sub>
    {isChief ? (
      <Item className="flex items-center gap-2" onSelect={openChiefHeartbeat}>
        <Icon name="Clock" aria-hidden="true" />
        Heartbeat…
      </Item>
    ) : null}
    </>
  );
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

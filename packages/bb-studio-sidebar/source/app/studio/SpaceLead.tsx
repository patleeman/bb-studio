import { errorMessage } from "@bb-studio/kit/format";
import { createContext, useContext } from "react";
import { useSetAtom } from "jotai";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import { ActionMenuItem } from "../ui/action-menu-items.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { STUDIO_CHANGED_EVENT, studioSpacesAtom } from "./studioSpaces.js";

/** By space only: which Space each thread is in, and each Space's lead. */
export interface SpaceLeadState {
  spaceIdOf(thread: SidebarThread): string | null;
  leads: Readonly<Record<string, string | null>>;
}

export const SpaceLeadContext = createContext<SpaceLeadState | null>(null);

/** Whether the thread leads its Space. A lead can't be archived until it's demoted. */
export function useIsSpaceLead(thread: SidebarThread): boolean {
  const state = useContext(SpaceLeadContext);
  const spaceId = state?.spaceIdOf(thread) ?? null;
  return spaceId !== null && state?.leads[spaceId] === thread.id;
}

/** Make Space lead, or Remove as Space lead, in a thread's menu while By space shows. */
export function SpaceLeadItem({ thread, surface }: {
  thread: SidebarThread;
  surface: "context" | "dropdown";
}) {
  const state = useContext(SpaceLeadContext);
  const sdk = useSdk();
  const setSpaces = useSetAtom(studioSpacesAtom);
  const spaceId = state?.spaceIdOf(thread) ?? null;
  if (!state || !spaceId) return null;
  const isLead = state.leads[spaceId] === thread.id;
  const setLead = (threadId: string | null) => {
    setSpaces((current) => current.status === "ready" ? { ...current, leads: { ...current.leads, [spaceId]: threadId } } : current);
    void sdk.plugins.callRpc({
      pluginId: "studio",
      method: "space_set_lead",
      input: { spaceId, threadId } as never,
      outputSchema: z.unknown(),
      signal: AbortSignal.timeout(15_000),
    }).then(
      () => window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT)),
      (cause: unknown) => {
        window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
        toast.error(`Couldn't change the lead: ${errorMessage(cause)}`);
      },
    );
  };
  return (
    <ActionMenuItem surface={surface} icon={isLead ? "Minus" : "Star"} onSelect={() => setLead(isLead ? null : thread.id)}>
      {isLead ? "Remove as Space lead" : "Make Space lead"}
    </ActionMenuItem>
  );
}

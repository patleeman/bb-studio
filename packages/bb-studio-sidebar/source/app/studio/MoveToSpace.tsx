import { useCallback, useContext, useState } from "react";
import { useSetAtom } from "jotai";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import { Icon } from "@/components/ui/icon";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { SpaceLeadContext } from "./SpaceLead.js";
import { SpaceMark } from "./SpaceSwitcher.js";
import type { StudioSpace } from "./space-groups.js";
import { SPACE_CHANGED_EVENT, STUDIO_CHANGED_EVENT, studioSpacesAtom, useStudioSpaces } from "./studioSpaces.js";

const THREAD_REF = "bb-thread";
const spaceOfSchema = z.object({ threads: z.record(z.string(), z.string()) });

/**
 * Moves threads into a Space with Studio's `spaceMembers`; a thread is in one
 * Space, so it leaves any other. The sidebar shows the move at once, then
 * refetches; a failure says so and refetches.
 */
export function useMoveThreadsToSpace(): (threadIds: readonly string[], space: StudioSpace) => Promise<void> {
  const sdk = useSdk();
  const setSpaces = useSetAtom(studioSpacesAtom);
  return useCallback(async (threadIds, space) => {
    if (!threadIds.length) return;
    const refresh = () => {
      window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
      window.dispatchEvent(new CustomEvent(SPACE_CHANGED_EVENT, { detail: { spaceId: space.id } }));
    };
    setSpaces((current) => current.status === "ready" && current.threadsLoaded
      ? { ...current, spaceOf: { ...current.spaceOf, ...Object.fromEntries(threadIds.map((id) => [id, space.id])) } }
      : current);
    try {
      await sdk.plugins.callRpc({
        pluginId: "studio",
        method: "spaceMembers",
        input: { id: space.id, add: threadIds.map((id) => ({ pluginId: THREAD_REF, id })), remove: [] } as never,
        outputSchema: z.unknown(),
        signal: AbortSignal.timeout(15_000),
      });
      toast.success(`Moved ${threadIds.length === 1 ? "" : `${threadIds.length} threads `}to ${space.name}`);
    } catch (cause) {
      toast.error(`Couldn't move to ${space.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
      throw cause;
    } finally {
      refresh();
    }
  }, [sdk, setSpaces]);
}

/**
 * Move to Space ▸ in a top-level thread's menu: each Space, the thread's
 * current one checked. By space knows each thread's Space; elsewhere it's
 * looked up when the submenu opens.
 */
export function MoveToSpaceItem({ thread, surface }: {
  thread: SidebarThread;
  surface: "context" | "dropdown";
}) {
  const state = useStudioSpaces();
  const bySpace = useContext(SpaceLeadContext);
  const compact = useIsCompactViewport();
  const sdk = useSdk();
  const move = useMoveThreadsToSpace();
  const [looked, setLooked] = useState<string | null | undefined>(undefined);
  if (state.status !== "ready" || state.spaces.length < 2) return null;
  if (thread.parentThreadId !== null || thread.archivedAt !== null) return null;
  // The phone drawer has no submenus.
  if (surface === "dropdown" && compact) return null;
  const known = bySpace?.spaceIdOf(thread) ?? (state.threadsLoaded ? state.spaceOf[thread.id] ?? null : undefined);
  const currentId = known !== undefined ? known : looked;
  const lookUp = (open: boolean) => {
    if (!open || known !== undefined || looked !== undefined) return;
    void sdk.plugins.callRpc({
      pluginId: "studio",
      method: "space_of_threads",
      input: {} as never,
      outputSchema: spaceOfSchema,
      signal: AbortSignal.timeout(10_000),
    }).then((result) => setLooked(spaceOfSchema.parse(result).threads[thread.id] ?? null), () => setLooked(null));
  };

  const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
  const SubTrigger = surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const SubContent = surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <Sub onOpenChange={lookUp}>
      <SubTrigger>
        <Icon name="Layers" aria-hidden="true" />
        Move to Space
      </SubTrigger>
      <SubContent className="max-h-[min(24rem,calc(100vh-2rem))] min-w-44 overflow-y-auto">
        {state.spaces.map((space) => {
          const isCurrent = space.id === currentId;
          return (
            <Item
              key={space.id}
              aria-current={isCurrent ? "true" : undefined}
              disabled={isCurrent}
              className="flex items-center gap-2"
              onSelect={() => void move([thread.id], space).catch(() => {})}
            >
              <SpaceMark space={space} />
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              {isCurrent ? <Icon name="Check" className="ml-auto" aria-hidden="true" /> : null}
            </Item>
          );
        })}
      </SubContent>
    </Sub>
  );
}

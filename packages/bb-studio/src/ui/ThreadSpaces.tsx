// A thread's spaces in its header, so a channel, direct message or any other
// thread links back to the spaces it's in, and can join one from there.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GHOST_BUTTON,
  Icon,
  openAppPath,
} from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, SpaceView } from "../contract";
import { SpaceGlyph, spaceLink } from "./Spaces";

const THREAD_REF = "bb-thread";
const REFETCH_DEBOUNCE_MS = 300;

export function ThreadSpaces({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [held, setHeld] = useState<{ spaces: SpaceView[]; inherited: string[] } | null>(null);
  const [all, setAll] = useState<SpaceView[]>([]);
  const refetch = useCallback(() => {
    rpc.call("spacesForThread", { threadId }).then(setHeld, () => setHeld(null));
    rpc.call("spaces", null).then((result) => setAll(result.spaces), () => setAll([]));
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  });

  if (!held || (!held.spaces.length && !all.length)) return null;
  const change = async (space: SpaceView, add: boolean) => {
    const ref = [{ pluginId: THREAD_REF, id: threadId }];
    try {
      await rpc.call("spaceMembers", { id: space.id, add: add ? ref : [], remove: add ? [] : ref });
      refetch();
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    }
  };
  const [first] = held.spaces;
  const others = all.filter((space) => !held.spaces.some((each) => each.id === space.id));
  const removable = held.spaces.filter((space) => !held.inherited.includes(space.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={GHOST_BUTTON} aria-label={first ? `Spaces: ${held.spaces.map((space) => space.name).join(", ")}` : "Add to a space"}>
          {first ? (
            <>
              <SpaceGlyph space={first} className="text-sm leading-none" />
              <span className="max-w-32 truncate">{first.name}</span>
              {held.spaces.length > 1 ? <span className="text-muted-foreground">+{held.spaces.length - 1}</span> : null}
            </>
          ) : (
            <Icon name="Layers" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
        {held.spaces.length ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">In spaces</DropdownMenuLabel> : null}
        {held.spaces.map((space) => (
          <DropdownMenuItem key={space.id} onSelect={() => openAppPath(spaceLink(space))}>
            <SpaceGlyph space={space} className="text-sm leading-none" /> {space.name}
            {held.inherited.includes(space.id) ? <span className="ml-auto text-xs text-muted-foreground">Project</span> : null}
          </DropdownMenuItem>
        ))}
        {held.spaces.length && others.length ? <DropdownMenuSeparator /> : null}
        {others.length ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Add to space</DropdownMenuLabel> : null}
        {others.map((space) => (
          <DropdownMenuItem key={space.id} onSelect={() => void change(space, true)}>
            <SpaceGlyph space={space} className="text-sm leading-none" /> {space.name}
          </DropdownMenuItem>
        ))}
        {removable.length ? <DropdownMenuSeparator /> : null}
        {removable.map((space) => (
          <DropdownMenuItem key={space.id} onSelect={() => void change(space, false)}>
            <Icon name="X" className="size-4" /> Remove from {space.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

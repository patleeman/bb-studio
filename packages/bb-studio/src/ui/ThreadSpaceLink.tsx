// A thread's space in its header, beside its other links: it opens the
// space, or moves the thread to another one (a thread is in one at a time).
import { DropdownMenu, DropdownMenuTrigger, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, SpaceView } from "../contract";
import { SpaceMark, SpacesMenuContent, useSpaces } from "./ComposerSpaces";

const THREAD_REF = "bb-thread";

export function ThreadSpaceLink({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { held, all, refetch } = useSpaces(threadId);
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
  const holding = held.spaces;
  const [first] = holding;
  const names = holding.map((space) => space.name).join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button"
          aria-label={first ? `Space: ${names}` : "Add to a space"}
          title={first ? names : "Add to a space"}
          className={cn(
            "flex h-7 min-w-0 items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
            isCompactViewport || !first ? "w-7 justify-center" : "max-w-56 px-2",
          )}>
          <SpaceMark space={first} />
          {first && !isCompactViewport ? <span className="truncate">{first.name}</span> : null}
          {holding.length > 1 && !isCompactViewport ? <span className="shrink-0">+{holding.length - 1}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <SpacesMenuContent heading="In space" othersHeading="Move to" holding={holding} inherited={held.inherited} all={all} align="end" onChange={(space, add) => void change(space, add)} />
    </DropdownMenu>
  );
}

// A thread's space in its header, beside its other links: it opens the
// space, or moves the thread to another one (a thread is in one at a time).
import { DropdownMenu, DropdownMenuTrigger, Icon, cn } from "@bb-studio/kit/app";
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
            // Drawn like the header's other dropdowns: an edge, and a chevron.
            "flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background text-sm text-muted-foreground shadow-sm outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-state-active data-[state=open]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
            isCompactViewport || !first ? "w-7 justify-center" : "max-w-56 pr-1.5 pl-2",
          )}>
          <SpaceMark space={first} />
          {first && !isCompactViewport ? <span className="truncate">{first.name}</span> : null}
          {holding.length > 1 && !isCompactViewport ? <span className="shrink-0">+{holding.length - 1}</span> : null}
          {first && !isCompactViewport ? <Icon name="ChevronDown" className="opacity-70" /> : null}
        </button>
      </DropdownMenuTrigger>
      <SpacesMenuContent heading="In space" othersHeading="Move to" holding={holding} inherited={held.inherited} all={all} align="end" onChange={(space, add) => void change(space, add)} />
    </DropdownMenu>
  );
}

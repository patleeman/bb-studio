// A thread's Space menu in its header, beside its other links: it opens the
// space, its files on this thread's worktree, or the worktree in VS Code, and
// moves the thread to another space (a thread is in one at a time).
//
// With Studio Code installed, its header chip hides while this menu shows and
// opens VS Code when asked. The plugins talk through window events (names
// shared with bb-studio-code's thread chip), so each still works alone.
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon, cn } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbNavigate, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, SpaceView } from "../contract";
import { SpaceMark, SpacesMenuContent, useSpaces } from "./ComposerSpaces";
import { openSpaceFiles } from "./StudioPanel";

const THREAD_REF = "bb-thread";
const CODE_STATE_EVENT = "studio:code-state";
const CODE_QUERY_EVENT = "studio:code-query";
const CODE_OPEN_EVENT = "studio:code-open";
const SPACE_MENU_EVENT = "studio:space-menu";

type MenuWindow = Window & { __studioSpaceMenus?: Set<string> };

/** Studio Code's state for this thread: null until its chip announces itself. */
function useCodeChip(threadId: string): { working: boolean } | null {
  const [state, setState] = useState<{ working: boolean } | null>(null);
  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; working?: boolean; gone?: boolean }>).detail;
      if (detail?.threadId !== threadId) return;
      setState(detail.gone ? null : { working: Boolean(detail.working) });
    };
    window.addEventListener(CODE_STATE_EVENT, onState);
    window.dispatchEvent(new CustomEvent(CODE_QUERY_EVENT));
    return () => window.removeEventListener(CODE_STATE_EVENT, onState);
  }, [threadId]);
  return state;
}

/** Tells Studio Code's chip this menu is showing for the thread, so it hides. */
function useClaimHeader(threadId: string, shown: boolean): void {
  useEffect(() => {
    if (!shown) return;
    const menus = ((window as MenuWindow).__studioSpaceMenus ??= new Set());
    menus.add(threadId);
    window.dispatchEvent(new CustomEvent(SPACE_MENU_EVENT));
    return () => {
      menus.delete(threadId);
      window.dispatchEvent(new CustomEvent(SPACE_MENU_EVENT));
    };
  }, [threadId, shown]);
}

export function ThreadSpaceLink({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { held, all, refetch } = useSpaces(threadId);
  const code = useCodeChip(threadId);
  const shown = Boolean(held && (held.spaces.length || all.length));
  useClaimHeader(threadId, shown);
  if (!held || !shown) return null;

  const change = async (space: SpaceView, add: boolean) => {
    const ref = [{ pluginId: THREAD_REF, id: threadId }];
    try {
      await rpc.call("spaceMembers", { id: space.id, add: add ? ref : [], remove: add ? [] : ref });
      refetch();
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    }
  };
  const openCode = () => {
    // The chip cancels the event when it opens VS Code.
    if (window.dispatchEvent(new CustomEvent(CODE_OPEN_EVENT, { detail: { threadId }, cancelable: true }))) toast.error("Couldn't open VS Code.");
  };
  const holding = held.spaces;
  const [first] = holding;
  const names = holding.map((space) => space.name).join(", ");
  const editing = Boolean(code?.working);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button"
          aria-label={first ? `Space: ${names}${editing ? ", the agent is editing files" : ""}` : "Add to a space"}
          title={first ? names : "Add to a space"}
          className={cn(
            // Drawn like the header's other dropdowns: an edge, and a chevron.
            "relative flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background text-sm text-muted-foreground shadow-sm outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-state-active data-[state=open]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
            isCompactViewport || !first ? "w-7 justify-center" : "max-w-56 pr-1.5 pl-2",
          )}>
          <SpaceMark space={first} />
          {first && !isCompactViewport ? <span className="truncate">{first.name}</span> : null}
          {holding.length > 1 && !isCompactViewport ? <span className="shrink-0">+{holding.length - 1}</span> : null}
          {first && !isCompactViewport ? <Icon name="ChevronDown" className="opacity-70" /> : null}
          {editing ? <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-background motion-safe:animate-pulse" /> : null}
        </button>
      </DropdownMenuTrigger>
      <SpacesMenuContent heading="In space" othersHeading="Move to" holding={holding} inherited={held.inherited} all={all} align="end" onChange={(space, add) => void change(space, add)}>
        {first ? (
          <DropdownMenuItem onSelect={() => openSpaceFiles(navigate, first, threadId)}>
            <Icon name="Folder" className="size-4" /> Browse files
          </DropdownMenuItem>
        ) : null}
        {code ? (
          <DropdownMenuItem onSelect={openCode}>
            <Icon name="Code" className="size-4" /> Open in VS Code
            {editing ? <span className="ml-auto text-xs text-muted-foreground">Editing</span> : null}
          </DropdownMenuItem>
        ) : null}
        {first || code ? <DropdownMenuSeparator /> : null}
      </SpacesMenuContent>
    </DropdownMenu>
  );
}

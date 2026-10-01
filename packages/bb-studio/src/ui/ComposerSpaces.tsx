// A thread's spaces under its composer, next to its other settings, so a
// thread, channel or direct message links back to the spaces it's in and can
// join one there. A new thread joins the spaces picked before it starts.
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  openAppPath,
} from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useComposer, useComposerView, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, SpaceView } from "../contract";
import { SpaceGlyph, spaceLink } from "./Spaces";

const THREAD_REF = "bb-thread";
const REFETCH_DEBOUNCE_MS = 300;
const pendingKey = (projectId: string) => `studio:new-thread-spaces:${projectId}`;
const savedPick = (projectId: string): string[] => {
  try {
    const ids: unknown = JSON.parse(sessionStorage.getItem(pendingKey(projectId)) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
};
const savePick = (projectId: string, ids: string[]) => {
  if (ids.length) sessionStorage.setItem(pendingKey(projectId), JSON.stringify(ids));
  else sessionStorage.removeItem(pendingKey(projectId));
};
const TRIGGER = "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground [&_svg]:size-3.5";

export function ComposerSpaces() {
  const view = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = view.scope.kind === "thread" ? view.scope.threadId : null;
  const projectId = view.scope.kind === "new-thread" ? view.scope.projectId : null;
  const [held, setHeld] = useState<{ spaces: SpaceView[]; inherited: string[] } | null>(null);
  const [picked, setPicked] = useState<string[]>(() => (projectId ? savedPick(projectId) : []));
  const [all, setAll] = useState<SpaceView[]>([]);
  const refetch = useCallback(() => {
    if (threadId) rpc.call("spacesForThread", { threadId }).then(setHeld, () => setHeld(null));
    rpc.call("spaces", null).then((result) => setAll(result.spaces), () => setAll([]));
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRealtime(STUDIO_REALTIME_CHANNEL, () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  });

  // A new thread's pick belongs to the composer's project and survives the
  // composer remounting. The server holds it until the first message; only
  // the shown project's pick is live.
  const pickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const previous = pickedFor.current;
    pickedFor.current = projectId;
    if (previous && previous !== projectId) void rpc.call("pendingThreadSpaces", { projectId: previous, ids: [] }).catch(() => {});
    const saved = savedPick(projectId);
    setPicked(saved);
    void rpc.call("pendingThreadSpaces", { projectId, ids: saved }).catch(() => {});
  }, [rpc, projectId]);
  useEffect(() => {
    if (!projectId) return;
    // The server adds the thread with the first message; start fresh.
    return composer.experimental_onSubmitted(() => {
      savePick(projectId, []);
      setPicked([]);
    });
  }, [composer, projectId]);

  const holding = threadId ? held?.spaces ?? [] : all.filter((space) => picked.includes(space.id));
  const inherited = threadId ? held?.inherited ?? [] : [];
  if ((threadId && !held) || (!holding.length && !all.length)) return null;

  const change = async (space: SpaceView, add: boolean) => {
    if (projectId) {
      const next = add ? [...picked, space.id] : picked.filter((id) => id !== space.id);
      setPicked(next);
      savePick(projectId, next);
      await rpc.call("pendingThreadSpaces", { projectId, ids: next }).catch((cause) => toast.error(`Couldn't pick the space: ${errorMessage(cause)}`));
      return;
    }
    if (!threadId) return;
    const ref = [{ pluginId: THREAD_REF, id: threadId }];
    try {
      await rpc.call("spaceMembers", { id: space.id, add: add ? ref : [], remove: add ? [] : ref });
      refetch();
    } catch (cause) {
      toast.error(`Couldn't change the space: ${errorMessage(cause)}`);
    }
  };
  const [first] = holding;
  const others = all.filter((space) => !holding.some((each) => each.id === space.id));
  const removable = holding.filter((space) => !inherited.includes(space.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={TRIGGER}
          aria-label={first ? `Spaces: ${holding.map((space) => space.name).join(", ")}` : "Add to a space"}
          title={first ? holding.map((space) => space.name).join(", ") : "Add to a space"}>
          {first ? <SpaceGlyph space={first} className="text-xs leading-none" /> : <Icon name="Layers" />}
          <span className="max-w-32 truncate">{first ? first.name : "Space"}</span>
          {holding.length > 1 ? <span>+{holding.length - 1}</span> : null}
          <Icon name="ChevronDown" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
        {holding.length ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{threadId ? "In spaces" : "Joins"}</DropdownMenuLabel> : null}
        {holding.map((space) => (
          <DropdownMenuItem key={space.id} onSelect={() => openAppPath(spaceLink(space))}>
            <SpaceGlyph space={space} className="text-sm leading-none" /> {space.name}
            {inherited.includes(space.id) ? <span className="ml-auto text-xs text-muted-foreground">Project</span> : null}
          </DropdownMenuItem>
        ))}
        {holding.length && others.length ? <DropdownMenuSeparator /> : null}
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

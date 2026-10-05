// The space a new thread joins, picked in its composer before it starts. A
// thread that has started shows its space in its header instead
// (ThreadSpaceLink).
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbNavigate, useComposer, useComposerView, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { rpcContract, SpaceView } from "../contract";
import { openSpaceItems } from "./StudioPanel";

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
// A New thread opened from a Space in Studio Sidebar or Navigation names the
// Space here; the picker takes it once, for its project (or any, if null).
const HANDOFF_KEY = "studio:new-thread-space";
const HANDOFF_TTL_MS = 30_000;
/** Names the Space the next New thread starts in, as Studio Sidebar does. */
export const handOffNewThreadSpace = (spaceId: string, projectId: string | null) => {
  const detail = { spaceId, projectId, at: Date.now() };
  try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(detail)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(HANDOFF_KEY, { detail }));
};
const takeHandoff = (projectId: string): string | null => {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const handoff: unknown = JSON.parse(raw);
    if (!handoff || typeof handoff !== "object") return null;
    const { spaceId, projectId: forProject, at } = handoff as Record<string, unknown>;
    const stale = typeof at !== "number" || Date.now() - at > HANDOFF_TTL_MS || typeof spaceId !== "string";
    if (!stale && typeof forProject === "string" && forProject !== projectId) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    return stale ? null : spaceId as string;
  } catch { return null; }
};
const TRIGGER = "inline-flex h-6 min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A space's emoji, or the spaces icon: a colour dot here reads as a status. */
export function SpaceMark({ space }: { space: SpaceView | undefined }) {
  return space?.icon ? <span className="text-xs leading-none">{space.icon}</span> : <Icon name="Layers" />;
}

/** Every space, and the ones `threadId` is in, kept fresh as spaces change. */
export function useSpaces(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [held, setHeld] = useState<{ spaces: SpaceView[]; inherited: string[] } | null>(null);
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
  return { held, all, refetch };
}

/** The spaces menu: open one it's in, move it to another, or take it out. */
export function SpacesMenuContent({ heading, othersHeading = "Add to space", holding, inherited, all, align = "start", onChange }: {
  heading: string;
  othersHeading?: string;
  holding: SpaceView[];
  inherited: string[];
  all: SpaceView[];
  align?: "start" | "end";
  onChange: (space: SpaceView, add: boolean) => void;
}) {
  const navigate = useBbNavigate();
  const others = all.filter((space) => !holding.some((each) => each.id === space.id));
  const removable = holding.filter((space) => !inherited.includes(space.id));
  return (
    <DropdownMenuContent side="bottom" align={align} className="max-h-96 w-64 overflow-y-auto">
      {holding.length ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{heading}</DropdownMenuLabel> : null}
      {holding.map((space) => (
        <DropdownMenuItem key={space.id} onSelect={() => openSpaceItems(navigate, space)}>
          <SpaceMark space={space} /> {space.name}
          {inherited.includes(space.id) ? <span className="ml-auto text-xs text-muted-foreground">Project</span> : null}
        </DropdownMenuItem>
      ))}
      {holding.length && others.length ? <DropdownMenuSeparator /> : null}
      {others.length ? <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{othersHeading}</DropdownMenuLabel> : null}
      {others.map((space) => (
        <DropdownMenuItem key={space.id} onSelect={() => onChange(space, true)}>
          <SpaceMark space={space} /> {space.name}
        </DropdownMenuItem>
      ))}
      {removable.length ? <DropdownMenuSeparator /> : null}
      {removable.map((space) => (
        <DropdownMenuItem key={space.id} onSelect={() => onChange(space, false)}>
          <Icon name="X" className="size-4" /> Remove from {space.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

export function ComposerSpaces() {
  const view = useComposerView();
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const projectId = view.scope.kind === "new-thread" ? view.scope.projectId : null;
  const { all } = useSpaces(null);
  const [picked, setPicked] = useState<string[]>(() => (projectId ? savedPick(projectId) : []));

  // A new thread's pick belongs to the composer's project and survives the
  // composer remounting. The server holds it until the first message; only
  // the shown project's pick is live.
  const pickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    const previous = pickedFor.current;
    pickedFor.current = projectId;
    if (previous && previous !== projectId) void rpc.call("pendingThreadSpaces", { projectId: previous, ids: [] }).catch(() => {});
    const handed = takeHandoff(projectId);
    const saved = handed ? [handed] : savedPick(projectId);
    if (handed) savePick(projectId, saved);
    setPicked(saved);
    void rpc.call("pendingThreadSpaces", { projectId, ids: saved }).catch(() => {});
  }, [rpc, projectId]);
  useEffect(() => {
    if (!projectId) return;
    // New thread from a Space while this composer is already open.
    const onHandoff = () => {
      const handed = takeHandoff(projectId);
      if (!handed) return;
      savePick(projectId, [handed]);
      setPicked([handed]);
      void rpc.call("pendingThreadSpaces", { projectId, ids: [handed] }).catch(() => {});
    };
    window.addEventListener(HANDOFF_KEY, onHandoff);
    return () => window.removeEventListener(HANDOFF_KEY, onHandoff);
  }, [rpc, projectId]);
  useEffect(() => {
    if (!projectId) return;
    // The server adds the thread with the first message; start fresh.
    return composer.experimental_onSubmitted(() => {
      savePick(projectId, []);
      setPicked([]);
    });
  }, [composer, projectId]);

  const holding = all.filter((space) => picked.includes(space.id));
  if (!projectId || !all.length) return null;

  const change = async (space: SpaceView, add: boolean) => {
    // A thread is in one space, so a new pick replaces the last.
    const next = add ? [space.id] : picked.filter((id) => id !== space.id);
    setPicked(next);
    savePick(projectId, next);
    await rpc.call("pendingThreadSpaces", { projectId, ids: next }).catch((cause) => toast.error(`Couldn't pick the space: ${errorMessage(cause)}`));
  };
  const [first] = holding;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={TRIGGER}
          aria-label={first ? `Spaces: ${holding.map((space) => space.name).join(", ")}` : "Add to a space"}
          title={first ? holding.map((space) => space.name).join(", ") : "Add to a space"}>
          <SpaceMark space={first} />
          <span className="max-w-32 truncate">{first ? first.name : "Space"}</span>
          {holding.length > 1 ? <span>+{holding.length - 1}</span> : null}
          <Icon name="ChevronDown" />
        </button>
      </DropdownMenuTrigger>
      <SpacesMenuContent heading="Joins" holding={holding} inherited={[]} all={all} onChange={(space, add) => void change(space, add)} />
    </DropdownMenu>
  );
}

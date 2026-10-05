import type { SidebarThread } from "../model/sidebar-thread.js";

/** The parts of a Studio Space the sidebar shows. */
export interface StudioSpace {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  defaultProjectId: string | null;
  /** Studio's default Space (Personal): threads in no Space belong to it. */
  isDefault: boolean;
  /** Projects the Space owns: their threads are in it unless added elsewhere. */
  projectIds: readonly string[];
}

/** Which Space owns each project. */
export function projectSpaces(spaces: readonly StudioSpace[]): ReadonlyMap<string, string> {
  return new Map(spaces.flatMap((space) => space.projectIds.map((projectId) => [projectId, space.id] as const)));
}

/** The default Space: Studio's flagged one, else the first. */
export function defaultSpaceId(spaces: readonly StudioSpace[]): string | null {
  return (spaces.find((space) => space.isDefault) ?? spaces[0])?.id ?? null;
}

export interface SpaceThreadGroup {
  space: StudioSpace;
  leadThreadId: string | null;
  /** The lead, when it's listed. It shows above the Space's lists, so it isn't in `threads`. */
  lead: SidebarThread | null;
  /** The lead's sub-threads, at any depth; they nest under the lead. */
  leadChildren: SidebarThread[];
  /** Pinned threads, in pin order, below the lead and above the rest; the lead stays the lead. */
  pinned: SidebarThread[];
  /** The pinned threads' sub-threads, at any depth. */
  pinnedChildren: SidebarThread[];
  /** Every other thread in the Space. */
  threads: SidebarThread[];
}

export function spaceSectionKey(spaceId: string): `space:${string}` {
  return `space:${spaceId}`;
}

/**
 * Which known Space a thread shows under. A child stays with its root's Space
 * so a thread tree is never split; a root without a Space falls back to the
 * thread's own. Unknown Space ids count as no Space, which is `fallback`
 * (the default Space) when given.
 */
export function createSpaceResolver(
  threads: readonly SidebarThread[],
  spaceOf: Readonly<Record<string, string>>,
  spaceIds: ReadonlySet<string>,
  fallback: string | null = null,
  /** A thread Studio hasn't listed yet, such as a new one, follows its project's Space. */
  projectSpace: ReadonlyMap<string, string> = new Map(),
): (thread: SidebarThread) => string | null {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const known = (id: string) => {
    const spaceId = spaceOf[id];
    return spaceId !== undefined && spaceIds.has(spaceId) ? spaceId : null;
  };
  return (thread) => {
    let root = thread;
    const seen = new Set([thread.id]);
    while (root.parentThreadId) {
      const parent = byId.get(root.parentThreadId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      root = parent;
    }
    const viaProject = projectSpace.get(root.projectId);
    return known(root.id) ?? known(thread.id) ?? (viaProject && spaceIds.has(viaProject) ? viaProject : null) ?? fallback;
  };
}

/**
 * One group per Space in Studio's order, each with its threads apart from the
 * lead and the pinned threads. Threads in no (known) Space join the default
 * Space; `loose` holds them only when there are no Spaces at all.
 */
export function buildSpaceThreadGroups(
  threads: readonly SidebarThread[],
  spaces: readonly StudioSpace[],
  spaceOf: Readonly<Record<string, string>>,
  leads: Readonly<Record<string, string | null>>,
  /** Pinned thread ids, in pin order. */
  pinnedIds: readonly string[] = [],
): { groups: SpaceThreadGroup[]; loose: SidebarThread[] } {
  const resolve = createSpaceResolver(threads, spaceOf, new Set(spaces.map((space) => space.id)), defaultSpaceId(spaces), projectSpaces(spaces));
  const bySpace = new Map<string, SidebarThread[]>();
  const loose: SidebarThread[] = [];
  for (const thread of threads) {
    const spaceId = resolve(thread);
    if (spaceId === null) {
      loose.push(thread);
      continue;
    }
    const bucket = bySpace.get(spaceId);
    if (bucket) bucket.push(thread);
    else bySpace.set(spaceId, [thread]);
  }
  return {
    groups: spaces.map((space) => {
      const leadThreadId = leads[space.id] ?? null;
      const held = bySpace.get(space.id) ?? [];
      const lead = held.find((thread) => thread.id === leadThreadId) ?? null;
      const underLead = lead ? descendantIds(lead.id, held) : new Set<string>();
      const byId = new Map(held.map((thread) => [thread.id, thread]));
      // A pin inside another pinned tree, or under the lead, stays where its root is.
      const pinnedSet = new Set(pinnedIds);
      const pinned = pinnedIds.flatMap((id) => {
        const thread = byId.get(id);
        if (!thread || id === leadThreadId || underLead.has(id)) return [];
        for (let parent = thread.parentThreadId ? byId.get(thread.parentThreadId) : undefined; parent; parent = parent.parentThreadId ? byId.get(parent.parentThreadId) : undefined) {
          if (pinnedSet.has(parent.id) || parent.id === leadThreadId) return [];
        }
        return [thread];
      });
      const underPinned = new Set(pinned.flatMap((thread) => [...descendantIds(thread.id, held)]));
      const pinnedRoots = new Set(pinned.map((thread) => thread.id));
      return {
        space,
        leadThreadId,
        lead,
        leadChildren: held.filter((thread) => underLead.has(thread.id)),
        pinned,
        pinnedChildren: held.filter((thread) => underPinned.has(thread.id)),
        threads: held.filter((thread) => thread.id !== leadThreadId && !underLead.has(thread.id) && !pinnedRoots.has(thread.id) && !underPinned.has(thread.id)),
      };
    }),
    loose,
  };
}

/** The ids of every thread below `rootId` among `threads`. */
function descendantIds(rootId: string, threads: readonly SidebarThread[]): Set<string> {
  const found = new Set<string>();
  let frontier = [rootId];
  while (frontier.length) {
    const parents = new Set(frontier);
    frontier = threads
      .filter((thread) => thread.parentThreadId !== null && parents.has(thread.parentThreadId) && thread.id !== rootId && !found.has(thread.id))
      .map((thread) => thread.id);
    for (const id of frontier) found.add(id);
  }
  return found;
}

/** A Space heading's drop target; the section key itself belongs to its thread list. */
export function spaceHeadingDropId(spaceId: string): string {
  return `space-head:${spaceId}`;
}

/** A Space dot's drop target in the switcher. */
export function spaceDotDropId(spaceId: string): string {
  return `space-dot:${spaceId}`;
}

export function isSpaceDotDropId(id: string): boolean {
  return id.startsWith("space-dot:");
}

/** The Space a drop target stands for: its section, heading or dot. */
export function spaceIdOfDropKey(key: string): string | null {
  const match = /^space(?:-head|-dot)?:(.+)$/u.exec(key);
  return match ? match[1]! : null;
}

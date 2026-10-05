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
  /** Every other thread in the Space; the lead's workers show at the top level. */
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
 * lead. Threads in no (known) Space join the default Space; `loose` holds
 * them only when there are no Spaces at all.
 */
export function buildSpaceThreadGroups(
  threads: readonly SidebarThread[],
  spaces: readonly StudioSpace[],
  spaceOf: Readonly<Record<string, string>>,
  leads: Readonly<Record<string, string | null>>,
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
      return {
        space,
        leadThreadId,
        lead: held.find((thread) => thread.id === leadThreadId) ?? null,
        threads: held.filter((thread) => thread.id !== leadThreadId),
      };
    }),
    loose,
  };
}

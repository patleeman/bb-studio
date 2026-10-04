import type { SidebarThread } from "../model/sidebar-thread.js";

/** The parts of a Studio Space the sidebar shows. */
export interface StudioSpace {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  defaultProjectId: string | null;
}

export interface SpaceThreadGroup {
  space: StudioSpace;
  leadThreadId: string | null;
  /** The lead, when it's listed. The Space's heading opens it, so it isn't in `threads`. */
  lead: SidebarThread | null;
  /** Every other thread in the Space; the lead's workers show at the top level. */
  threads: SidebarThread[];
}

export function spaceSectionKey(spaceId: string): `space:${string}` {
  return `space:${spaceId}`;
}

export function spaceHref(spaceId: string): string {
  return `/plugins/studio/spaces/${encodeURIComponent(spaceId)}`;
}

/**
 * Which known Space a thread shows under. A child stays with its root's Space
 * so a thread tree is never split; a root without a Space falls back to the
 * thread's own. Unknown Space ids count as no Space.
 */
export function createSpaceResolver(
  threads: readonly SidebarThread[],
  spaceOf: Readonly<Record<string, string>>,
  spaceIds: ReadonlySet<string>,
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
    return known(root.id) ?? known(thread.id);
  };
}

/**
 * One group per Space in Studio's order, each with its threads apart from the
 * lead, and the threads in no (known) Space for the closing Threads section.
 */
export function buildSpaceThreadGroups(
  threads: readonly SidebarThread[],
  spaces: readonly StudioSpace[],
  spaceOf: Readonly<Record<string, string>>,
  leads: Readonly<Record<string, string | null>>,
): { groups: SpaceThreadGroup[]; loose: SidebarThread[] } {
  const resolve = createSpaceResolver(threads, spaceOf, new Set(spaces.map((space) => space.id)));
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

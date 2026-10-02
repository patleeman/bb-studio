// Whether items are in a space, and whether that can change here. An item
// is in a space directly, or through its project; only direct membership can
// be undone per item.

export interface SpaceHolder {
  projectId: string | null;
  /** Every space holding the item, directly or through its project. */
  spaces?: readonly string[];
}

export interface SpaceMembership {
  /** Whether every item, some, or none are in the space. */
  has: boolean | "mixed";
  /** The projects that hold every item in the space; empty unless all do, when it can't change here. */
  through: string[];
}

export function spaceMembership(space: { id: string; projectIds?: readonly string[] }, items: readonly SpaceHolder[]): SpaceMembership {
  const count = items.filter((item) => item.spaces?.includes(space.id)).length;
  const locked = items.length > 0 && items.every((item) => item.projectId !== null && !!space.projectIds?.includes(item.projectId));
  return {
    has: count === 0 ? false : count === items.length ? true : "mixed",
    through: locked ? [...new Set(items.map((item) => item.projectId!))] : [],
  };
}

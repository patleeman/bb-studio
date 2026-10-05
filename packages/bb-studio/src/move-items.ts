// Moving Studio items to a project or a Space. Items follow their project, so
// moving one to a Space moves it into the Space's catch-all project; items
// already somewhere in that Space stay where they are.
import { inSpace, type Space } from "./spaces";

export interface MovableItem {
  pluginId: string;
  id: string;
  title: string;
  projectId: string | null;
}

export interface MovePlan<T extends MovableItem> {
  /** Ids to move, per plugin. */
  byPlugin: Map<string, string[]>;
  /** Items already where they're going. */
  unchanged: T[];
  /** Items whose kind can't move. */
  refused: T[];
}

/**
 * Which items to move where. `movable` tells whether an item's kind can move;
 * with a Space, items already in it stay.
 */
export function planMove<T extends MovableItem>(items: readonly T[], target: { projectId: string | null; space?: Space }, movable: (item: T) => boolean): MovePlan<T> {
  const byPlugin = new Map<string, string[]>();
  const unchanged: T[] = [];
  const refused: T[] = [];
  for (const item of items) {
    const there = target.space ? inSpace(target.space, item) : item.projectId === target.projectId;
    if (there) unchanged.push(item);
    else if (!movable(item)) refused.push(item);
    else byPlugin.set(item.pluginId, [...(byPlugin.get(item.pluginId) ?? []), item.id]);
  }
  return { byPlugin, unchanged, refused };
}

import type { z } from "zod";
import type { tableItemSchema } from "../contract";
import type { Relation } from "../model";

/** A Studio item a relation cell can point at. */
export type TableItem = z.infer<typeof tableItemSchema>;

/** What a table view needs from the surface it sits in. */
export interface TableHost {
  openUrl(url: string): void;
  /** Opens a relation cell's Studio item. */
  openItem?(relation: Relation): void;
  /** Items offered and named in relation cells. */
  items?: readonly TableItem[];
  /** Names offered in person and bot cells. */
  people?: readonly string[];
  bots?: readonly string[];
  /** Copies a link to the table, one of its views, or one of its rows. */
  copyLink?(target: { viewId?: string; rowId?: string }): void;
  onError(error: unknown): void;
}

export function itemKey(relation: Relation): string {
  return `${relation.pluginId}:${relation.itemId}`;
}

export function findItem(host: TableHost, relation: Relation): TableItem | undefined {
  return host.items?.find((item) => item.pluginId === relation.pluginId && item.itemId === relation.itemId);
}

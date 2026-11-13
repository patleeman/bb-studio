/** A group shows this many rows, then "N more". */
export const GROUP_FOLD = 8;

/** The rows a group shows: all when open, else the first GROUP_FOLD; and how many it leaves out. */
export function foldRows<T>(rows: readonly T[], open: boolean): { shown: T[]; more: number } {
  if (open || rows.length <= GROUP_FOLD) return { shown: [...rows], more: 0 };
  return { shown: rows.slice(0, GROUP_FOLD), more: rows.length - GROUP_FOLD };
}

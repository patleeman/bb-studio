import { errorMessage } from "@bb-studio/kit/format";
import type { Table } from "@bb-studio/kit/tables";

export type TableLoad = { table: Table | null; error: string };

/** A cancelled request cannot replace the result of a newer realtime refresh. */
export function loadTable(request: () => Promise<{ table: Table | null }>, receive: (result: TableLoad) => void): () => void {
  let cancelled = false;
  void request().then(
    ({ table }) => {
      if (!cancelled) receive({ table, error: table ? "" : "This table was deleted." });
    },
    (error) => {
      if (!cancelled) receive({ table: null, error: errorMessage(error) });
    },
  );
  return () => { cancelled = true; };
}

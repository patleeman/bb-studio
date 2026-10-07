// Tables' part of a Studio backup (docs/backup.md): `items/<id>.json` holds a
// whole table, rows included. Restore keeps ids and times, so running it again
// changes nothing, and a table edited here since the backup is kept.
import { mapProject, restoreDecision } from "@bb-studio/kit/backup";
import { fileSafeId, type BackupHandlers } from "@bb-studio/kit/server";
import { tableSchema, type Table } from "@bb-studio/kit/tables";
import type { TableStore } from "./store";

export function tablesBackup(store: TableStore, changed: (ids: string[]) => void = () => {}): BackupHandlers {
  return {
    version: 1,
    async backup(writer) {
      let tables = 0;
      let rows = 0;
      for (const table of store.list()) {
        await writer.json(`items/${fileSafeId(table.id)}.json`, table);
        tables += 1;
        rows += table.rows.length;
      }
      return { counts: { tables, rows } };
    },
    async restore(reader, { dryRun, projects, tally }) {
      const writes: Table[] = [];
      for (const name of await reader.list("items")) {
        let table: Table;
        try {
          const parsed = tableSchema.safeParse(await reader.json(`items/${name}`));
          if (!parsed.success) throw new Error(`Not a table: ${parsed.error.issues[0]?.message ?? "invalid"}`);
          table = store.checked(parsed.data as Table);
        } catch (error) {
          tally.record("failed", { id: name.replace(/\.json$/, "") }, error instanceof Error ? error.message : String(error));
          continue;
        }
        const local = store.get(table.id);
        const decision = restoreDecision(local?.updatedAt, table.updatedAt);
        tally.decided(decision, table);
        if (decision !== "create" && decision !== "update") continue;
        const mapped = mapProject(projects, table.projectId);
        if (mapped.unmapped) tally.unmapped(table);
        // An update keeps the table where it is here when its old project isn't on this BB.
        writes.push({ ...table, projectId: mapped.unmapped && local ? local.projectId : mapped.projectId });
      }
      if (dryRun || !writes.length) return;
      store.transaction(() => {
        for (const table of writes) store.put(table);
      });
      changed(writes.map((table) => table.id));
    },
  };
}

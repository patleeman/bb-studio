import type Database from "better-sqlite3";
import { resolve } from "node:path";

const RELEASED: Record<string, null | 0> = {
  environment_provider_id: null,
  environment_provider_plugin_id: null,
  environment_provider_selection: null,
  environment_provider_instance_key: null,
  provider_owns_path: 0,
  owner_thread_id: null,
  retire_at: null,
  teardown_status: null,
  teardown_message: null,
  teardown_attempt: 0,
};

export function releaseBbEnvironments(
  db: Database.Database,
  bbDataDirs: readonly string[],
): number {
  const columns = new Set(
    db
      .prepare<[], { name: string }>(
        "SELECT name FROM pragma_table_info('environments')",
      )
      .all()
      .map((column) => column.name),
  );
  const assignments = Object.keys(RELEASED).filter((column) =>
    columns.has(column),
  );
  if (assignments.length === 0) return 0;
  const update = db.prepare(
    `UPDATE environments SET ${assignments.map((column) => `"${column}" = @${column}`).join(", ")}
     WHERE (status <> 'destroyed' OR teardown_status IS NOT 'removed')
       AND (path = @root OR substr(path, 1, length(@root) + 1) = @root || '/'${columns.has("claim_path") ? " OR claim_path = @root OR substr(claim_path, 1, length(@root) + 1) = @root || '/'" : ""})
       AND (environment_provider_id IS NOT NULL OR provider_owns_path = 1 OR retire_at IS NOT NULL OR teardown_status IS NOT NULL)`,
  );
  let released = 0;
  db.transaction(() => {
    for (const root of new Set(bbDataDirs.map((dir) => resolve(dir)))) {
      if (root === "/" || root.length < 2) continue;
      released += update.run({
        ...Object.fromEntries(
          assignments.map((column) => [column, RELEASED[column]]),
        ),
        root,
      }).changes;
    }
  })();
  return released;
}

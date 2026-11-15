import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../src/migrations";
import { migrateToTasks, summarizeTaskMigration, verifyTaskMigration } from "../src/tasks/migrate";

const source = process.argv[2];
if (!source) {
  console.error("Usage: tsx scripts/tasks-dry-run.mts <path to Studio data.db>");
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "tasks-dry-run-"));
const copyPath = join(dir, "data.db");
const live = new Database(source, { readonly: true, fileMustExist: true });
await live.backup(copyPath);
live.close();

const copy = new Database(copyPath);
const hasTasks = !!copy.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get();
if (!hasTasks) copy.exec(MIGRATIONS.find((sql) => sql.includes("CREATE TABLE tasks"))!);
const first = migrateToTasks(copy);
const problems = verifyTaskMigration(copy);
const summary = summarizeTaskMigration(copy);
const second = migrateToTasks(copy);
copy.close();
console.log(JSON.stringify({ copy: copyPath, first, problems, summary, secondRun: second }, null, 2));

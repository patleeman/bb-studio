import Database from "better-sqlite3";
import { MIGRATIONS, TaskStore } from "../server/store";

export function memoryStore(now: () => number = Date.now): { db: Database.Database; store: TaskStore } {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { db, store: new TaskStore(db, now) };
}

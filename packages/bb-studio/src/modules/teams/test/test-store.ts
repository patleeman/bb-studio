import type Database from "better-sqlite3";
import { MIGRATIONS } from "../migrations";
import { Store } from "../store";

export function createTestStore(db: Database.Database): Store {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='office_team_migrations'").get()) for (const sql of MIGRATIONS) db.exec(sql);
  return new Store(db);
}

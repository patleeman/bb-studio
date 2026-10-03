import type Database from "better-sqlite3";
import { MIGRATIONS } from "../migrations";
import { Store } from "../store";

export function createTestStore(db: Database.Database): Store {
  for (const sql of MIGRATIONS) db.exec(sql);
  return new Store(db);
}

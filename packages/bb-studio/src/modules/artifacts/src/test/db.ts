import Database from "better-sqlite3";
import { ArtifactStore, MIGRATIONS } from "../server/store";

export function memoryStore(now: () => number = Date.now): { db: Database.Database; store: ArtifactStore } {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { db, store: new ArtifactStore(db, now) };
}

export const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

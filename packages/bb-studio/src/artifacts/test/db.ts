import Database from "better-sqlite3";
import { ARTIFACT_LIVE_TABLES } from "../live/store";
import { ARTIFACT_TABLES, ArtifactStore } from "../server/store";

export function memoryStore(now: () => number = Date.now): { db: Database.Database; store: ArtifactStore } {
  const db = new Database(":memory:");
  db.exec(ARTIFACT_TABLES);
  db.exec(ARTIFACT_LIVE_TABLES);
  return { db, store: new ArtifactStore(db, now) };
}

export const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

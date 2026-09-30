import Database from "better-sqlite3";
import { MIGRATIONS, TalkStore } from "../server/store";

export function memoryStore(now: () => number = Date.now): { db: Database.Database; store: TalkStore } {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { db, store: new TalkStore(db, now) };
}

export function addSegment(
  store: TalkStore,
  recordingId: string,
  sessionId: string,
  index: number,
  startedAt: number,
  durationMs = 20_000,
): boolean {
  return store.addSegment({
    recordingId,
    sessionId,
    index,
    startedAt,
    durationMs,
    mimeType: "audio/webm;codecs=opus",
    bytes: 1000,
    file: `${recordingId}/${sessionId}-${index}.webm`,
  });
}

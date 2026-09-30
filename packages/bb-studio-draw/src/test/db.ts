import Database from "better-sqlite3";
import { DrawingStore, MIGRATIONS } from "../server/store";

export function memoryStore(now: () => number = Date.now): { db: Database.Database; store: DrawingStore } {
  const db = new Database(":memory:");
  for (const statement of MIGRATIONS) db.exec(statement);
  return { db, store: new DrawingStore(db, now) };
}

type Element = Record<string, unknown>;

/** A saved scene with the given elements, in Excalidraw's file shape. */
export function scene(elements: Element[]): string {
  return JSON.stringify({ type: "excalidraw", version: 2, elements, appState: {}, files: {} });
}

let seed = 0;
export function element(type: string, props: Element = {}): Element {
  seed += 1;
  return { id: `el${seed}`, type, x: 0, y: 0, width: 100, height: 50, version: 1, versionNonce: seed, isDeleted: false, ...props };
}

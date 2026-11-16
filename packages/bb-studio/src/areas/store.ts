import type Database from "better-sqlite3";
import { area as areaSchema, type Area } from "./contract";

export class AreaStore {
  constructor(readonly db: Database.Database, readonly changed: () => void = () => {}) {}

  find(id: string): Area | null {
    const row = this.db.prepare("SELECT record FROM areas WHERE id = ?").get(id) as { record: string } | undefined;
    return row ? areaSchema.parse(JSON.parse(row.record)) : null;
  }

  all(): Area[] {
    return (this.db.prepare("SELECT record FROM areas ORDER BY rowid").all() as { record: string }[]).map((row) => areaSchema.parse(JSON.parse(row.record)));
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM areas").get() as { n: number }).n;
  }

  save(area: Area): Area {
    const next = areaSchema.parse(area);
    this.db.prepare("INSERT INTO areas (id, record, updated_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at")
      .run(next.id, JSON.stringify(next), next.updatedAt);
    return next;
  }
}

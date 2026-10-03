import type Database from "better-sqlite3";

/** Runs after the legacy Spaces-to-office migration, which replaces `spaces`.
 * Keeping this in the office migration ledger supports both fresh and upgraded DBs. */
export function migrateSpaceOrder(db: Database.Database): void {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM office_migrations WHERE id='space-order-v1'").get()) return;
    db.exec("ALTER TABLE spaces ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    const rows = db.prepare("SELECT id FROM spaces ORDER BY is_default DESC,name COLLATE NOCASE,id").all() as { id: string }[];
    const put = db.prepare("UPDATE spaces SET position=? WHERE id=?");
    rows.forEach((row, i) => put.run(i, row.id));
    db.prepare("INSERT INTO office_migrations VALUES ('space-order-v1',?)").run(Date.now());
  })();
}

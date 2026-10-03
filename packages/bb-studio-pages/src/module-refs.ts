import type Database from "better-sqlite3";
import * as Y from "yjs";
import { legacyReferencePluginIds, rewriteLegacyValue } from "@bb-studio/kit/contract";
import { DOCUMENT_FRAGMENT, THREADS_MAP } from "./schema-config";
import { readMarkdown } from "./doc";

/** Preserve Yjs structure, block ids, comments and formatting while changing refs. */
export function rewriteDocumentRefs(doc: Y.Doc, ids: readonly string[]): number {
  let changes = 0;
  const rewrite = (value: unknown) => rewriteLegacyValue(value, ids);
  const different = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const visit = (node: unknown): void => {
    if (node instanceof Y.XmlElement) {
      for (const [key, value] of Object.entries(node.getAttributes())) {
        const next = rewriteLegacyValue(value, ids, key);
        if (different(value, next)) { node.setAttribute(key, next as string); changes++; }
      }
      node.toArray().forEach(visit);
    } else if (node instanceof Y.XmlText || node instanceof Y.Text) {
      const delta = node.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>;
      const next = delta.map(part => ({ ...part, insert: rewrite(part.insert), ...(part.attributes ? { attributes: rewrite(part.attributes) } : {}) }));
      if (different(delta, next)) { node.delete(0, node.length); node.applyDelta(next); changes++; }
    } else if (node instanceof Y.XmlFragment) node.toArray().forEach(visit);
    else if (node instanceof Y.Map) {
      for (const [key, value] of node.entries()) {
        if (value instanceof Y.AbstractType) visit(value);
        else { const next = rewriteLegacyValue(value, ids, key); if (different(value, next)) { node.set(key, next); changes++; } }
      }
    } else if (node instanceof Y.Array) {
      for (let index = node.length - 1; index >= 0; index--) {
        const value = node.get(index);
        if (value instanceof Y.AbstractType) visit(value);
        else { const next = rewrite(value); if (different(value, next)) { node.delete(index, 1); node.insert(index, [next]); changes++; } }
      }
    }
  };
  doc.transact(() => { visit(doc.getXmlFragment(DOCUMENT_FRAGMENT)); visit(doc.getMap(THREADS_MAP)); }, "studio-module-refs");
  return changes;
}

export function migratePageModuleRefs(db: Database.Database): number {
  db.exec(`CREATE TABLE IF NOT EXISTS studio_ref_migrations (legacy_id TEXT PRIMARY KEY, changes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS studio_ref_backups (source_table TEXT NOT NULL, source_id TEXT NOT NULL, legacy_id TEXT NOT NULL, state BLOB NOT NULL, PRIMARY KEY(source_table, source_id, legacy_id))`);
  return db.transaction(() => {
    let total = 0;
    for (const legacyId of legacyReferencePluginIds) {
      if (db.prepare("SELECT 1 FROM studio_ref_migrations WHERE legacy_id = ?").get(legacyId)) continue;
      let changed = 0;
      for (const table of ["pages", "snapshots"] as const) {
        const rows = db.prepare(`SELECT id, state FROM ${table} WHERE state IS NOT NULL`).all() as { id: string; state: Buffer }[];
        for (const row of rows) {
          const doc = new Y.Doc();
          try {
            Y.applyUpdate(doc, row.state);
            const changes = rewriteDocumentRefs(doc, [legacyId]);
            if (!changes) continue;
            db.prepare("INSERT INTO studio_ref_backups VALUES (?, ?, ?, ?)").run(table, row.id, legacyId, row.state);
            const state = Buffer.from(Y.encodeStateAsUpdate(doc));
            if (table === "pages") db.prepare("UPDATE pages SET state = ?, markdown = ? WHERE id = ?").run(state, readMarkdown(doc), row.id);
            else db.prepare("UPDATE snapshots SET state = ? WHERE id = ?").run(state, row.id);
            changed += changes;
          } finally { doc.destroy(); }
        }
      }
      db.prepare("INSERT INTO studio_ref_migrations VALUES (?, ?)").run(legacyId, changed);
      total += changed;
    }
    return total;
  })();
}

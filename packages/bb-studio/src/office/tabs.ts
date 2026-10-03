import type Database from "better-sqlite3";
import { newId } from "@bb-studio/kit/ids";
import type { OfficeSpaceStore } from "./space-store";
import type { Tab, TabFolder, TabTarget, TabZone } from "./tabs-contract";

export interface TabRow { ref: string; zone: TabZone; folder_id: string | null; position: number; opened_at: number; archived_at: number | null }
const archiveHours = { "12h": 12, "1d": 24, "3d": 72, "7d": 168 };

/** All ordering changes and the seed marker commit atomically. Resolvers run
 * outside transactions; this store never mutates the referenced objects. */
export class OfficeTabs {
  constructor(private readonly db: Database.Database, private readonly spaces: OfficeSpaceStore, private readonly changed: () => void, private readonly now = Date.now) {}

  private batching = 0;
  private notify(): void { if (!this.batching) this.changed(); }
  private atomic<T>(work: () => T): T {
    this.batching++;
    let result: T;
    try { result = this.db.transaction(work)(); }
    finally { this.batching--; }
    this.notify();
    return result;
  }
  split(spaceId: string, ref: string): string[] | null {
    const row = this.db.prepare("SELECT refs FROM office_tab_splits WHERE space_id=? AND id=?").get(spaceId, ref.slice(6)) as { refs: string } | undefined;
    return row ? JSON.parse(row.refs) as string[] : null;
  }
  containing(spaceId: string, ref: string): string | null {
    const rows = this.db.prepare("SELECT id,refs FROM office_tab_splits WHERE space_id=?").all(spaceId) as { id: string; refs: string }[];
    return rows.find(s => (JSON.parse(s.refs) as string[]).includes(ref))?.id ?? null;
  }
  createSplit(spaceId: string, refs: string[], zone: TabZone = "today", folderId?: string | null): string {
    this.spaces.get(spaceId);
    return this.atomic(() => {
      const json = JSON.stringify(refs);
      const existing = this.db.prepare("SELECT id FROM office_tab_splits WHERE space_id=? AND refs=?").get(spaceId, json) as { id: string } | undefined;
      if (existing) return `split:${existing.id}`;
      const id = newId("spl");
      this.db.prepare("INSERT INTO office_tab_splits VALUES (?,?,?,?)").run(id, spaceId, json, this.now());
      this.forget(spaceId, refs);
      this.open(spaceId, `split:${id}`);
      this.move(spaceId, `split:${id}`, zone, folderId, 0);
      return `split:${id}`;
    });
  }
  /** Only confirmed missing members are passed here. One survivor inherits
   * the split's zone, folder, order and timestamps, including archive state. */
  cleanSplit(spaceId: string, ref: string, live: string[]): string | null {
    const refs = this.split(spaceId, ref);
    if (!refs) return null;
    if (JSON.stringify(refs) === JSON.stringify(live)) return ref;
    return this.atomic(() => {
      if (live.length > 1) {
        this.db.prepare("UPDATE office_tab_splits SET refs=? WHERE space_id=? AND id=?").run(JSON.stringify(live), spaceId, ref.slice(6));
        return ref;
      }
      const row = this.rows(spaceId).find(t => t.ref === ref);
      this.db.prepare("DELETE FROM office_tabs WHERE space_id=? AND ref=?").run(spaceId, ref);
      this.db.prepare("DELETE FROM office_tab_splits WHERE space_id=? AND id=?").run(spaceId, ref.slice(6));
      if (live[0] && row) this.db.prepare("INSERT OR REPLACE INTO office_tabs VALUES (?,?,?,?,?,?,?)")
        .run(spaceId, live[0], row.zone, row.folder_id, row.position, row.opened_at, row.archived_at);
      return live[0] ?? null;
    });
  }
  removeSplit(spaceId: string, ref: string, liveRefs?: string[]): void {
    this.spaces.get(spaceId);
    const refs = this.split(spaceId, ref);
    if (!refs) return;
    this.atomic(() => {
      this.forget(spaceId, [ref]);
      for (const member of [...(liveRefs ?? refs)].reverse()) {
        this.open(spaceId, member);
        this.move(spaceId, member, "today", null, 0);
      }
    });
  }
  moveSpace(spaceId: string, ref: string, toSpaceId: string): void {
    this.spaces.get(toSpaceId);
    if (!this.rows(spaceId).some(t => t.ref === ref)) throw new Error("That tab is not in this Space.");
    this.atomic(() => {
      const members = this.split(spaceId, ref);
      this.db.prepare("DELETE FROM office_tabs WHERE space_id=? AND ref=?").run(spaceId, ref);
      if (members) {
        const duplicate = this.db.prepare("SELECT id FROM office_tab_splits WHERE space_id=? AND refs=? AND id!=?").get(toSpaceId, JSON.stringify(members), ref.slice(6)) as { id: string } | undefined;
        if (duplicate) this.forget(toSpaceId, [`split:${duplicate.id}`]);
        this.db.prepare("UPDATE office_tab_splits SET space_id=? WHERE space_id=? AND id=?").run(toSpaceId, spaceId, ref.slice(6));
        this.forget(toSpaceId, members);
      }
      this.open(toSpaceId, ref);
      this.move(toSpaceId, ref, "today", null, 0);
    });
  }
  closeMany(spaceId: string, refs: string[]): void {
    this.spaces.get(spaceId);
    this.atomic(() => {
      const put = this.db.prepare("UPDATE office_tabs SET zone='archived',folder_id=NULL,archived_at=? WHERE space_id=? AND ref=? AND zone!='archived'");
      let at = this.archiveTime(spaceId);
      for (const ref of new Set(refs)) at += put.run(at, spaceId, ref).changes;
    });
  }
  private archiveTime(spaceId: string): number {
    const row = this.db.prepare("SELECT MAX(archived_at) AS latest FROM office_tabs WHERE space_id=?").get(spaceId) as { latest: number | null };
    return Math.max(this.now(), (row.latest ?? 0) + 1);
  }

  rows(spaceId: string): TabRow[] {
    this.spaces.get(spaceId);
    return this.db.prepare("SELECT * FROM office_tabs WHERE space_id=? ORDER BY position,ref").all(spaceId) as TabRow[];
  }
  tab(spaceId: string, target: TabTarget): Tab {
    const row = this.rows(spaceId).find(t => t.ref === target.ref);
    return { ...target, zone: row?.zone ?? "archived", folderId: row?.folder_id ?? null, openedAt: row?.opened_at ?? 0, archivedAt: row?.archived_at ?? null };
  }
  seeded(spaceId: string): boolean {
    this.spaces.get(spaceId);
    return !!this.db.prepare("SELECT 1 FROM space_settings WHERE space_id=? AND key='office.tabsSeeded'").get(spaceId);
  }
  private markSeeded(spaceId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO space_settings VALUES (?,'office.tabsSeeded','true')").run(spaceId);
  }
  private order(spaceId: string, refs: string[]): void {
    const put = this.db.prepare("UPDATE office_tabs SET position=? WHERE space_id=? AND ref=?");
    refs.forEach((ref, index) => put.run(index, spaceId, ref));
  }
  private place(spaceId: string, ref: string, zone: TabZone, folderId: string | null, index = 0): void {
    const refs = this.rows(spaceId).filter(t => t.zone === zone && t.folder_id === folderId && t.ref !== ref).map(t => t.ref);
    refs.splice(Math.min(index, refs.length), 0, ref);
    this.order(spaceId, refs);
  }
  open(spaceId: string, ref: string): void {
    this.db.transaction(() => {
      const old = this.rows(spaceId).find(t => t.ref === ref);
      if (!old || old.zone === "archived") {
        this.db.prepare("INSERT INTO office_tabs VALUES (?,?,'today',NULL,0,?,NULL) ON CONFLICT(space_id,ref) DO UPDATE SET zone='today',folder_id=NULL,opened_at=excluded.opened_at,archived_at=NULL")
          .run(spaceId, ref, this.now());
        this.place(spaceId, ref, "today", null);
      } else this.db.prepare("UPDATE office_tabs SET opened_at=? WHERE space_id=? AND ref=?").run(this.now(), spaceId, ref);
    })();
    this.notify();
  }
  move(spaceId: string, ref: string, zone: TabZone, folderId?: string | null, index?: number): void {
    this.db.transaction(() => {
      const rows = this.rows(spaceId);
      const old = rows.find(t => t.ref === ref);
      if (!old) throw new Error("Open this target before moving its tab.");
      if (zone === "essential" && old.zone !== zone && rows.filter(t => t.zone === zone).length >= 8) throw new Error("Essentials can hold up to 8 tabs.");
      if (folderId && zone !== "pinned") throw new Error("Only Pinned tabs can belong to a tab folder.");
      const folder = zone === "pinned" ? folderId ?? null : null;
      if (folder && !this.folders(spaceId).some(f => f.id === folder)) throw new Error("That tab folder is not in this Space.");
      this.db.prepare("UPDATE office_tabs SET zone=?,folder_id=?,archived_at=?,opened_at=? WHERE space_id=? AND ref=?")
        .run(zone, folder, zone === "archived" ? this.archiveTime(spaceId) : null, zone === "today" && old.zone !== "today" ? this.now() : old.opened_at, spaceId, ref);
      // Today and the archive are newest first; Essentials and Pinned grow at the end, as in Arc.
      this.place(spaceId, ref, zone, folder, index ?? (zone === "today" || zone === "archived" ? 0 : Number.MAX_SAFE_INTEGER));
    })();
    this.notify();
  }
  archiveOld(spaceId: string): void {
    const setting = this.spaces.settings(spaceId).todayArchiveAfter;
    if (setting === "never") return;
    const result = this.db.prepare("UPDATE office_tabs SET zone='archived',archived_at=? WHERE space_id=? AND zone='today' AND opened_at < ?")
      .run(this.archiveTime(spaceId), spaceId, this.now() - archiveHours[setting] * 3600000);
    if (result.changes) this.notify();
  }
  forget(spaceId: string, refs: string[]): void {
    let count = 0;
    this.db.transaction(() => {
      const remove = this.db.prepare("DELETE FROM office_tabs WHERE space_id=? AND ref=?");
      for (const ref of refs) {
        count += remove.run(spaceId, ref).changes;
        if (ref.startsWith("split:")) count += this.db.prepare("DELETE FROM office_tab_splits WHERE space_id=? AND id=?").run(spaceId, ref.slice(6)).changes;
      }
    })();
    if (count) this.notify();
  }
  seed(spaceId: string, essentials: string[], pinned: string[]): void {
    const changed = this.db.transaction(() => {
      if (this.seeded(spaceId)) return false;
      // A route may open before the client's seed request. Keep those rows.
      const insert = this.db.prepare("INSERT OR IGNORE INTO office_tabs VALUES (?,?,?,NULL,?,?,NULL)");
      for (const [zone, refs] of [["essential", essentials.slice(0, 8)], ["pinned", pinned]] as const) {
        const existing = this.rows(spaceId).filter(t => t.zone === zone);
        let count = existing.length;
        let position = Math.max(-1, ...existing.map(t => t.position)) + 1;
        for (const ref of new Set(refs)) {
          if (this.containing(spaceId, ref)) continue;
          if (zone === "essential" && count >= 8) break;
          const added = insert.run(spaceId, ref, zone, position, this.now()).changes;
          position += added; count += added;
        }
      }
      this.markSeeded(spaceId);
      return true;
    })();
    if (changed) this.notify();
  }
  folders(spaceId: string): TabFolder[] {
    this.spaces.get(spaceId);
    return (this.db.prepare("SELECT * FROM office_tab_folders WHERE space_id=? ORDER BY position,id").all(spaceId) as (Omit<TabFolder, "open"> & { open: number })[])
      .map(f => ({ id: f.id, name: f.name, open: !!f.open, position: f.position }));
  }
  private folder(id: string): { space_id: string } & TabFolder {
    const row = this.db.prepare("SELECT * FROM office_tab_folders WHERE id=?").get(id) as ({ space_id: string } & TabFolder) | undefined;
    if (!row) throw new Error("That tab folder no longer exists.");
    return { ...row, open: !!row.open };
  }
  createFolder(spaceId: string, name: string): TabFolder {
    const id = newId("tbf");
    const position = this.folders(spaceId).length;
    this.db.prepare("INSERT INTO office_tab_folders VALUES (?,?,?,1,?)").run(id, spaceId, name, position);
    this.notify();
    return { id, name, open: true, position };
  }
  updateFolder(id: string, patch: { name?: string; open?: boolean; position?: number }): TabFolder {
    const old = this.folder(id);
    this.db.transaction(() => {
      this.db.prepare("UPDATE office_tab_folders SET name=?,open=? WHERE id=?").run(patch.name ?? old.name, +(patch.open ?? old.open), id);
      if (patch.position !== undefined) {
        const ids = this.folders(old.space_id).filter(f => f.id !== id).map(f => f.id);
        ids.splice(Math.min(patch.position, ids.length), 0, id);
        const put = this.db.prepare("UPDATE office_tab_folders SET position=? WHERE id=?");
        ids.forEach((key, i) => put.run(i, key));
      }
    })();
    this.notify();
    return this.folders(old.space_id).find(f => f.id === id)!;
  }
  deleteFolder(id: string): void {
    const old = this.folder(id);
    this.db.transaction(() => {
      const rows = this.rows(old.space_id);
      const refs = [...rows.filter(t => t.folder_id === id), ...rows.filter(t => t.zone === "pinned" && t.folder_id === null)].map(t => t.ref);
      this.db.prepare("UPDATE office_tabs SET folder_id=NULL WHERE folder_id=?").run(id);
      this.order(old.space_id, refs);
      this.db.prepare("DELETE FROM office_tab_folders WHERE id=?").run(id);
      const put = this.db.prepare("UPDATE office_tab_folders SET position=? WHERE id=?");
      this.folders(old.space_id).forEach((f, i) => put.run(i, f.id));
    })();
    this.notify();
  }
}

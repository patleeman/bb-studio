import type Database from "better-sqlite3";
import { SpaceStore, type Space, type SpaceInput, type SpaceMember, PROJECT_REF } from "../spaces";
import { OfficeSpaceStore } from "./space-store";

/** Old RPC result shapes remain readable while ownership follows core projects. */
export class ProjectSpaceStore extends SpaceStore {
  readonly office: OfficeSpaceStore;
  constructor(private readonly rootDb: Database.Database) { super(rootDb); this.office = new OfficeSpaceStore(rootDb); }
  override list(): Space[] {
    return this.office.list().map(s => {
      const extra = this.rootDb.prepare("SELECT color,page_id FROM spaces WHERE id=?").get(s.id) as { color: string; page_id: string | null };
      return { ...s, color: extra.color, pageId: extra.page_id, threadIds: [], itemKeys: [] };
    });
  }
  override create(input: SpaceInput & { name: string }): Space {
    const s = this.office.create(input);
    if (input.defaultProjectId) this.office.setCatchAll(s.id, input.defaultProjectId);
    return this.get(s.id)!;
  }
  override update(id: string, input: SpaceInput): Space {
    this.office.update({ ...input, spaceId: id });
    if (input.defaultProjectId) this.office.setCatchAll(id, input.defaultProjectId);
    return this.get(id)!;
  }
  override remove(id: string): void { this.office.remove(id); }
  override add(id: string, members: readonly SpaceMember[]): void {
    if (members.some(m => m.pluginId !== PROJECT_REF)) throw new Error("Space membership follows the item's folder. Move its project or move the item to a folder in this Space.");
    for (const member of members) this.office.moveProject(member.id, id);
  }
  override removeMembers(id: string, members: readonly SpaceMember[]): void {
    if (members.some(m => m.pluginId !== PROJECT_REF)) throw new Error("Space membership follows the item's folder.");
    for (const member of members) if (this.office.forProject(member.id).id === id) this.office.moveProject(member.id, this.office.defaultSpace().id);
  }
  override inheritParents(..._args: Parameters<SpaceStore["inheritParents"]>): boolean { return false; }
  override setPage(id: string, pageId: string | null, template = 1): void {
    this.office.get(id);
    this.rootDb.prepare("UPDATE spaces SET page_id=?,page_template=? WHERE id=?").run(pageId, template, id);
  }
  override pageTemplate(id: string): number {
    return (this.rootDb.prepare("SELECT page_template FROM spaces WHERE id=?").get(id) as { page_template: number | null } | undefined)?.page_template ?? 1;
  }
  override setPageTemplate(id: string, template: number): void {
    this.rootDb.prepare("UPDATE spaces SET page_template=? WHERE id=?").run(template, id);
  }
}

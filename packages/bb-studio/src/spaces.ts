// Spaces gather Studio items, BB projects and threads into one place. A space
// is a protected tag: it lives in `tags` with kind 'space' and keeps its
// members in `item_tags`, so add-ons don't need to know about it and deleted
// items leave it the way they leave tags. Unlike a tag, only the user makes,
// renames or deletes one; agents can add to a space that exists.
//
// Members are `<plugin>:<id>` refs. A BB project is `bb-project:<project id>`
// and pulls in everything in that project, now and later; a thread is
// `bb-thread:<thread id>`. No add-on lists those, so pruning leaves them be.
import { newId } from "@bb-studio/kit/ids";
import type Database from "better-sqlite3";
import { tagName, TAG_COLORS, type ItemRef } from "./tags";

export const PROJECT_REF = "bb-project";
export const THREAD_REF = "bb-thread";
export const MAX_SPACE_DESCRIPTION = 500;

export interface Space {
  id: string;
  name: string;
  color: string;
  /** An emoji, or null for the space icon. */
  icon: string | null;
  description: string;
  /** Where the space's new items and threads go; null for global. */
  defaultProjectId: string | null;
  /** BB projects whose items and threads all belong to the space. */
  projectIds: string[];
  /** Threads added one by one. */
  threadIds: string[];
  /** Studio items added one by one, as `<plugin>:<id>`. */
  itemKeys: string[];
  createdAt: number;
  /** When it was made or last gained a member. */
  updatedAt: number;
}

export interface SpaceInput {
  name?: string;
  icon?: string | null;
  description?: string;
  defaultProjectId?: string | null;
}

/** What a space can hold: an item, a thread, or a whole project. */
export type SpaceMember = ItemRef;

interface SpaceRow {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  description: string | null;
  default_project_id: string | null;
  created_at: number;
}

function description(raw: string): string {
  const text = raw.trim();
  if (text.length > MAX_SPACE_DESCRIPTION) throw new Error(`Space descriptions are at most ${MAX_SPACE_DESCRIPTION} characters.`);
  return text;
}

export class SpaceStore {
  constructor(private readonly db: Database.Database) {}

  list(): Space[] {
    const rows = this.db
      .prepare(
        `SELECT tags.id, tags.name, tags.color, tags.created_at, spaces.icon, spaces.description, spaces.default_project_id
           FROM tags LEFT JOIN spaces ON spaces.tag_id = tags.id
          WHERE tags.kind = 'space' ORDER BY tags.name COLLATE NOCASE`,
      )
      .all() as SpaceRow[];
    const members = this.db
      .prepare("SELECT plugin_id, item_id, tag_id, item_tags.created_at FROM item_tags JOIN tags ON tags.id = item_tags.tag_id WHERE tags.kind = 'space' ORDER BY item_tags.created_at")
      .all() as { plugin_id: string; item_id: string; tag_id: string; created_at: number }[];
    return rows.map((row) => {
      const own = members.filter((member) => member.tag_id === row.id);
      return {
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        description: row.description ?? "",
        defaultProjectId: row.default_project_id,
        projectIds: own.filter((member) => member.plugin_id === PROJECT_REF).map((member) => member.item_id),
        threadIds: own.filter((member) => member.plugin_id === THREAD_REF).map((member) => member.item_id),
        itemKeys: own.filter((member) => member.plugin_id !== PROJECT_REF && member.plugin_id !== THREAD_REF).map((member) => `${member.plugin_id}:${member.item_id}`),
        createdAt: row.created_at,
        updatedAt: Math.max(row.created_at, ...own.map((member) => member.created_at)),
      };
    });
  }

  get(id: string): Space | null {
    return this.list().find((space) => space.id === id) ?? null;
  }

  /** By id, or by name ignoring case and a leading "#". */
  find(idOrName: string): Space | null {
    const spaces = this.list();
    const byId = spaces.find((space) => space.id === idOrName);
    if (byId) return byId;
    const name = idOrName.replace(/^#+\s*/, "").trim().toLowerCase();
    return spaces.find((space) => space.name.toLowerCase() === name) ?? null;
  }

  create(input: SpaceInput & { name: string }): Space {
    const name = tagName(input.name);
    const clash = this.db.prepare("SELECT kind FROM tags WHERE name = ? COLLATE NOCASE").get(name) as { kind: string } | undefined;
    if (clash) throw new Error(`There's already a ${clash.kind === "space" ? "space" : "tag"} called "${name}".`);
    const count = (this.db.prepare("SELECT COUNT(*) AS n FROM tags WHERE kind = 'space'").get() as { n: number }).n;
    const id = newId("spc");
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO tags (id, name, color, created_at, kind) VALUES (?, ?, ?, ?, 'space')").run(id, name, TAG_COLORS[count % TAG_COLORS.length]!, Date.now());
      this.db
        .prepare("INSERT INTO spaces (tag_id, icon, description, default_project_id) VALUES (?, ?, ?, ?)")
        .run(id, input.icon ?? null, description(input.description ?? ""), input.defaultProjectId ?? null);
      if (input.defaultProjectId) this.add(id, [{ pluginId: PROJECT_REF, id: input.defaultProjectId }]);
    })();
    return this.get(id)!;
  }

  update(id: string, input: SpaceInput): Space {
    const space = this.get(id);
    if (!space) throw new Error("That space no longer exists.");
    this.db.transaction(() => {
      if (input.name !== undefined) {
        const name = tagName(input.name);
        const clash = this.db.prepare("SELECT id, kind FROM tags WHERE name = ? COLLATE NOCASE").get(name) as { id: string; kind: string } | undefined;
        if (clash && clash.id !== id) throw new Error(`There's already a ${clash.kind === "space" ? "space" : "tag"} called "${name}".`);
        this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, id);
      }
      this.db
        .prepare("INSERT INTO spaces (tag_id, icon, description, default_project_id) VALUES (?, ?, ?, ?) ON CONFLICT (tag_id) DO UPDATE SET icon = excluded.icon, description = excluded.description, default_project_id = excluded.default_project_id")
        .run(
          id,
          input.icon !== undefined ? input.icon : space.icon,
          input.description !== undefined ? description(input.description) : space.description,
          input.defaultProjectId !== undefined ? input.defaultProjectId : space.defaultProjectId,
        );
      if (input.defaultProjectId) this.add(id, [{ pluginId: PROJECT_REF, id: input.defaultProjectId }]);
    })();
    return this.get(id)!;
  }

  /** Deletes the space; its members stay where they are. */
  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM item_tags WHERE tag_id = ?").run(id);
      this.db.prepare("DELETE FROM spaces WHERE tag_id = ?").run(id);
      this.db.prepare("DELETE FROM tags WHERE id = ? AND kind = 'space'").run(id);
    })();
  }

  add(id: string, members: readonly SpaceMember[]): void {
    if (!this.exists(id)) throw new Error("That space no longer exists.");
    const insert = this.db.prepare("INSERT OR IGNORE INTO item_tags (plugin_id, item_id, tag_id, created_at) VALUES (?, ?, ?, ?)");
    const now = Date.now();
    this.db.transaction(() => {
      for (const member of members) insert.run(member.pluginId, member.id, id, now);
    })();
  }

  /** Removing the default project from a space also clears it as the default. */
  removeMembers(id: string, members: readonly SpaceMember[]): void {
    const drop = this.db.prepare("DELETE FROM item_tags WHERE plugin_id = ? AND item_id = ? AND tag_id = ?");
    const clear = this.db.prepare("UPDATE spaces SET default_project_id = NULL WHERE tag_id = ? AND default_project_id = ?");
    this.db.transaction(() => {
      for (const member of members) {
        drop.run(member.pluginId, member.id, id);
        if (member.pluginId === PROJECT_REF) clear.run(id, member.id);
      }
    })();
  }

  private exists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM tags WHERE id = ? AND kind = 'space'").get(id) !== undefined;
  }
}

/** Whether an item is in a space: added to it, or in one of its projects. */
export function inSpace(space: Space, item: { pluginId: string; id: string; projectId: string | null }): boolean {
  return space.itemKeys.includes(`${item.pluginId}:${item.id}`) || (item.projectId !== null && space.projectIds.includes(item.projectId));
}

/** Whether a thread is in a space: added to it, or in one of its projects. */
export function threadInSpace(space: Space, thread: { id: string; projectId: string | null }): boolean {
  return space.threadIds.includes(thread.id) || (thread.projectId !== null && space.projectIds.includes(thread.projectId));
}

/** Space ids per `<plugin>:<id>`, for every item given. */
export function spaceAssignments(spaces: readonly Space[], items: readonly { pluginId: string; id: string; projectId: string | null }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of items) {
    const ids = spaces.filter((space) => inSpace(space, item)).map((space) => space.id);
    if (ids.length) map.set(`${item.pluginId}:${item.id}`, ids);
  }
  return map;
}

/** Space ids a new thread's first input links to, as `/plugins/studio/studio/space/<id>`. */
export function linkedSpaceIds(text: string): string[] {
  return [...new Set([...text.matchAll(/\/plugins\/studio\/studio\/space\/(spc_[A-Za-z0-9]+)/g)].map((match) => match[1]!))];
}

/** The app path that opens a space in the Studio collection. */
export function spacePath(id: string): string {
  return `/plugins/studio/studio/space/${encodeURIComponent(id)}`;
}

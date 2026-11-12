// Whiteboards: drawings that live in pages. A page embeds one as
// ```embed {"kind":"drawing","target":"drw_…"}```; the drawing stays in the
// `drawings` table. These helpers find the pages a drawing is in, and gather
// drawings no page shows (orphans) into a "Whiteboards" page so none is lost.

/** A page, as the whiteboard tools and the editor need it. */
export interface WhiteboardPage {
  id: string;
  title: string;
  projectId: string | null;
  archived: boolean;
}

/** What Pages gives Drawings. Pages registers after Drawings, so it's connected later. */
export interface WhiteboardPages {
  /** Every page that embeds a drawing, keyed by drawing id. */
  embeddings(): Map<string, WhiteboardPage[]>;
  page(id: string): WhiteboardPage | null;
  /** Adds a whiteboard embed at the end of the page, or after `afterBlockId`. */
  embed(pageId: string, drawingIds: readonly string[], options?: { afterBlockId?: string; by?: "agent" | "studio" }): void;
  createPage(input: { projectId: string | null; title: string; markdown: string }): string;
}

export const pagePath = (pageId: string) => `/plugins/studio/studio/pages/${pageId}`;

/**
 * The Markdown block that embeds a drawing as a whiteboard, at its default
 * height or `height` pixels. Options, not a second argument, so
 * `ids.map(whiteboardMarkdown)` can't pass an index as a height.
 */
export function whiteboardMarkdown(drawingId: string, { height }: { height?: number } = {}): string {
  return "```embed\n" + JSON.stringify({ kind: "drawing", target: drawingId, ...(height ? { height } : {}) }) + "\n```";
}

/** The height of the whiteboard New → Whiteboard makes: most of a page. */
export const NEW_WHITEBOARD_PAGE_HEIGHT = 640;

const EMBED_FENCE = /```embed[ \t]*\n([\s\S]*?)\n[ \t]*```/g;

/** The drawing ids a page's Markdown embeds, in order. */
export function embeddedDrawingIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(EMBED_FENCE)) {
    try {
      const value = JSON.parse(match[1]!) as { kind?: unknown; target?: unknown };
      if (value?.kind === "drawing" && typeof value.target === "string" && value.target && !ids.includes(value.target)) ids.push(value.target);
    } catch {
      // Not JSON: Pages reads it as a bookmark, not a drawing.
    }
  }
  return ids;
}

/** One "Drawings" page per project, from the migration's last run. */
export type OrphanMigrationState = { pages: Record<string, string>; migrated: string[] };
export const ORPHAN_MIGRATION_KEY = "drawings:orphans-to-pages";

const projectKey = (projectId: string | null) => projectId ?? "";

/**
 * Embeds each drawing no page shows in its project's "Drawings" page, made
 * when needed. A drawing is moved once: deleting the page or the embed later
 * doesn't bring it back. No orphans, no change. Templates and archived
 * drawings stay where they are, in the library.
 */
export function migrateOrphanDrawings(input: {
  drawings: readonly { id: string; name: string; projectId: string | null; archived: boolean; template: boolean; createdAt: number }[];
  pages: WhiteboardPages;
  state: OrphanMigrationState | null;
}): { state: OrphanMigrationState; moved: string[] } | null {
  const state: OrphanMigrationState = { pages: { ...(input.state?.pages ?? {}) }, migrated: [...(input.state?.migrated ?? [])] };
  const done = new Set(state.migrated);
  const embedded = input.pages.embeddings();
  const orphans = input.drawings
    .filter((drawing) => !drawing.archived && !drawing.template && !done.has(drawing.id) && !embedded.has(drawing.id))
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!orphans.length) return null;
  const byProject = new Map<string, typeof orphans>();
  for (const drawing of orphans) byProject.set(projectKey(drawing.projectId), [...(byProject.get(projectKey(drawing.projectId)) ?? []), drawing]);
  const moved: string[] = [];
  for (const [key, drawings] of byProject) {
    const ids = drawings.map((drawing) => drawing.id);
    const existing = state.pages[key] ? input.pages.page(state.pages[key]!) : null;
    if (existing && !existing.archived) {
      input.pages.embed(existing.id, ids, { by: "studio" });
    } else {
      state.pages[key] = input.pages.createPage({
        projectId: drawings[0]!.projectId,
        title: "Whiteboards",
        markdown: ["Whiteboards made before they moved into pages. Sketch on each one here, or open it full size.", ...ids.map((id) => whiteboardMarkdown(id))].join("\n\n"),
      });
    }
    moved.push(...ids);
  }
  state.migrated.push(...moved);
  return { state, moved };
}

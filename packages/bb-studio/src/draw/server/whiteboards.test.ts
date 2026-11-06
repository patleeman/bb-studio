import { expect, it } from "vitest";
import { drawHost } from "../test/host";
import { embeddedDrawingIds, migrateOrphanDrawings, whiteboardMarkdown, type WhiteboardPage, type WhiteboardPages } from "./whiteboards";

/** Pages in memory: each page's Markdown, as Pages saves it. */
function fakePages(initial: Record<string, { title: string; projectId?: string | null; archived?: boolean; markdown?: string }> = {}) {
  const pages = new Map(Object.entries(initial).map(([id, page]) => [id, { id, title: page.title, projectId: page.projectId ?? null, archived: page.archived ?? false, markdown: page.markdown ?? "" }]));
  let next = 0;
  const view = (page: { id: string; title: string; projectId: string | null; archived: boolean }): WhiteboardPage => ({ id: page.id, title: page.title, projectId: page.projectId, archived: page.archived });
  const api: WhiteboardPages = {
    embeddings() {
      const found = new Map<string, WhiteboardPage[]>();
      for (const page of pages.values()) for (const id of embeddedDrawingIds(page.markdown)) found.set(id, [...(found.get(id) ?? []), view(page)]);
      return found;
    },
    page: (id) => { const page = pages.get(id); return page ? view(page) : null; },
    embed(pageId, drawingIds, { afterBlockId } = {}) {
      const page = pages.get(pageId);
      if (!page) throw new Error("Page not found.");
      if (afterBlockId === "missing") throw new Error("No block missing.");
      page.markdown = [page.markdown, ...drawingIds.map((id) => whiteboardMarkdown(id))].filter(Boolean).join("\n\n");
    },
    createPage(input) {
      const id = `pg_new${++next}`;
      pages.set(id, { id, title: input.title, projectId: input.projectId, archived: false, markdown: input.markdown });
      return id;
    },
  };
  return { api, pages };
}

const drawing = (id: string, extra: Partial<{ projectId: string | null; archived: boolean; template: boolean; createdAt: number }> = {}) =>
  ({ id, name: id, projectId: null, archived: false, template: false, createdAt: 0, ...extra });

it("reads the drawings a page embeds, and nothing else", () => {
  const markdown = [
    "Intro",
    whiteboardMarkdown("drw_a"),
    "```embed\n{\"kind\":\"artifact\",\"target\":\"art_1\"}\n```",
    "```embed\nnot json\n```",
    whiteboardMarkdown("drw_b"),
    whiteboardMarkdown("drw_a"),
  ].join("\n\n");
  expect(embeddedDrawingIds(markdown)).toEqual(["drw_a", "drw_b"]);
});

it("does nothing when every drawing is in a page", () => {
  const { api, pages } = fakePages({ pg_1: { title: "Plan", markdown: whiteboardMarkdown("drw_a") } });
  expect(migrateOrphanDrawings({ drawings: [drawing("drw_a")], pages: api, state: null })).toBeNull();
  expect(migrateOrphanDrawings({ drawings: [], pages: api, state: null })).toBeNull();
  expect(pages.size).toBe(1);
});

it("embeds each orphan in its project's Drawings page once, oldest first, leaving templates and archived ones", () => {
  const { api, pages } = fakePages({ pg_1: { title: "Plan", markdown: whiteboardMarkdown("drw_in") } });
  const drawings = [
    drawing("drw_in"),
    drawing("drw_new", { createdAt: 2 }),
    drawing("drw_old", { createdAt: 1 }),
    drawing("drw_orbit", { projectId: "proj_orbit" }),
    drawing("drw_template", { template: true }),
    drawing("drw_archived", { archived: true }),
  ];
  const first = migrateOrphanDrawings({ drawings, pages: api, state: null })!;
  expect([...first.moved].sort()).toEqual(["drw_new", "drw_old", "drw_orbit"]);
  const global = pages.get(first.state.pages[""]!)!;
  expect(global.title).toBe("Whiteboards");
  expect(embeddedDrawingIds(global.markdown)).toEqual(["drw_old", "drw_new"]);
  expect(pages.get(first.state.pages.proj_orbit!)!.projectId).toBe("proj_orbit");

  // Running again changes nothing, even after the user deletes the page.
  pages.delete(first.state.pages[""]!);
  expect(migrateOrphanDrawings({ drawings, pages: api, state: first.state })).toBeNull();

  // A later orphan joins the project's existing page.
  const later = migrateOrphanDrawings({ drawings: [...drawings, drawing("drw_late", { projectId: "proj_orbit" })], pages: api, state: first.state })!;
  expect(later.moved).toEqual(["drw_late"]);
  expect(embeddedDrawingIds(pages.get(first.state.pages.proj_orbit!)!.markdown)).toEqual(["drw_orbit", "drw_late"]);
});

it("creates a whiteboard in a page and lists whiteboards with their pages", async () => {
  const host = drawHost();
  const { api, pages } = fakePages({ pg_plan: { title: "Launch plan", projectId: "proj_orbit" } });
  host.drawings.connectPages(api);
  try {
    const result = String(await host.harness.behavior.callAgentTool("whiteboard_create", { pageId: "pg_plan", name: "Flow" }, { threadId: "thr_1" }));
    const id = /\(id (drw_[0-9a-f]+)\)/.exec(result)![1]!;
    expect(result).toContain('::page{id="pg_plan"}');
    expect(embeddedDrawingIds(pages.get("pg_plan")!.markdown)).toEqual([id]);
    expect(host.drawings.store.get(id)!.project_id).toBe("proj_orbit");
    expect(String(await host.harness.behavior.callAgentTool("whiteboard_list", {}))).toContain(`Flow (id ${id}) — 0 element(s)`);
    expect(String(await host.harness.behavior.callAgentTool("whiteboard_list", {}))).toContain("in [Launch plan](/plugins/studio/studio/pages/pg_plan)");
    expect(await host.harness.behavior.callRpc("drawings.whiteboardPage", { id })).toEqual({ page: { id: "pg_plan", title: "Launch plan", href: "/plugins/studio/studio/pages/pg_plan" } });

    // An agent's edit links the page, not a standalone drawing card.
    const update = String(await host.harness.behavior.callAgentTool("whiteboard_update", { whiteboardId: id, elements: [{ id: "box", type: "rectangle" }] }, { threadId: "thr_1" }));
    expect(update).toContain('::page{id="pg_plan"}');
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("makes no drawing when the page is missing or the embed fails", async () => {
  const host = drawHost();
  const { api } = fakePages({ pg_plan: { title: "Plan" } });
  host.drawings.connectPages(api);
  try {
    const missing = await host.harness.behavior.callAgentTool("excalidraw_create_drawing", { pageId: "pg_gone", name: "Flow" }, { threadId: "thr_1" }) as { isError?: boolean };
    expect(missing.isError).toBe(true);
    const failed = await host.harness.behavior.callAgentTool("excalidraw_create_drawing", { pageId: "pg_plan", name: "Flow", afterBlockId: "missing" }, { threadId: "thr_1" }) as { isError?: boolean };
    expect(failed.isError).toBe(true);
    expect(host.drawings.store.list({ includeArchived: true })).toEqual([]);
    expect(await host.drawings.cli(["create", "Flow"], {})).toMatchObject({ exitCode: 1 });
    const cli = await host.drawings.cli(["create", "--page", "pg_plan", "Flow"], {});
    expect(cli.exitCode).toBe(0);
    expect(cli.stdout).toMatch(/^drw_[0-9a-f]+\tFlow\tpg_plan\n$/);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("whiteboard_create without a page makes a whiteboard page, tall, titled with the name", async () => {
  const host = drawHost();
  const { api, pages } = fakePages();
  host.drawings.connectPages(api);
  try {
    const result = String(await host.harness.behavior.callAgentTool("whiteboard_create", { name: "Sprint map" }, { threadId: "thr_1", projectId: "proj_orbit" }));
    const id = /\(id (drw_[0-9a-f]+)\)/.exec(result)![1]!;
    const page = [...pages.values()].find((each) => each.title === "Sprint map")!;
    expect(page.projectId).toBe("proj_orbit");
    expect(page.markdown).toBe(whiteboardMarkdown(id, { height: 640 }));
    expect(result).toContain(`::page{id="${page.id}"}`);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("keeps the old excalidraw_* tool names working, with their drawingId", async () => {
  const host = drawHost();
  const { api, pages } = fakePages({ pg_plan: { title: "Plan" } });
  host.drawings.connectPages(api);
  try {
    const made = String(await host.harness.behavior.callAgentTool("excalidraw_create_drawing", { pageId: "pg_plan", name: "Old" }, { threadId: "thr_1" }));
    const id = /\(id (drw_[0-9a-f]+)\)/.exec(made)![1]!;
    expect(embeddedDrawingIds(pages.get("pg_plan")!.markdown)).toEqual([id]);
    await host.harness.behavior.callAgentTool("excalidraw_update_drawing", { drawingId: id, elements: [{ id: "box", type: "rectangle" }] }, { threadId: "thr_1" });
    const read = JSON.parse(String(await host.harness.behavior.callAgentTool("excalidraw_get_drawing", { drawingId: id })));
    expect(read.scene.elements.map((el: { id: string }) => el.id)).toEqual(["box"]);
    expect(String(await host.harness.behavior.callAgentTool("excalidraw_list_drawings", {}))).toContain(`Old (id ${id})`);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

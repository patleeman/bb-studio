import { studioSchemas } from "@bb-studio/kit/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { element, memoryStore, scene } from "../test/db";
import { registerStudio, toStudioItem } from "./studio";

function setup() {
  const { store } = memoryStore();
  let handlers: Record<string, (input: unknown) => unknown> = {};
  const bb = { rpc: { register: (_contract: unknown, registered: typeof handlers) => (handlers = registered) } };
  const changed: string[] = [];
  registerStudio(bb as never, studioSchemas(z), { store, changed: (id) => void changed.push(id) });
  const call = async (method: string, input: unknown): Promise<any> => handlers[method]!(input);
  return { store, call, changed };
}

describe("the Draw Studio provider", () => {
  it("describes drawings, which Studio can create", async () => {
    const { call } = setup();
    const info = await call("studio_describe", null);
    expect(info).toMatchObject({ pluginId: "excalidraw", panel: "drawings", kinds: [{ id: "drawing", create: { mode: "rpc" } }] });
    expect(studioSchemas(z).info.parse(info)).toBeTruthy();
  });

  it("lists drawings with a thumbnail, the text as preview and an element count", async () => {
    const { store, call } = setup();
    const row = store.create({ name: "Plan", projectId: "proj_a", by: "app" });
    store.write(
      row.id,
      scene([
        element("text", { text: "Second", y: 200 }),
        element("text", { text: "First", y: 10 }),
        element("rectangle"),
        element("rectangle", { isDeleted: true }),
      ]),
      "agent",
    );
    const { items } = await call("studio_list", null);
    const updatedAt = store.get(row.id)!.updated_at;
    expect(items).toEqual([
      expect.objectContaining({
        id: row.id,
        kind: "drawing",
        title: "Plan",
        projectId: "proj_a",
        updatedBy: "agent",
        preview: "First · Second",
        facts: [{ id: "elements", value: "3", sort: 3 }],
        thumbnailUrl: `/api/v1/plugins/excalidraw/http/thumbnail?drawing=${row.id}&v=${updatedAt}`,
        href: `/plugins/excalidraw/drawings/${row.id}`,
        archived: false,
      }),
    ]);
    expect(studioSchemas(z).provider.studio_list.output.parse({ items })).toBeTruthy();
  });

  it("shows no thumbnail for an empty drawing", () => {
    const { store } = setup();
    const row = store.create({ name: "", projectId: null, by: "app" });
    expect(toStudioItem(row)).toMatchObject({ title: "", thumbnailUrl: null, preview: null });
  });

  it("creates, moves, archives and deletes", async () => {
    const { store, call, changed } = setup();
    const { item } = await call("studio_create", { kind: "drawing", projectId: "proj_a" });
    expect(item).toMatchObject({ kind: "drawing", projectId: "proj_a" });
    expect(await call("studio_move", { ids: [item.id, "missing"], projectId: "proj_b" })).toEqual({
      done: [item.id],
      failed: [{ id: "missing", error: "Drawing not found." }],
    });
    await call("studio_archive", { ids: [item.id], archived: true });
    expect(store.get(item.id)).toMatchObject({ project_id: "proj_b" });
    expect(store.list()).toEqual([]);
    await call("studio_delete", { ids: [item.id] });
    expect(store.get(item.id)).toBeNull();
    expect(changed).toEqual([item.id, item.id, item.id, item.id]);
  });

  it("finds drawings by the words written on them", async () => {
    const { store, call } = setup();
    const row = store.create({ name: "", projectId: null, by: "app" });
    store.write(row.id, scene([element("text", { text: "Checkout flow" })]), "editor");
    store.create({ name: "", projectId: null, by: "app" });
    expect(await call("studio_search", { query: "CHECKOUT" })).toEqual({ ids: [row.id], snippets: { [row.id]: "Checkout flow" } });
  });

  it("copies a drawing's text, and says so when there is none", async () => {
    const { store, call } = setup();
    const row = store.create({ name: "", projectId: null, by: "app" });
    expect(await call("studio_action", { action: "copy-text", ids: [row.id] })).toEqual({
      message: "There's no text on this drawing.",
      text: null,
    });
    store.write(row.id, scene([element("text", { text: "A", y: 0 }), element("text", { text: "B", y: 9 })]), "editor");
    expect(await call("studio_action", { action: "copy-text", ids: [row.id] })).toEqual({ message: "Text copied", text: "A\n\nB" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../server";

const item = {
  pluginId: "excalidraw", id: "drawing_1", kind: "drawing", title: "Companion flow", icon: null,
  projectId: "project_companion", parentId: null, createdAt: 1, updatedAt: 2, updatedBy: null,
  preview: null, facts: [], badge: null, thumbnailUrl: null,
  href: "/plugins/excalidraw/drawings/drawing_1", archived: false,
};
const ref = { pluginId: item.pluginId, id: item.id };
const request = { input: [{ type: "text", text: "Fix the arrow", mentions: [] }] };
let handlers: any;
const rpc = vi.fn();
const spawn = vi.fn();
const set = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ item, kind: null });
  spawn.mockResolvedValue({ id: "thread_new" });
  await plugin({
    storage: { kv: { list: async () => [], get: async () => null, set } },
    sdk: { plugins: { callRpc: rpc }, threads: { spawn } },
    ui: { registerMentionProvider: () => {} },
    rpc: { register: (_contract: unknown, registered: unknown) => { handlers = registered; } },
  } as any);
});

describe("Chat item resolution and submission", () => {
  it("leaves views with their own chat UI out of the automatic overlay while keeping their explicit context available", async () => {
    rpc.mockResolvedValue({ item, kind: { hasOwnChat: true } });
    expect(await handlers.viewing({ path: item.href })).toEqual({ item: null });
    expect((await handlers.subject(ref)).item).toMatchObject(ref);
    rpc.mockResolvedValue({ item, kind: null });
    expect((await handlers.viewing({ path: item.href })).item).toMatchObject(ref);
  });
  it("resolves the explicit companion ref through Studio", async () => {
    expect((await handlers.subject(ref)).item).toMatchObject({ ...ref, title: item.title, projectId: item.projectId });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "studio", method: "itemAt", input: ref }));
  });

  it("keeps missing and archived items out of composers", async () => {
    rpc.mockResolvedValueOnce({ item: null, kind: null });
    expect(await handlers.subject(ref)).toEqual({ item: null });
    rpc.mockResolvedValueOnce({ item: { ...item, archived: true }, kind: null });
    expect(await handlers.subject(ref)).toEqual({ item: null });
  });

  it("adds the explicit item pill when spawning the conversation", async () => {
    expect(await handlers.start({ item: ref, request })).toEqual({ threadId: "thread_new" });
    expect(spawn.mock.calls[0]![0].input[0]).toMatchObject({
      text: "@Companion flow Fix the arrow",
      mentions: [{ resource: { pluginId: "studio", itemId: "item:excalidraw:drawing_1" } }],
    });
    expect(set).toHaveBeenCalledWith("link:excalidraw:drawing_1", expect.objectContaining({ threadId: "thread_new" }));
  });

  it("rejects an item deleted or archived after the composer opened", async () => {
    for (const found of [null, { ...item, archived: true }]) {
      rpc.mockResolvedValue({ item: found, kind: null });
      await expect(handlers.start({ item: ref, request })).rejects.toThrow("That Studio item is archived or gone.");
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("preserves a plain composer request without resolving an item", async () => {
    await handlers.start({ item: null, request });
    expect(spawn).toHaveBeenCalledWith(request);
    expect(rpc).not.toHaveBeenCalled();
  });
});

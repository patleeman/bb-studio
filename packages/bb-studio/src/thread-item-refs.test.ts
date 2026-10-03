import { expect, it, vi } from "vitest";
import { firstThreadItemRefs, firstThreadMentionPlugins, mentionProviderLookup } from "./thread-item-refs";

it("links every selected item from the first composer input", () => {
  const events = [{ type: "client/turn/requested", data: { input: [{ type: "text", text: "[Task](/plugins/studio-tasks/tasks/task_a) [Page](/plugins/pages/pages/pg_b) [Task](/plugins/studio-tasks/tasks/task_a)" }] } }];
  expect(firstThreadItemRefs(events)).toEqual([{ pluginId: "studio-tasks", id: "task_a" }, { pluginId: "pages", id: "pg_b" }]);
});

it("reads item mentions and does not treat a later turn as the thread's origin", () => {
  expect(firstThreadItemRefs([{ type: "client/thread/start", data: { request: { params: { input: [{ type: "text", text: "[Drawing](/plugins/excalidraw/drawings/draw_1)" }] } } } }])).toEqual([{ pluginId: "excalidraw", id: "draw_1" }]);
  expect(firstThreadItemRefs([{ type: "client/thread/start", data: { request: { params: {} } } }, { type: "client/turn/requested", data: { input: [{ type: "text", text: "[Page](/plugins/pages/pages/pg_b)" }] } }])).toEqual([{ pluginId: "pages", id: "pg_b" }]);
  expect(firstThreadItemRefs([{ type: "client/turn/start", data: { input: [{ type: "text", text: "@Task", mentions: [{ resource: { kind: "plugin", pluginId: "studio-tasks", itemId: "task_a" } }] }] } }])).toEqual([{ pluginId: "studio-tasks", id: "task_a" }]);
  expect(firstThreadItemRefs([{ type: "client/turn/requested", data: { input: [{ type: "text", text: "Hello" }] } }, { type: "client/turn/requested", data: { input: [{ type: "text", text: "[Page](/plugins/pages/pages/pg_b)" }] } }])).toEqual([]);
  expect(firstThreadItemRefs([])).toBeNull();
});

it("resolves serialized mention provider IDs, including Studio Chat's cross-plugin pills", () => {
  const mentions = [
    { pluginId: "studio-chat", itemId: "item:excalidraw:drawing_1" },
    { pluginId: "pages", itemId: "page:pg_1" },
    { pluginId: "studio-tasks", itemId: "task:task_1" },
    { pluginId: "talk", itemId: "recordings:rec_1" },
    { pluginId: "bot-teams", itemId: "views:view_1" },
    { pluginId: "extension", itemId: "unknown:colon:id" },
  ].map((resource) => ({ resource: { kind: "plugin", ...resource } }));
  expect(firstThreadItemRefs([{ type: "client/turn/requested", data: { input: [{ type: "text", text: "Review these", mentions }] } }])).toEqual([
    { pluginId: "excalidraw", id: "drawing_1" },
    { pluginId: "pages", id: "pg_1" },
    { pluginId: "studio-tasks", id: "task_1" },
    { pluginId: "talk", id: "rec_1" },
    { pluginId: "bot-teams", id: "view_1" },
    { pluginId: "extension", id: "unknown:colon:id" },
  ]);
});

it("uses declared namespaces, preserves raw IDs, and decodes local paths only once", () => {
  const events = [{ type: "client/turn/requested", data: { input: [{ type: "text", text: "[Raw](item:custom:raw:50%2F) [Path](/plugins/pages/pages/pg_%252F) https://evil.example/plugins/pages/pages/pg_evil", mentions: [
    { resource: { kind: "plugin", pluginId: "custom", itemId: "objects:raw:50%2F" } },
    { resource: { kind: "plugin", pluginId: "pages", itemId: "page:literal%bad" } },
  ] }] } }];
  expect(firstThreadItemRefs(events, { providers: [{ pluginId: "custom", kinds: [{ mentionProviderId: "objects" }] }] })).toEqual([
    { pluginId: "custom", id: "raw:50%2F" }, { pluginId: "pages", id: "pg_%2F" }, { pluginId: "pages", id: "literal%bad" },
  ]);
});

it("loads only first-input serialized mention namespaces, coalesces and bounds lookup", async () => {
  vi.useFakeTimers();
  try {
    const events = [{ type: "client/turn/requested", data: { input: [{ type: "text", mentions: [
      { resource: { kind: "plugin", pluginId: "custom", itemId: "objects:id" } },
      { resource: { kind: "plugin", pluginId: "custom", itemId: "objects:other" } },
      { resource: { kind: "plugin", pluginId: "studio-chat", itemId: "item:pages:pg_1" } },
      { resource: { kind: "plugin", pluginId: "pages", itemId: "page:pg_1" } },
    ] }] } }, { type: "client/turn/requested", data: { input: [{ type: "text", mentions: [{ resource: { kind: "plugin", pluginId: "later", itemId: "objects:id" } }] }] } }];
    expect(firstThreadMentionPlugins(events)).toEqual(["custom"]);
    const load = vi.fn(async (_id: string, _signal: AbortSignal): Promise<{ pluginId: string; kinds: { mentionProviderId: string }[] }> => new Promise(() => {}));
    const lookup = mentionProviderLookup(load);
    const first = lookup(["custom"]);
    const second = lookup(["custom", "custom"]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await first).toEqual([]);
    expect(await second).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0]![1].aborted).toBe(true);
    load.mockImplementation(async (pluginId) => ({ pluginId, kinds: [{ mentionProviderId: "objects" }] }));
    await vi.advanceTimersByTimeAsync(1_500);
    const providers = await lookup(["custom"]);
    expect(providers).toEqual([{ pluginId: "custom", kinds: [{ mentionProviderId: "objects" }] }]);
    expect(firstThreadItemRefs(events, { providers })).toEqual([{ pluginId: "custom", id: "id" }, { pluginId: "custom", id: "other" }, { pluginId: "pages", id: "pg_1" }]);
    await lookup(["custom"]);
    expect(load).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

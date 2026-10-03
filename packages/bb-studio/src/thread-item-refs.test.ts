import { expect, it } from "vitest";
import { firstThreadItemRefs } from "./thread-item-refs";

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

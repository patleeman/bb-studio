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

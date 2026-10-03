import { registerStudio as registerDraw } from "../../bb-studio-draw/src/server/studio";
import { memoryStore as drawingStore } from "../../bb-studio-draw/src/test/db";
import { registerStudio as registerTasks } from "../../bb-studio-tasks/src/server/studio";
import { memoryStore as taskStore } from "../../bb-studio-tasks/src/test/db";
import { schemas } from "./contract";
import { providerConformance, type ProviderHarness } from "./test/provider-conformance";

function registration() {
  const handlers: ProviderHarness["handlers"] = {};
  return { handlers, bb: { rpc: { register: (_contract: unknown, registered: typeof handlers) => Object.assign(handlers, registered) } } };
}
providerConformance("Draw", () => {
  const { db, store } = drawingStore();
  const { handlers, bb } = registration();
  registerDraw(bb as never, schemas, { store, changed: () => {} });
  return { pluginId: "excalidraw", kind: "drawing", handlers, close: () => db.close() };
});
providerConformance("Tasks", () => {
  const { db, store } = taskStore();
  const { handlers, bb } = registration();
  registerTasks(bb as never, schemas, { store, changed: () => {}, move: async (id, status) => { store.move(id, status, "user"); } });
  return { pluginId: "studio-tasks", kind: "task", handlers, close: () => db.close() };
});
providerConformance("Task boards", () => {
  const { db, store } = taskStore();
  const { handlers, bb } = registration();
  registerTasks(bb as never, schemas, { store, changed: () => {}, move: async (id, status) => { store.move(id, status, "user"); } });
  return { pluginId: "studio-tasks", kind: "board", handlers, close: () => db.close() };
});

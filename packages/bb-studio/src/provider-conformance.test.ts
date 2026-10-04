import { registerStudio as registerDraw } from "../../bb-studio-draw/src/server/studio";
import { memoryStore as drawingStore } from "../../bb-studio-draw/src/test/db";
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
  return { pluginId: "excalidraw", kind: "drawing", handlers, editTitle: (id, title) => { store.rename(id, title, "app"); }, close: () => db.close() };
});

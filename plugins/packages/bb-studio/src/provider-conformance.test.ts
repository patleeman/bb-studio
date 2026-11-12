import { drawingProvider } from "./draw/server/provider";
import { memoryStore as drawingStore } from "./draw/test/db";
import { providerConformance, type ProviderHarness } from "./test/provider-conformance";

providerConformance("Draw", () => {
  const { db, store } = drawingStore();
  const handlers = drawingProvider({ store, changed: () => {} }) as unknown as ProviderHarness["handlers"];
  return { pluginId: "excalidraw", kind: "drawing", handlers, editTitle: (id, title) => { store.rename(id, title, "app"); }, close: () => db.close() };
});

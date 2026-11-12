import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { pageProvider } from "./pages/studio";
import { PageStore, MIGRATIONS as PAGE_MIGRATIONS } from "./pages/store";
import { PagesService } from "./pages/service";
import { readMarkdown } from "./pages/doc";
import { recordingProvider } from "./talk/server/studio";
import { memoryStore as talkStore, addSegment } from "./talk/test/db";
import { artifactProvider } from "./artifacts/server/provider";
import { memoryStore as artifactStore, bytes } from "./artifacts/test/db";
import { providerConformance, type ProviderHarness } from "./test/provider-conformance";

function registration() {
  const handlers: ProviderHarness["handlers"] = {};
  const events: unknown[] = [];
  return {
    handlers, events,
    bb: {
      rpc: { register: (_contract: unknown, registered: typeof handlers) => { Object.assign(handlers, registered); } },
      realtime: { publish: (_channel: string, event: unknown) => { events.push(event); } },
      log: { error: () => {}, warn: () => {}, debug: () => {} },
    },
  };
}

providerConformance("Pages", () => {
  const db = new Database(":memory:");
  for (const sql of PAGE_MIGRATIONS) db.exec(sql);
  const store = new PageStore(db);
  const { handlers, bb, events } = registration();
  const service = new PagesService(bb as never, store);
  Object.assign(handlers, pageProvider(service));
  return {
    pluginId: "pages", kind: "page", handlers,
    prepareContent: (id) => { service.editClientDocument(id, readMarkdown(service.hub.open(id).doc, { ids: true }), "Conformance page body"); },
    expectedContent: "Conformance page body",
    notificationCount: () => events.length,
    editTitle: (id, title) => { store.update(id, { title }, "user"); },
    close: () => { service.dispose(); db.close(); },
  };
});

for (const kind of ["recording", "dictation"] as const) providerConformance(`Talk ${kind}`, () => {
  const { db, store } = talkStore();
  const changed: string[] = [];
  const removedAudio: string[] = [];
  const handlers = recordingProvider({
    store, changed: (id) => { changed.push(id); }, removeAudio: async (id) => { removedAudio.push(id); }, readAudio: async () => Buffer.alloc(0),
  }) as unknown as ProviderHarness["handlers"];
  return {
    pluginId: "talk", kind, handlers, expectedContent: "Conformance transcript content",
    seed: (projectId) => {
      const id = `rec_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      store.create({ id, kind, projectId, threadId: null });
      addSegment(store, id, "session", 0, 1);
      store.markTranscribed(id, "session-0", "Conformance transcript content");
      store.setStatus(id, "finishing");
      return id;
    },
    notificationCount: () => changed.length,
    editTitle: (id, title) => { store.rename(id, title, "user"); },
    close: () => { db.close(); },
  };
});

providerConformance("Artifacts", () => {
  const { db, store } = artifactStore();
  const changed: string[] = [];
  const handlers = artifactProvider({ store, changed: (id) => { changed.push(id); } }) as unknown as ProviderHarness["handlers"];
  return {
    pluginId: "artifacts", kind: "artifact", handlers, expectedContent: "Conformance artifact body",
    seed: (projectId) => store.save({ name: "conformance.md", mime: "text/markdown", bytes: bytes("Conformance artifact body"), projectId, by: "agent" }).artifact.id,
    notificationCount: () => changed.length,
    editTitle: (id, title) => { store.update(id, { title }, "app"); },
    close: () => { db.close(); },
  };
});

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { registerStudio as registerPages } from "../../bb-studio-pages/src/studio";
import { PageStore, MIGRATIONS as PAGE_MIGRATIONS } from "../../bb-studio-pages/src/store";
import { PagesService } from "../../bb-studio-pages/src/service";
import { readMarkdown } from "../../bb-studio-pages/src/doc";
import { registerStudio as registerTalk } from "../../bb-studio-talk/src/server/studio";
import { memoryStore as talkStore, addSegment } from "../../bb-studio-talk/src/test/db";
import { registerStudio as registerArtifacts } from "../../bb-studio-artifacts/src/server/studio";
import { memoryStore as artifactStore, bytes } from "../../bb-studio-artifacts/src/test/db";
import { schemas } from "./contract";
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
  registerPages(bb as never, service, schemas);
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
  const { handlers, bb } = registration();
  const changed: string[] = [];
  const removedAudio: string[] = [];
  registerTalk(bb as never, schemas, {
    store, changed: (id) => { changed.push(id); }, removeAudio: async (id) => { removedAudio.push(id); }, readAudio: async () => Buffer.alloc(0),
  });
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
  const { handlers, bb } = registration();
  const changed: string[] = [];
  registerArtifacts(bb as never, schemas, { store, changed: (id) => { changed.push(id); } });
  return {
    pluginId: "artifacts", kind: "artifact", handlers, expectedContent: "Conformance artifact body",
    seed: (projectId) => store.save({ name: "conformance.md", mime: "text/markdown", bytes: bytes("Conformance artifact body"), projectId, by: "agent" }).artifact.id,
    notificationCount: () => changed.length,
    editTitle: (id, title) => { store.update(id, { title }, "app"); },
    close: () => { db.close(); },
  };
});

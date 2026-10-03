import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { registerStudio as registerPages } from "../../bb-studio-pages/src/studio";
import { PageStore, MIGRATIONS as PAGE_MIGRATIONS } from "../../bb-studio-pages/src/store";
import { PagesService } from "../../bb-studio-pages/src/service";
import { readMarkdown } from "../../bb-studio-pages/src/doc";
import { registerStudio as registerTalk } from "../../bb-studio/src/modules/talk/src/server/studio";
import { memoryStore as talkStore, addSegment } from "../../bb-studio/src/modules/talk/src/test/db";
import { registerStudio as registerArtifacts } from "../../bb-studio/src/modules/artifacts/src/server/studio";
import { memoryStore as artifactStore, bytes } from "../../bb-studio/src/modules/artifacts/src/test/db";
import { registerStudio as registerBots } from "./modules/teams/studio-provider";
import { createTestStore } from "./modules/teams/test/test-store";
import { botSchema } from "./modules/teams/contract";
import { Runtime } from "./modules/teams/mission-runtime";
import { ThreadViews } from "./modules/teams/thread-views";
import tablesPlugin from "./modules/tables/server";
import { schemas } from "./contract";
import { StudioHub, type HubSdk } from "./hub";
import { SearchIndex } from "./search-index";
import { MIGRATIONS } from "./migrations";
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
  const service = new PagesService(bb as never, store, {} as never);
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
    store, changed: (id) => { changed.push(id); }, removeAudio: async (id) => { removedAudio.push(id); },
  });
  return {
    pluginId: "studio", kind, handlers, expectedContent: "Conformance transcript content",
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
    pluginId: "studio", kind: "artifact", handlers, expectedContent: "Conformance artifact body",
    seed: (projectId) => store.save({ name: "conformance.md", mime: "text/markdown", bytes: bytes("Conformance artifact body"), projectId, by: "agent" }).artifact.id,
    notificationCount: () => changed.length,
    editTitle: (id, title) => { store.update(id, { title }, "app"); },
    close: () => { db.close(); },
  };
});

function botsFixture(kind: "bot" | "view"): ProviderHarness {
  const db = new Database(":memory:");
  const store = createTestStore(db);
  const { handlers, bb, events } = registration();
  const runtime = new Runtime(bb as never, store);
  const views = new ThreadViews(bb as never, store, {} as never);
  registerBots(bb as never, schemas, {
    bots: () => store.all(), activity: () => store.botActivitySummary(), views: () => views.all(),
    createView: () => views.create("Conformance channel", []),
    archiveView: async (id, archived) => { const view = views.get(id); return views.handlers().viewUpdate({ ...view, archived, expectedUpdatedAt: view.updatedAt }); },
    deleteView: (id) => Promise.resolve(views.handlers().viewDelete({ id })),
    readView: async (id) => { const page = await views.page(id); return [`# ${page.view.name}`, ...page.entries.map((entry) => entry.text)].join("\n\n"); },
    retire: (id, retired) => runtime.retire(id, retired),
  });
  return {
    pluginId: "studio", kind, handlers, expectedContent: kind === "bot" ? "Conformance bot content" : "Conformance channel", projectId: null, canDelete: kind !== "bot",
    ...(kind === "bot" ? { seed: () => {
      const id = `bot_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      store.put(botSchema.parse({ id, name: "Conformance bot", description: "Conformance bot content", handle: id, home: "/unused/conformance", projectId: "proj_private", hostId: "local", createdAt: 1, updatedAt: 1, lastWakeAt: 0, error: null }));
      return id;
    } } : {}),
    notificationCount: () => events.length,
    editTitle: async (id, title) => {
      if (kind === "bot") store.put({ ...store.get(id), name: title, updatedAt: 2 });
      else { const view = views.get(id); await views.handlers().viewUpdate({ ...view, name: title, expectedUpdatedAt: view.updatedAt }); }
    },
    close: () => { db.close(); },
  };
}
providerConformance("Bots", () => botsFixture("bot"));
providerConformance("Channels", () => botsFixture("view"));

function tablesFixture() {
  const db = new Database(":memory:");
  const { handlers, bb, events } = registration();
  const optionalStudio = vi.fn(async () => { throw Object.assign(new Error("Studio is not installed"), { status: 404 }); });
  const cleanup = tablesPlugin({
    ...bb,
    storage: { database: () => db, migrate: (_db: Database.Database, sql: readonly string[]) => { for (const statement of sql) db.exec(statement); } },
    sdk: { plugins: { callRpc: optionalStudio, list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] } },
    ui: { registerMentionProvider: () => {} }, agents: { registerTool: () => {}, configure: () => {} }, cli: { register: () => {} },
  } as never);
  return {
    pluginId: "studio", kind: "table", handlers, optionalStudio, expectedContent: "Name",
    notificationCount: () => events.length,
    editTitle: async (id: string, title: string) => { await handlers.update!({ id, title } as never); },
    close: () => { cleanup(); db.close(); },
  };
}
providerConformance("Tables", tablesFixture);

it("Tables native writes and reads survive the optional Studio notifier rejecting", async () => {
  vi.useFakeTimers();
  const fixture = tablesFixture();
  try {
    const created = await fixture.handlers.create!({ title: "Local table", projectId: null, columns: [{ id: "name", name: "Name", type: "text", options: [] }], rows: [{ name: "Offline content" }] } as never) as { table: { id: string } };
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.optionalStudio).toHaveBeenCalledOnce();
    expect(await fixture.handlers.studio_read!({ id: created.table.id } as never)).toMatchObject({ content: expect.stringContaining("Offline content") });
    expect(await fixture.handlers.studio_list!(null as never)).toMatchObject({ items: [{ id: created.table.id }] });
  } finally { fixture.close(); vi.useRealTimers(); }
});

it("Tables supplies searchable text beyond the 200-row preview", async () => {
  const fixture = tablesFixture();
  try {
    const created = await fixture.handlers.create!({ title: "Large table", projectId: null, columns: [{ id: "name", name: "Name", type: "text", options: [] }], rows: Array.from({ length: 201 }, (_, index) => ({ name: index === 200 ? "afterpreviewuniqueword" : `Entry ${index}` })) } as never) as { table: { id: string } };
    const output = schemas.provider.studio_read.output.parse(await fixture.handlers.studio_read!({ id: created.table.id, format: "text" } as never));
    expect(output.content).toContain("afterpreviewuniqueword");
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS) db.exec(sql);
    const sdk: HubSdk = { plugins: {
      list: async () => ({ plugins: [{ id: "studio", name: "Tables", enabled: true, status: "running", statusDetail: null, version: "1" }] }),
      experimental_discoverRpc: async () => [{ pluginId: "studio" }],
      callRpc: async ({ method, input, outputSchema }) => outputSchema.parse(await fixture.handlers[method]!(input as never)),
    } };
    const index = new SearchIndex(db, new StudioHub(sdk));
    try {
      await index.ensure();
      expect(index.search("afterpreviewuniqueword").map((hit) => hit.ref)).toEqual([{ pluginId: "studio", id: created.table.id }]);
      expect(index.status().state).toBe("current");
    } finally { await index.dispose(); db.close(); }
  } finally { fixture.close(); }
});

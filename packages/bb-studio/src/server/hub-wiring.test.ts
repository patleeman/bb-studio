import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { ChangeLog } from "../changes";
import { StudioHub } from "../hub";
import { MIGRATIONS } from "../migrations";
import { StudioServices } from "../services";
import { TriggerEngine } from "../triggers/engine";
import { setupHubWiring } from "./hub-wiring";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

it("does not fan out composer thread linking or touch DB after plugin dispose", async () => {
  let resolveList!: (threads: ReturnType<typeof makeThreadResponse>[]) => void;
  const listPromise = new Promise<ReturnType<typeof makeThreadResponse>[]>((resolve) => { resolveList = resolve; });
  const eventsList = vi.fn(async () => []);
  const { bb, harness } = createFakePluginHost({
    pluginId: "studio",
    sdk: {
      threads: {
        list: vi.fn(() => listPromise) as never,
        events: { list: eventsList as never } as never,
      },
      plugins: { experimental_discoverRpc: async () => [] },
    },
  });
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const hub = new StudioHub(bb.sdk, []);
  const changes = new ChangeLog();
  const services = new StudioServices(db);
  const threadsForThreadSpy = vi.spyOn(services, "threadsForThread");
  const triggers = new TriggerEngine(db);

  await setupHubWiring({
    bb,
    db,
    hub,
    changes,
    services,
    triggers,
    onStudioChangedReady: () => {},
  });

  // Dispose before startup threads.list resolves.
  await harness.lifecycle.dispose();
  threadsForThreadSpy.mockClear();
  resolveList([makeThreadResponse({ id: "thr_1", projectId: "proj_1" })]);
  await tick();

  expect(threadsForThreadSpy).not.toHaveBeenCalled();
  expect(eventsList).not.toHaveBeenCalled();
});

it("does not link or publish realtime events if disposed while composer events.list is in flight", async () => {
  let resolveEvents!: (events: unknown[]) => void;
  const eventsPromise = new Promise<unknown[]>((resolve) => { resolveEvents = resolve; });
  const publish = vi.fn();
  const { bb, harness } = createFakePluginHost({
    pluginId: "studio",
    sdk: {
      threads: {
        list: vi.fn(async () => []) as never,
        events: { list: vi.fn(() => eventsPromise) as never } as never,
      },
      plugins: { experimental_discoverRpc: async () => [] },
    },
  });
  bb.realtime.publish = publish as never;
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const hub = new StudioHub(bb.sdk, []);
  const changes = new ChangeLog();
  const services = new StudioServices(db);
  const linkSpy = vi.spyOn(services, "linkThread");
  const triggers = new TriggerEngine(db);

  await setupHubWiring({
    bb,
    db,
    hub,
    changes,
    services,
    triggers,
    onStudioChangedReady: () => {},
  });

  await harness.behavior.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_2", projectId: "proj_1" }) });
  await harness.lifecycle.dispose();

  resolveEvents([
    {
      type: "client/turn/requested",
      data: { input: [{ type: "text", text: "See /plugins/studio/studio/pages/pg_123" }] },
    },
  ]);
  await tick();

  expect(linkSpy).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

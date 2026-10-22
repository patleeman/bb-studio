import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { registerCode } from "./server";
import { MIGRATIONS } from "./server/store";

const watch = vi.hoisted(() => vi.fn());
vi.mock("./server/watch", () => ({ ThreadWatcher: class {
  watch = watch;
  watching() { return false; }
  dispose() {}
} }));
vi.mock("./server/runtime", () => ({ CodeServers: class { dispose() {} } }));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); watch.mockClear(); });

it("does not poll an active thread when no editor can show its work", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: { threads: { get: async () => ({ environment: { path: "/repo" } }) } } });
  cleanup.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
  registerCode(bb, db);
  await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_a" }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(watch).not.toHaveBeenCalled();
  expect(harness.registrations.rpcMethods).not.toContain("code.threadChip");
});

import { describe, expect, it } from "vitest";
import {
  createProject,
  createThread,
  noopNotifier,
  patchThreadPluginMetadata,
  upsertHost,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { forkProviderOptionsContext } from "../../../src/services/providers/provider-options-context.fork.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/source" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const providerRegistry = {
    get: (providerId: string) =>
      providerId === "codex" ? { pluginId: "provider-codex" } : null,
  };
  return { db, thread, deps: { db, providerRegistry } };
}

describe("the provider options context (BB Studio)", () => {
  it("carries the thread's metadata under the provider plugin's own id", () => {
    const { db, thread, deps } = setup();
    patchThreadPluginMetadata(db, {
      threadId: thread.id,
      pluginId: "provider-codex",
      set: { experimental_computerUse: false },
      remove: [],
    });
    patchThreadPluginMetadata(db, {
      threadId: thread.id,
      pluginId: "studio",
      set: { experimental_computerUse: true },
      remove: [],
    });
    expect(forkProviderOptionsContext(deps, "codex", thread.id)).toEqual({
      experimental_pluginMetadata: { experimental_computerUse: false },
    });
  });

  it("is an empty namespace without metadata, and nothing for a provider no plugin owns", () => {
    const { thread, deps } = setup();
    expect(forkProviderOptionsContext(deps, "codex", thread.id)).toEqual({
      experimental_pluginMetadata: {},
    });
    expect(forkProviderOptionsContext(deps, "unknown", thread.id)).toEqual({});
  });
});

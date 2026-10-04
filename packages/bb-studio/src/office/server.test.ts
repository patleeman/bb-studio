import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { StudioHub } from "../hub";
import { initializeOffice } from "./server";

// The live adapter is exercised through schema-validating SDK RPC dispatch.
// No folder is created outside the fake host in these read/move tests.
it("registers root Space RPCs and derives folder membership from projects", async () => {
  const project = (id: string) => ({ id, name: id, kind: "personal" as const, sources: [], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    projects: { list: async () => [project("proj_personal"), project("p1")], get: async ({ projectId }) => project(projectId) },
    threads: { list: async () => [makeThreadResponse({ id: "t1", projectId: "p1" })] },
    plugins: { list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  await initializeOffice(bb, db, new StudioHub(bb.sdk));
  const result = await harness.behavior.callRpc("spaces_list", {}) as { spaces: { id: string; projectIds: string[] }[] };
  expect(result.spaces).toHaveLength(1);
  expect(result.spaces[0]!.projectIds).toEqual(["p1", "proj_personal"]);
  const id = result.spaces[0]!.id;
  await harness.behavior.callRpc("space_settings_set", { spaceId: id, settings: { defaultTrust: "read_only" } });
  expect(await harness.behavior.callRpc("space_settings_get", { spaceId: id })).toMatchObject({ settings: { defaultTrust: "read_only" } });
  const tree = await harness.behavior.callRpc("space_tree", { spaceId: id }) as { folders: unknown[] };
  expect(tree.folders).toHaveLength(2);
  await expect(harness.behavior.callRpc("space_delete", { spaceId: id })).rejects.toThrow("default Space");
  await harness.lifecycle.dispose();
});

it("creates and archives actual folder directories through the RPC boundary", async () => {
  const { mkdtemp, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "office-folders-"));
  const projects = [{ id: "proj_personal", name: "Personal", kind: "personal" as "personal" | "standard", sources: [] as { id: string; projectId: string; type: "local_path"; path: string; hostId: string; isDefault: boolean; createdAt: number; updatedAt: number }[], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 }];
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    projects: {
      list: async () => projects,
      create: async input => {
        const id = `p${projects.length}`;
        const project = { id, name: input.name, kind: "standard" as const, sources: [{ ...input.source, id: `s${id}`, projectId: id, isDefault: true, createdAt: 1, updatedAt: 1 }], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 };
        projects.push(project); return project;
      },
    },
    system: { config: async () => ({ primaryHostId: "fixture-host" }) as never },
    plugins: { list: async () => ({ plugins: [] }), experimental_discoverRpc: async () => [] },
  } });
  try {
    const db = bb.storage.database(); bb.storage.migrate(db, MIGRATIONS);
    await initializeOffice(bb, db, new StudioHub(bb.sdk), { folderRoot: root });
    const made = await harness.behavior.callRpc("space_create", { name: "Work" }) as { space: { id: string; defaultProjectId: string } };
    expect(made.space.defaultProjectId).toBe("p1");
    const folder = await harness.behavior.callRpc("folder_create", { spaceId: made.space.id, name: "Drafts" }) as { folder: { id: string; path: string } };
    expect((await stat(folder.folder.path)).isDirectory()).toBe(true);
    await harness.behavior.callRpc("folder_archive", { folderId: folder.folder.id });
    expect(projects).toHaveLength(3);
    expect((await stat(folder.folder.path)).isDirectory()).toBe(true);
  } finally { await harness.lifecycle.dispose(); await rm(root, { recursive: true, force: true }); }
});

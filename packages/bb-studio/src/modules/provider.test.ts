import { expect, it } from "vitest";
import { ModuleServices } from "./services";
import { ModuleProvider, moduleProviderContract as contract } from "./provider";
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";

function fixture() {
  const services = new ModuleServices();
  const provider = new ModuleProvider(services);
  const deleted: string[] = [];
  const register = (name: string, id: string) => {
    const item = { id, kind: name, title: name, icon: null, projectId: null, parentId: null, createdAt: 1, updatedAt: 1, updatedBy: null, preview: null, facts: [], badge: null, thumbnailUrl: null, href: `/plugins/studio/${name}/${id}`, archived: false };
    services.register(name, contract, {
      studio_describe: () => ({ pluginId: name, version: 2, panel: name, kinds: [{ id: name, label: name, plural: name, icon: "File", columns: [], actions: [], create: null, canArchive: true, blurb: "test" }] }),
      studio_list: () => ({ items: [item] }),
      studio_get: ({ ids }: { ids: string[] }) => ({ items: ids.includes(id) ? [item] : [] }),
      studio_delete: ({ ids }: { ids: string[] }) => { deleted.push(...ids.map(value => `${name}:${value}`)); return { done: ids, failed: [] }; },
      studio_create: () => ({ item }),
      studio_search: () => ({ ids: [id], snippets: { [id]: name } }),
    } as unknown as PluginRpcHandlers<typeof contract>);
  };
  register("tables", "tbl_1"); register("tasks", "tsk_1");
  return { provider, deleted };
}
it("combines module kinds and items under Studio without changing item ids", async () => {
  const { provider } = fixture();
  await provider.add("tables"); await provider.add("tasks");
  expect((await provider.call("studio_describe", null)).kinds.map(kind => kind.id)).toEqual(["tables", "tasks"]);
  expect((await provider.items()).map(item => [item.pluginId, item.id])).toEqual([["studio", "tbl_1"], ["studio", "tsk_1"]]);
  expect((await provider.call("studio_create", { kind: "tasks", projectId: null })).item.id).toBe("tsk_1");
  expect(await provider.call("studio_search", { query: "x" })).toEqual({ ids: ["tbl_1", "tsk_1"], snippets: { tbl_1: "tables", tsk_1: "tasks" } });
});
it("dispatches mixed bulk operations only to each item's owner", async () => {
  const { provider, deleted } = fixture();
  await provider.add("tables"); await provider.add("tasks");
  expect(await provider.call("studio_delete", { ids: ["tsk_1", "tbl_1"] })).toEqual({ done: ["tsk_1", "tbl_1"], failed: [] });
  expect(deleted).toEqual(["tasks:tsk_1", "tables:tbl_1"]);
  await expect(provider.call("studio_delete", { ids: ["missing"] })).rejects.toThrow("not found");
  expect(deleted).toHaveLength(2);
});

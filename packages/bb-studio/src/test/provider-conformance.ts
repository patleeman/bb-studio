import Database from "better-sqlite3";
import { studioIndex } from "@bb-studio/kit/server";
import { afterEach, describe, expect, it } from "vitest";
import { schemas } from "../contract";
import { StudioHub, type HubSdk } from "../hub";
import { MIGRATIONS } from "../migrations";
import { SearchIndex } from "../search-index";

type Method = keyof typeof schemas.provider;
export interface ProviderHarness {
  pluginId: string;
  kind: string;
  handlers: Record<string, (input: never) => unknown>;
  close(): void;
}

/** Runs transport, availability and lifecycle invariants against registered production handlers. */
export function providerConformance(label: string, create: () => ProviderHarness): void {
  describe(`${label} provider conformance`, () => {
    const cleanups: (() => void | Promise<void>)[] = [];
    afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
    function setup() {
      const harness = create();
      cleanups.push(() => harness.close());
      const transport = { installed: true, unavailable: false };
      const call = async (method: Method, input: unknown) => {
        const schema = schemas.provider[method];
        const parsed = schema.input.parse(input);
        return schema.output.parse(await harness.handlers[method]!(parsed as never));
      };
      const sdk: HubSdk = { plugins: {
        list: async () => ({ plugins: transport.installed ? [{ id: harness.pluginId, enabled: true, status: "running", statusDetail: null, version: "1", name: label }] : [] }),
        experimental_discoverRpc: async () => transport.installed ? [{ pluginId: harness.pluginId }] : [],
        callRpc: async ({ method, input, outputSchema }) => {
          if (transport.unavailable) throw new Error("Temporary transport outage");
          return outputSchema.parse(await call(method as Method, input));
        },
      } };
      const hub = new StudioHub(sdk);
      const picker = studioIndex(sdk as never, schemas);
      const db = new Database(":memory:");
      for (const sql of MIGRATIONS) db.exec(sql);
      cleanups.push(() => { db.close(); });
      const index = new SearchIndex(db, hub);
      cleanups.push(() => index.dispose());
      return { harness, transport, call, hub, picker, index };
    }

    it("validates production describe/create/list/get/read contracts and canonical identity", async () => {
      const { harness, call, hub } = setup();
      const info = await call("studio_describe", null) as { pluginId: string };
      expect(info.pluginId).toBe(harness.pluginId);
      const created = await call("studio_create", { kind: harness.kind, projectId: "proj_conformance" }) as { item: { id: string; href: string } };
      const found = await hub.get(harness.pluginId, [created.item.id, "missing_conformance"]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ pluginId: harness.pluginId, id: created.item.id, kind: harness.kind, projectId: "proj_conformance", href: created.item.href });
      expect(created.item.href).toContain(`/plugins/${harness.pluginId}/`);
      expect((await hub.overview()).items.some((item) => item.id === created.item.id)).toBe(true);
      expect(await call("studio_read", { id: created.item.id, format: "text" })).toMatchObject({ content: expect.any(String) });
    });

    it("preserves cached identity through outages, then honors deletion and uninstall", async () => {
      const { harness, call, transport, hub, picker, index } = setup();
      const { item } = await call("studio_create", { kind: harness.kind, projectId: null }) as { item: { id: string } };
      await index.ensure();
      await picker.snapshot();
      transport.unavailable = true;
      picker.invalidate();
      await index.changed(harness.pluginId, [item.id]);
      expect(await hub.itemsResult(harness.pluginId, [item.id])).toMatchObject({ status: "unavailable" });
      expect((await picker.snapshot()).items.some((entry) => entry.id === item.id)).toBe(true);
      expect(index.recent().some((entry) => entry.ref.id === item.id)).toBe(true);
      transport.unavailable = false;
      await call("studio_delete", { ids: [item.id] });
      await index.changed(harness.pluginId, [item.id]);
      picker.invalidate();
      expect((await picker.items()).some((entry) => entry.id === item.id)).toBe(false);
      expect(index.recent().some((entry) => entry.ref.id === item.id)).toBe(false);
      await call("studio_create", { kind: harness.kind, projectId: null });
      await index.rebuild();
      expect(index.recent().length).toBeGreaterThan(0);
      transport.installed = false;
      await index.rebuild();
      picker.invalidate();
      expect(await hub.itemsResult(harness.pluginId, [item.id])).toEqual({ status: "absent" });
      expect(await picker.items()).toEqual([]);
      expect(index.recent()).toEqual([]);
      expect(index.status()).toMatchObject({ state: "current", unavailableProviders: [] });
    });

    it("keeps archived identity retrievable while removing it from searchable results", async () => {
      const { harness, call, hub, index } = setup();
      const { item } = await call("studio_create", { kind: harness.kind, projectId: null }) as { item: { id: string } };
      await index.ensure();
      await call("studio_archive", { ids: [item.id], archived: true });
      await index.changed(harness.pluginId, [item.id]);
      expect(await hub.get(harness.pluginId, [item.id])).toMatchObject([{ id: item.id, archived: true }]);
      expect(index.recent().some((entry) => entry.ref.id === item.id)).toBe(false);
      await call("studio_archive", { ids: [item.id], archived: false });
      await index.changed(harness.pluginId, [item.id]);
      expect(index.recent().some((entry) => entry.ref.id === item.id)).toBe(true);
    });
  });
}

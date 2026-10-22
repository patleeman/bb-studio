import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { StudioServices } from "./services";
import { registerDraw } from "./draw/server";
import { registerDesign } from "./design/server";
import { registerArtifacts } from "./artifacts/server";
import { registerDashboards } from "./dashboards/server";

describe("built-in item thread links", () => {
  for (const [kind, register, tool, input] of [
    ["excalidraw", registerDraw, "excalidraw_create_drawing", { name: "Plan" }],
    ["design", registerDesign, "design_create", { name: "Plan" }],
    ["artifacts", registerArtifacts, "artifacts_save", { title: "Plan", name: "plan.md", content: "Plan" }],
    ["dashboards", registerDashboards, "dashboard_create", { name: "Plan" }],
  ] as const) {
    it(`${kind} links its new item without the plugin RPC bridge`, async () => {
      const callRpc = vi.fn(async () => { throw new Error("bridge unavailable"); });
      const host = createFakePluginHost({ pluginId: "studio", sdk: { plugins: { callRpc } } });
      const db = host.bb.storage.database();
      for (const sql of MIGRATIONS) db.exec(sql);
      const services = new StudioServices(db);
      const builtin = register(host.bb, db, services);
      try {
        await host.harness.behavior.callAgentTool(tool, input, { threadId: "thr_maker" });
        expect(services.threadsForThread("thr_maker")).toMatchObject([{ ref: { pluginId: kind }, role: "created" }]);
        expect(callRpc).not.toHaveBeenCalled();
        vi.spyOn(services, "created").mockImplementation(() => { throw new Error("link write failed"); });
        const failure = await host.harness.behavior.callAgentTool(tool, input, { threadId: "thr_other" })
          .then((result) => JSON.stringify(result), (error: unknown) => String(error));
        expect(failure).toContain("link write failed");
      } finally { builtin.dispose(); await host.harness.lifecycle.dispose(); }
    });
  }
});

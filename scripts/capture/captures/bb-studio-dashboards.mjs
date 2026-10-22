// Dashboards are built into Studio. A seeded "Launch metrics" dashboard (stat
// tiles, a chart, a table, a feed and a custom widget) in dark and light, an
// empty dashboard, a dashboard of tiles with nothing to show yet, edit mode
// with the widget picker, and the script approval dialog.
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SIGNUPS = [42, 55, 49, 68, 81, 63, 74];
const ACTIVE = [310, 342, 335, 371, 402, 388, 415];

const GAUGE = `<div id="g" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:4px">
  <svg viewBox="0 0 120 70" width="80%" style="max-width:220px">
    <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke-width="12" stroke-linecap="round" id="track"/>
    <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke-width="12" stroke-linecap="round" id="arc" pathLength="100"/>
  </svg>
  <div id="value" style="font-size:22px;font-weight:600;margin-top:-18px"></div>
  <div id="label" style="font-size:12px"></div>
</div>
<script>
addEventListener("bbwidget", (event) => {
  const { data, theme } = event.detail;
  const pct = Math.max(0, Math.min(100, data.value));
  track.setAttribute("stroke", theme.colors.border);
  arc.setAttribute("stroke", theme.colors.series[1]);
  arc.setAttribute("stroke-dasharray", pct + " 100");
  value.textContent = pct + "%";
  value.style.color = theme.colors.foreground;
  label.textContent = data.label;
  label.style.color = theme.colors.muted;
});
</script>`;

const OPS = [
  { op: "add", type: "stat", title: "Revenue", options: { prefix: "$" }, source: { kind: "static", data: { value: 48210, delta: "+12.4%", trend: "up", series: [36100, 38900, 37400, 41800, 43900, 45200, 48210] } } },
  // Pushed, like an agent's widget_set_data: the tile shows when it updated.
  { op: "add", type: "stat", title: "Active users", source: { kind: "push" } },
  { op: "add", type: "stat", title: "Churn", options: { unit: "%", invert: true }, source: { kind: "static", data: { value: 2.1, delta: "-0.4 pts", trend: "down", series: [3.1, 2.9, 2.8, 2.6, 2.5, 2.3, 2.1] } } },
  { op: "add", type: "stat", title: "Open incidents", options: { invert: true }, source: { kind: "static", data: { value: 3, delta: "+1", trend: "up", caption: "1 needs an owner" } } },
  { op: "add", type: "area", title: "Weekly signups", w: 8, h: 7, options: { x: "day" }, source: { kind: "static", data: WEEK.map((day, index) => ({ day, signups: SIGNUPS[index], trials: Math.round(SIGNUPS[index] * 0.6) })) } },
  { op: "add", type: "custom", title: "Launch readiness", w: 4, h: 7, html: GAUGE, source: { kind: "static", data: { value: 72, label: "18 of 25 checks done" } } },
  { op: "add", type: "table", title: "Release train", w: 6, h: 6, source: { kind: "static", data: [
    { release: "ORBIT-42", owner: "Maya", status: "In QA", due: "Oct 17" },
    { release: "ORBIT-43", owner: "Theo", status: "Building", due: "Oct 24" },
    { release: "ORBIT-44", owner: "Ana", status: "Planned", due: "Nov 1" },
    { release: "Hotfix 41.2", owner: "Sam", status: "Shipped", due: "Oct 9" },
  ] } },
  { op: "add", type: "list", title: "Changelog feed", w: 6, h: 6, source: { kind: "static", data: { items: [
    { title: "Offline mode for the mobile app", summary: "Drafts and reading lists work without a connection.", date: "2026-10-12T15:00:00Z", link: "https://example.com/changelog/offline" },
    { title: "Faster search across projects", summary: "Results arrive in under 100 ms for most queries.", date: "2026-10-10T09:30:00Z", link: "https://example.com/changelog/search" },
    { title: "Checkout retries failed payments", summary: "One automatic retry before asking the customer.", date: "2026-10-07T12:00:00Z", link: "https://example.com/changelog/retries" },
  ] } } },
];

// Tiles with nothing to show yet, next to one that works.
const STATES = [
  { op: "add", type: "stat", title: "Deploys today", x: 0, y: 0, w: 3, h: 3, source: { kind: "static", data: { value: 14, delta: "+3", trend: "up", series: [9, 12, 8, 11, 14] } } },
  { op: "add", type: "stat", title: "Queue depth", x: 3, y: 0, w: 3, h: 3, source: { kind: "push" } },
  { op: "add", type: "stat", title: "Failed jobs", x: 6, y: 0, w: 6, h: 3, source: { kind: "script", command: "sqlite3 -json ~/orbit/jobs.db \"select count(*) as value from jobs where status = 'failed'\"", intervalSec: 300, select: "[0]" } },
  // Nothing listens on this port: the fetch fails at once.
  { op: "add", type: "line", title: "Error rate", x: 0, y: 3, w: 8, h: 6, source: { kind: "url", url: "http://127.0.0.1:47999/metrics.json", intervalSec: 300 } },
  { op: "add", type: "note", title: "Runbook", x: 8, y: 3, w: 4, h: 6, options: { markdown: "" } },
];

const SCRIPT = { op: "add", type: "table", title: "Disk usage", w: 6, h: 6, source: { kind: "script", command: "df -h / /System/Volumes/Data | awk 'NR>1 {printf \"{\\\"mount\\\":\\\"%s\\\",\\\"size\\\":\\\"%s\\\",\\\"used\\\":\\\"%s\\\",\\\"free\\\":\\\"%s\\\"}\\n\", $9, $2, $3, $4}' | jq -s .", cwd: "/tmp", intervalSec: 300 } };

const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

/** Opens a dashboard as a Studio tab and waits for its grid (or its empty state). */
async function open(client, id, { empty = false } = {}) {
  const path = `/plugins/studio/studio/dashboards/${id}`;
  await client.navigate(path);
  await client.waitForSelector(`[data-studio-workspace-editor="${path}"]`, 30000);
  await client.waitForSelector(`[data-studio-workspace-editor="${path}"] ${empty ? "[data-dashboard-empty]" : "[data-dashboard-grid] .react-grid-layout"}`, 30000);
}

const tileCount = (client) => client.evaluate(`document.querySelectorAll("[data-dashboard-grid] [data-widget-id]").length`);

export default ({ pluginRpc, projectId, sleep }) => {
  // A deleted dashboard's page goes back to the library; let it before the next capture navigates.
  const settle = () => sleep(1500);
  /** A dashboard seeded with `ops`, removed (and its tab closed) by the returned cleanup. */
  async function seeded(name, ops) {
    const { dashboard } = await pluginRpc("studio", "dashboards.create", { name, projectId });
    const cleanup = async () => {
      await pluginRpc("studio", "closeTabs", { items: [{ pluginId: "dashboards", id: dashboard.id }] }).catch(() => {});
      await pluginRpc("studio", "dashboards.delete", { id: dashboard.id }).catch(() => {});
    };
    try {
      if (ops.length) {
        const { dashboard: view } = await pluginRpc("studio", "dashboards.edit", { id: dashboard.id, ops });
        if (view.widgets.length !== ops.length) throw new Error(`Seeded ${view.widgets.length} widgets, not ${ops.length}`);
        return { id: dashboard.id, view, cleanup };
      }
      return { id: dashboard.id, view: null, cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  /** The populated dashboard in one color scheme, every tile checked. */
  const populated = (id, fileName, mode) => ({
    id,
    packageDir: "bb-studio",
    fileName,
    privateSidebar: true,
    setup: async (client) => {
      await scheme(client, mode);
      const { id: dashboardId, view, cleanup } = await seeded("Launch metrics", OPS);
      const done = async () => { await cleanup(); await scheme(client, ""); await settle(); };
      try {
        const active = view.widgets.find((widget) => widget.title === "Active users");
        await pluginRpc("studio", "dashboards.setData", { id: dashboardId, widgetId: active.id, data: ACTIVE });
        await open(client, dashboardId);
        const dark = await client.evaluate(`document.documentElement.classList.contains("dark")`);
        if (dark !== (mode === "dark")) throw new Error(`BB isn't in ${mode} mode`);
        for (const text of ["Launch metrics", "Revenue", "$48,210", "+12.4%", "Active users", "415", "just now", "Weekly signups", "Launch readiness", "Release train", "Release", "ORBIT-43", "Changelog feed", "Offline mode for the mobile app"]) await client.waitForText(text, 30000);
        await client.waitForSelector("[data-dashboard-grid] figure .recharts-surface", 30000);
        await client.waitForSelector('[data-widget-type="custom"] iframe[sandbox="allow-scripts"]', 30000);
        if (await tileCount(client) !== OPS.length) throw new Error(`The grid shows ${await tileCount(client)} tiles, not ${OPS.length}`);
        // The custom widget is sandboxed: no same-origin, no network.
        const frame = await client.evaluate(`(() => { const f = document.querySelector('[data-widget-type="custom"] iframe'); return { sandbox: f.getAttribute("sandbox"), csp: f.getAttribute("srcdoc").includes("connect-src 'none'") }; })()`);
        if (frame.sandbox !== "allow-scripts" || !frame.csp) throw new Error(`Custom widget frame isn't sandboxed: ${JSON.stringify(frame)}`);
        // Churn and incidents count down as good: churn's drop is green, the extra incident red.
        const tones = await client.evaluate(`(() => Object.fromEntries(["Churn", "Open incidents"].map((name) => [name, document.querySelector('[aria-label="' + name + '"] [data-widget-body="stat"] .text-sm')?.className ?? ""])))()`);
        if (!tones.Churn.includes("emerald") || !tones["Open incidents"].includes("red")) throw new Error(`Stat deltas aren't toned: ${JSON.stringify(tones)}`);
        await sleep(1500);
      } catch (error) {
        await done();
        throw error;
      }
      return done;
    },
  });

  return [
    populated("dashboards", "dashboards-preview.png", "dark"),
    populated("dashboards-light", "dashboards-light.png", "light"),
    {
      id: "dashboards-empty",
      packageDir: "bb-studio",
      fileName: "dashboards-empty.png",
      privateSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const { id, cleanup } = await seeded("Team health", []);
        const done = async () => { await cleanup(); await scheme(client, ""); await settle(); };
        try {
          await open(client, id, { empty: true });
          for (const text of ["Team health", "No widgets yet", "Add stat tiles, charts, tables and feeds", "Add widget"]) await client.waitForText(text);
          if (await tileCount(client) !== 0) throw new Error("A new dashboard shows tiles");
          await sleep(600);
        } catch (error) {
          await done();
          throw error;
        }
        return done;
      },
    },
    {
      id: "dashboards-states",
      packageDir: "bb-studio",
      fileName: "dashboards-states.png",
      privateSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const { id, cleanup } = await seeded("Ops board", STATES);
        const done = async () => { await cleanup(); await scheme(client, ""); await settle(); };
        try {
          await open(client, id);
          // The working tile, a push tile waiting for data, a URL that failed,
          // an empty note, and a script waiting for approval.
          for (const text of ["Deploys today", "14", "No data yet", "widget_set_data", "Couldn't load", "Couldn't reach 127.0.0.1:47999 (connection refused).", "Try again", "Empty note", "Runs only after you approve it.", "sqlite3 -json", "Review command…", "Needs approval"]) await client.waitForText(text, 30000);
          await client.waitForSelector('[aria-label="Error rate"] [data-tile-status="error"]', 30000);
          await client.waitForSelector('[aria-label="Error rate"] [role="alert"]', 30000);
          if (await tileCount(client) !== STATES.length) throw new Error(`The grid shows ${await tileCount(client)} tiles, not ${STATES.length}`);
          await sleep(800);
        } catch (error) {
          await done();
          throw error;
        }
        return done;
      },
    },
    {
      id: "dashboards-edit",
      packageDir: "bb-studio",
      fileName: "dashboards-edit.png",
      privateSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const { id, cleanup } = await seeded("Launch metrics", OPS.slice(0, 6));
        const done = async () => { await cleanup(); await scheme(client, ""); await settle(); };
        try {
          await open(client, id);
          await client.clickButtonText("Edit");
          await client.waitForText("Done");
          await client.clickButtonText("Add widget");
          for (const text of ["Add a widget", "Stat", "Line chart", "Table", "Note", "Custom", "Drag a tile by its header"]) await client.waitForText(text);
          const groups = await client.evaluate(`[...document.querySelectorAll("[data-dashboard-picker] section")].map((section) => section.getAttribute("aria-label") + ":" + section.querySelectorAll("button").length).join(",")`);
          if (groups !== "Numbers:2,Charts:4,Lists:3,Content:5") throw new Error(`Widget picker groups: ${groups}`);
          const handles = await client.evaluate(`({
            drag: document.querySelectorAll("[data-dashboard-grid] .dashboard-drag").length,
            resize: document.querySelectorAll("[data-dashboard-grid] .react-grid-item:not(.react-resizable-hide) > .react-resizable-handle").length,
            settings: document.querySelectorAll('[data-dashboard-grid] button[aria-label^="Settings for "]').length,
          })`);
          if (handles.drag !== 6 || handles.resize !== 6 || handles.settings !== 6) throw new Error(`Edit mode affordances: ${JSON.stringify(handles)}`);
          await sleep(800);
        } catch (error) {
          await done();
          throw error;
        }
        return done;
      },
    },
    {
      id: "dashboards-approval",
      packageDir: "bb-studio",
      fileName: "dashboards-approval.png",
      privateSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const { id, view, cleanup } = await seeded("Launch metrics", [...OPS.slice(0, 4), SCRIPT]);
        const done = async () => { await cleanup(); await scheme(client, ""); await settle(); };
        try {
          await open(client, id);
          await client.waitForText("Runs only after you approve it.", 30000);
          // A direct approve, without the dialog's nonce, is refused.
          const script = view.widgets.find((widget) => widget.title === "Disk usage");
          const refused = await pluginRpc("studio", "dashboards.approveScript", { id, widgetId: script.id, sha256: script.script.sha256, nonce: "x".repeat(43) }).then(() => false, (error) => /approval dialog/.test(error.message));
          if (!refused) throw new Error("A forged approval was accepted");
          await client.clickButtonText("Review command…");
          await client.waitForSelector("[data-dashboard-approval]");
          for (const text of ["Run this command for “Disk usage”?", "df -h / /System/Volumes/Data", "jq -s .", "/tmp", "the BB host", "Every 5 minutes while the dashboard is open; every 30 minutes otherwise", "Stopped after 30 s; output up to 1 MB", "You, just now", "Deny", "Approve"]) await client.waitForText(text);
          const state = await client.evaluate(`(() => {
            const dialog = document.querySelector("[data-dashboard-approval]");
            const command = dialog.querySelector("[data-approval-command]");
            return {
              focused: document.activeElement === dialog.querySelector("[data-approval-deny]"),
              wraps: getComputedStyle(command).whiteSpace === "pre-wrap" && command.scrollWidth <= command.clientWidth,
              mono: /mono/i.test(getComputedStyle(command).fontFamily) || /Menlo|Monaco|Consolas|Courier/i.test(getComputedStyle(command).fontFamily),
              approveReady: !dialog.querySelector("[data-approval-approve]").disabled,
            };
          })()`);
          await sleep(1000);
          const ready = await client.evaluate(`!document.querySelector("[data-approval-approve]").disabled`);
          if (!state.focused || !state.wraps || !state.mono || !ready) throw new Error(`Approval dialog: ${JSON.stringify({ ...state, ready })}`);
          // The README is public: blur this machine's name, which the row above checked is there.
          await client.evaluate(`(() => {
            const row = [...document.querySelectorAll("[data-dashboard-approval] dd")].find((dd) => dd.textContent.includes("the BB host"));
            const name = row?.querySelector("span.font-medium");
            if (!name?.textContent.trim()) throw new Error("No host name in the approval dialog");
            name.style.filter = "blur(4px)";
            return true;
          })()`);
          await sleep(300);
        } catch (error) {
          await done();
          throw error;
        }
        return done;
      },
    },
  ];
};

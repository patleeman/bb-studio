// Dashboards are built into Studio: a seeded dashboard (stat tiles, a chart,
// a table, a feed and a custom widget, all with static data) as a Studio tab.
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
  { op: "add", type: "stat", title: "Active users", source: { kind: "static", data: ACTIVE } },
  { op: "add", type: "stat", title: "Churn", options: { unit: "%", invert: true }, source: { kind: "static", data: { value: 2.1, delta: "-0.4 pts", trend: "down", series: [3.1, 2.9, 2.8, 2.6, 2.5, 2.3, 2.1] } } },
  { op: "add", type: "stat", title: "Open incidents", source: { kind: "static", data: { value: 3, delta: "+1", trend: "up", caption: "1 needs an owner" } } },
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

export default ({ pluginRpc, projectId, sleep }) => [
  {
    id: "dashboards",
    packageDir: "bb-studio",
    fileName: "dashboards-preview.png",
    privateSidebar: true,
    setup: async (client) => {
      const { dashboard } = await pluginRpc("studio", "dashboards.create", { name: "Launch metrics", projectId });
      const cleanup = async () => {
        await pluginRpc("studio", "closeTabs", { items: [{ pluginId: "dashboards", id: dashboard.id }] }).catch(() => {});
        await pluginRpc("studio", "dashboards.delete", { id: dashboard.id }).catch(() => {});
      };
      try {
        const { dashboard: view } = await pluginRpc("studio", "dashboards.edit", { id: dashboard.id, ops: OPS });
        if (view.widgets.length !== OPS.length) throw new Error(`Seeded ${view.widgets.length} widgets, not ${OPS.length}`);
        const path = `/plugins/studio/studio/dashboards/${dashboard.id}`;
        await client.navigate(path);
        await client.waitForSelector(`[data-studio-workspace-editor="${path}"]`, 30000);
        await client.waitForSelector("[data-dashboard-grid] .react-grid-layout", 30000);
        for (const text of ["Launch metrics", "Revenue", "$48,210", "+12.4%", "Active users", "Weekly signups", "Launch readiness", "Release train", "ORBIT-43", "Changelog feed", "Offline mode for the mobile app"]) await client.waitForText(text, 30000);
        await client.waitForSelector("[data-dashboard-grid] figure .recharts-surface", 30000);
        await client.waitForSelector('[data-widget-type="custom"] iframe[sandbox="allow-scripts"]', 30000);
        const tiles = await client.evaluate(`document.querySelectorAll("[data-dashboard-grid] [data-widget-id]").length`);
        if (tiles !== OPS.length) throw new Error(`The grid shows ${tiles} tiles, not ${OPS.length}`);
        // The custom widget is sandboxed: no same-origin, no network.
        const frame = await client.evaluate(`(() => { const f = document.querySelector('[data-widget-type="custom"] iframe'); return { sandbox: f.getAttribute("sandbox"), csp: f.getAttribute("srcdoc").includes("connect-src 'none'") }; })()`);
        if (frame.sandbox !== "allow-scripts" || !frame.csp) throw new Error(`Custom widget frame isn't sandboxed: ${JSON.stringify(frame)}`);
        await sleep(1500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
];

// The Studio panels Studio Navigation leaves out, by the label bb gives their rows.
const LEFT_OUT = ["Pages", "Drawings", "Artifacts", "Recordings", "Tasks", "Tables", "New channel"];
const STUDIO_PLUGINS = ["studio", "pages", "excalidraw", "artifacts", "talk", "studio-tasks", "studio-tables", "bot-teams", "thread-list-plus", "studio-navigation"];
// Staged by scripts/staged-bb.mjs: a plugin outside BB Studio whose row stays.
const OUTSIDE_PLUGIN = "staged-forecast";

export default ({ projectId, threadId, bbCli, sleep }) => [
  {
    id: "studio-navigation",
    packageDir: "bb-studio-navigation",
    showSidebar: true,
    setup: async (client) => {
      // Every Studio plugin with a sidebar row is running, so the rows missing
      // below are ones Studio Navigation left out, not ones never registered.
      const plugins = await bbCli(["plugin", "list"]);
      for (const id of [...STUDIO_PLUGINS, OUTSIDE_PLUGIN]) {
        if (!new RegExp(`^${id}@\\S+\\s+running`, "m").test(plugins)) throw new Error(`Install and enable ${id} before capturing`);
      }
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      await client.waitForSelector('[data-bb-plugin="studio-navigation"] [data-testid="plugin-nav-sidebar-items"]');
      await client.waitForSelector('[data-sidebar-navigation-item="studio/studio"]');
      await client.waitForSelector("[data-studio-sidebar-sections]");
      await client.clickAriaButtonWithPointer("More sidebar navigation");
      await client.waitForText("Customize sidebar");
      await sleep(400);
      const shown = JSON.parse(await client.evaluate(`JSON.stringify({
        rows: Array.from(document.querySelectorAll('[data-sidebar-navigation-item]'), (el) => el.textContent.trim()),
        more: Array.from(document.querySelectorAll('[role="list"][aria-label="More navigation"] [data-sidebar-overflow-item]'), (el) => el.textContent.trim()),
      })`));
      // Which rows sit in More depends on saved preferences, so look in both.
      const listed = [...shown.rows, ...shown.more];
      for (const label of ["New thread", "Studio", "Teams", "Plugins", "Skills", "Forecast"]) {
        if (!listed.some((row) => row.startsWith(label))) throw new Error(`The navigation is missing ${label}`);
      }
      for (const label of LEFT_OUT) {
        if (listed.some((row) => row === label)) throw new Error(`Studio Navigation still shows ${label}`);
      }
      return async () => {
        await client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      };
    },
    // The navigation rows and the open More menu, without the projects and
    // threads below them.
    clip: async (client) => client.evaluate(`(() => {
      const nav = document.querySelector('[data-testid="plugin-nav-sidebar-items"]');
      const menu = document.querySelector('[role="list"][aria-label="More navigation"]')?.parentElement;
      if (!nav || !menu) throw new Error('Navigation or its More menu not found for capture');
      const sidebar = document.querySelector('[data-sidebar="sidebar"]').getBoundingClientRect();
      const rects = [nav.getBoundingClientRect(), menu.getBoundingClientRect()];
      const bottom = Math.max(...rects.map((rect) => rect.bottom)) + 12;
      const right = Math.max(sidebar.right, ...rects.map((rect) => rect.right)) + 12;
      return { x: sidebar.x, y: sidebar.y, width: right - sidebar.x, height: bottom - sidebar.y };
    })()`),
  },
];

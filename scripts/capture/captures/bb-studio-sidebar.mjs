export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "thread-list-plus",
    packageDir: "bb-studio-sidebar",
    showSidebar: true,
    setup: async (client) => {
      // Two Studio items opened become tabs in the Studio section, above the
      // threads and in the same scroll area.
      const { page, notes, cleanup: removePages } = await seedPages();
      const opened = [page, notes];
      for (const item of opened) {
        await client.navigate(`/plugins/pages/pages/${item.id}`);
        await client.waitForSelector(`[data-studio-tab="pages:${item.id}"]`);
      }
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      for (const item of opened) await client.waitForSelector(`[data-studio-tab="pages:${item.id}"]`);
      const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        const studio = sidebar?.querySelector('[data-studio-sidebar-sections]');
        const threads = Array.from(sidebar?.querySelectorAll('button, p, span') ?? []).find((el) => el.textContent?.trim() === 'Threads');
        const scrollers = Array.from(studio?.querySelectorAll('*') ?? []).filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY));
        return {
          tabs: Array.from(studio?.querySelectorAll('[data-studio-tab]') ?? []).map((el) => el.textContent.trim()),
          above: Boolean(studio && threads && (studio.compareDocumentPosition(threads) & Node.DOCUMENT_POSITION_FOLLOWING)),
          scrollers: scrollers.length,
        };
      })())`));
      for (const title of ["Offline mode launch", "Release notes: October"]) {
        if (!layout.tabs.some((tab) => tab.includes(title))) throw new Error(`The Studio section is missing the ${title} tab`);
      }
      if (!layout.above) throw new Error("The Studio section is not above Threads");
      if (layout.scrollers) throw new Error("The Studio section has its own scroll area");
      return async () => {
        await pluginRpc("studio", "closeTabs", { items: opened.map((item) => ({ pluginId: "pages", id: item.id })) }).catch(() => {});
        await removePages();
      };
    },
    clip: async (client) => client.evaluate(`(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]');
      if (!sidebar) throw new Error('Sidebar not found for capture');
      const rect = sidebar.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, 640) };
    })()`),
  },
  {
    id: "thread-list-plus-dialog",
    packageDir: "bb-studio-sidebar",
    fileName: "project-dialog.png",
    showSidebar: true,
    setup: async (client) => {
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      await client.waitForAriaButton("Threads actions");
      await client.evaluate(`document.querySelector('button[aria-label="Threads actions"]')?.scrollIntoView({ block: 'center' })`);
      await sleep(350);
      await client.clickAriaButtonWithPointer("Threads actions");
      await client.waitForSelector('[role="menuitem"]');
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "New project");
      await client.waitForSelector('[role="dialog"]');
      const hasTitle = await client.evaluate(`document.querySelector('[role="dialog"]')?.textContent?.includes('New project')`);
      if (!hasTitle) throw new Error('The live New project dialog is missing its title');
      for (const text of ["Folder path", "Browse", "Create project"]) await client.waitForText(text);
    },
    clip: async (client) => client.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) throw new Error('New project dialog not found for capture');
      const rect = dialog.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`),
  }
];

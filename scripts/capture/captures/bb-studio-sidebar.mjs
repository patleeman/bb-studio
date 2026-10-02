export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "thread-list-plus-background",
    packageDir: "bb-studio-sidebar",
    fileName: "background-threads.png",
    showSidebar: true,
    setup: async (client) => {
      const { preferences } = await pluginRpc("thread-list-plus", "listPreferences", null);
      const threads = [];
      const automations = [];
      const cleanup = async () => {
        for (const automationId of automations) await pluginRpc("automations", "automations_delete", { projectId, automationId });
        for (const id of threads) await bbCli(["thread", "delete", id, "--yes"]);
        for (const key of ["backgroundThreads", "backgroundCollapsed"]) await pluginRpc("thread-list-plus", "setPreference", { key, value: preferences[key] });
      };
      try {
        for (const title of ["Release digest", "Build health watch"]) {
          const target = JSON.parse(await bbCli(["thread", "spawn", "--project", projectId, "--title", title, "--prompt", "Staged screenshot fixture. Do not run.", "--send-at", "30d", "--json"]));
          threads.push(target.id);
          const automation = await pluginRpc("automations", "automations_create", {
            projectId, name: title, enabled: false, origin: "human",
            trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
            execution: { mode: "agent", prompt: "Staged screenshot fixture. Do not run.", providerId: "codex", model: "gpt-6-luna", reasoningLevel: "low", permissionMode: "auto", environment: { type: "project-default" }, targetThreadId: target.id },
          });
          automations.push(automation.id);
        }
        await pluginRpc("thread-list-plus", "setPreference", { key: "backgroundThreads", value: "grouped" });
        await pluginRpc("thread-list-plus", "setPreference", { key: "backgroundCollapsed", value: true });
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForAriaButton("Expand Background section");
        const collapsed = await client.evaluate(`document.querySelector('[data-sidebar-background-threads] [data-sidebar-thread-id]') === null`);
        if (!collapsed) throw new Error("Background threads are visible while the section is collapsed");
        await client.clickAriaButtonWithPointer("Expand Background section");
        for (const id of threads) await client.waitForSelector(`[data-sidebar-background-threads] [data-sidebar-thread-id="${id}"]`);
        const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          const background = sidebar.querySelector('[data-sidebar-background-threads]');
          return {
            titles: background.textContent,
            counts: ${JSON.stringify(threads)}.map(id => sidebar.querySelectorAll('[data-sidebar-thread-id="' + id + '"]').length),
            normal: Boolean(sidebar.querySelector('[data-sidebar-thread-id="${threadId}"]') && !background.querySelector('[data-sidebar-thread-id="${threadId}"]')),
          };
        })())`));
        if (!layout.titles.includes("Release digest") || !layout.titles.includes("Build health watch") || layout.counts.some(count => count !== 1) || !layout.normal) throw new Error(`Background grouping failed: ${JSON.stringify(layout)}`);
        await client.clickAriaButtonWithPointer("Background actions");
        for (const label of ["Only show updates", "Hide background threads", "Show with other threads"]) await client.waitForText(label);
        await client.clickElementWithTextAndPointer('[role="menuitemradio"]', "Hide background threads");
        await sleep(350);
        if (await client.evaluate(`Boolean(document.querySelector('[data-sidebar-background-threads]'))`)) throw new Error("Hide background threads left the section visible");
        await pluginRpc("thread-list-plus", "setPreference", { key: "backgroundThreads", value: "grouped" });
        await client.waitForSelector('[data-sidebar-background-threads]');
        await client.evaluate(`document.querySelector('[data-sidebar-background-threads]')?.scrollIntoView({ block: 'center' })`);
        await sleep(350);
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
    },
    clip: async (client) => client.evaluate(`(() => {
      const rect = document.querySelector('[data-sidebar="sidebar"]').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, 760) };
    })()`),
  },
  {
    id: "thread-list-plus",
    packageDir: "bb-studio-sidebar",
    showSidebar: true,
    setup: async (client) => {
      // Two Studio items opened become tabs in the Studio section, above the
      // threads and in the same scroll area.
      const { page, notes, cleanup: removePages } = await seedPages();
      const opened = [page, notes];
      const cleanup = async () => {
        await pluginRpc("studio", "closeTabs", { items: opened.map((item) => ({ pluginId: "pages", id: item.id })) }).catch(() => {});
        await removePages();
      };
      try {
        for (const item of opened) {
          await client.navigate(`/plugins/pages/pages/${item.id}`);
          await client.waitForSelector(`[data-studio-tab="pages:${item.id}"]`);
        }
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        for (const item of opened) await client.waitForSelector(`[data-studio-tab="pages:${item.id}"]`);
        const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          const studio = sidebar?.querySelector('[data-studio-sidebar-sections]');
          // The first thread row, whether threads are grouped by project or listed together.
          const threads = sidebar?.querySelector('[data-sidebar-rename-row]');
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
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
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

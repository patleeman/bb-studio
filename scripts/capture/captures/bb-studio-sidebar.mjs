export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  ...(() => {
    // By space and Automated threads share one seeded fixture: two Spaces,
    // their threads, one thread attached to a paused automation, and one that
    // works as the Atlas bot. Nothing runs during the capture.
    const fixture = { spaces: {}, threads: {}, automations: [], preferences: null, active: 0 };
    const spawn = async (title) => JSON.parse(await bbCli(["thread", "spawn", "--project", projectId, "--title", title, "--prompt", "Staged screenshot fixture. Do not run.", "--send-at", "30d", "--json"])).id;
    const seed = async () => {
      fixture.active += 1;
      if (fixture.preferences) return;
      ({ preferences: fixture.preferences } = await pluginRpc("thread-list-plus", "listPreferences", null));
      // A Space is a project with its own folder, so a staged BB keeps them
      // once made (deleteSpace refuses); reuse them on another run.
      const { spaces: existing } = await pluginRpc("studio", "spaces", null);
      for (const [key, spec] of Object.entries({ launch: { name: "Launch", icon: "🚀" }, research: { name: "Research" } })) {
        fixture.spaces[key] = existing.find((space) => space.name === spec.name) ?? (await pluginRpc("studio", "createSpace", spec)).space;
      }
      for (const [key, title] of Object.entries({ plan: "Launch plan", checklist: "Launch checklist", digest: "Release digest", notes: "Paper notes", atlas: "Atlas weekly sync", loose: "Loose idea" })) fixture.threads[key] = await spawn(title);
      const automation = await pluginRpc("automations", "automations_create", {
        projectId, name: "Release digest", enabled: false, origin: "human",
        trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
        execution: { mode: "agent", prompt: "Staged screenshot fixture. Do not run.", providerId: "codex", model: "gpt-6-luna", reasoningLevel: "low", permissionMode: "auto", environment: { type: "project-default" }, targetThreadId: fixture.threads.digest },
      });
      fixture.automations.push(automation.id);
      const { bots } = await pluginRpc("bot-teams", "list", null);
      const atlas = bots.find((bot) => bot.handle === "atlas");
      if (!atlas) throw new Error("Seed the Atlas bot before capturing.");
      await pluginRpc("bot-teams", "setThreadProfile", { threadId: fixture.threads.atlas, botId: atlas.id });
      const member = (key) => ({ pluginId: "bb-thread", id: fixture.threads[key] });
      await pluginRpc("studio", "spaceMembers", { id: fixture.spaces.launch.id, add: ["plan", "checklist", "digest"].map(member) });
      await pluginRpc("studio", "spaceMembers", { id: fixture.spaces.research.id, add: ["notes", "atlas"].map(member) });
      const { threads } = await pluginRpc("studio", "space_of_threads", {});
      for (const [key, space] of [["plan", "launch"], ["digest", "launch"], ["atlas", "research"]]) {
        if (threads[fixture.threads[key]] !== fixture.spaces[space].id) throw new Error(`${key} isn't in ${space}: ${JSON.stringify(threads)}`);
      }
      // Threads outside Launch and Research stay in their own project's Space (Personal, or none).
      if ([fixture.spaces.launch.id, fixture.spaces.research.id].includes(threads[fixture.threads.loose])) throw new Error("Loose idea joined Launch or Research");
    };
    const cleanup = async () => {
      fixture.active -= 1;
      if (fixture.active > 0 || !fixture.preferences) return;
      for (const automationId of fixture.automations) await pluginRpc("automations", "automations_delete", { projectId, automationId }).catch(() => {});
      for (const id of Object.values(fixture.threads)) await bbCli(["thread", "delete", id, "--yes"]).catch(() => {});
      for (const key of ["organizationMode", "automatedThreads"]) await pluginRpc("thread-list-plus", "setPreference", { key, value: fixture.preferences[key] });
      Object.assign(fixture, { spaces: {}, threads: {}, automations: [], preferences: null });
    };
    const showBySpace = async (client) => {
      await pluginRpc("thread-list-plus", "setPreference", { key: "organizationMode", value: "project" });
      await pluginRpc("thread-list-plus", "setPreference", { key: "automatedThreads", value: { [`space:${fixture.spaces.research.id}`]: "all" } });
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      // Studio's own Spaces section shows until the list is organized by Space.
      await client.waitForSelector('[data-studio-sidebar-anchor="studio:spaces"]');
      await pluginRpc("thread-list-plus", "setPreference", { key: "organizationMode", value: "space" });
      await client.waitForSelector(`[data-sidebar-section-id="space:${fixture.spaces.launch.id}"]`, 20000);
      for (const title of ["Launch", "Research", "Launch plan", "Paper notes", "Atlas weekly sync", "Loose idea"]) await client.waitForText(title);
      const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        const section = (id) => sidebar.querySelector('[data-sidebar-section-id="' + id + '"]');
        const ids = (el) => Array.from(el?.querySelectorAll('[data-sidebar-thread-id]') ?? [], (row) => row.getAttribute('data-sidebar-thread-id'));
        const labels = Array.from(sidebar.querySelectorAll('[data-sidebar-sticky-tier="label"] [title]'), (el) => el.getAttribute('title'));
        return {
          labels,
          launch: ids(section("space:${fixture.spaces.launch.id}")),
          research: ids(section("space:${fixture.spaces.research.id}")),
          hiddenRow: section("space:${fixture.spaces.launch.id}")?.querySelector('[data-sidebar-automated-hidden]')?.textContent ?? null,
          botMark: Boolean(sidebar.querySelector('[data-automated-thread-id="${fixture.threads.atlas}"][data-sidebar-automated-mark="bot"] [data-icon="Bot"]')),
          studioSpaces: Boolean(document.querySelector('[data-studio-sidebar-anchor="studio:spaces"]')),
          emoji: section("space:${fixture.spaces.launch.id}")?.querySelector('[data-sidebar-space-mark]')?.textContent ?? null,
        };
      })())`));
      const order = ["Launch", "Research"].map((label) => layout.labels.indexOf(label));
      if (order.some((index) => index < 0) || order.some((index, i) => i > 0 && index < order[i - 1])) throw new Error(`By space sections are out of order: ${JSON.stringify(layout)}`);
      if (!layout.launch.includes(fixture.threads.plan) || layout.launch.includes(fixture.threads.digest)) throw new Error(`Launch shows the wrong threads: ${JSON.stringify(layout)}`);
      if (!layout.research.includes(fixture.threads.atlas) || !layout.botMark) throw new Error(`Research lacks the marked bot thread: ${JSON.stringify(layout)}`);
      if (!layout.hiddenRow?.includes("1 automated thread hidden")) throw new Error(`Launch lacks the hidden-count row: ${JSON.stringify(layout)}`);
      if (layout.studioSpaces) throw new Error("Studio's Spaces section still shows in By space");
      if (layout.emoji !== "🚀") throw new Error(`Launch lacks its emoji: ${JSON.stringify(layout)}`);
    };
    // The thread list from its first Space down through Research.
    const clip = async (client) => client.evaluate(`(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]').getBoundingClientRect();
      const first = document.querySelector('[data-sidebar-section-id^="space:"]').getBoundingClientRect();
      const research = document.querySelector('[data-sidebar-section-id="space:${fixture.spaces.research.id}"]').getBoundingClientRect();
      const top = Math.max(sidebar.y, first.y - 8);
      return { x: sidebar.x, y: top, width: sidebar.width, height: Math.min(research.bottom + 8, sidebar.bottom) - top };
    })()`);
    return [
      {
        id: "thread-list-plus-by-space",
        packageDir: "bb-studio-sidebar",
        fileName: "by-space.png",
        showSidebar: true,
        setup: async (client) => {
          try {
            await seed();
            await showBySpace(client);
            await client.evaluate(`document.querySelector('[data-sidebar-section-id="space:${fixture.spaces.research.id}"]')?.scrollIntoView({ block: 'end' })`);
            await sleep(350);
          } catch (error) { await cleanup(); throw error; }
          return cleanup;
        },
        clip,
      },
      {
        id: "thread-list-plus-automated",
        packageDir: "bb-studio-sidebar",
        fileName: "automated-threads.png",
        showSidebar: true,
        setup: async (client) => {
          try {
            await seed();
            await showBySpace(client);
            // Launch's own Show: another Space can hide an automated thread too.
            // It can sit under the sidebar's footer, so bring it into view first.
            await client.evaluate(`document.querySelector('[data-sidebar-section-id="space:${fixture.spaces.launch.id}"] button[aria-label="Show 1 automated thread"]')?.scrollIntoView({ block: "center" })`);
            await sleep(200);
            await client.clickElementWithTextAndPointer(`[data-sidebar-section-id="space:${fixture.spaces.launch.id}"] button[aria-label="Show 1 automated thread"]`, "Show");
            await client.waitForSelector(`[data-automated-thread-id="${fixture.threads.digest}"][data-sidebar-automated-mark="automation"] [data-icon="Clock"]`);
            await client.waitForText("Showing 1 automated thread");
            await client.evaluate(`document.querySelector('[data-sidebar-section-id="space:${fixture.spaces.research.id}"]')?.scrollIntoView({ block: 'end' })`);
            await sleep(350);
          } catch (error) { await cleanup(); throw error; }
          return cleanup;
        },
        clip,
      },
    ];
  })(),
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
      const hasTitle = await client.evaluate(`Array.from(document.querySelectorAll('[role="dialog"]')).find(el => el.checkVisibility())?.textContent?.includes('New project')`);
      if (!hasTitle) throw new Error('The live New project dialog is missing its title');
      for (const text of ["Folder path", "Browse", "Create project"]) await client.waitForText(text);
    },
    clip: async (client) => client.evaluate(`(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(el => el.checkVisibility());
      if (!dialog) throw new Error('New project dialog not found for capture');
      const rect = dialog.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`),
  }
];

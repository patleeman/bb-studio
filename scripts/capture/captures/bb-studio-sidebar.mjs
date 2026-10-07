export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchSpace, getLaunchSpaceId, sleep }) => [
  ...(() => {
    // By space and Hidden threads share one seeded fixture: two Spaces and
    // their threads. Nothing runs during the capture.
    const fixture = { spaces: {}, threads: {}, preferences: null, active: 0 };
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
      const member = (key) => ({ pluginId: "bb-thread", id: fixture.threads[key] });
      await pluginRpc("studio", "spaceMembers", { id: fixture.spaces.launch.id, add: ["plan", "checklist", "digest"].map(member) });
      await pluginRpc("studio", "spaceMembers", { id: fixture.spaces.research.id, add: ["notes", "atlas"].map(member) });
      const { threads } = await pluginRpc("studio", "space_of_threads", {});
      for (const [key, space] of [["plan", "launch"], ["digest", "launch"], ["atlas", "research"]]) {
        if (threads[fixture.threads[key]] !== fixture.spaces[space].id) throw new Error(`${key} isn't in ${space}: ${JSON.stringify(threads)}`);
      }
      // Threads outside Launch and Research stay in their own project's Space (Personal, or none).
      if ([fixture.spaces.launch.id, fixture.spaces.research.id].includes(threads[fixture.threads.loose])) throw new Error("Loose idea joined Launch or Research");
      // Launch plan leads Launch and Launch checklist is pinned: a star and a pin mark them, with no headings.
      await pluginRpc("studio", "space_set_lead", { spaceId: fixture.spaces.launch.id, threadId: fixture.threads.plan });
      await bbCli(["thread", "pin", fixture.threads.checklist]);
    };
    const cleanup = async () => {
      fixture.active -= 1;
      if (fixture.active > 0 || !fixture.preferences) return;
      if (fixture.spaces.launch) await pluginRpc("studio", "space_set_lead", { spaceId: fixture.spaces.launch.id, threadId: null }).catch(() => {});
      for (const id of Object.values(fixture.threads)) await bbCli(["thread", "delete", id, "--yes"]).catch(() => {});
      for (const key of ["organizationMode", "hiddenThreads", "currentSpace"]) await pluginRpc("thread-list-plus", "setPreference", { key, value: fixture.preferences[key] });
      Object.assign(fixture, { spaces: {}, threads: {}, preferences: null });
    };
    const showBySpace = async (client) => {
      await pluginRpc("thread-list-plus", "setPreference", { key: "organizationMode", value: "project" });
      await pluginRpc("thread-list-plus", "setPreference", { key: "hiddenThreads", value: [] });
      // By space shows one Space at a time: Launch, with the switcher's dots below.
      await pluginRpc("thread-list-plus", "setPreference", { key: "currentSpace", value: fixture.spaces.launch.id });
      // Not a thread: opening one shows its own Space (Personal here) instead of Launch.
      await client.navigate("/plugins/studio/studio");
      // Studio's own Spaces section shows until the list is organized by Space.
      await client.waitForSelector('[data-studio-sidebar-anchor="studio:spaces"]');
      await pluginRpc("thread-list-plus", "setPreference", { key: "organizationMode", value: "space" });
      await client.waitForSelector(`[data-sidebar-section-id="space:${fixture.spaces.launch.id}"]`, 20000);
      for (const title of ["Launch", "Launch plan", "Launch checklist", "Release digest"]) await client.waitForText(title);
      const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]');
        const section = (id) => sidebar.querySelector('[data-sidebar-section-id="' + id + '"]');
        const ids = (el) => Array.from(el?.querySelectorAll('[data-sidebar-thread-id]') ?? [], (row) => row.getAttribute('data-sidebar-thread-id'));
        const labels = Array.from(sidebar.querySelectorAll('[data-sidebar-sticky-tier="label"] [title]'), (el) => el.getAttribute('title'));
        return {
          labels,
          launch: ids(section("space:${fixture.spaces.launch.id}")),
          research: Boolean(section("space:${fixture.spaces.research.id}")),
          dots: Array.from(sidebar.querySelectorAll('[data-sidebar-space-switcher] button[data-space-id]'), (el) => el.getAttribute('data-space-id')),
          current: sidebar.querySelector('[data-sidebar-space-switcher] [aria-current="true"]')?.getAttribute('data-space-id') ?? null,
          studioSpaces: Boolean(document.querySelector('[data-studio-sidebar-anchor="studio:spaces"]')),
          emoji: section("space:${fixture.spaces.launch.id}")?.querySelector('[data-sidebar-space-mark]')?.textContent ?? null,
          statusDots: section("space:${fixture.spaces.launch.id}")?.querySelectorAll('[data-space-thread-dot]').length ?? 0,
          marks: Array.from(section("space:${fixture.spaces.launch.id}")?.querySelectorAll('[data-space-thread-mark]') ?? [], (el) => el.getAttribute('data-space-thread-mark')),
          subheadings: Array.from(section("space:${fixture.spaces.launch.id}")?.querySelectorAll('button[aria-label^="Collapse "], button[aria-label^="Expand "]') ?? [], (el) => el.getAttribute('aria-label')).filter((label) => /^(Collapse|Expand) (Lead|Studio|Threads)$/.test(label)),
        };
      })())`));
      if (!layout.labels.includes("Launch") || layout.labels.includes("Research") || layout.research) throw new Error(`By space should show only Launch: ${JSON.stringify(layout)}`);
      if (!["plan", "checklist", "digest"].every((key) => layout.launch.includes(fixture.threads[key]))) throw new Error(`Launch shows the wrong threads: ${JSON.stringify(layout)}`);
      if (["notes", "atlas", "loose"].some((key) => layout.launch.includes(fixture.threads[key]))) throw new Error(`Launch shows another Space's threads: ${JSON.stringify(layout)}`);
      const dots = [fixture.spaces.launch.id, fixture.spaces.research.id].map((id) => layout.dots.indexOf(id));
      if (layout.dots[0] !== "all" || dots.some((index) => index < 0) || dots[1] < dots[0] || layout.current !== fixture.spaces.launch.id) throw new Error(`The Space switcher is wrong: ${JSON.stringify(layout)}`);
      if (layout.studioSpaces) throw new Error("Studio's Spaces section still shows in By space");
      if (layout.emoji !== "🚀") throw new Error(`Launch lacks its emoji: ${JSON.stringify(layout)}`);
      if (layout.statusDots < layout.launch.length) throw new Error(`Launch's rows lack their status dots: ${JSON.stringify(layout)}`);
      if (layout.launch[0] !== fixture.threads.plan || layout.launch[1] !== fixture.threads.checklist || layout.marks.join() !== "lead,pinned") throw new Error(`Launch's lead and pin aren't first with their marks: ${JSON.stringify(layout)}`);
      if (layout.subheadings.length) throw new Error(`Launch still has subheadings: ${JSON.stringify(layout)}`);
    };
    // The thread list from Launch's heading down to the Space switcher.
    const clip = async (client) => client.evaluate(`(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]').getBoundingClientRect();
      const first = document.querySelector('[data-sidebar-section-id^="space:"]').getBoundingClientRect();
      const switcher = document.querySelector('[data-sidebar-space-switcher]').getBoundingClientRect();
      const top = Math.max(sidebar.y, first.y - 8);
      return { x: sidebar.x, y: top, width: sidebar.width, height: Math.min(switcher.bottom + 4, sidebar.bottom) - top };
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
            await client.evaluate(`document.querySelector('[data-sidebar-section-id="space:${fixture.spaces.launch.id}"]')?.scrollIntoView({ block: 'start' })`);
            await sleep(350);
          } catch (error) { await cleanup(); throw error; }
          return cleanup;
        },
        clip,
      },
      {
        id: "thread-list-plus-hidden",
        packageDir: "bb-studio-sidebar",
        fileName: "hidden-threads.png",
        showSidebar: true,
        setup: async (client) => {
          try {
            await seed();
            await showBySpace(client);
            const launch = `[data-sidebar-section-id="space:${fixture.spaces.launch.id}"]`;
            const digest = `${launch} [data-sidebar-thread-id="${fixture.threads.digest}"]`;
            const waitFor = async (check, message) => {
              for (let started = Date.now(); Date.now() - started < 15000; await sleep(250)) if (await check()) return;
              throw new Error(message);
            };
            const shown = () => client.evaluate(`Boolean(document.querySelector(${JSON.stringify(digest)}))`);
            const menuItem = (text) => client.evaluate(`Array.from(document.querySelectorAll('[role="menuitem"]')).some((item) => item.checkVisibility() && item.textContent?.trim() === ${JSON.stringify(text)})`);
            const openLaunchMenu = async () => {
              await client.evaluate(`document.querySelector(${JSON.stringify(launch)})?.scrollIntoView({ block: 'start' })`);
              await sleep(200);
              await client.clickAriaButtonWithPointer(`${fixture.spaces.launch.name} actions`);
              await client.waitForSelector('[role="menuitem"]');
            };
            // Hide Release digest from its row's real right-click menu.
            await client.openContextMenu(digest);
            await client.waitForSelector('[role="menuitem"]');
            await client.clickElementWithTextAndPointer('[role="menuitem"]', "Hide");
            await waitFor(async () => !(await shown()), "Release digest still shows after Hide");
            if (await client.evaluate(`Boolean(document.querySelector('[data-sidebar-hidden-threads]'))`)) throw new Error("A hidden-threads footer row still shows");
            // Launch's ⋯ menu shows it again.
            await openLaunchMenu();
            await waitFor(() => menuItem("Show 1 hidden thread"), "Launch ⋯ lacks \"Show 1 hidden thread\"");
            await client.clickElementWithTextAndPointer('[role="menuitem"]', "Show 1 hidden thread");
            await waitFor(shown, "Release digest didn't come back after Show");
            // Leave the menu open on its Hide hidden threads item for the capture.
            await openLaunchMenu();
            await waitFor(() => menuItem("Hide hidden threads"), "Launch ⋯ lacks \"Hide hidden threads\"");
            await sleep(350);
          } catch (error) { await cleanup(); throw error; }
          return cleanup;
        },
        // The sidebar plus the open ⋯ menu beside it.
        clip: async (client) => {
          const base = await clip(client);
          const menu = await client.evaluate(`(() => {
            const rect = document.querySelector('[role="menu"]')?.getBoundingClientRect();
            return rect ? { right: rect.right, bottom: rect.bottom } : null;
          })()`);
          if (!menu) return base;
          return { ...base, width: Math.max(base.width, menu.right + 8 - base.x), height: Math.max(base.height, menu.bottom + 8 - base.y) };
        },
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
      // New project is in every section's menu: the loose Threads section's, or
      // with no loose threads, the seeded Orbit project's.
      await client.waitForSelector('button[aria-label="Threads actions"], button[aria-label="Orbit actions"]');
      const menu = await client.evaluate(`document.querySelector('button[aria-label="Threads actions"]') ? "Threads actions" : "Orbit actions"`);
      await client.evaluate(`document.querySelector('button[aria-label=${JSON.stringify(menu)}]')?.scrollIntoView({ block: 'center' })`);
      await sleep(350);
      await client.clickAriaButtonWithPointer(menu);
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

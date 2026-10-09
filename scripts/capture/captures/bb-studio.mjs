export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, sleep }) => [
  {
    id: "studio-workspace",
    packageDir: "bb-studio",
    fileName: "workspace.png",
    showSidebar: true,
    setup: async client => {
      const pages = await seedPages();
      const recording = await seedTalkRecording(projectId, { transcribe: false });
      const cleanup = async () => { await pages.cleanup(); await talkRpc("recording_delete", { id: recording }); };
      try {
        await client.navigate("/plugins/studio/studio/collection");
        await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:query:all', ''); localStorage.setItem('studio:collection:view', 'list')`);
        await client.navigate("/plugins/studio/studio/collection");
        const openRow = async title => {
          const selector = `[role="row"][aria-label="${title}"]`;
          await client.waitForSelector(selector);
          await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
          await client.waitForSelector('[data-studio-workspace]');
        };
        await openRow("Offline mode launch");
        await client.waitForText("Launch checklist");
        // Browse inside BB (no reload), then open a second kind of editor.
        await client.evaluate(`document.querySelector('[aria-label="Browse Studio items"]').click()`);
        await openRow("Weekly product sync");
        await client.waitForText("Weekly product sync");
        const href = `/plugins/talk/recordings/${recording}`;
        await client.waitForSelector(`[data-studio-workspace-editor="${href}"] [aria-label="Recording position"]`);
        const destination = await client.evaluate(`(() => { const rect = document.querySelector('[data-workspace-pane]').getBoundingClientRect(); return { x: rect.right - 20, y: rect.top + rect.height / 2 }; })()`);
        for (const type of ["dragEnter", "dragOver", "drop"]) await client.command("Input.dispatchDragEvent", { type, ...destination, data: { items: [{ mimeType: "application/x-bb-studio-item", data: JSON.stringify({ href, title: "Weekly product sync" }) }], dragOperationsMask: 1 } });
        await sleep(500);
        const assertLayout = async () => {
          const result = await client.evaluate(`(() => { const workspace = document.querySelector('[data-studio-workspace]'); return { panes: workspace.querySelectorAll('[data-workspace-pane]').length, tabs: workspace.querySelectorAll('[role="tab"]').length, page: workspace.innerText.includes('Launch checklist'), recording: workspace.innerText.includes('Weekly product sync') }; })()`);
          if (result.panes !== 2 || result.tabs !== 2 || !result.page || !result.recording) { await client.capture("/tmp/studio-workspace-failure.png"); throw new Error(`Workspace lost an editor: ${JSON.stringify(result)}`); }
        };
        await assertLayout();
        await client.navigate("/plugins/studio/studio/workspace");
        await client.waitForText("Launch checklist");
        await assertLayout();
        await client.evaluate(`document.querySelector('[aria-label="Close Weekly product sync"]').click()`);
        await sleep(250);
        if (await client.evaluate(`document.querySelectorAll('[data-studio-workspace] [data-workspace-pane]').length`) !== 1) throw new Error("Closing the last tab did not collapse the pane");
        // Restore the two-editor arrangement for the screenshot.
        await client.evaluate(`document.querySelector('[aria-label="Browse Studio items"]').click()`);
        await openRow("Weekly product sync");
        const split = await client.evaluate(`(() => { const rect = document.querySelector('[data-workspace-pane]').getBoundingClientRect(); return { x: rect.right - 20, y: rect.top + rect.height / 2 }; })()`);
        for (const type of ["dragEnter", "dragOver", "drop"]) await client.command("Input.dispatchDragEvent", { type, ...split, data: { items: [{ mimeType: "application/x-bb-studio-item", data: JSON.stringify({ href, title: "Weekly product sync" }) }], dragOperationsMask: 1 } });
        await sleep(500);
        await assertLayout();
        const misplaced = await client.evaluate(`document.querySelectorAll('header:not([data-studio-workspace-toolbar]) [data-studio-bar-slot] [data-studio-bar]').length`);
        if (misplaced) throw new Error("Workspace editor tools escaped into the shared app header");
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await sleep(500);
        if (await client.evaluate(`document.querySelectorAll('[data-studio-workspace] [role="tab"]').length`) !== 2) throw new Error("The compact workspace lost a tab");
        const compact = await client.evaluate(`(() => { const workspace = document.querySelector('[data-studio-workspace]'); return { picker: !!workspace.querySelector('select[aria-label="Studio pane"]'), width: workspace.clientWidth, content: workspace.scrollWidth }; })()`);
        if (!compact.picker || compact.content > compact.width + 1) throw new Error(`Compact workspace overflow: ${JSON.stringify(compact)}`);
        await client.capture(new URL('../../../packages/bb-studio/assets/workspace-mobile.png', import.meta.url).pathname);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(500);
        return cleanup;
      } catch (error) { await cleanup(); throw error; }
    },
  },
  {
    id: "studio-sidebar-new-menu",
    packageDir: "bb-studio",
    fileName: "sidebar-new-menu.png",
    showSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const created = [];
      const cleanup = async () => {
        await pluginRpc("studio", "closeTabs", { items: [...created, { pluginId: "pages", id: pages.page.id }] }).catch(() => {});
        for (const item of created) await pluginRpc("studio", "remove", { pluginId: item.pluginId, ids: [item.id] }).catch(() => {});
        await pages.cleanup();
      };
      const openNew = async (keyboard = false) => {
        await client.waitForAriaButton("New Studio item");
        if (keyboard) {
          await client.evaluate(`document.querySelector('button[aria-label="New Studio item"]').focus()`);
          for (const type of ["rawKeyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
        } else await client.clickAriaButtonWithPointer("New Studio item");
        await client.waitForSelector('[role="menu"][aria-label="New Studio item"]');
        await client.waitForSelector('[role="menu"][aria-label="New Studio item"] [role="menuitem"]:not([data-disabled])');
        const labels = await client.evaluate(`[...document.querySelectorAll('[role="menu"][aria-label="New Studio item"] [role="menuitem"]')].map(each => each.innerText.trim())`);
        for (const label of ["Page", "Drawing", "Table", "Recording"]) {
          if (!labels.includes(label)) throw new Error(`Sidebar New menu did not offer ${label}`);
        }
        if (labels.includes("Artifact")) throw new Error("The sidebar offers an artifact even though artifacts cannot be created here");
      };
      try {
        await client.navigate(`/plugins/pages/pages/${pages.page.id}`);
        await client.waitForSelector(`[data-studio-tab="pages:${pages.page.id}"]`);
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await openNew(true);
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Page");
        await client.waitForSelector('[data-studio-tab][data-studio-tab^="pages:"][aria-current="page"], .tiptap');
        const pageId = await client.evaluate(`location.pathname.split('/plugins/pages/pages/')[1]?.split('/')[0]`);
        if (!pageId || pageId === pages.page.id) throw new Error("New Page did not open the created page");
        created.push({ pluginId: "pages", id: pageId });
        await client.waitForSelector(`[data-studio-tab="pages:${pageId}"]`);
        const { items } = await pluginRpc("studio", "items", { pluginId: "pages", ids: [pageId] });
        if (items[0]?.projectId !== projectId) throw new Error("Sidebar New Page did not use the open thread's project");
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await openNew();
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 800, y: 800 });
        await sleep(350);
        const visible = await client.evaluate(`(() => {
          const button = document.querySelector('button[aria-label="New Studio item"]');
          return button.getAttribute('aria-expanded') === 'true' && getComputedStyle(button.parentElement).opacity === '1';
        })()`);
        if (!visible) throw new Error("The sidebar plus faded while its menu was open");
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
    },
    clip: async (client) => client.evaluate(`(() => {
      const section = document.querySelector('[data-studio-sidebar-section="studio:tabs"]').getBoundingClientRect();
      const menu = document.querySelector('[role="menu"][aria-label="New Studio item"]').getBoundingClientRect();
      const x = Math.max(0, Math.min(section.x, menu.x) - 8);
      const y = Math.max(0, Math.min(section.y, menu.y) - 8);
      return { x, y, width: Math.max(section.right, menu.right) - x + 8, height: Math.max(section.bottom, menu.bottom) - y + 8 };
    })()`),
  },
  {
    id: "studio-new-menu",
    packageDir: "bb-studio",
    fileName: "new-menu.png",
    showSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      try {
        const openNew = async () => {
          await client.waitForSelector('input[aria-label="Search and filter studio"]');
          await client.evaluate(`(() => {
            const button = [...document.querySelectorAll('button')].find(each => each.innerText.trim() === 'New');
            if (!button || button.getAttribute('aria-haspopup') !== 'menu') throw new Error('New must open a menu');
            button.focus();
          })()`);
          for (const type of ["rawKeyDown", "keyUp"]) {
            await client.command("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
          }
          await client.waitForSelector('[role="menuitem"]');
          return client.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].map(each => each.innerText.trim())`);
        };
        await client.navigate("/plugins/studio/studio/collection");
        await client.evaluate(`localStorage.setItem('studio:query:all', ''); localStorage.setItem('studio:collection:view', 'list')`);
        await client.navigate("/plugins/studio/studio/collection");
        const unfiltered = await openNew();
        for (const label of ["Page", "Drawing", "Table"]) {
          if (!unfiltered.includes(label)) throw new Error(`New menu did not offer ${label}`);
        }
        // Bots live in Teams, not Studio.
        if (unfiltered.includes("Bot")) throw new Error("The New menu still offers a bot");
        for (const kind of ["drawing", "page"]) {
          await client.navigate("/plugins/studio/studio/collection");
          await client.evaluate(`localStorage.setItem('studio:query:all', ${JSON.stringify(`kind:${kind}`)})`);
          await client.navigate("/plugins/studio/studio/collection");
          await client.waitForAriaButton(kind === "drawing" ? "Remove Kind Drawings" : "Remove Kind Pages");
          const filtered = await openNew();
          if (JSON.stringify(filtered) !== JSON.stringify(unfiltered)) throw new Error(`The ${kind} filter changed the New menu`);
        }
        await sleep(500);
      } catch (error) { await pages.cleanup(); throw error; }
      return pages.cleanup;
    },
  },
  {
    id: "studio",
    packageDir: "bb-studio",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const drawing = await seedDrawing();
      let recordingId = null;
      let spaceId = null;
      const cleanup = async () => {
        if (spaceId) await pluginRpc("studio", "deleteSpace", { id: spaceId }).catch(() => {});
        await pages.cleanup();
        await drawing.cleanup();
        if (recordingId) await talkRpc("recording_delete", { id: recordingId }).catch(() => {});
      };
      try {
        // Studio only lists the recording, so it needn't be transcribed.
        recordingId = await seedTalkRecording(projectId, { transcribe: false });
        const { space } = await pluginRpc("studio", "createSpace", { name: "Launch review", defaultProjectId: projectId });
        spaceId = space.id;
        await client.navigate("/plugins/studio/studio/collection");
        await client.evaluate(`localStorage.setItem("studio:collection:view", "grid"); localStorage.setItem("studio:query:all", "")`);
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForSelector('input[aria-label="Search and filter studio"]');
        await client.waitForAriaButton("Filter by space");
        await client.waitForAriaButton("Filter by kind");
        if (await client.evaluate(`!!document.querySelector('aside[aria-label="Filters"]')`)) throw new Error("Studio still reserves space for a filter rail");
        await client.clickAriaButtonWithPointer("Filter by space");
        await client.waitForAriaButton("Launch review");
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await client.clickAriaButtonWithPointer("Filter by kind");
        for (const label of ["Pages", "Recordings", "Drawings"]) await client.waitForAriaButton(label);
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await client.waitForText("Pages");
        await client.waitForText("Recordings");
        await client.waitForText("Drawings");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Weekly product sync");
        await client.waitForText("Checkout flow");
        // The drawing's card shows its server-rendered thumbnail.
        await client.waitForSelector('img[src*="/plugins/excalidraw/http/thumbnail"]');
        const loaded = await client.evaluate(`(async () => { const img = document.querySelector('img[src*="/plugins/excalidraw/http/thumbnail"]'); await img.decode(); return img.naturalWidth > 0; })()`, true);
        if (!loaded) throw new Error("The drawing thumbnail didn't load");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  ...[false, true].map((mobile) => ({
    id: mobile ? "studio-filters-mobile" : "studio-filters",
    packageDir: "bb-studio",
    fileName: mobile ? "filters-mobile.png" : "filters.png",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      let viewId = null;
      const cleanup = async () => {
        if (viewId) await pluginRpc("studio", "deleteView", { id: viewId }).catch(() => {});
        await pages.cleanup();
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      };
      const escape = () => client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      try {
        await client.command("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
        await client.navigate("/plugins/studio/studio/collection");
        await client.evaluate(`localStorage.setItem('studio:query:all', 'kind:Pages'); localStorage.setItem('studio:collection:view', 'list')`);
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForAriaButton("Remove Kind Pages");
        // A persisted plural label resolves to the same checkbox as kind:page.
        await client.clickAriaButtonWithPointer("Filter by kind");
        await client.waitForSelector('button[aria-label="Pages"][aria-pressed="true"]');
        await client.clickAriaButtonWithPointer("Pages");
        if (await client.evaluate(`!!document.querySelector('button[aria-label="Remove Kind Pages"]')`)) throw new Error("The checkbox failed to remove a stored plural filter");
        await client.clickAriaButtonWithPointer("Pages");
        await escape();
        await client.waitForAriaButton("Remove Kind Pages");
        await client.evaluate(`document.querySelector('input[aria-label="Search and filter studio"]').focus()`);
        await client.command("Input.insertText", { text: "Offline" });
        await client.waitForText("Offline mode launch");
        if (await client.evaluate(`document.querySelector('input[aria-label="Search and filter studio"]').getAttribute('aria-expanded') !== 'false'`)) throw new Error("Ordinary search opened query syntax suggestions");
        await client.clickAriaButtonWithPointer("Clear search");
        await client.waitForAriaButton("Remove Kind Pages");
        await client.clickAriaButtonWithPointer("Options for Kind Pages");
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Exclude Pages");
        const excluded = await client.evaluate(`localStorage.getItem('studio:query:all')`);
        if (excluded !== '-kind:page') throw new Error(`Exclude produced ${excluded}`);
        await client.clickAriaButtonWithPointer("Options for Kind Pages");
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Include Pages");
        await client.clickElementWithTextAndPointer('button', "More filters");
        await client.waitForSelector('[role="dialog"] section[aria-label="Project"]');
        await client.waitForAriaButton("Orbit");
        await client.clickAriaButtonWithPointer("Orbit");
        await escape();
        await client.waitForAriaButton("Remove Project Orbit");
        await sleep(350);
        await client.evaluate(`window.prompt = () => 'Launch pages'`);
        await client.clickAriaButtonWithPointer("Save view");
        await client.waitForText("Views");
        const overview = await pluginRpc("studio", "overview", null);
        viewId = overview.views.find((view) => view.name === 'Launch pages')?.id;
        if (!viewId) throw new Error("Save view did not persist the filter query");
        await client.clickElementWithTextAndPointer('button', "Clear filters");
        await client.clickElementWithTextAndPointer('button', "Views");
        await client.clickElementWithTextAndPointer('button', "Launch pages");
        await client.waitForAriaButton("Remove Project Orbit");
        await client.waitForAriaButton("Remove Kind Pages");
        await client.waitForText("Offline mode launch");
        const layout = await client.evaluate(`(() => { const field = document.querySelector('input[aria-label="Search and filter studio"]'); return { inside: !field.parentElement.querySelector('[aria-label^="Remove "]'), overflow: document.documentElement.scrollWidth > innerWidth, toolbarOverflow: [...document.querySelectorAll('[role="toolbar"][aria-label="Filters"]')].some((toolbar) => toolbar.scrollWidth > toolbar.clientWidth + 1) }; })()`);
        if (!layout.inside || layout.overflow || layout.toolbarOverflow) throw new Error(`Invalid filter layout: ${JSON.stringify(layout)}`);
        // Leave the controls, then let the toast and tooltips clear.
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 800 });
        await sleep(5000);
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
    },
  })),
  {
    id: "studio-search",
    packageDir: "bb-studio",
    fileName: "search.png",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const artifact = await seedArtifact().catch(async (error) => {
        await pages.cleanup();
        throw error;
      });
      const cleanup = async () => {
        await pages.cleanup();
        await artifact.cleanup();
      };
      try {
        // Artifacts search their saved text through Studio's index.
        await bbCli(["studio", "reindex"]);
        const found = await pluginRpc("studio", "searchAll", { query: "weekly active teams", limit: 40 });
        const key = `artifacts:${artifact.artifactId}`;
        if (!found.some((hit) => `${hit.ref.pluginId}:${hit.ref.id}` === key && /weekly active teams/i.test(hit.snippet.text))) {
          throw new Error(`Studio search didn't find the artifact with a snippet: ${JSON.stringify(found)}`);
        }
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForSelector('input[aria-label="Search and filter studio"]');
        // Open Studio search with its real shortcut, Mod+Shift+K.
        const modifiers = process.platform === "darwin" ? 4 : 2;
        // rawKeyDown: a shortcut with no text, as a real keyboard sends it.
        for (const type of ["rawKeyDown", "keyUp"]) {
          await client.command("Input.dispatchKeyEvent", { type, modifiers: modifiers | 8, key: "K", code: "KeyK", windowsVirtualKeyCode: 75 });
        }
        await client.waitForSelector('[role="dialog"].studio-quick-open input[aria-label="Search Studio"]');
        await client.waitForText("Recently changed");
        await client.waitForText("Hand to agent");
        await client.command("Input.insertText", { text: "offline sync" });
        // The pages match on title and content.
        await client.waitForText("Offline sync for every team");
        await client.waitForText("Ship offline sync to beta teams");
        const snippets = await client.evaluate(`document.querySelectorAll(".studio-quick-open-snippet mark").length`);
        if (snippets < 3) throw new Error(`Expected highlighted snippets, found ${snippets}`);
        await sleep(600);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    // A fresh staged BB has no Jev key, so Studio Decisions reports a problem
    // and the Plugin health footer item opens by itself.
    id: "studio-health",
    packageDir: "bb-studio",
    fileName: "plugin-health.png",
    showSidebar: true,
    setup: async (client) => {
      // Forget problems an earlier run already showed, so it opens again.
      await client.navigate(`/projects/${projectId}`);
      await client.evaluate(`localStorage.removeItem("studio:health-seen")`);
      await client.navigate(`/projects/${projectId}`);
      // Studio confirms a new problem 30 seconds after it first finds it.
      await client.waitForText("No Jev provider is set up", 90000);
      await client.waitForText("Studio Decisions");
      await client.waitForText("Add a key");
      await client.waitForText("Turn off plugin");
      await client.waitForText("Open plugin setup");
      await sleep(400);
    },
    clip: async (client) => client.evaluate(`(() => {
      const anchor = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Open plugin setup");
      const card = anchor?.closest("[data-bb-plugin-root], [role=dialog], [role=region]") ?? anchor?.parentElement;
      const sidebar = document.querySelector("[data-sidebar=sidebar]") ?? card;
      const box = sidebar.getBoundingClientRect();
      const top = Math.max(0, card.getBoundingClientRect().top - 24);
      return { x: box.left, y: top, width: box.width, height: box.bottom - top, scale: 2 };
    })()`),
  },
  {
    id: "studio-setup",
    packageDir: "bb-studio",
    fileName: "plugin-setup.png",
    setup: async (client) => {
      await client.navigate("/plugins/studio/studio/setup");
      await client.waitForText("Set up BB Studio", 30000);
      await client.waitForText("Add-ons");
      await client.waitForText("Studio Decisions");
      await client.waitForText("Needs setup");
      await client.waitForText("No Jev provider is set up");
      await client.waitForText("Last checked");
      await sleep(400);
    },
  },
];

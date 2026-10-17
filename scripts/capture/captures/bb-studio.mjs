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
        await client.navigate("/plugins/studio/studio");
        await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:query:all', ''); localStorage.setItem('studio:collection:view', 'list')`);
        // Studio opens on its workspace, showing the new tab page: the item list as a tab.
        await client.navigate("/plugins/studio/studio");
        const openRow = async title => {
          const selector = `[role="row"][aria-label="${title}"]`;
          await client.waitForSelector(selector);
          await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
          // Retained workspaces still exist in hidden parking while browsing.
          // Wait for the actual visible pane before measuring a drag destination.
          const started = Date.now();
          while (!(await client.evaluate(`Boolean([...document.querySelectorAll('[data-studio-workspace]')].find(element => element.checkVisibility()))`))) {
            if (Date.now() - started > 15000) throw new Error("Workspace did not become visible after opening an item");
            await sleep(50);
          }
        };
        // Studio opens on its workspace; the item list shows only as a new tab.
        const fresh = await client.evaluate(`({ tabs: document.querySelectorAll('[data-studio-workspace-tabs] [role="tab"]').length, rows: document.querySelectorAll('[data-studio-workspace] [role="row"]').length, empty: document.querySelector('[data-studio-workspace]').innerText.includes('No open tabs') })`);
        if (fresh.tabs || fresh.rows || !fresh.empty) throw new Error(`The workspace didn't open empty: ${JSON.stringify(fresh)}`);
        // An old list address opens the new tab page in the workspace.
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForSelector('[data-studio-workspace] [role="row"][aria-label="Offline mode launch"]');
        if (!(await client.evaluate(`location.pathname`)).endsWith("/plugins/studio/studio")) throw new Error("The collection's old address didn't move to the workspace");
        await sleep(500);
        await client.capture(new URL('../../../packages/bb-studio/assets/workspace-new-tab.png', import.meta.url).pathname);
        await openRow("Offline mode launch");
        await client.waitForText("Launch checklist");
        // The item took the new tab page's place.
        const replaced = await client.evaluate(`[...document.querySelectorAll('[data-studio-workspace-tabs] [role="tab"]')].map(tab => tab.lastElementChild?.textContent.trim())`);
        if (replaced.join() !== "Offline mode launch") throw new Error(`Opening an item didn't replace the new tab page: ${JSON.stringify(replaced)}`);
        // Browse inside BB (no reload), then open a second kind of editor.
        await client.evaluate(`document.querySelector('[aria-label="New tab"]').click()`);
        await openRow("Weekly product sync");
        await client.waitForText("Weekly product sync");
        const href = `/plugins/studio/studio/recordings/${recording}`;
        await client.waitForSelector(`[data-studio-workspace-editor="${href}"] [aria-label="Recording position"]`);
        const destination = await client.evaluate(`(() => { const rect = [...document.querySelectorAll('[data-workspace-pane]')].find(element => element.checkVisibility()).getBoundingClientRect(); return { x: rect.right - 20, y: rect.top + rect.height / 2 }; })()`);
        for (const type of ["dragEnter", "dragOver", "drop"]) await client.command("Input.dispatchDragEvent", { type, ...destination, data: { items: [{ mimeType: "application/x-bb-studio-item", data: JSON.stringify({ href, title: "Weekly product sync" }) }], dragOperationsMask: 1 } });
        await sleep(500);
        const assertLayout = async () => {
          const result = await client.evaluate(`(() => { const workspace = document.querySelector('[data-studio-workspace]'); return { panes: workspace.querySelectorAll('[data-workspace-pane]').length, tabs: document.querySelectorAll('[data-studio-workspace-tabs] [role="tab"]').length, page: workspace.innerText.includes('Launch checklist'), recording: workspace.innerText.includes('Weekly product sync') }; })()`);
          if (result.panes !== 2 || result.tabs !== 2 || !result.page || !result.recording) { await client.capture("/tmp/studio-workspace-failure.png"); throw new Error(`Workspace lost an editor: ${JSON.stringify(result)}`); }
        };
        await assertLayout();
        // The old address still leads to the workspace.
        await client.navigate("/plugins/studio/studio/workspace");
        await client.waitForText("Launch checklist");
        if (!(await client.evaluate(`location.pathname`)).endsWith("/plugins/studio/studio")) throw new Error("The workspace's old address didn't move to Studio's landing page");
        await assertLayout();
        await client.evaluate(`document.querySelector('[aria-label="Close Weekly product sync"]').click()`);
        await sleep(250);
        if (await client.evaluate(`document.querySelectorAll('[data-studio-workspace] [data-workspace-pane]').length`) !== 1) throw new Error("Closing the last tab did not collapse the pane");
        // One pane: its tab row, with the item's tools, takes BB's title bar.
        await sleep(500);
        const single = await client.evaluate(`(() => { const row = document.querySelector('[data-testid="app-page-header-content-row"] [data-studio-workspace-tabs]'); return { row: !!row, tools: !!row?.querySelector('[data-studio-workspace-bar]:not([hidden]) [data-studio-item-header]'), label: [...document.querySelectorAll('[data-testid="app-page-header-content-row"] > div:first-child')].some(element => element.checkVisibility() && element.innerText.trim() === 'Studio') }; })()`);
        if (!single.row || !single.tools || single.label) throw new Error(`A single pane's tab row did not take the title bar: ${JSON.stringify(single)}`);
        // + sits right after the last tab, as in Chrome.
        const gap = await client.evaluate(`(() => { const row = document.querySelector('[data-studio-workspace-tabs]'); const tabs = row.querySelectorAll('[data-studio-workspace-tab]'); return row.querySelector('[aria-label="New tab"]').getBoundingClientRect().left - tabs[tabs.length - 1].getBoundingClientRect().right; })()`);
        if (gap < 0 || gap > 8) throw new Error(`New tab isn't beside the last tab: ${gap}px away`);
        await client.capture(new URL('../../../packages/bb-studio/assets/workspace-single.png', import.meta.url).pathname);
        // Restore the two-editor arrangement for the screenshot.
        await client.evaluate(`document.querySelector('[aria-label="New tab"]').click()`);
        await openRow("Weekly product sync");
        const split = await client.evaluate(`(() => { const rect = [...document.querySelectorAll('[data-workspace-pane]')].find(element => element.checkVisibility()).getBoundingClientRect(); return { x: rect.right - 20, y: rect.top + rect.height / 2 }; })()`);
        for (const type of ["dragEnter", "dragOver", "drop"]) await client.command("Input.dispatchDragEvent", { type, ...split, data: { items: [{ mimeType: "application/x-bb-studio-item", data: JSON.stringify({ href, title: "Weekly product sync" }) }], dragOperationsMask: 1 } });
        await sleep(500);
        await assertLayout();
        // A tab's right-click menu has the usual tab actions and where it can go.
        await client.openContextMenu(`[data-studio-workspace-tab="${href}"]`);
        const menu = await client.evaluate(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(each => each.innerText.trim())`);
        for (const label of ["Close", "Close others", "Close tabs to the right", "Close all in this pane", "Split right", "Split down", "Move to pane 1", "Rename", "Copy link"]) {
          if (!menu.includes(label)) throw new Error(`The tab menu has no ${label}: ${JSON.stringify(menu)}`);
        }
        await client.capture(new URL('../../../packages/bb-studio/assets/workspace-tab-menu.png', import.meta.url).pathname);
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(250);
        // Escape hands keyboard focus back to the tab, ringed; the screenshot is of a mouse user's screen.
        await client.evaluate(`document.activeElement?.blur()`);
        // Mid-drag, a drop layer covers each editor, so editors in iframes can't swallow the drop.
        const over = await client.evaluate(`(() => { const rect = [...document.querySelectorAll('[data-workspace-pane]')].filter(element => element.checkVisibility())[0].querySelector('[data-studio-workspace-drop]').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.bottom - 40 }; })()`);
        const item = { items: [{ mimeType: "application/x-bb-studio-item", data: JSON.stringify({ href, title: "Weekly product sync" }) }], dragOperationsMask: 1 };
        await client.command("Input.dispatchDragEvent", { type: "dragEnter", ...over, data: item });
        await client.command("Input.dispatchDragEvent", { type: "dragOver", ...over, data: item });
        await sleep(100);
        const covered = await client.evaluate(`document.elementFromPoint(${over.x}, ${over.y})?.hasAttribute('data-studio-workspace-drop-layer') ?? false`);
        // A cancelled drag may say nothing to the page; the next pointer move ends it.
        await client.command("Input.dispatchDragEvent", { type: "dragCancel", ...over, data: item });
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: over.x + 5, y: over.y, buttons: 0 });
        await sleep(100);
        if (!covered) throw new Error("No drop layer covered the editor during a drag");
        if (await client.evaluate(`document.querySelectorAll('[data-studio-workspace-drop-layer]').length`)) throw new Error("The drop layer outlived the drag");
        const misplaced = await client.evaluate(`[...document.querySelectorAll('[data-studio-item-header]')].filter(element => element.checkVisibility() && !element.closest('[data-studio-workspace-bar]')).length`);
        if (misplaced) throw new Error("Workspace editor tools escaped into the shared app header");
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await sleep(500);
        if (await client.evaluate(`document.querySelectorAll('[data-studio-workspace] [role="tab"]').length`) !== 2) throw new Error("The compact workspace lost a tab");
        const compact = await client.evaluate(`(() => { const workspace = document.querySelector('[data-studio-workspace]'); return { picker: !!workspace.querySelector('select[aria-label="Studio pane"]'), width: workspace.clientWidth, content: workspace.scrollWidth }; })()`);
        if (!compact.picker || compact.content > compact.width + 1) throw new Error(`Compact workspace overflow: ${JSON.stringify(compact)}`);
        await client.capture(new URL('../../../packages/bb-studio/assets/workspace-mobile.png', import.meta.url).pathname);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(500);
        const title = await client.evaluate(`(() => { const title = document.querySelector('[data-studio-workspace] [aria-label="Page title"]'); return { value: title?.value, height: title?.getBoundingClientRect().height }; })()`);
        if (title.value !== "Offline mode launch" || title.height < 20) throw new Error(`The page title did not survive pane hiding: ${JSON.stringify(title)}`);
        return cleanup;
      } catch (error) { await cleanup(); throw error; }
    },
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
        await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:query:all', ''); localStorage.setItem('studio:collection:view', 'list')`);
        await client.navigate("/plugins/studio/studio/collection");
        const unfiltered = await openNew();
        for (const label of ["Page", "Drawing"]) {
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
      const cleanup = async () => {
        await pages.cleanup();
        await drawing.cleanup();
        if (recordingId) await talkRpc("recording_delete", { id: recordingId }).catch(() => {});
      };
      try {
        // Studio only lists the recording, so it needn't be transcribed.
        recordingId = await seedTalkRecording(projectId, { transcribe: false });
        await client.navigate("/plugins/studio/studio/collection");
        await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem("studio:collection:view", "grid"); localStorage.setItem("studio:query:all", "")`);
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForSelector('input[aria-label="Search and filter studio"]');
        await client.waitForAriaButton("Filter by project");
        await client.waitForAriaButton("Filter by kind");
        if (await client.evaluate(`!!document.querySelector('aside[aria-label="Filters"]')`)) throw new Error("Studio still reserves space for a filter rail");
        await client.clickAriaButtonWithPointer("Filter by project");
        await client.waitForAriaButton("Global");
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
        await client.waitForSelector('img[src*="/plugins/studio/http/drawings/thumbnail"]');
        const loaded = await client.evaluate(`(async () => { const img = document.querySelector('img[src*="/plugins/studio/http/drawings/thumbnail"]'); await img.decode(); return img.naturalWidth > 0; })()`, true);
        if (!loaded) throw new Error("The drawing thumbnail didn't load");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    // The Studio sidebar (src/ui/StudioSidebar.tsx): on the Studio panel BB's
    // thread list becomes Studio's kinds, saved views, tags and recent items.
    id: "studio-sidebar",
    packageDir: "bb-studio",
    fileName: "studio-sidebar.png",
    showSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const drawing = await seedDrawing();
      let tagId = null, viewId = null;
      const cleanup = async () => {
        if (tagId) await pluginRpc("studio", "deleteTag", { id: tagId }).catch(() => {});
        if (viewId) await pluginRpc("studio", "deleteView", { id: viewId }).catch(() => {});
        await pages.cleanup();
        await drawing.cleanup();
      };
      try {
        const { tag } = await pluginRpc("studio", "createTag", { name: "Launch" });
        tagId = tag.id;
        const overview = await pluginRpc("studio", "overview", null);
        const tagged = overview.items.filter((item) => ["Offline mode launch", "Checkout flow"].includes(item.title));
        if (!tagged.length) throw new Error("No seeded items to tag");
        await pluginRpc("studio", "tagItems", { items: tagged.map((item) => ({ pluginId: item.pluginId, id: item.id })), add: [tag.id], remove: [] });
        viewId = (await pluginRpc("studio", "saveView", { name: "Launch pages", query: "kind:page tag:Launch" }))?.view?.id ?? null;
        await client.navigate("/plugins/studio/studio");
        await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:query:all', '')`);
        await client.navigate("/plugins/studio/studio");
        await client.waitForSelector('nav[aria-label="Studio"]', 30000);
        for (let i = 0; i < 40 && JSON.parse(await bbCli(["settings", "ui", "get", "sidebar.threadListProvider"])) !== "studio/studio-items"; i++) await sleep(500);
        const pref = JSON.parse(await bbCli(["settings", "ui", "get", "sidebar.threadListProvider"]));
        if (pref !== "studio/studio-items") throw new Error(`On the Studio page the thread list is ${pref}, not studio/studio-items`);
        if (!viewId) viewId = (await pluginRpc("studio", "overview", null)).views.find((view) => view.name === "Launch pages")?.id ?? null;
        for (const text of ["All items", "Pages", "Drawings", "Saved views", "Launch pages", "Tags", "Launch", "Recent", "Offline mode launch", "Checkout flow"]) await client.waitForText(text, 30000);
        await client.evaluate(`(() => {
          const nav = document.querySelector('nav[aria-label="Studio"]');
          if (nav.getBoundingClientRect().left > 120) throw new Error("The Studio list isn't in BB's sidebar");
          const pages = nav.querySelector('[data-kind="page"]');
          if (!pages || !/\\d/.test(pages.textContent)) throw new Error("The Pages kind has no count");
          pages.click();
          return true;
        })()`);
        await client.waitForSelector('nav[aria-label="Studio"] [data-kind="page"][aria-current="page"]', 15000);
        await client.waitForAriaButton("Remove Kind page").catch(() => client.waitForText("Offline mode launch"));
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 900 });
        await sleep(2000);
      } catch (error) { await cleanup(); throw error; }
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
        await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:query:all', 'kind:Pages'); localStorage.setItem('studio:collection:view', 'list')`);
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForAriaButton("Remove Kind Pages");
        // A persisted plural label resolves to the same checkbox as kind:page.
        await client.clickAriaButtonWithPointer("Filter by kind");
        await client.waitForSelector('button[aria-label="Pages"][aria-pressed="true"]');
        // The Kind menu's checkbox, not BB's own Pages row in the sidebar.
        await client.clickAriaButtonWithPointer("Pages", "[data-radix-popper-content-wrapper]");
        if (await client.evaluate(`!!document.querySelector('button[aria-label="Remove Kind Pages"]')`)) throw new Error("The checkbox failed to remove a stored plural filter");
        await client.clickAriaButtonWithPointer("Pages", "[data-radix-popper-content-wrapper]");
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
        // Project is its own picker beside Kind, not a More filters section.
        await client.clickAriaButtonWithPointer("Filter by project");
        await client.waitForSelector('[aria-label="Project filters"] button[aria-label="Orbit"]');
        await client.clickAriaButtonWithPointer("Orbit", "[data-radix-popper-content-wrapper]");
        // Let the chip land before Escape closes the picker.
        await client.waitForAriaButton("Remove Project Orbit");
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
        // The toolbar's Views menu, not the Studio sidebar's saved views behind the page.
        await client.clickElementWithTextAndPointer('[role="toolbar"][aria-label="Filters"] button', "Views");
        await client.waitForSelector('[data-radix-popper-content-wrapper] [aria-label="Saved views"]');
        await client.clickElementWithTextAndPointer('[data-radix-popper-content-wrapper] [aria-label="Saved views"] button', "Launch pages");
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
    // Setup → Kinds with Designs turned off for the shot (restored after).
    id: "studio-kinds",
    packageDir: "bb-studio",
    fileName: "kinds.png",
    setup: async (client) => {
      await pluginRpc("studio", "kinds.update", { kind: "design", on: false });
      await client.navigate("/plugins/studio/studio/setup");
      await client.waitForText("Set up BB Studio", 30000);
      await client.waitForText("Kinds");
      for (const label of ["Pages", "Drawings", "Recordings and dictation", "Artifacts", "Designs", "Dashboards"]) await client.waitForText(label);
      await client.waitForText("Your designs are kept.");
      await client.evaluate(`(() => {
        const section = document.querySelector('section[aria-label="Kinds"]');
        if (!section) throw new Error("The Kinds section is missing");
        const switches = [...section.querySelectorAll('[role="switch"]')].map((each) => each.getAttribute("aria-label") + "=" + each.getAttribute("aria-checked"));
        const want = ["Pages: turn off=true", "Drawings: turn off=true", "Recordings and dictation: turn off=true", "Artifacts: turn off=true", "Designs: turn on=false", "Dashboards: turn off=true"];
        if (JSON.stringify(switches) !== JSON.stringify(want)) throw new Error("Kind switches: " + switches.join(", "));
        section.scrollIntoView({ block: "start" });
        return true;
      })()`);
      await sleep(400);
      return async () => { await pluginRpc("studio", "kinds.update", { kind: "design", on: true }); };
    },
    clip: async (client) => client.evaluate(`(() => {
      const box = document.querySelector('section[aria-label="Kinds"]').getBoundingClientRect();
      return { x: Math.max(0, box.left - 24), y: Math.max(0, box.top - 24), width: box.width + 48, height: box.height + 48, scale: 2 };
    })()`),
  },
  {
    // Setup → Speech on OpenRouter with an ElevenLabs voice, playing the
    // sample. Needs OPENROUTER_API_KEY in the staged BB's environment.
    id: "studio-speech",
    packageDir: "bb-studio",
    fileName: "speech.png",
    setup: async (client) => {
      await pluginRpc("studio", "speech.update", { engine: "openrouter", model: "elevenlabs/eleven-v4", voice: "george", instructions: "Warm and calm, a little brisk." });
      await client.navigate("/plugins/studio/studio/setup");
      await client.waitForText("Set up BB Studio", 30000);
      await client.waitForText("The voice Studio speaks with.");
      await client.waitForText("$40/M chars", 30000);
      await client.waitForText("george");
      await client.evaluate(`(() => {
        const section = document.querySelector('section[aria-label="Speech"]');
        if (!section) throw new Error("The Speech section is missing");
        if (section.querySelector(".text-destructive")) throw new Error("Speech shows an error: " + section.querySelector(".text-destructive").textContent);
        const play = [...section.querySelectorAll("button")].find((button) => button.textContent.trim() === "Play sample");
        if (!play) throw new Error("No Play sample button");
        section.scrollIntoView({ block: "start" });
        play.click();
        return true;
      })()`);
      // The sample plays once the first piece's audio streams in.
      await client.waitForText("Stop", 30000);
      await sleep(400);
      return async () => {
        await client.evaluate(`[...document.querySelectorAll('section[aria-label="Speech"] button')].find((button) => button.textContent.trim() === "Stop")?.click()`).catch(() => {});
        await pluginRpc("studio", "speech.update", { model: "fish-audio/drama-3", voice: "", instructions: "" });
      };
    },
    clip: async (client) => client.evaluate(`(() => {
      const box = document.querySelector('section[aria-label="Speech"]').getBoundingClientRect();
      return { x: Math.max(0, box.left - 24), y: Math.max(0, box.top - 24), width: box.width + 48, height: box.height + 48, scale: 2 };
    })()`),
  },
  {
    // Setup → Speech on local voices: Studio installs mlx-audio into the
    // staged BB's data folder, starts its server, and plays a Kokoro sample.
    // Needs an Apple silicon Mac with uv; the first sample downloads Kokoro.
    id: "studio-speech-local",
    packageDir: "bb-studio",
    fileName: "speech-local.png",
    setup: async (client) => {
      await pluginRpc("studio", "speech.update", { engine: "local", instructions: "" });
      await pluginRpc("studio", "speech.local", { action: "install" });
      await client.navigate("/plugins/studio/studio/setup");
      await client.waitForText("Set up BB Studio", 30000);
      await client.waitForText("On this Mac (local)");
      await client.waitForText("Running", 10 * 60_000);
      await client.waitForText("Kokoro · fast", 30000);
      await client.waitForText("af_heart");
      const sampleButton = `[...document.querySelectorAll('section[aria-label="Speech"] button')].find((button) => /^(Play sample|Loading… \\(stop\\)|Stop)$/.test(button.textContent.trim()) && button.closest('.flex-col')?.querySelector('textarea'))`;
      await client.evaluate(`(() => {
        const section = document.querySelector('section[aria-label="Speech"]');
        if (section.querySelector(".text-destructive")) throw new Error("Speech shows an error: " + section.querySelector(".text-destructive").textContent);
        section.scrollIntoView({ block: "start" });
        ${sampleButton}.click();
        return true;
      })()`);
      // Kokoro downloads (0.4 GB) on the first sample; then it plays.
      const started = Date.now();
      while ((await client.poll(`${sampleButton}?.textContent.trim()`)) !== "Stop") {
        const error = await client.poll(`document.querySelector('section[aria-label="Speech"] .text-destructive')?.textContent`);
        if (error) throw new Error(`Speech shows an error: ${error}`);
        if (Date.now() - started > 5 * 60_000) throw new Error("The local sample never started playing");
        await sleep(250);
      }
      await sleep(400);
      return async () => {
        await client.evaluate(`${sampleButton}?.click()`).catch(() => {});
        await pluginRpc("studio", "speech.update", { engine: "openrouter" });
      };
    },
    clip: async (client) => client.evaluate(`(() => {
      const box = document.querySelector('section[aria-label="Speech"]').getBoundingClientRect();
      return { x: Math.max(0, box.left - 24), y: Math.max(0, box.top - 24), width: box.width + 48, height: box.height + 48, scale: 2 };
    })()`),
  },
  {
    // Studio → Voice: a real session on GPT-6-Luna (Codex's fast tier), asked
    // a question, its reply spoken with Speech. Needs Codex signed in and
    // OPENROUTER_API_KEY in the staged BB's environment.
    id: "studio-voice",
    packageDir: "bb-studio",
    fileName: "voice.png",
    setup: async (client) => {
      await pluginRpc("studio", "voice.end", null);
      await client.navigate("/plugins/studio/studio/voice");
      await client.waitForText("Talk to BB and hear the answers.", 30000);
      await client.clickButtonText("Start a voice session");
      // The agent greets the user; that reply is spoken.
      await client.waitForText("End session", 30000);
      const { session } = await pluginRpc("studio", "voice.state", null);
      if (!session) throw new Error("No voice session started");
      await client.waitForText("Stop speaking", 120000);
      await client.evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Stop speaking")?.click()`);
      await bbCli(["thread", "tell", session.threadId, "In one sentence: what's a good name for a release about offline mode?"]);
      await client.waitForText("Stop speaking", 180000);
      await client.evaluate(`(() => {
        const error = document.querySelector(".text-destructive");
        if (error) throw new Error("Voice shows an error: " + error.textContent);
        return true;
      })()`);
      await sleep(600);
      return async () => {
        await client.evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Stop speaking")?.click()`).catch(() => {});
      };
    },
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

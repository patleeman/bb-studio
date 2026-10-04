export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, sleep }) => [
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
        for (const label of ["Page", "Drawing", "Table", "Space", "Recording"]) {
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
        await openNew();
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Space");
        await client.waitForSelector('[role="dialog"]');
        const dialog = await client.evaluate(`document.querySelector('[role="dialog"]').innerText`);
        if (!dialog.includes("New space") || !dialog.includes("Default project")) throw new Error("Sidebar New Space did not open its creation dialog");
        await client.clickElementWithTextAndPointer('[role="dialog"] button', "Cancel");
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
        for (const label of ["Page", "Drawing", "Bot"]) {
          if (!unfiltered.includes(label)) throw new Error(`New menu did not offer ${label}`);
        }
        for (const kind of ["bot", "page"]) {
          await client.navigate("/plugins/studio/studio/collection");
          await client.evaluate(`localStorage.setItem('studio:query:all', ${JSON.stringify(`kind:${kind}`)})`);
          await client.navigate("/plugins/studio/studio/collection");
          await client.waitForAriaButton(kind === "bot" ? "Remove Kind Bots" : "Remove Kind Pages");
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
        await pluginRpc("studio", "spaceMembers", { id: spaceId, add: [{ pluginId: "pages", id: pages.page.id }] });
        await client.navigate("/plugins/studio/studio/collection");
        await client.evaluate(`localStorage.setItem("studio:collection:view", "grid"); localStorage.setItem("studio:query:all", "")`);
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForSelector('input[aria-label="Search and filter studio"]');
        await client.waitForSelector('nav[aria-label="Filters"]');
        const rail = await client.evaluate(`document.querySelector('nav[aria-label="Filters"]')?.innerText ?? ""`);
        for (const label of ["Spaces", "Launch review", "Kind", "Pages", "Recordings", "Drawings", "Project", "Orbit"]) {
          if (!rail.includes(label)) throw new Error(`The filter rail didn't show ${label}: ${rail}`);
        }
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
  {
    id: "studio-space",
    packageDir: "bb-studio",
    fileName: "space-page.png",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      let spaceId = null;
      const cleanup = async () => {
        if (spaceId) await pluginRpc("studio", "deleteSpace", { id: spaceId }).catch(() => {});
        await pages.cleanup();
      };
      try {
        const { space } = await pluginRpc("studio", "createSpace", { name: "Launch", icon: "🚀", description: "Everything for the Orbit launch: plans, notes and the people working on it.", defaultProjectId: projectId });
        spaceId = space.id;
        if (!space.pageId) throw new Error("The new space didn't get a page");
        await client.navigate(`/plugins/pages/pages/${space.pageId}`);
        await client.waitForSelector('[data-space-widget="actions"]');
        for (const label of ["Recent", "Channels and messages", "Space settings", "Offline mode launch", "Add or remove projects", "Orbit"]) await client.waitForText(label);
        const widgets = await client.evaluate(`[...document.querySelectorAll("[data-space-widget]")].map((each) => each.dataset.spaceWidget).join(",")`);
        if (widgets !== "actions,recent,threads,channels,projects") throw new Error(`The space page showed widgets ${widgets}`);
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
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
        await client.waitForSelector('.studio-quick-open [role="dialog"][aria-label="Search Studio"]');
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
  }
];

export default context => {
  const { projectId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, talkRpc, pluginRpc, sleep } = context;
  const fixtures = [
    { id: "pages", packageDir: "bb-studio-pages", seed: async () => { const { page, cleanup } = await seedPages(); return { path: `/plugins/pages/pages/${page.id}`, ready: '.pages-editor .ProseMirror', cleanup }; } },
    { id: "draw", packageDir: "bb-studio-draw", seed: async () => { const { drawing, cleanup } = await seedDrawing(); return { path: `/plugins/excalidraw/drawings/${drawing.id}`, ready: 'canvas.excalidraw__canvas', cleanup }; } },
    { id: "artifacts", packageDir: "bb-studio/src/modules/artifacts", seed: async () => { const { artifactId, cleanup } = await seedArtifact(); return { path: `/plugins/studio/artifacts/${artifactId}`, ready: 'iframe[title="q3-usage-report.html"]', cleanup }; } },
    { id: "talk", packageDir: "bb-studio-talk", seed: async () => { const id = await seedTalkRecording(projectId, { transcribe: false }); return { path: `/plugins/talk/recordings/${id}`, ready: 'input[aria-label="Title"]', cleanup: () => talkRpc("recording_delete", { id }) }; } },
    { id: "tables", packageDir: "bb-studio/src/modules/tables", seed: async () => {
      const { table } = await pluginRpc("studio", "tables_create", { title: "Release inventory", projectId, columns: [{ id: "name", name: "Name", type: "text", options: [] }] });
      await pluginRpc("studio", "tables_insert", { id: table.id, values: { name: "Review notes" } });
      return { path: `/plugins/studio/tables/${table.id}`, ready: 'input[aria-label="Table title"]', cleanup: () => pluginRpc("studio", "tables_remove", { id: table.id }) };
    } },
    { id: "tasks", packageDir: "bb-studio/src/modules/tasks", seed: async () => {
      const { board } = await pluginRpc("studio", "tasks_boardCreate", { title: "Release checklist", projectId });
      await pluginRpc("studio", "tasks_create", { title: "Review the launch notes", projectId, boardId: board.id, assignee: "me" });
      return { path: `/plugins/studio/tasks/${board.id}`, ready: 'input[aria-label="Board title"]', cleanup: () => pluginRpc("studio", "tasks_boardDelete", { id: board.id }) };
    } },
    { id: "teams", packageDir: "bb-studio/src/modules/teams", seed: async () => {
      const { bots } = await pluginRpc("studio", "teams_list", null);
      const bot = bots.find(b => b.handle === "atlas"); if (!bot) throw new Error("Missing staged Atlas profile");
      return { path: `/plugins/studio/bots/${bot.id}/profile`, ready: '[aria-label="Bot sections"]', cleanup: async () => {} };
    } },
  ];
  return fixtures.map(fixture => ({
    id: `${fixture.id}-compact-header`, packageDir: fixture.packageDir, fileName: "compact-header.png", privateSidebar: false,
    setup: async client => {
      const { path, ready, cleanup } = await fixture.seed();
      let sidebarToggle;
      const forget = async () => {
        await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1')`).catch(() => {});
        await cleanup();
        if (sidebarToggle) await client.evaluate(`document.querySelector('button[aria-label=${JSON.stringify(sidebarToggle)}]')?.click()`);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      };
      const fits = async selector => {
        const clipped = await client.evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(selector)})].filter(button => {
          if (!button.checkVisibility()) return false;
          const r = button.getBoundingClientRect();
          const covered = !button.disabled && !button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
          return r.width <= 0 || r.left < 0 || r.right > innerWidth + 1 || r.top < 0 || r.bottom > innerHeight + 1 || covered;
        }).map(button => button.getAttribute('aria-label') || button.innerText))()`);
        if (clipped.length) throw new Error(`${fixture.id} clips compact controls: ${JSON.stringify(clipped)}`);
      };
      try {
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        if (await client.evaluate(`location.origin === 'null'`)) await client.navigate('/plugins/studio/studio');
        await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1')`);
        await client.navigate(path);
        await client.waitForSelector(ready);
        sidebarToggle = await client.evaluate(`(() => {
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          if (['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'))) return null;
          if (!sidebar?.checkVisibility() || sidebar.getBoundingClientRect().right <= 0) return null;
          return [...document.querySelectorAll('button')].find(button => /^Toggle sidebar/i.test(button.getAttribute('aria-label') || '') && button.checkVisibility())?.getAttribute('aria-label') || null;
        })()`);
        if (sidebarToggle) await client.clickAriaButtonWithPointer(sidebarToggle);
        await client.waitForAriaButton("Item actions");
        await sleep(500);
        const chat = await client.evaluate(`(() => {
          const button = [...document.querySelectorAll('[data-studio-item-header] button')].find(button => button.innerText.trim() === 'Chat');
          return !!button?.checkVisibility() && !button.disabled;
        })()`);
        if (!chat) throw new Error(`${fixture.id} has no available compact Chat action`);
        if (await client.evaluate(`!!document.querySelector('.bb-float-stack button[aria-label="Floating tab actions"]')`)) {
          await client.clickAriaButtonWithPointer("Floating tab actions");
          const all = await client.evaluate(`Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => item.textContent.trim() === 'Close all')`);
          await client.clickElementWithTextAndPointer('[role="menuitem"]', all ? "Close all" : "Close tab");
        }
        if (fixture.id === "draw") {
          await client.dragBy('canvas.excalidraw__canvas', 0, 0);
          await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "!", code: "Digit1", modifiers: 8 });
          await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "!", code: "Digit1", modifiers: 8 });
        }
        await fits('[data-studio-item-header] button');
        await client.clickAriaButtonWithPointer("Item actions");
        await client.waitForSelector('[data-studio-item-actions]');
        await fits('[data-studio-item-header] button');
        if (await client.evaluate(`document.documentElement.scrollWidth > innerWidth + 1`)) throw new Error(`${fixture.id} overflows the compact viewport`);
        await client.clickAriaButtonWithPointer("Related");
        await client.waitForSelector('[data-studio-related-panel]');
        const panelFits = await client.evaluate(`(() => { const r = document.querySelector('[data-studio-related-panel]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`);
        if (!panelFits) throw new Error(`${fixture.id} Related popover overflows the compact viewport`);
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(400);
        const expanded = await client.evaluate(`document.querySelector('button[aria-label="Item actions"]').getAttribute('aria-expanded') === 'true'`);
        if (!expanded) await client.clickAriaButtonWithPointer("Item actions");
        await fits('[data-studio-item-header] button');
      } catch (error) {
        console.error(await client.evaluate(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-2200) })`).catch(() => "Capture unavailable"));
        if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
        await forget(); throw error;
      }
      return forget;
    },
  }));
};

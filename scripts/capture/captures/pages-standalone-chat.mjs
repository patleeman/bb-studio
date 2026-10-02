export default ({ projectId, seedPages, pluginRpc, bbCli, sleep, mobile = false }) => ({
  id: mobile ? "pages-standalone-chat-mobile" : "pages-standalone-chat",
  packageDir: "bb-studio-pages",
  fileName: mobile ? "standalone-chat-mobile.png" : "standalone-chat.png",
  privateSidebar: !mobile,
  setup: async (client) => {
    const { page, cleanup } = await seedPages();
    let threadId;
    let disabled = false;
    let sidebarToggle = null;
    const forget = async () => {
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1')`).catch(() => {});
      if (disabled) await bbCli(["plugin", "enable", "studio-chat", "--json"]);
      if (threadId) await bbCli(["thread", "delete", threadId, "--yes", "--json"]);
      await cleanup();
      if (mobile) {
        if (sidebarToggle) await client.evaluate(`document.querySelector('button[aria-label=${JSON.stringify(sidebarToggle)}]')?.click()`);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      }
    };
    try {
      await bbCli(["plugin", "disable", "studio-chat", "--json"]);
      disabled = true;
      const result = await pluginRpc("pages", "work", {
        id: page.id,
        request: {
          projectId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", permissionMode: "full",
          executionInputSources: {}, environment: { type: "project-default" },
          input: [{ type: "text", text: "Review the offline launch checklist.", mentions: [] }],
          sendAt: Date.now() + 30 * 86400000,
        },
      });
      threadId = result.threadId;
      if (mobile) await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForText("Launch checklist");
      if (mobile) {
        sidebarToggle = await client.evaluate(`(() => {
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          if (['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'))) return null;
          if (!sidebar?.checkVisibility() || sidebar.getBoundingClientRect().right <= 0) return null;
          return [...document.querySelectorAll('button')].find(button => /^Toggle sidebar/i.test(button.getAttribute('aria-label') ?? '') && button.checkVisibility())?.getAttribute('aria-label') ?? null;
        })()`);
        if (sidebarToggle) await client.clickAriaButtonWithPointer(sidebarToggle);
      }
      await client.waitForSelector('[data-studio-item-header] button[title="Continue this page\'s conversation"]');
      if (mobile) {
        await client.clickAriaButtonWithPointer("Item actions");
        await client.clickAriaButtonWithPointer("Page actions");
        await client.waitForText("Version history…");
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        if (await client.evaluate(`document.querySelector('button[aria-label="Item actions"]').getAttribute('aria-expanded') === 'true'`)) await client.clickAriaButtonWithPointer("Item actions");
        const fits = await client.evaluate(`(() => [...document.querySelectorAll('[data-studio-item-header] button')].filter(button => button.checkVisibility()).every(button => {
          const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
        }))()`);
        if (!fits) throw new Error("Standalone Pages clips its compact header controls");
      }
      await client.clickElementWithTextAndPointer('[data-studio-item-header] button', "Chat");
      await client.waitForSelector(`[data-float-window="thread:${threadId}"] [data-promptbox]`);
      const chats = await pluginRpc("pages", "chats", { pageId: page.id });
      if (chats.chats.length !== 1 || chats.chats[0].threadId !== threadId) throw new Error("Continuing a legacy page conversation created a duplicate");
      if (await client.evaluate(`Boolean(document.querySelector('.pages-chat'))`)) throw new Error("Pages still renders its separate chat card");
      await client.clickAriaButtonWithPointer("Chat options");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "New conversation");
      const composer = '[role="dialog"] [data-promptbox] [contenteditable="true"]';
      await client.waitForSelector(composer);
      await client.dragBy(composer, 0, 0);
      await client.command("Input.insertText", { text: "Keep this page conversation draft." });
      if (mobile) {
        await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x: 10, y: 10, button: "left", buttons: 1, clickCount: 1 });
        await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 10, y: 10, button: "left", buttons: 0, clickCount: 1 });
        await sleep(500);
      }
      else await client.clickElementWithTextAndPointer('[role="dialog"] button', "Close");
      await client.clickAriaButtonWithPointer("Chat options");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "New conversation");
      await client.waitForSelector(composer);
      const draft = await client.evaluate(`document.querySelector(${JSON.stringify(composer)})?.textContent`);
      if (!draft.includes("Keep this page conversation draft.")) throw new Error(`Standalone page draft was lost: ${JSON.stringify(draft)}`);
      await sleep(500);
      const clipped = await client.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return [...dialog.querySelectorAll('button')].filter(button => {
          if (!button.checkVisibility()) return false;
          const rect = button.getBoundingClientRect();
          return rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight;
        }).map(button => button.getAttribute('aria-label') ?? button.innerText);
      })()`);
      if (clipped.length) throw new Error(`The page composer clips controls: ${JSON.stringify(clipped)}`);
    } catch (error) {
      console.error(await client.evaluate(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-2500), width: innerWidth, chat: [...document.querySelectorAll('[data-studio-item-header] button')].filter(button => button.innerText.trim() === 'Chat').map(button => ({title: button.title, bounds: button.getBoundingClientRect().toJSON()})) })`).catch(() => "Capture context unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget();
      throw error;
    }
    return forget;
  },
});

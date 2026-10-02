export default ({ threadId, seedPages, seedDrawing, pluginRpc, sleep }) => [
  {
    id: "studio-chat",
    packageDir: "bb-studio-chat",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup: cleanupDrawing } = await seedDrawing();
      const { page, notes, cleanup: cleanupPages } = await seedPages();
      const drawingRef = { pluginId: "excalidraw", id: drawing.id };
      const drawingChat = `[data-studio-chat-item="excalidraw:${drawing.id}"]`;
      const pageChat = `[data-float-window="path:/plugins/pages/pages/${page.id}"] [data-studio-chat-item="pages:${page.id}"]`;
      const forget = async () => {
        await client.evaluate('sessionStorage.removeItem("bb-studio-float:windows")').catch(() => {});
        await pluginRpc("studio-chat", "unlink", drawingRef).catch(() => {});
        await cleanupDrawing();
        await cleanupPages();
      };
      const chat = async (selector) => {
        await client.waitForSelector(`${selector} > button:not(:disabled)`);
        await client.clickElementWithTextAndPointer(`${selector} > button`, "Chat");
      };
      const option = async (selector, label) => {
        await client.dragBy(`${selector} [aria-label="Chat options"]`, 0, 0);
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', label);
      };
      const expectComposer = async (title) => {
        await client.waitForSelector(".studio-chat-composer [data-promptbox]");
        const text = await client.evaluate('document.querySelector(".studio-chat-composer").closest("section").innerText');
        if (!text.includes(`Chat about "${title}"`)) throw new Error(`Composer targets the wrong item: ${text}`);
      };
      try {
        await client.navigate(`/plugins/pages/pages/${notes.id}`);
        await client.waitForText("Release notes: October");
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await chat(drawingChat);
        await expectComposer("Checkout flow");
        await client.clickAriaButtonWithPointer("Close composer");
        const oldBar = await client.evaluate('!!document.querySelector(".studio-chat-bar")');
        if (oldBar) throw new Error("The duplicate Float-specific corner bar is still present");

        await option(drawingChat, "Choose conversation…");
        await client.waitForSelector(`.studio-chat-picker [data-thread-id="${threadId}"]`);
        await client.dragBy(`.studio-chat-picker [data-thread-id="${threadId}"]`, 0, 0);
        await client.waitForSelector(`[data-float-tab="thread:${threadId}"][aria-selected="true"]`);
        const home = (await pluginRpc("studio-chat", "home", drawingRef)).thread;
        if (home?.threadId !== threadId) throw new Error("Choose conversation did not link the drawing");
        await chat(drawingChat);
        const duplicates = await client.evaluate(`document.querySelectorAll('[data-float-tab="thread:${threadId}"]').length`);
        if (duplicates !== 1) throw new Error(`Chat duplicated the linked thread ${duplicates} times`);
        await option(drawingChat, "New conversation");
        await expectComposer("Checkout flow");
        if ((await pluginRpc("studio-chat", "home", drawingRef)).thread?.threadId !== threadId)
          throw new Error("Opening a new composer changed the existing item link");
        await client.clickAriaButtonWithPointer("Close composer");

        // A page in Float owns its Chat action while the main pane shows the drawing.
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForText("Offline mode launch");
        await client.clickAriaButtonWithPointer("Move");
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float this");
        await client.waitForSelector(pageChat);
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector(pageChat);
        await chat(pageChat);
        await expectComposer("Offline mode launch");
        await client.waitForSelector(`[data-studio-tab="pages:${notes.id}"] a`);
        await client.dragBy(`[data-studio-tab="pages:${notes.id}"] a`, 0, 0);
        await client.waitForSelector(`[data-studio-chat-item="pages:${notes.id}"]`);
        const route = await client.evaluate("location.pathname");
        if (route !== `/plugins/pages/pages/${notes.id}`) throw new Error(`The main pane did not navigate: ${route}`);
        await expectComposer("Offline mode launch");
        await client.clickAriaButtonWithPointer("Close composer");
        await client.dragBy(`[data-studio-tab="excalidraw:${drawing.id}"] a`, 0, 0);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await chat(drawingChat);
        await client.waitForSelector(`[data-float-window="thread:${threadId}"] .studio-chat-viewing`);
        await client.waitForText("Viewing: Checkout flow");
        await sleep(1000);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  },
];

const WINDOWS_KEY = "bb-studio-float:windows";

export default ({ threadId, seedPages, launchRoomThread, sleep }) => [
  {
    id: "float",
    packageDir: "bb-studio-float",
    privateSidebar: true,
    setup: async (client) => {
      const channelThreadId = await launchRoomThread();
      const { page, cleanup } = await seedPages();
      const forget = async () => {
        await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(WINDOWS_KEY)})`).catch(() => {});
        await cleanup();
      };
      const float = async (selector) => {
        await client.openContextMenu(selector);
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      };
      try {
        await client.navigate("/plugins/studio/studio");
        await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(WINDOWS_KEY)})`);
        // Visiting the page opens its Studio tab, whose menu floats it.
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForText("Offline mode launch");
        await client.waitForSelector(`[data-studio-tab="pages:${page.id}"]`);
        await float(`[data-studio-tab="pages:${page.id}"] a`);
        // A thread from Studio Sidebar's row menu, and a channel from its row in Studio Teams.
        await client.openThreadContextMenu();
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
        await float(`.channel-sidebar-row a[href="/threads/${channelThreadId}"]`);
        // The windows stay while the main view moves on.
        await client.navigate("/plugins/studio/studio");
        const keys = [`path:/plugins/pages/pages/${page.id}`, `thread:${threadId}`, `thread:${channelThreadId}`];
        for (const key of keys) await client.waitForSelector(`[data-float-window="${key}"]`);
        const shown = await client.evaluate(`[...document.querySelectorAll("[data-float-window]")].map((element) => element.getAttribute("data-float-window"))`);
        if (JSON.stringify(shown) !== JSON.stringify(keys)) throw new Error(`Float shows ${JSON.stringify(shown)}, not ${JSON.stringify(keys)}`);
        // The page renders in its window, and the channel's window is named for it.
        await client.waitForSelector(`[data-float-window="path:/plugins/pages/pages/${page.id}"] .float-body .pages-doc`);
        const pageText = await client.evaluate(`document.querySelector('[data-float-window="path:/plugins/pages/pages/${page.id}"]').innerText`);
        if (!pageText.includes("Launch checklist")) throw new Error("The floated page doesn't show its content");
        const channelTitle = await client.evaluate(`document.querySelector('[data-float-window="thread:${channelThreadId}"] .float-title').innerText`);
        if (!channelTitle.includes("#Launch room")) throw new Error(`The channel window is titled "${channelTitle}"`);
        await client.waitForText("Ready. I'll keep the decision log");
        await sleep(1500);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  },
];

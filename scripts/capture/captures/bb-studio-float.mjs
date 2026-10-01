const STATE_KEY = "bb-studio-float:windows";

export default ({ threadId, seedPages, launchRoomThread, sleep }) => [
  {
    id: "float",
    packageDir: "bb-studio-float",
    privateSidebar: true,
    setup: async (client) => {
      const channelThreadId = await launchRoomThread();
      const { page, cleanup } = await seedPages();
      const forget = async () => {
        await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(STATE_KEY)})`).catch(() => {});
        await cleanup();
      };
      const float = async (selector) => {
        await client.openContextMenu(selector);
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      };
      const tabOrder = () => client.evaluate(`[...document.querySelectorAll("[data-float-tab]")].map((element) => element.getAttribute("data-float-tab"))`);
      const place = () => client.evaluate(`document.querySelector(".bb-float-stack")?.getAttribute("data-float-place") ?? ""`);
      const expectPlace = async (expected) => {
        const actual = await place();
        if (actual !== expected) throw new Error(`The Float panel is "${actual}", not "${expected}"`);
      };
      // The header's grip, left of the tabs.
      const dragPanel = (dx, dy) => client.dragBy(".bb-float-stack header", dx, dy, { atX: 10 });
      try {
        await client.navigate("/plugins/studio/studio");
        await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(STATE_KEY)})`);
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
        // The tabs stay while the main view moves on, the newest showing.
        await client.navigate("/plugins/studio/studio");
        const pageKey = `path:/plugins/pages/pages/${page.id}`;
        const keys = [pageKey, `thread:${threadId}`, `thread:${channelThreadId}`];
        for (const key of keys) await client.waitForSelector(`[data-float-tab="${key}"]`);
        if (JSON.stringify(await tabOrder()) !== JSON.stringify(keys)) throw new Error(`Float's tabs are ${JSON.stringify(await tabOrder())}, not ${JSON.stringify(keys)}`);
        await client.waitForSelector(`[data-float-tab="thread:${channelThreadId}"][aria-selected="true"]`);
        const channelTab = await client.evaluate(`document.querySelector('[data-float-tab="thread:${channelThreadId}"]').innerText`);
        if (!channelTab.includes("#Launch room")) throw new Error(`The channel's tab is "${channelTab}"`);
        await client.waitForText("Ready. I'll keep the decision log");
        await expectPlace("dock");
        // Pulled off the bottom it floats free; dropped near the bottom it docks again.
        await dragPanel(-560, -300);
        await expectPlace("free");
        await dragPanel(0, 400);
        await expectPlace("dock");
        await dragPanel(-520, -260);
        await expectPlace("free");
        // Dragging the channel's tab to the front reorders the strip.
        await client.dragBy(`[data-float-tab="thread:${channelThreadId}"]`, -400, 0);
        const reordered = [`thread:${channelThreadId}`, pageKey, `thread:${threadId}`];
        if (JSON.stringify(await tabOrder()) !== JSON.stringify(reordered)) throw new Error(`After the drag, Float's tabs are ${JSON.stringify(await tabOrder())}`);
        // Clicking the page's tab shows the page, rendered by Pages in the panel.
        // A press and release without moving is a click.
        await client.dragBy(`[data-float-tab="${pageKey}"]`, 0, 0);
        await client.waitForSelector(`[data-float-window="${pageKey}"] .float-body .pages-doc`);
        const pageText = await client.evaluate(`document.querySelector('[data-float-window="${pageKey}"]').innerText`);
        if (!pageText.includes("Launch checklist")) throw new Error("The floated page doesn't show its content");
        await expectPlace("free");
        await sleep(1500);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  },
];

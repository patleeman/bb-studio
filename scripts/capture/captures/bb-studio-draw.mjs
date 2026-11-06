// Whiteboards live in pages (packages/bb-studio README, "Whiteboards"): the
// page's whiteboard, opened full size over its page, in the same tab.
export default ({ seedDrawing, pluginRpc, sleep }) => [
  {
    id: "excalidraw",
    packageDir: "bb-studio",
    fileName: "drawings-preview.png",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, page, cleanup } = await seedDrawing();
      const close = () => pluginRpc("studio", "closeTabs", { items: [{ pluginId: "excalidraw", id: drawing.id }, { pluginId: "pages", id: page.id }] }).catch(() => {});
      const editor = `[data-studio-workspace-editor="/plugins/studio/studio/drawings/${drawing.id}"]`;
      try {
        // The old Draw address still opens the drawing, as a Studio tab.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector(editor, 30000);
        const path = await client.evaluate("location.pathname");
        if (path !== "/plugins/studio/studio") throw new Error(`The old drawing address didn't open in Studio's workspace: ${path}`);
        await close();
        // The page shows the whiteboard; Open full size opens the full editor over the page, in the same tab.
        // The browser keeps the workspace's tabs too: start the page's shot without the drawing's tab.
        await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1')`);
        await client.navigate(`/plugins/studio/studio/pages/${page.id}`);
        await client.waitForSelector(`svg[data-whiteboard="${drawing.id}"]`, 30000);
        const fullSize = `[data-whiteboard-full-size="${drawing.id}"]`;
        const open = async () => {
          const before = await client.evaluate("location.pathname");
          await client.clickButtonText("Open full size");
          await client.waitForSelector(fullSize, 30000);
          await client.waitForSelector(`${fullSize} canvas.excalidraw__canvas`, 30000);
          if (await client.evaluate("location.pathname") !== before) throw new Error("Open full size navigated away from the page");
        };
        await open();
        // Esc returns to the page, then it opens again for the shot.
        await client.evaluate(`document.activeElement?.blur?.()`);
        for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(600);
        if (await client.evaluate(`!!document.querySelector(${JSON.stringify(fullSize)})`)) throw new Error("Esc didn't return to the page");
        await open();
        // Laid over the page, the editor keeps its own bar: Page (back), the name, its tools.
        await client.waitForText("Checkout flow");
        await client.waitForAriaButton("Copy image");
        await client.waitForAriaButton("More");
        await client.waitForText("Saved");
        if (!(await client.evaluate(`[...document.querySelectorAll('${fullSize} button')].some((b) => b.checkVisibility() && b.textContent.trim() === "Page")`))) throw new Error("Full size has no Page (back)");
        // The staged scene is on the canvas, from Studio, not a blank one.
        const data = await client.evaluate(`(async () => (await (await fetch("/api/v1/plugins/studio/rpc/drawings.getDrawing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(drawing.id)} }) })).json()).result.drawing.data)()`, true);
        if (JSON.parse(data).elements.filter((element) => !element.isDeleted).length !== 9) throw new Error("The staged drawing lost its elements");
        // Back (outside a workspace tab) returns to the page the whiteboard is in.
        const home = await pluginRpc("studio", "drawings.whiteboardPage", { id: drawing.id });
        if (home?.page?.id !== page.id || home.page.title !== "Checkout whiteboard") throw new Error(`The whiteboard's page is ${JSON.stringify(home)}`);
        await sleep(1500);
      } catch (error) {
        await close();
        await cleanup();
        throw error;
      }
      return async () => {
        await close();
        await cleanup();
      };
    },
  },
];

// Whiteboards are drawings that live in pages (packages/bb-studio README,
// "Whiteboards"): the page's whiteboard, opened in the full editor as a
// Studio tab.
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
        // The page shows the whiteboard; Open drawing opens the full editor.
        await client.navigate(`/plugins/studio/studio/pages/${page.id}`);
        await client.waitForSelector(`[data-whiteboard="${drawing.id}"] svg`, 30000);
        await client.clickButtonText("Open drawing");
        await client.waitForSelector(editor, 30000);
        // In a workspace tab the name is the tab's title, and the drawing's tools sit in the tab row.
        await client.waitForText("Checkout flow");
        await client.waitForAriaButton("Copy image");
        await client.waitForAriaButton("More");
        await client.waitForText("Saved");
        await client.waitForSelector("canvas.excalidraw__canvas");
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

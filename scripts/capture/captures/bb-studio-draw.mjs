// Drawings are built into Studio (docs/merging-add-ons.md): the editor as a
// Studio tab.
export default ({ seedDrawing, pluginRpc, sleep }) => [
  {
    id: "excalidraw",
    packageDir: "bb-studio",
    fileName: "drawings-preview.png",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup } = await seedDrawing();
      const close = () => pluginRpc("studio", "closeTabs", { items: [{ pluginId: "excalidraw", id: drawing.id }] }).catch(() => {});
      try {
        // The old Draw address still opens the drawing, as a Studio tab.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector(`[data-studio-workspace-editor="/plugins/studio/studio/drawings/${drawing.id}"]`, 30000);
        const path = await client.evaluate("location.pathname");
        if (path !== "/plugins/studio/studio") throw new Error(`The old drawing address didn't open in Studio's workspace: ${path}`);
        // In a workspace tab the name is the tab's title, and the drawing's tools sit in the tab row.
        await client.waitForText("Checkout flow");
        await client.waitForAriaButton("Copy image");
        await client.waitForAriaButton("More");
        await client.waitForText("Saved");
        await client.waitForSelector("canvas.excalidraw__canvas");
        // The staged scene is on the canvas, from Studio, not a blank one.
        const data = await client.evaluate(`(async () => (await (await fetch("/api/v1/plugins/studio/rpc/drawings.getDrawing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(drawing.id)} }) })).json()).result.drawing.data)()`, true);
        if (JSON.parse(data).elements.filter((element) => !element.isDeleted).length !== 9) throw new Error("The staged drawing lost its elements");
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

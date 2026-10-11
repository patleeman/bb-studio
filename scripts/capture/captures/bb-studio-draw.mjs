// Drawings are built into Studio (docs/merging-add-ons.md): the editor is a
// Studio capture, and the old Draw plugin's README shows its last release,
// the upgrade bridge, where users meet it: Studio's Setup page.
export default ({ seedDrawing, pluginRpc, bbCli, sleep }) => [
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
  {
    id: "draw-bridge",
    packageDir: "bb-studio-draw",
    setup: async (client) => {
      const migrated = await bbCli(["excalidraw", "migrate"]);
      if (!migrated.includes("Migration complete")) throw new Error(`bb excalidraw migrate didn't finish: ${migrated}`);
      await client.navigate("/plugins/studio/studio/setup");
      await client.waitForText("Set up BB Studio", 30000);
      await client.waitForText("Retired plugins");
      await client.waitForText("Drawings are built into Studio now");
      await client.waitForText("bb excalidraw migrate");
      // Copied: nothing blocks removal.
      const blocked = await client.evaluate(`[...document.querySelectorAll("p")].some((p) => p.textContent.startsWith("Not yet:") && p.closest("li,div")?.textContent.includes("Studio Draw"))`);
      if (blocked) throw new Error("Setup still blocks removing Studio Draw after Migration complete");
      // Studio Artifacts' bridge may be listed first; show Studio Draw's entry.
      await client.evaluate(`[...document.querySelectorAll("p")].find((p) => p.textContent.startsWith("Drawings are built into Studio now"))?.closest("li,section,div")?.scrollIntoView({ block: "start" })`);
      await sleep(400);
    },
  },
];

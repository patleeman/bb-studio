export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "excalidraw",
    packageDir: "bb-studio-draw",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup } = await seedDrawing();
      try {
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForInputValue("Drawing name", "Checkout flow");
        await client.waitForAriaButton("Copy image");
        await client.waitForAriaButton("More");
        // Studio Chat's chip for the drawing's thread; the seeded drawing has none yet.
        await client.waitForSelector(`button[title^="Pick the thread this item's chat"], button[title^="Quotes and chat go to"]`);
        await client.waitForText("Saved");
        await client.waitForSelector("canvas.excalidraw__canvas");
        // The staged scene is on the canvas, not a blank one.
        const count = await client.evaluate(`(async () => (await (await fetch("/api/v1/plugins/excalidraw/rpc/getDrawing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ${JSON.stringify(drawing.id)} }) })).json()).result.drawing.data)()`, true);
        if (JSON.parse(count).elements.filter((element) => !element.isDeleted).length !== 9) throw new Error("The staged drawing lost its elements");
        await sleep(1500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];

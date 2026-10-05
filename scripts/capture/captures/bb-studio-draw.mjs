export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchSpace, getLaunchSpaceId, sleep }) => [
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
        await client.waitForSelector(`[data-studio-chat-item="excalidraw:${drawing.id}"] > button[title="Start a conversation about this item"]`);
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

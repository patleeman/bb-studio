export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "studio-chat",
    packageDir: "bb-studio-chat",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup } = await seedDrawing();
      const forget = async () => {
        await client.evaluate(`sessionStorage.removeItem("bb-studio-float:windows")`).catch(() => {});
        await cleanup();
      };
      try {
        // Over a Studio item, New in Float and Open in Float sit in Float's corner.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.evaluate(`sessionStorage.removeItem("bb-studio-float:windows")`);
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await client.waitForSelector(".float-corner .studio-chat-bar");
        const bar = await client.evaluate(`document.querySelector(".float-corner .studio-chat-bar").innerText`);
        if (!bar.includes("New in Float") || !bar.includes("Open in Float")) throw new Error(`The corner offers "${bar}"`);
        // Open in Float lists recent threads; picking the seeded one opens it as a Float tab.
        const title = await client.evaluate(
          `(async () => { const body = await (await fetch("/api/v1/threads/${threadId}")).json(); const thread = body.thread ?? body; return thread.title ?? thread.titleFallback ?? ""; })()`,
          true,
        );
        if (!title) throw new Error("The seeded thread has no title to check the Float tab against");
        await client.clickElementWithTextAndPointer(".studio-chat-bar button", "Open in Float");
        await client.waitForSelector(`.studio-chat-picker [data-thread-id="${threadId}"]`);
        // A press and release without moving is a click.
        await client.dragBy(`.studio-chat-picker [data-thread-id="${threadId}"]`, 0, 0);
        // Studio Chat names the drawing on screen in the thread's tab.
        await client.waitForSelector(`[data-float-window="thread:${threadId}"] .studio-chat-viewing`);
        await client.waitForText("Viewing: Checkout flow");
        const tab = await client.evaluate(`document.querySelector('[data-float-tab="thread:${threadId}"][aria-selected="true"] .float-tab-title')?.innerText ?? ""`);
        if (!tab.includes(title)) throw new Error(`The showing Float tab is "${tab}", not the seeded thread "${title}"`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await sleep(1500);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  }
];

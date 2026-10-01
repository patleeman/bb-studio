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
        // Over a Studio item, the chat is a bar named for its kind, in Float's row.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.evaluate(`sessionStorage.removeItem("bb-studio-float:windows")`);
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await client.waitForSelector(".float-corner .studio-chat-bar");
        await client.waitForText("Work with this drawing…");
        // The seeded thread's sidebar menu floats it into a Float window.
        const title = await client.evaluate(
          `(async () => { const body = await (await fetch("/api/v1/threads/${threadId}")).json(); const thread = body.thread ?? body; return thread.title ?? thread.titleFallback ?? ""; })()`,
          true,
        );
        if (!title) throw new Error("The seeded thread has no title to check the window header against");
        await client.openThreadContextMenu();
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
        // Studio Chat names the drawing on screen in the thread's window.
        const window = `[data-float-window="thread:${threadId}"]`;
        await client.waitForSelector(`${window} .studio-chat-viewing`);
        await client.waitForText("Viewing: Checkout flow");
        const header = await client.evaluate(`document.querySelector('${window} .float-title')?.innerText ?? ""`);
        if (!header.includes(title)) throw new Error(`The Float window shows "${header}", not the seeded thread "${title}"`);
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

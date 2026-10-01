export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "studio-chat",
    packageDir: "bb-studio-chat",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup } = await seedDrawing();
      const forget = async () => {
        await client.evaluate(`sessionStorage.removeItem("bb-studio-chat:state")`).catch(() => {});
        await cleanup();
      };
      try {
        // Over a Studio item, the closed chat is a bar named for its kind.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.evaluate(`sessionStorage.removeItem("bb-studio-chat:state")`);
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await client.waitForText("Work with this drawing…");
        // The seeded thread's sidebar menu floats it into the chat.
        const title = await client.evaluate(
          `(async () => { const body = await (await fetch("/api/v1/threads/${threadId}")).json(); const thread = body.thread ?? body; return thread.title ?? thread.titleFallback ?? ""; })()`,
          true,
        );
        if (!title) throw new Error("The seeded thread has no title to check the chat header against");
        await client.navigate(`/threads/${threadId}`);
        await client.openThreadContextMenu();
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float in Studio Chat");
        // The card steps aside on the thread's own view and returns over the drawing.
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector('section[aria-label="Studio chat"]');
        await client.waitForText("Viewing: Checkout flow");
        const header = await client.evaluate(`document.querySelector('section[aria-label="Studio chat"] .studio-chat-title')?.innerText ?? ""`);
        if (!header.includes(title)) throw new Error(`The floating chat shows "${header}", not the seeded thread "${title}"`);
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

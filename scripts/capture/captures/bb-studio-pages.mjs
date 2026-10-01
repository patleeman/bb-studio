export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "pages",
    packageDir: "bb-studio-pages",
    privateSidebar: true,
    setup: async (client) => {
      const { page, cleanup } = await seedPages();
      try {
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForSelector('nav[aria-label="Breadcrumbs"]');
        await client.waitForAriaButton("Comments");
        await client.waitForAriaButton("Page actions");
        await client.waitForText("Work with this page…");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Beta teams");
        await client.waitForText("Crash-free sessions");
        await client.waitForText("Weekly active teams");
        await client.waitForText("Localise onboarding for Japanese and German");
        await client.waitForSelector(".recharts-bar-rectangle");
        // Talk is installed in the staged app, so the page offers dictation.
        await client.waitForSelector('[data-talk-field^="pages:"]');
        await client.waitForAriaButton("Dictate");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "pages-collection",
    packageDir: "bb-studio-pages",
    fileName: "collection.png",
    privateSidebar: true,
    setup: async (client) => {
      const { cleanup } = await seedPages();
      try {
        // With Studio installed, Pages' collection hands over to Studio,
        // filtered to pages. Shows the list view across every project.
        await client.navigate("/plugins/pages/pages");
        await client.evaluate(`localStorage.setItem("studio:collection:view", "list"); localStorage.setItem("studio:query:all", "")`);
        await client.navigate("/plugins/studio/studio/page");
        await client.waitForSelector('input[aria-label="Search and filter studio"]');
        await client.waitForSelector('button[aria-label="Remove Kind Pages"]');
        await client.waitForSelector('[role="grid"]');
        await client.waitForText("New page");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Rollout risks");
        await client.waitForText("Release notes: October");
        await sleep(800);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];

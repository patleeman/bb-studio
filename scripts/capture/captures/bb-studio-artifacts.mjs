export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "artifacts",
    packageDir: "bb-studio-artifacts",
    privateSidebar: true,
    setup: async (client) => {
      const { artifactId, cleanup } = await seedArtifact();
      try {
        await client.navigate(`/plugins/artifacts/artifacts/${artifactId}`);
        await client.waitForInputValue("Artifact title", "Q3 usage report");
        await client.waitForText("HTML ·");
        await client.waitForText("· v2");
        await client.waitForText("Preview");
        await client.waitForText("Source");
        await client.waitForText("New thread");
        await client.waitForAriaButton("Copy");
        await client.waitForAriaButton("More");
        // The report renders in its sandboxed frame from the content route.
        await client.waitForSelector('iframe[sandbox="allow-scripts"][title="q3-usage-report.html"]');
        const rendered = await client.evaluate(`(async () => {
          const frame = document.querySelector('iframe[title="q3-usage-report.html"]');
          const body = await (await fetch(frame.src)).text();
          return body.includes("Q3 usage report") && body.includes("September");
        })()`, true);
        if (!rendered) throw new Error("The viewer isn't showing the report's latest version");
        await sleep(1500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];

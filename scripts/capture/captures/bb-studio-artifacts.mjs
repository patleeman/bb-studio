// Artifacts are built into Studio (docs/merging-add-ons.md): the viewer is a
// Studio capture, and the old Artifacts plugin's README shows its last
// release, the upgrade bridge, where users meet it: Studio's Setup page.
export default ({ seedArtifact, pluginRpc, bbCli, sleep }) => [
  {
    id: "studio-artifacts",
    packageDir: "bb-studio",
    fileName: "artifacts-preview.png",
    privateSidebar: true,
    setup: async (client) => {
      const { artifactId, cleanup } = await seedArtifact();
      try {
        // The old add-on address still opens the artifact, as a Studio tab.
        await client.navigate(`/plugins/artifacts/artifacts/${artifactId}`);
        await client.waitForSelector(`[data-studio-workspace-editor="/plugins/studio/studio/artifacts/${artifactId}"]`, 30000);
        const path = await client.evaluate("location.pathname");
        if (path !== "/plugins/studio/studio") throw new Error(`The old artifact address didn't open in Studio's workspace: ${path}`);
        // In a workspace tab the title is the tab's, and the viewer's tools sit in the tab row.
        await client.waitForText("Q3 usage report");
        await client.waitForText("HTML ·", 30000);
        await client.waitForText("· v2");
        await client.waitForAriaButton("Show source");
        await client.waitForAriaButton("Copy");
        await client.waitForAriaButton("More");
        // The report renders in its sandboxed frame from Studio's content route.
        await client.waitForSelector('iframe[sandbox="allow-scripts"][title="q3-usage-report.html"]');
        const rendered = await client.evaluate(`(async () => {
          const frame = document.querySelector('iframe[title="q3-usage-report.html"]');
          if (!new URL(frame.src, location.href).pathname.startsWith("/api/v1/plugins/studio/http/artifacts/content")) return false;
          const body = await (await fetch(frame.src)).text();
          return body.includes("Q3 usage report") && body.includes("September");
        })()`, true);
        if (!rendered) throw new Error("The viewer isn't showing the report's latest version from Studio");
        await sleep(1500);
      } catch (error) {
        await pluginRpc("studio", "closeTabs", { items: [{ pluginId: "artifacts", id: artifactId }] }).catch(() => {});
        await cleanup();
        throw error;
      }
      return async () => {
        await pluginRpc("studio", "closeTabs", { items: [{ pluginId: "artifacts", id: artifactId }] }).catch(() => {});
        await cleanup();
      };
    },
  },
  {
    id: "artifacts-bridge",
    packageDir: "bb-studio-artifacts",
    setup: async (client) => {
      const migrated = await bbCli(["artifacts", "migrate"]);
      if (!migrated.includes("Migration complete")) throw new Error(`bb artifacts migrate didn't finish: ${migrated}`);
      await client.navigate("/plugins/studio/studio/setup");
      await client.waitForText("Set up BB Studio", 30000);
      await client.waitForText("Retired plugins");
      await client.waitForText("Artifacts are built into Studio now");
      await client.waitForText("bb artifacts migrate");
      // Copied: nothing blocks removal.
      const blocked = await client.evaluate(`[...document.querySelectorAll("p")].some((p) => p.textContent.startsWith("Not yet:") && p.closest("li,div")?.textContent.includes("Studio Artifacts"))`);
      if (blocked) throw new Error("Setup still blocks removing Studio Artifacts after Migration complete");
      await client.evaluate(`[...document.querySelectorAll("h2")].find((h) => h.textContent.startsWith("Retired plugins"))?.scrollIntoView({ block: "start" })`);
      await sleep(400);
    },
  },
];

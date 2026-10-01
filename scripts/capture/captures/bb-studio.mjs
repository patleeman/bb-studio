export default ({ projectId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, sleep }) => [
  {
    id: "studio-home",
    packageDir: "bb-studio",
    fileName: "home.png",
    privateSidebar: true,
    setup: async (client) => {
      const ids = [];
      const cleanup = async () => { for (const id of ids) await pluginRpc("studio-tasks", "delete", { id }).catch(() => {}); };
      try {
        const today = new Date();
        const due = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
        for (const input of [
          { title: "QA Review launch copy", status: "review", assignee: "me" },
          { title: "QA Ship onboarding guide", status: "todo", assignee: "me", due },
        ]) {
          const { task } = await pluginRpc("studio-tasks", "create", { ...input, projectId });
          ids.push(task.id);
        }
        await pluginRpc("studio", "recordActivity", { ref: { pluginId: "studio-tasks", id: ids[0] }, actor: { kind: "user" }, verb: "updated", at: Date.now(), summary: "QA Review launch copy is ready" });
        await client.navigate("/plugins/studio/studio");
        for (const label of ["Needs you", "Due today and overdue", "In review", "Recent items", "Activity", "QA Ship onboarding guide", "QA Review launch copy"]) await client.waitForText(label);
        const needs = await client.evaluate(`(() => { const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent === "Needs you"); return heading?.closest("section")?.innerText ?? ""; })()`);
        if (!needs.includes("QA Ship onboarding guide") || !needs.includes("QA Review launch copy")) throw new Error("Home did not derive the staged task requests");
        await sleep(600);
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
    },
  },
  {
    id: "studio",
    packageDir: "bb-studio",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const drawing = await seedDrawing();
      let recordingId = null;
      const cleanup = async () => {
        await pages.cleanup();
        await drawing.cleanup();
        if (recordingId) await talkRpc("recording_delete", { id: recordingId }).catch(() => {});
      };
      try {
        // Studio only lists the recording, so it needn't be transcribed.
        recordingId = await seedTalkRecording(projectId, { transcribe: false });
        await client.navigate("/plugins/studio/studio/collection");
        await client.evaluate(`localStorage.setItem("studio:collection:view", "grid"); localStorage.setItem("studio:collection:project", ${JSON.stringify(projectId)}); localStorage.setItem("studio:sidebar-tip-dismissed", "1")`);
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForSelector('input[aria-label="Search studio"]');
        await client.waitForText("Pages");
        await client.waitForText("Recordings");
        await client.waitForText("Drawings");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Weekly product sync");
        await client.waitForText("Checkout flow");
        // The drawing's card shows its server-rendered thumbnail.
        await client.waitForSelector('img[src*="/plugins/excalidraw/http/thumbnail"]');
        const loaded = await client.evaluate(`(async () => { const img = document.querySelector('img[src*="/plugins/excalidraw/http/thumbnail"]'); await img.decode(); return img.naturalWidth > 0; })()`, true);
        if (!loaded) throw new Error("The drawing thumbnail didn't load");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "studio-search",
    packageDir: "bb-studio",
    fileName: "search.png",
    privateSidebar: true,
    setup: async (client) => {
      const pages = await seedPages();
      const artifact = await seedArtifact().catch(async (error) => {
        await pages.cleanup();
        throw error;
      });
      const taskIds = [];
      const cleanup = async () => {
        await pages.cleanup();
        await artifact.cleanup();
        for (const id of taskIds) await pluginRpc("studio-tasks", "delete", { id }).catch(() => {});
      };
      try {
        for (const task of [
          { title: "Write the launch post", status: "todo", assignee: "me", description: "Announce offline sync and the new team plans." },
          { title: "Add offline sync to settings", status: "review", assignee: "agent" },
        ]) {
          const { task: created } = await pluginRpc("studio-tasks", "create", { ...task, projectId });
          taskIds.push(created.id);
        }
        // Artifacts search their saved text through Studio's index.
        await bbCli(["studio", "reindex"]);
        const found = await pluginRpc("studio", "searchAll", { query: "weekly active teams", limit: 40 });
        const key = `artifacts:${artifact.artifactId}`;
        if (!found.some((hit) => `${hit.ref.pluginId}:${hit.ref.id}` === key && /weekly active teams/i.test(hit.snippet.text))) {
          throw new Error(`Studio search didn't find the artifact with a snippet: ${JSON.stringify(found)}`);
        }
        await client.navigate("/plugins/studio/studio/collection");
        await client.waitForSelector('input[aria-label="Search studio"]');
        // Open Studio search with its real shortcut, Mod+K.
        const modifiers = process.platform === "darwin" ? 4 : 2;
        // rawKeyDown: a shortcut with no text, as a real keyboard sends it.
        for (const type of ["rawKeyDown", "keyUp"]) {
          await client.command("Input.dispatchKeyEvent", { type, modifiers, key: "K", code: "KeyK", windowsVirtualKeyCode: 75 });
        }
        await client.waitForSelector('.studio-quick-open [role="dialog"][aria-label="Search Studio"]');
        await client.waitForText("Recently changed");
        await client.waitForText("Hand to agent");
        await client.command("Input.insertText", { text: "offline sync" });
        // The task's title matches; the page and the other task match on content.
        await client.waitForText("Add offline sync to settings");
        await client.waitForText("Announce offline sync and the new team plans.");
        await client.waitForText("Offline sync for every team");
        await client.waitForText("Ship offline sync to beta teams");
        const snippets = await client.evaluate(`document.querySelectorAll(".studio-quick-open-snippet mark").length`);
        if (snippets < 3) throw new Error(`Expected highlighted snippets, found ${snippets}`);
        await sleep(600);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];

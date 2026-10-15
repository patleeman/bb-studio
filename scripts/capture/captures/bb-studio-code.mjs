// Studio Code: the thread's VS Code beside a conversation, open to the
// thread's own folder. The editor is a cross-origin
// frame, so its contents are read through an isolated world in that frame,
// not from BB's page; what the editor shows is checked through the bridge
// (editorState), which reports what VS Code itself has on screen.

/** Runs `expression` inside the VS Code frame; null until the frame exists. */
async function inEditor(client, expression) {
  const { frameTree } = await client.command("Page.getFrameTree");
  const frames = [];
  const walk = (node) => { for (const child of node.childFrames ?? []) { frames.push(child.frame); walk(child); } };
  walk(frameTree);
  const frame = frames.find((each) => each.url.includes("workspace="));
  if (!frame) return null;
  const { executionContextId } = await client.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "studio-code-capture" });
  const result = await client.command("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true });
  return result.result?.value ?? null;
}

async function waitFor(sleep, what, check, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check().catch(() => false)) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const explorer = `[...document.querySelectorAll(".explorer-folders-view .label-name")].map((label) => label.textContent)`;

/** Waits for VS Code to show the project and the bridge to connect, then reveals lines and checks the editor has them. */
async function revealIn(client, pluginRpc, sleep, id, startLine, endLine) {
  await waitFor(sleep, "VS Code showing the project", async () => {
    const names = await inEditor(client, explorer);
    return Array.isArray(names) && names.includes("README.md") && names.includes("src");
  }, 300000);
  await waitFor(sleep, "the bridge to connect", async () => (await pluginRpc("studio-code", "editorState", { id })).state !== null);
  const { shown } = await pluginRpc("studio-code", "reveal", { id, path: "src/retry.ts", startLine, endLine });
  if (!shown) throw new Error("reveal found no editor");
  await waitFor(sleep, `retry.ts lines ${startLine}–${endLine} selected`, async () => {
    const { state } = await pluginRpc("studio-code", "editorState", { id });
    return state?.activeFile?.path.endsWith("src/retry.ts") && state.activeFile.selection.startLine === startLine && state.activeFile.selection.endLine === endLine;
  });
  await sleep(1200);
}

export default ({ projectId, pluginRpc, sleep }) => [
  {
    id: "studio-code", packageDir: "bb-studio-code", privateSidebar: true,
    setup: async (client) => {
      // The thread that ran in the Orbit checkout, so it has a folder for VS Code.
      const workspaceThreadId = process.env.BB_CAPTURE_WORKSPACE_THREAD_ID;
      if (!workspaceThreadId) throw new Error("Set BB_CAPTURE_WORKSPACE_THREAD_ID (staged-bb.mjs seeds it) to capture VS Code beside a thread.");
      let id = null;
      const cleanup = async () => {
        if (!id) return;
        await pluginRpc("studio-code", "stop", { id }).catch(() => {});
      };
      try {
        await client.navigate(`/projects/${projectId}/threads/${workspaceThreadId}`);
        await sleep(1500);
        // The thread's right panel, then VS Code from its new-tab menu.
        await client.evaluate(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Show right panel"))?.click()`);
        await sleep(800);
        await client.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Open new tab")); if (!button) throw new Error("No new-tab button"); button.click(); })()`);
        await sleep(800);
        await client.clickButtonText("VS Code");
        // The tab opens the thread's own folder, its VS Code made on first open.
        await waitFor(sleep, "the thread's worktree workspace", async () => {
          const { workspace } = await pluginRpc("studio-code", "threadWorkspace", { threadId: workspaceThreadId });
          id = workspace?.id ?? null;
          return !!id;
        });
        await revealIn(client, pluginRpc, sleep, id, 13, 15);
        // Laid out for BB: VS Code's side bar on the right, no title bar.
        if (!(await inEditor(client, `document.querySelector(".part.sidebar")?.classList.contains("right")`))) throw new Error("VS Code's side bar isn't on the right");
        // The chat and the editor side by side.
        if (!(await client.hasText("Pick a database for the todo app"))) throw new Error("The thread isn't beside the editor");
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
    },
  },
];

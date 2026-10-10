// Studio Code: a workspace made the way Studio's New makes one, open in VS
// Code, and the same editor beside a thread. The editor is a cross-origin
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

/** A workspace for the seeded project: Studio's New, then its folder (the Orbit checkout). */
async function makeWorkspace(pluginRpc, projectId) {
  const { item } = await pluginRpc("studio-code", "studio_create", { kind: "code-workspace", projectId });
  if (item.facts[0]?.value !== "1") throw new Error("The workspace didn't start with its project's folder");
  return item;
}

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

export default ({ projectId, threadId, pluginRpc, sleep }) => [
  {
    id: "studio-code", packageDir: "bb-studio-code", privateSidebar: true,
    setup: async (client) => {
      const item = await makeWorkspace(pluginRpc, projectId);
      const cleanup = async () => {
        await pluginRpc("studio-code", "stop", { id: item.id }).catch(() => {});
        await pluginRpc("studio-code", "studio_delete", { ids: [item.id] }).catch(() => {});
      };
      try {
        await client.navigate(item.href);
        await client.waitForTab(item.title);
        await revealIn(client, pluginRpc, sleep, item.id, 8, 18);
        // Laid out for BB: VS Code's side bar on the right, no title bar.
        if (!(await inEditor(client, `document.querySelector(".part.sidebar")?.classList.contains("right")`))) throw new Error("VS Code's side bar isn't on the right");
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
    },
  },
  {
    id: "studio-code-thread", packageDir: "bb-studio-code", fileName: "staged-thread.png", privateSidebar: true,
    setup: async (client) => {
      const item = await makeWorkspace(pluginRpc, projectId);
      const cleanup = async () => {
        await pluginRpc("studio-code", "stop", { id: item.id }).catch(() => {});
        await pluginRpc("studio-code", "studio_delete", { ids: [item.id] }).catch(() => {});
      };
      try {
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await sleep(1500);
        // The thread's right panel, then VS Code from its new-tab menu.
        await client.evaluate(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Show right panel"))?.click()`);
        await sleep(800);
        await client.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Open new tab")); if (!button) throw new Error("No new-tab button"); button.click(); })()`);
        await sleep(800);
        await client.clickButtonText("VS Code");
        // The seeded thread hasn't run, so it has no worktree yet: the tab lists
        // workspaces instead, and the one for its project is there.
        await waitFor(sleep, "the workspace in the VS Code tab", () => client.evaluate(`[...document.querySelectorAll("button")].some((button) => button.innerText.includes(${JSON.stringify(item.title)}))`));
        await client.evaluate(`[...document.querySelectorAll("button")].find((button) => button.innerText.includes(${JSON.stringify(item.title)}))?.click()`);
        await revealIn(client, pluginRpc, sleep, item.id, 13, 15);
        // The chat and the editor side by side.
        if (!(await client.hasText("Draft the ORBIT-42 release notes"))) throw new Error("The thread isn't beside the editor");
      } catch (error) { await cleanup(); throw error; }
      return cleanup;
    },
  },
];

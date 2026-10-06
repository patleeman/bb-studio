// Studio Code: a workspace made the way Studio's New makes one, open in VS
// Code. The editor is a cross-origin frame, so its Explorer is read through
// an isolated world in that frame, not from BB's page.
/** Runs `expression` inside the VS Code frame; null until the frame exists. */
async function inEditor(client, expression) {
  const { frameTree } = await client.command("Page.getFrameTree");
  const frame = (frameTree.childFrames ?? []).map((child) => child.frame).find((each) => each.url.includes("workspace="));
  if (!frame) return null;
  const { executionContextId } = await client.command("Page.createIsolatedWorld", { frameId: frame.id, worldName: "studio-code-capture" });
  const result = await client.command("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true });
  return result.result?.value ?? null;
}

async function waitInEditor(client, sleep, what, expression, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await inEditor(client, expression).catch(() => null)) return;
    await sleep(1000);
  }
  throw new Error(`VS Code never showed ${what}`);
}

const explorer = `[...document.querySelectorAll(".explorer-folders-view .label-name")].map((label) => label.textContent)`;

export default ({ projectId, pluginRpc, sleep }) => [{
  id: "studio-code", packageDir: "bb-studio-code", privateSidebar: true,
  setup: async (client) => {
    // Studio's New calls studio_create with the project; the workspace opens its folder.
    const { item } = await pluginRpc("studio-code", "studio_create", { kind: "code-workspace", projectId });
    const cleanup = async () => {
      await pluginRpc("studio-code", "stop", { id: item.id }).catch(() => {});
      await pluginRpc("studio-code", "studio_delete", { ids: [item.id] }).catch(() => {});
    };
    try {
      if (item.facts[0]?.value !== "1") throw new Error("The workspace didn't start with its project's folder");
      await client.navigate(item.href);
      await client.waitForInputValue("Workspace name", item.title);
      // The first open downloads code-server, so allow for it.
      await waitInEditor(client, sleep, "the project's files", `${explorer}.includes("README.md") && ${explorer}.includes("src")`, 300000);
      await inEditor(client, `[...document.querySelectorAll(".explorer-folders-view .label-name")].find((label) => label.textContent === "src")?.click()`);
      await waitInEditor(client, sleep, "src/retry.ts", `${explorer}.includes("retry.ts")`);
      await inEditor(client, `[...document.querySelectorAll(".explorer-folders-view .label-name")].find((label) => label.textContent === "retry.ts")?.click()`);
      await waitInEditor(client, sleep, "retry.ts open", `document.title.startsWith("retry.ts") && document.querySelector(".view-lines")?.textContent.includes("uploadWithRetry")`);
      await sleep(1500);
    } catch (error) { await cleanup(); throw error; }
    return cleanup;
  },
}];

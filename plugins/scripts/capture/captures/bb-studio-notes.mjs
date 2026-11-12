// Notes, in Pages: the composer's Expand to page, the note open beside its
// thread, and the note's done actions. Writes notes-expand.png and
// notes-beside-thread.png on the way, and notes-done-actions.png last.

const NOTES = [
  "Weekly launch sync, Ana, Bo, Chen",
  "Decisions",
  "- Ship ORBIT-42 on Friday after the CI run",
  "- Move the standup to 10:30",
  "Follow-ups",
  "- Bo checks the crash-free rate for the beta teams",
  "- Chen drafts the release notes",
];

const pointAt = (client, selector) => client.evaluate(`(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) throw new Error("Not found: ${selector}");
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`);

async function hover(client, selector) {
  const { x, y } = await pointAt(client, selector);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
}

async function click(client, selector) {
  const { x, y } = await pointAt(client, selector);
  await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await client.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

const composerText = (client) => client.evaluate(`document.querySelector('[data-promptbox] [contenteditable="true"]')?.innerText ?? null`);

async function typeNotes(client) {
  await client.evaluate(`document.querySelector('[data-promptbox] [contenteditable="true"]').focus()`);
  for (const [index, line] of NOTES.entries()) {
    if (index) {
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 8 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 8 });
    }
    await client.command("Input.insertText", { text: line });
  }
}

/** Collapses BB's sidebar so the shots show no other threads; returns how to put it back. */
async function hideSidebar(client, sleep) {
  const collapsed = await client.evaluate(`(() => {
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    if (['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'))) return false;
    if (!sidebar?.checkVisibility() || sidebar.getBoundingClientRect().right <= 0) return false;
    const button = document.querySelector('button[aria-label^="Toggle sidebar" i]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (collapsed) await sleep(400);
  return async () => {
    if (collapsed) await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar" i]')?.click()`).catch(() => {});
  };
}

export default ({ projectId, bbCli, pluginRpc, sleep }) => [
  {
    id: "pages-notes",
    packageDir: "bb-studio",
    fileName: "notes-done-actions.png",
    privateSidebar: true,
    setup: async (client) => {
      let threadId = null;
      let pageId = null;
      let showSidebar = async () => {};
      const cleanup = async () => {
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
        if (pageId) await pluginRpc("studio", "notes.discard", { pageId }).catch(() => pluginRpc("studio", "pages.remove", { id: pageId }).catch(() => {}));
        await showSidebar();
        if (threadId) {
          await bbCli(["thread", "stop", threadId]).catch(() => {});
          await bbCli(["thread", "delete", threadId, "--yes"]).catch(() => {});
        }
      };
      try {
        const thread = JSON.parse(await bbCli([
          "thread", "spawn", "--project", projectId, "--provider", "codex",
          "--model", "gpt-6.1-sol", "--reasoning-level", "low", "--title", "Weekly launch sync",
          "--prompt", "I'll take notes in our weekly launch sync and send them here. Reply only: Ready when you are. Do not use tools.", "--json",
        ]));
        threadId = thread.id;
        await bbCli(["thread", "wait", threadId, "--timeout", "90s", "--json"]);
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForSelector('[data-promptbox] [contenteditable="true"]', 30000);
        await client.waitForText("Ready when you are", 30000);
        showSidebar = await hideSidebar(client, sleep);

        // 1. The draft, and Expand to page among the composer's actions.
        await client.waitForSelector('[data-promptbox] button[data-notes-expand][aria-label="Expand to page"]');
        await typeNotes(client);
        const draft = await composerText(client);
        for (const line of NOTES) if (!draft?.includes(line.replace(/^- /, ""))) throw new Error(`The draft is missing "${line}": ${draft}`);
        await hover(client, "[data-notes-expand]");
        await client.waitForText("Expand to page");
        await sleep(500);
        await client.capture("packages/bb-studio/assets/notes-expand.png");

        // 2. Expanded: the note beside the thread, the composer empty, the chip above it.
        await click(client, "[data-notes-expand]");
        await client.waitForSelector(".pages-panel-tab [data-note-actions]", 20000);
        const { note } = await pluginRpc("studio", "notes.forThread", { threadId });
        if (!note) throw new Error("Expand to page made no note for the thread");
        pageId = note.pageId;
        if (!/^Notes · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M · Weekly launch sync$/.test(note.title)) throw new Error(`Unexpected note title: ${note.title}`);
        const { markdown } = await pluginRpc("studio", "pages.markdown", { id: pageId });
        if (!markdown.includes("- Ship ORBIT-42 on Friday after the CI run\n- Move the standup to 10:30")) throw new Error(`The note lost the draft's lines: ${markdown}`);
        await client.waitForSelector(".pages-panel-tab .bn-editor", 20000);
        await client.waitForText("Chen drafts the release notes");
        if ((await composerText(client))?.trim()) throw new Error("The composer kept the draft after it moved into the note");
        await client.waitForSelector("[data-notes-in-progress]");
        await client.waitForText("Notes in progress");
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, buttons: 0 });
        await sleep(4500); // Let the panel settle and any toast leave.
        await client.capture("packages/bb-studio/assets/notes-beside-thread.png");

        // Recovery: reopened, the thread shows the chip, and it reopens the note.
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForSelector("[data-notes-in-progress] button", 30000);
        await click(client, "[data-notes-in-progress] button");
        await client.waitForSelector(".pages-panel-tab [data-note-actions]", 20000);
        await client.waitForText("Chen drafts the release notes");

        // 3. The done actions, with Send's two ways open.
        await client.waitForAriaButton("Send to thread");
        await client.waitForAriaButton("Keep as page");
        await client.waitForAriaButton("Discard");
        await client.clickAriaButtonWithPointer("How to send");
        await client.waitForText("Send the notes as the message (default)");
        await client.waitForText("Send a link and ask for a summary");
        await sleep(600);
      } catch (error) {
        await client.capture(`${process.env.TMPDIR ?? "/tmp/"}pages-notes-capture-error.png`).catch(() => {});
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
];

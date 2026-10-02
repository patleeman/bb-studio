export default ({ projectId, seedPages, pluginRpc, bbCli, sleep }) => ({
  id: "pages-standalone-chat",
  packageDir: "bb-studio-pages",
  fileName: "standalone-chat.png",
  privateSidebar: true,
  setup: async (client) => {
    const { page, cleanup } = await seedPages();
    let threadId;
    let disabled = false;
    const forget = async () => {
      if (disabled) await bbCli(["plugin", "enable", "studio-chat", "--json"]);
      if (threadId) await bbCli(["thread", "delete", threadId, "--yes", "--json"]);
      await cleanup();
    };
    try {
      await bbCli(["plugin", "disable", "studio-chat", "--json"]);
      disabled = true;
      const result = await pluginRpc("pages", "work", {
        id: page.id,
        request: {
          projectId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", permissionMode: "full",
          executionInputSources: {}, environment: { type: "project-default" },
          input: [{ type: "text", text: "Review the offline launch checklist.", mentions: [] }],
          sendAt: Date.now() + 30 * 86400000,
        },
      });
      threadId = result.threadId;
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForText("Launch checklist");
      await client.waitForSelector('[data-studio-item-header] button[title="Continue this page\'s conversation"]');
      await client.clickElementWithTextAndPointer('[data-studio-item-header] button', "Chat");
      await client.waitForSelector(`[data-float-window="thread:${threadId}"] [data-promptbox]`);
      const chats = await pluginRpc("pages", "chats", { pageId: page.id });
      if (chats.chats.length !== 1 || chats.chats[0].threadId !== threadId) throw new Error("Continuing a legacy page conversation created a duplicate");
      if (await client.evaluate(`Boolean(document.querySelector('.pages-chat'))`)) throw new Error("Pages still renders its separate chat card");
      await client.clickAriaButtonWithPointer("Chat options");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "New conversation");
      const composer = '[role="dialog"] [data-promptbox] [contenteditable="true"]';
      await client.waitForSelector(composer);
      await client.dragBy(composer, 0, 0);
      await client.command("Input.insertText", { text: "Keep this page conversation draft." });
      await client.clickElementWithTextAndPointer('[role="dialog"] button', "Close");
      await client.clickAriaButtonWithPointer("Chat options");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "New conversation");
      await client.waitForSelector(composer);
      const draft = await client.evaluate(`document.querySelector(${JSON.stringify(composer)})?.textContent`);
      if (!draft.includes("Keep this page conversation draft.")) throw new Error(`Standalone page draft was lost: ${JSON.stringify(draft)}`);
      await sleep(500);
    } catch (error) {
      await forget();
      throw error;
    }
    return forget;
  },
});

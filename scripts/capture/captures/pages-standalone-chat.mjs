import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default ({ projectId, seedPages, pluginRpc, bbCli, sleep, mobile = false }) => ({
  id: mobile ? "pages-standalone-chat-mobile" : "pages-standalone-chat",
  packageDir: "bb-studio-pages",
  fileName: mobile ? "standalone-chat-mobile.png" : "standalone-chat.png",
  privateSidebar: !mobile,
  setup: async client => {
    const { page, notes, cleanup } = await seedPages();
    const directory = await mkdtemp(join(tmpdir(), "bb-pages-chat-capture-"));
    const attachment = join(directory, "release-review.txt");
    await writeFile(attachment, "Review the release window before publishing.\n");
    const threads = [];
    let disabled = false, sidebarToggle = null;
    const forget = async () => {
      if (disabled) await bbCli(["plugin", "enable", "studio", "--json"]);
      for (const id of threads) await bbCli(["thread", "delete", id, "--yes", "--json"]);
      await cleanup();
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows'); delete window.bbPageDraft").catch(() => {});
      await rm(directory, { recursive: true, force: true });
      if (mobile) {
        if (sidebarToggle) await client.evaluate(`document.querySelector('button[aria-label=${JSON.stringify(sidebarToggle)}]')?.click()`);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      }
    };
    const attach = async root => {
      const document = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: `${root} input[type=file]` });
      if (!input.nodeId) throw new Error("Pages has no native attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
      await client.waitForText("release-review.txt");
    };
    const newConversation = async () => {
      await client.clickAriaButtonWithPointer("Chat options");
      await client.clickElementWithTextAndPointer('[role=menuitem]', "New conversation");
    };
    const path = `/plugins/pages/pages/${page.id}/compose`, key = `path:${path}`;
    const root = `[data-float-window=${JSON.stringify(key)}]`, prompt = `${root} [data-promptbox] [contenteditable=true]`;
    const retained = async visible => {
      const state = await client.evaluate(`(() => { const draft = document.querySelector(${JSON.stringify(prompt)}); return {
        same: draft === window.bbPageDraft, visible: !!draft?.checkVisibility(), text: draft?.textContent,
        file: draft?.closest('[data-float-window]')?.textContent.includes('release-review.txt'),
        tabs: document.querySelectorAll(${JSON.stringify(`[data-float-tab=${JSON.stringify(key)}]`)}).length }; })()`);
      if (!state.same || state.visible !== visible || !state.text?.includes("Keep this page conversation draft.") || !state.file || state.tabs !== 1) throw new Error(`Pages lost its retained composer: ${JSON.stringify(state)}`);
    };
    try {
      await bbCli(["plugin", "disable", "studio", "--json"]); disabled = true;
      const { threadId } = await pluginRpc("pages", "work", { id: page.id, request: {
        projectId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", permissionMode: "full",
        executionInputSources: {}, environment: { type: "project-default" },
        input: [{ type: "text", text: "Review the offline launch checklist.", mentions: [] }], sendAt: Date.now() + 30 * 86400000,
      }}); threads.push(threadId);
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForText("Launch checklist");
      await client.waitForSelector(`[data-studio-tab="pages:${page.id}"] a[aria-current="page"]`);
      await client.navigate(`/plugins/pages/pages/${notes.id}`);
      await client.waitForText("Offline sync for every team");
      await client.waitForSelector(`[data-studio-tab="pages:${notes.id}"] a[aria-current="page"]`);
      await client.waitForSelector(`[data-studio-tab="pages:${page.id}"] a`);
      await client.dragBy(`[data-studio-tab="pages:${page.id}"] a`, 0, 0);
      await client.waitForText("Launch checklist");
      if (mobile) await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      if (mobile) {
        await sleep(500);
        sidebarToggle = await client.evaluate(`(() => {
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          if (['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'))) return null;
          if (!sidebar?.checkVisibility() || sidebar.getBoundingClientRect().right <= 0) return null;
          return [...document.querySelectorAll('button')].find(button => /^Toggle sidebar/i.test(button.getAttribute('aria-label') ?? '') && button.checkVisibility())?.getAttribute('aria-label') ?? null;
        })()`);
        if (sidebarToggle) await client.clickAriaButtonWithPointer(sidebarToggle);
      }
      await client.clickElementWithTextAndPointer('[data-studio-item-header] button', "Chat");
      await client.waitForSelector(`[data-float-window="thread:${threadId}"] [data-promptbox]`);
      const chats = await pluginRpc("pages", "chats", { pageId: page.id });
      if (chats.chats.length !== 1 || chats.chats[0].threadId !== threadId) throw new Error("Continuing a page conversation created a duplicate");
      if (await client.evaluate("!!document.querySelector('.pages-chat')")) throw new Error("Pages still renders its separate chat card");
      await newConversation(); await client.waitForSelector(prompt);
      await client.dragBy(prompt, 0, 0);
      await client.command("Input.insertText", { text: "Keep this page conversation draft." });
      await attach(root);
      await client.waitForText("release-review.txt");
      await client.evaluate(`(() => { window.bbPageDraft = document.querySelector(${JSON.stringify(prompt)}); return true; })()`);
      await retained(true);
      await newConversation(); await retained(true);
      await client.clickAriaButtonWithPointer("Fold floating tabs"); await retained(false);
      await newConversation(); await retained(true);
      if (!mobile) {
        await client.dragBy(`[data-studio-tab="pages:${notes.id}"] a`, 0, 0);
        await client.waitForText("Offline sync for every team");
        await retained(true);
        await newConversation();
        const notesKey = `path:/plugins/pages/pages/${notes.id}/compose`, notesRoot = `[data-float-window=${JSON.stringify(notesKey)}]`;
        const notesPrompt = `${notesRoot} [data-promptbox] [contenteditable=true]`;
        await client.waitForSelector(notesPrompt); await retained(false);
        await client.dragBy(notesPrompt, 0, 0);
        await client.command("Input.insertText", { text: "Schedule this release review." });
        await attach(notesRoot);
        await client.dragBy(`${notesRoot} button[aria-label="Send options"]`, 0, 0);
        await client.clickElementWithTextAndPointer('[role=menuitem]', "Send later…");
        await client.waitForText("Choose when this thread should start.");
        await client.clickElementWithTextAndPointer('[role=dialog] button', "Schedule send");
        let created;
        const deadline = Date.now() + 15000;
        while (!created) {
          created = (await pluginRpc("pages", "chats", { pageId: notes.id })).chats[0]?.threadId;
          if (Date.now() > deadline) throw new Error("The new page conversation was not linked");
          if (!created) await sleep(200);
        }
        threads.push(created);
        await client.waitForSelector(`[data-float-window="thread:${created}"] [data-promptbox]`);
        if (await client.evaluate(`!!document.querySelector('[data-float-tab=${JSON.stringify(notesKey)}]')`)) throw new Error("Scheduled send did not replace its originating tab");
        const queued = await bbCli(["thread", "queue", "list", created, "--json"]);
        if (!queued.includes(notes.id) || !queued.includes("Schedule this release review.") || !queued.includes("release-review.txt")) throw new Error("Pages lost its context, draft or attachment when scheduling");
        await client.clickElementWithTextAndPointer('[data-studio-item-header] button', "Chat");
        if (await client.evaluate(`document.querySelectorAll('[data-float-tab="thread:${created}"]').length`) !== 1) throw new Error("The header duplicated its new page conversation");
        await client.dragBy(`[data-float-tab=${JSON.stringify(key)}]`, 0, 0); await retained(true);
        await client.dragBy(`[data-studio-tab="pages:${page.id}"] a`, 0, 0); await retained(true);
      }
      await sleep(1500);
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForSelector(prompt); await client.waitForText("release-review.txt");
      await client.evaluate(`(() => { window.bbPageDraft = document.querySelector(${JSON.stringify(prompt)}); return true; })()`);
      await retained(true);
      const clipped = await client.evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(`${root} [data-studio-conversation] button`)})].filter(button => button.checkVisibility()).filter(button => {
        const rect = button.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight;
      }).map(button => button.getAttribute('aria-label') ?? button.innerText))()`);
      if (clipped.length) throw new Error(`Pages clips its composer controls: ${JSON.stringify(clipped)}`);
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate("JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-3000)})").catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

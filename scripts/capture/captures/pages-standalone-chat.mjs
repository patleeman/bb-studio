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
      await client.evaluate("delete window.bbPageDraft").catch(() => {});
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
    const path = `/plugins/pages/pages/${page.id}/compose`;
    const root = '[data-capture-root="page"]', prompt = `${root} [data-promptbox] [contenteditable=true]`;
    const draftText = "Keep this page conversation draft.";
    const waitForPath = async (expected, timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const current = await client.poll("decodeURIComponent(location.pathname)");
        if (current?.endsWith(expected)) return;
        await sleep(200);
      }
      throw new Error(`The main view did not open ${expected}`);
    };
    // The composer route opens in the main view; mark its live section so later checks find the same one.
    const markRoot = async name => {
      const deadline = Date.now() + 15000;
      while (!(await client.poll(`(() => {
        const section = [...document.querySelectorAll('section[data-studio-conversation]')].find(node => node.checkVisibility() && node.querySelector('[data-promptbox] [contenteditable=true]'));
        if (!section) return false; section.dataset.captureRoot = ${JSON.stringify(name)}; return true; })()`))) {
        if (Date.now() > deadline) throw new Error(`No visible ${name} composer in the main view`);
        await sleep(200);
      }
    };
    const retained = async visible => {
      const state = await client.evaluate(`(() => { const draft = document.querySelector(${JSON.stringify(prompt)}); return {
        same: draft === window.bbPageDraft, visible: !!draft?.checkVisibility(), text: draft?.textContent,
        file: !!draft?.closest('[data-studio-conversation]')?.textContent.includes('release-review.txt'),
        copies: [...document.querySelectorAll('section[data-studio-conversation] [data-promptbox] [contenteditable=true]')].filter(node => node.textContent.includes(${JSON.stringify(draftText)})).length }; })()`);
      if (!state.same || state.visible !== visible || !state.text?.includes(draftText) || !state.file || state.copies !== 1) throw new Error(`Pages lost its retained composer: ${JSON.stringify(state)}`);
    };
    // Studio is off here, so pages switch through the app's router, as a link click would, keeping retained views.
    const openPage = async id => {
      await client.evaluate(`(() => { history.pushState({ usr: null, key: "capture", idx: (history.state?.idx ?? 0) + 1 }, "", ${JSON.stringify(`/plugins/pages/pages/${id}`)}); dispatchEvent(new PopStateEvent("popstate", { state: history.state })); return true; })()`);
    };
    const backToPage = async () => {
      await client.evaluate("history.back()");
      await client.waitForText("Launch checklist");
      await client.waitForSelector('[data-studio-item-header]');
    };
    try {
      await bbCli(["plugin", "disable", "studio", "--json"]); disabled = true;
      const { threadId } = await pluginRpc("pages", "work", { id: page.id, request: {
        projectId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", permissionMode: "full",
        executionInputSources: {}, environment: { type: "project-default" },
        input: [{ type: "text", text: "Review the offline launch checklist.", mentions: [] }], sendAt: Date.now() + 30 * 86400000,
      }}); threads.push(threadId);
      await client.navigate(`/plugins/pages/pages/${notes.id}`);
      await client.waitForText("Offline sync for every team");
      await openPage(page.id);
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
      // Chat continues the page's conversation in BB's main thread view, once the page knows it.
      await client.waitForSelector(`[data-studio-item-header] button[title="Continue this page's conversation"]`);
      await client.clickElementWithTextAndPointer('[data-studio-item-header] button', "Chat");
      await waitForPath(`/threads/${threadId}`);
      await client.waitForSelector("[data-promptbox]");
      const chats = await pluginRpc("pages", "chats", { pageId: page.id });
      if (chats.chats.length !== 1 || chats.chats[0].threadId !== threadId) throw new Error("Continuing a page conversation created a duplicate");
      if (await client.evaluate("!!document.querySelector('.pages-chat')")) throw new Error("Pages still renders its separate chat card");
      // New conversation opens the page's composer route in the main view.
      await backToPage();
      await newConversation(); await waitForPath(path); await markRoot("page");
      await client.dragBy(prompt, 0, 0);
      await client.command("Input.insertText", { text: draftText });
      await attach(root);
      await client.waitForText("release-review.txt");
      await client.evaluate(`(() => { window.bbPageDraft = document.querySelector(${JSON.stringify(prompt)}); return true; })()`);
      await retained(true);
      await backToPage(); await retained(false);
      await newConversation(); await waitForPath(path); await retained(true);
      if (!mobile) {
        await openPage(notes.id);
        await client.waitForText("Offline sync for every team");
        await retained(false);
        await newConversation();
        await waitForPath(`/plugins/pages/pages/${notes.id}/compose`); await markRoot("notes");
        const notesRoot = '[data-capture-root="notes"]', notesPrompt = `${notesRoot} [data-promptbox] [contenteditable=true]`;
        await retained(false);
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
        // Submitting opens the new thread in the main view.
        await waitForPath(`/threads/${created}`);
        await client.waitForSelector("[data-promptbox]");
        const queued = await bbCli(["thread", "queue", "list", created, "--json"]);
        if (!queued.includes(notes.id) || !queued.includes("Schedule this release review.") || !queued.includes("release-review.txt")) throw new Error("Pages lost its context, draft or attachment when scheduling");
        await openPage(notes.id);
        await client.waitForText("Offline sync for every team");
        await client.clickElementWithTextAndPointer('[data-studio-item-header] button', "Chat");
        await waitForPath(`/threads/${created}`);
        if ((await pluginRpc("pages", "chats", { pageId: notes.id })).chats.length !== 1) throw new Error("The header duplicated its new page conversation");
        await openPage(page.id);
        await client.waitForText("Launch checklist");
        await newConversation(); await waitForPath(path); await retained(true);
      }
      await sleep(1500);
      // A reload keeps the draft and attachment under the page's draft key.
      await client.navigate(path);
      await markRoot("page");
      await client.waitForSelector(prompt); await client.waitForText("release-review.txt");
      await client.evaluate(`(() => { window.bbPageDraft = document.querySelector(${JSON.stringify(prompt)}); return true; })()`);
      await retained(true);
      const clipped = await client.evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(`${root} button`)})].filter(button => button.checkVisibility()).filter(button => {
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

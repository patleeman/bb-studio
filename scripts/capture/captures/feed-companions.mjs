import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default ({ projectId, threadId, pluginRpc, bbCli, sleep }) => ({
  id: "feed-companions", packageDir: "bb-studio-feed", fileName: "discussion-preview.png", privateSidebar: true,
  setup: async client => {
    const directory = await mkdtemp(join(tmpdir(), "bb-feed-capture-"));
    const attachment = join(directory, "release-review.txt");
    await writeFile(attachment, "Review the release window before publishing.\n");
    let post, page, createdThreadId;
    const forget = async () => {
      if (createdThreadId) await bbCli(["thread", "delete", createdThreadId, "--yes", "--json"]);
      if (post) await pluginRpc("feed", "remove", { postId: post.id });
      if (page) await pluginRpc("pages", "remove", { id: page.id });
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows'); delete window.bbFeedDraft").catch(() => {});
      await rm(directory, { recursive: true, force: true });
    };
    try {
      ({ page } = await pluginRpc("pages", "create", { projectId, parentId: null, title: "Release window checklist", markdown: "- [ ] Confirm the owner\n- [ ] Review the rollback plan" }));
      ({ post } = await pluginRpc("feed", "publish", { projectId, threadId, author: "Atlas", title: "Release window ready for review", body: `The launch owner and rollback plan are ready.\n\n[Release window checklist](/plugins/pages/pages/${page.id})` }));
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForText("Review the rollback plan");
      await client.navigate(`/plugins/feed/feed/${post.id}`);
      await client.waitForText(post.title);
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows')");
      const main = "main";
      const path = `/plugins/feed/feed/${post.id}/discussion`, key = `path:${path}`;
      const root = `[data-float-window=${JSON.stringify(key)}]`, prompt = `${root} [data-promptbox] [contenteditable=true]`;
      const newThread = () => client.clickElementWithTextAndPointer(`${main} button`, "New thread");
      await newThread();
      await client.waitForSelector(prompt);
      await client.dragBy(prompt, 0, 0);
      await client.command("Input.insertText", { text: " Keep this launch review draft." });
      const document = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: `${root} input[type=file]` });
      if (!input.nodeId) throw new Error("Feed discussion has no native attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
      await client.waitForText("release-review.txt");
      await client.evaluate(`(() => { window.bbFeedDraft = document.querySelector(${JSON.stringify(prompt)}); return true; })()`);
      const retained = async visible => {
        const state = await client.evaluate(`(() => {
          const draft = document.querySelector(${JSON.stringify(prompt)});
          return { same: draft === window.bbFeedDraft, visible: !!draft?.checkVisibility(), text: draft?.textContent,
            file: draft?.closest('[data-float-window]')?.textContent.includes('release-review.txt'),
            tabs: document.querySelectorAll(${JSON.stringify(`[data-float-tab=${JSON.stringify(key)}]`)}).length };
        })()`);
        if (!state.same || state.visible !== visible || !state.text?.includes("Keep this launch review draft") || !state.file || state.tabs !== 1) throw new Error(`Feed discussion lost its draft: ${JSON.stringify(state)}`);
      };
      await newThread();
      await retained(true);
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await retained(false);
      await newThread();
      await retained(true);
      await client.clickElementWithTextAndPointer(`${main} section[aria-label$="Release window checklist"] button`, "Open");
      const pageRoot = `[data-float-window="path:/plugins/pages/pages/${page.id}"]`;
      await client.waitForSelector(`${pageRoot} .pages-editor .ProseMirror`);
      await retained(false);
      await client.dragBy(`[data-float-tab=${JSON.stringify(key)}]`, 0, 0);
      await retained(true);
      await client.dragBy(`[data-studio-tab="pages:${page.id}"] a`, 0, 0);
      await client.waitForSelector('[data-studio-item-header]');
      await retained(true);
      await client.clickElementWithTextAndPointer('[data-sidebar] a, [data-sidebar] button', "Inbox");
      await client.waitForText(post.title);
      await client.evaluate(`(() => { const article = [...document.querySelectorAll('main article')].find(each => each.innerText.includes(${JSON.stringify(post.title)})); const toggle = article?.querySelector('button[aria-expanded]'); if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click(); return true; })()`);
      await client.clickElementWithTextAndPointer('main button', post.threadTitle ?? "Open thread");
      await client.waitForSelector(`[data-float-tab="thread:${threadId}"][aria-selected=true]`);
      await retained(false);
      await client.clickElementWithTextAndPointer('main button', post.threadTitle ?? "Open thread");
      if (await client.evaluate(`document.querySelectorAll('[data-float-tab="thread:${threadId}"]').length`) !== 1) throw new Error("Feed duplicated its source thread");
      await newThread();
      await retained(true);
      await client.dragBy('[data-float-resize="nw"]', -240, -100);
      await sleep(500);
      await client.capture(join(process.cwd(), "packages/bb-studio-feed/assets/discussion-draft.png"));
      await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await sleep(500);
      await retained(true);
      const clipped = await client.evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(`${root} [data-studio-conversation] button`)})].filter(button => button.checkVisibility()).filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight;
      }).map(button => button.getAttribute('aria-label') ?? button.innerText))()`);
      if (clipped.length) throw new Error(`Feed's compact composer clips controls: ${JSON.stringify(clipped)}`);
      await client.capture(join(process.cwd(), "packages/bb-studio-feed/assets/discussion-mobile.png"));
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
      await retained(true);
      await client.clickAriaButtonWithPointer("Send options");
      await client.clickElementWithTextAndPointer('[role=menuitem]', "Send later…");
      await client.waitForText("Choose when this thread should start.");
      await client.clickElementWithTextAndPointer('[role=dialog] button', "Schedule send");
      const deadline = Date.now() + 15000;
      while (!createdThreadId) {
        const tabs = await client.evaluate("JSON.parse(sessionStorage.getItem('bb-studio-float:windows')).tabs");
        createdThreadId = tabs.find(tab => tab.target.kind === 'thread' && tab.target.threadId !== threadId)?.target.threadId;
        if (Date.now() > deadline) throw new Error("Scheduled discussion did not replace its originating tab");
        if (!createdThreadId) await sleep(200);
      }
      await client.waitForSelector(`[data-float-window="thread:${createdThreadId}"] [data-promptbox]`);
      const queued = await bbCli(["thread", "queue", "list", createdThreadId, "--json"]);
      if (!queued.includes(post.id) || !queued.includes("Keep this launch review draft") || !queued.includes("release-review.txt")) throw new Error("Created discussion lost its Feed context, edited draft or attachment");
      await sleep(5000);
    } catch (error) {
      console.error(await client.evaluate("JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-4000)})").catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

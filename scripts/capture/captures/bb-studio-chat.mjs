import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default ({ projectId, threadId, seedPages, seedDrawing, pluginRpc, sleep }) => {
  const itemChat = {
    id: "studio-item-chat",
    packageDir: "bb-studio",
    fileName: "chat-preview.png",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup: cleanupDrawing } = await seedDrawing();
      const { page, notes, cleanup: cleanupPages } = await seedPages();
      const drawingRef = { pluginId: "excalidraw", id: drawing.id };
      const directory = await mkdtemp(join(tmpdir(), "bb-chat-draft-capture-"));
      const attachment = join(directory, "release-review.txt");
      await writeFile(attachment, "A deterministic attachment for the new-conversation draft.\n");
      let artifactId;
      const drawingChat = `[data-studio-chat-item="excalidraw:${drawing.id}"]`;
      const pageChat = `[data-studio-chat-item="pages:${page.id}"]`;
      // Without a linked thread, Chat opens a compact composer in the bottom-right corner.
      const corner = ".studio-chat section[data-studio-conversation]";
      const prompt = `${corner} [data-promptbox] [contenteditable="true"]`;
      const draftText = "Keep the release review draft beside my work.";
      const forget = async () => {
        await pluginRpc("studio", "chat.unlink", drawingRef).catch(() => {});
        await cleanupDrawing();
        await cleanupPages();
        if (artifactId) await pluginRpc("artifacts", "delete", { id: artifactId });
        await rm(directory, { recursive: true, force: true });
        await client.evaluate("delete window.bbChatDraft").catch(() => {});
        await client.evaluate("delete window.bbChatQuoteDraft").catch(() => {});
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      };
      const chat = async (selector) => {
        await client.waitForSelector(`${selector} > button:not(:disabled)`);
        await client.clickElementWithTextAndPointer(`${selector} > button`, "Chat");
      };
      const option = async (selector, label) => {
        await client.dragBy(`${selector} [aria-label="Chat options"]`, 0, 0);
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', label);
      };
      const expectComposer = async (title) => {
        await client.waitForSelector(`${corner} .studio-chat-composer [data-promptbox]`);
        const text = await client.evaluate(`document.querySelector(${JSON.stringify(corner)}).innerText`);
        if (text.includes("@mention a bot")) throw new Error("Retired bot handoff prompt is visible");
        if (!text.includes(`Chat about "${title}"`)) throw new Error(`Composer targets the wrong item: ${text}`);
      };
      const closeComposer = async () => {
        await client.dragBy(`${corner} [aria-label="Close composer"]`, 0, 0);
        const deadline = Date.now() + 5000;
        while (await client.evaluate(`!!document.querySelector(${JSON.stringify(corner)})`)) {
          if (Date.now() > deadline) throw new Error("The corner composer did not close");
          await sleep(100);
        }
      };
      const waitForPath = async (expected) => {
        const deadline = Date.now() + 15000;
        while (!(await client.poll("location.pathname"))?.endsWith(expected)) {
          if (Date.now() > deadline) throw new Error(`The main view did not open ${expected}`);
          await sleep(200);
        }
      };
      const openTab = async (ref, ready) => {
        await client.waitForSelector(`[data-studio-tab="${ref}"] a`);
        await client.dragBy(`[data-studio-tab="${ref}"] a`, 0, 0);
        await ready();
      };
      const toDrawing = () => openTab(`excalidraw:${drawing.id}`, () => client.waitForSelector("canvas.excalidraw__canvas"));
      const toPage = () => openTab(`pages:${page.id}`, () => client.waitForText("Offline mode launch"));
      const draft = async ({ same, visible = true }) => {
        const state = await client.evaluate(`(() => {
          const prompt = document.querySelector(${JSON.stringify(prompt)});
          return { same: prompt === window.bbChatDraft, visible: !!prompt?.checkVisibility(),
            text: prompt?.textContent, file: !!prompt?.closest('section')?.textContent.includes('release-review.txt'),
            title: document.querySelector(${JSON.stringify(corner)})?.innerText.includes('Chat about "Checkout flow"'),
            count: document.querySelectorAll(${JSON.stringify(corner)}).length };
        })()`);
        if ((same && !state.same) || state.visible !== visible || !state.text?.includes(draftText) || !state.file || !state.title || state.count !== 1) throw new Error(`New conversation lost its draft: ${JSON.stringify(state)}`);
      };
      try {
        await client.navigate(`/plugins/pages/pages/${notes.id}`);
        await client.waitForText("Release notes: October");
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForText("Offline mode launch");
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await chat(drawingChat);
        await expectComposer("Checkout flow");
        await closeComposer();
        const oldBar = await client.evaluate('!!document.querySelector(".studio-chat-bar")');
        if (oldBar) throw new Error("The retired Studio Chat corner bar is still present");

        // Choosing a conversation links it and opens it in the main thread view.
        await option(drawingChat, "Choose conversation…");
        await client.waitForSelector(`.studio-chat-picker [data-thread-id="${threadId}"]`);
        await client.dragBy(`.studio-chat-picker [data-thread-id="${threadId}"]`, 0, 0);
        await waitForPath(`/threads/${threadId}`);
        const home = (await pluginRpc("studio", "chat.home", drawingRef)).thread;
        if (home?.threadId !== threadId) throw new Error("Choose conversation did not link the drawing");
        await toDrawing();
        await chat(drawingChat);
        await waitForPath(`/threads/${threadId}`);
        if (await client.evaluate(`!!document.querySelector(${JSON.stringify(corner)})`)) throw new Error("Chat opened a composer for a linked drawing");
        await toDrawing();

        await option(drawingChat, "New conversation");
        await expectComposer("Checkout flow");
        await client.dragBy(prompt, 0, 0);
        await client.command("Input.insertText", { text: draftText });
        const document = await client.command("DOM.getDocument");
        const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: `${corner} input[type="file"]` });
        if (!input.nodeId) throw new Error("New conversation has no native attachment input");
        await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
        await client.waitForText("release-review.txt");
        await client.evaluate(`(() => { window.bbChatDraft = document.querySelector(${JSON.stringify(prompt)}); return true; })()`);
        await option(drawingChat, "New conversation");
        await draft({ same: true });
        if ((await pluginRpc("studio", "chat.home", drawingRef)).thread?.threadId !== threadId)
          throw new Error("Opening a new composer changed the existing item link");

        // The composer stays bound to its item while the main view moves on.
        await toPage();
        await draft({ same: true });
        await chat(pageChat);
        await expectComposer("Offline mode launch");
        await openTab(`pages:${notes.id}`, () => client.waitForSelector(`[data-studio-chat-item="pages:${notes.id}"]`));
        const route = await client.evaluate("location.pathname");
        if (route !== `/plugins/pages/pages/${notes.id}`) throw new Error(`The main pane did not navigate: ${route}`);
        await expectComposer("Offline mode launch");
        await closeComposer();
        await toDrawing();
        await chat(drawingChat);
        await waitForPath(`/threads/${threadId}`);
        await toDrawing();
        // The drawing's draft and attachment come back under its draft key.
        await option(drawingChat, "New conversation");
        await expectComposer("Checkout flow");
        await client.waitForText("release-review.txt");
        await draft({ same: false });
        await closeComposer();

        const bytes = await client.evaluate(`(() => {
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 320;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#f3f8f7'; ctx.fillRect(0,0,640,320);
          ctx.fillStyle = '#183d42'; ctx.font = '24px sans-serif'; ctx.fillText('Release upload queue', 32, 48);
          for (const [x,label] of [[32,'Pending'],[252,'Uploading'],[472,'Saved']]) {
            ctx.fillStyle = '#d3e6e2'; ctx.fillRect(x,110,136,90);
            ctx.fillStyle = '#183d42'; ctx.font = '18px sans-serif'; ctx.fillText(label,x+18,162);
          }
          ctx.strokeStyle = '#183d42'; ctx.lineWidth = 3;
          for (const x of [174,394]) { ctx.beginPath(); ctx.moveTo(x,155); ctx.lineTo(x+62,155); ctx.lineTo(x+52,145); ctx.moveTo(x+62,155); ctx.lineTo(x+52,165); ctx.stroke(); }
          ctx.font = '16px sans-serif'; ctx.fillText('Review the retry arrow before release.',32,260);
          return canvas.toDataURL('image/png').split(',')[1];
        })()`);
        ({ id: artifactId } = await pluginRpc("artifacts", "importFile", { name: "release-diagram.png", mime: "image/png", bytes, projectId }));
        await pluginRpc("artifacts", "update", { id: artifactId, title: "Release diagram", description: "A deterministic diagram for cropped-image chat context." });
        await client.navigate(`/plugins/artifacts/artifacts/${artifactId}`);
        await client.waitForSelector('img[alt="release-diagram.png"]');
        const deadline = Date.now() + 15000;
        while (!(await client.evaluate(`document.querySelector('img[alt="release-diagram.png"]')?.naturalWidth === 640`))) {
          if (Date.now() > deadline) throw new Error("The seeded release diagram did not load");
          await sleep(100);
        }
        await client.dragBy('img[alt="release-diagram.png"]', 80, -55, { atX: 170 });
        await client.waitForSelector('section[aria-label="Send to thread"]');
        const quoteTargets = await client.evaluate(`(() => {
          const card = document.querySelector('section[aria-label="Send to thread"]');
          return [...card.querySelectorAll('textarea,button')].filter(element => {
            const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2);
            return !hit || !element.contains(hit);
          }).map(element => element.getAttribute('aria-label') ?? element.textContent);
        })()`);
        if (quoteTargets.length) throw new Error(`Quote controls are covered: ${JSON.stringify(quoteTargets)}`);
        await client.dragBy('textarea[aria-label="Note"]', 0, 0);
        await client.command("Input.insertText", { text: "Clarify this retry arrow before release." });
        await client.clickElementWithTextAndPointer('section[aria-label="Send to thread"] button', "Send");
        // The artifact has no linked thread, so the quote opens the corner composer.
        await client.waitForSelector(`${corner} img[alt="Selected image area"]`);
        const quoteRoot = corner;
        const quotePrompt = prompt;
        await client.waitForSelector(quotePrompt);
        await client.dragBy(quotePrompt, 0, 0);
        for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", modifiers: 4 });
        await client.command("Input.insertText", { text: "\nAlso align the arrowhead." });
        const quoteDocument = await client.command("DOM.getDocument");
        const quoteFile = await client.command("DOM.querySelector", { nodeId: quoteDocument.root.nodeId, selector: `${quoteRoot} input[type="file"]` });
        if (!quoteFile.nodeId) throw new Error("Quote composer has no native attachment input");
        await client.command("DOM.setFileInputFiles", { nodeId: quoteFile.nodeId, files: [attachment] });
        await client.waitForText("release-review.txt");
        const expectQuote = async () => {
          const state = await client.evaluate(`(() => {
            const root = document.querySelector(${JSON.stringify(quoteRoot)});
            return { text: root?.textContent, image: root?.querySelector('img[alt="Selected image area"]')?.src,
              visible: root?.checkVisibility(), count: document.querySelectorAll(${JSON.stringify(quoteRoot)}).length };
          })()`);
          if (!state.visible || state.count !== 1 || !state.text.includes('Chat about "Release diagram"') || !state.text.includes('Clarify this retry arrow before release.') || !state.text.includes('Also align the arrowhead.') || !state.text.includes('release-review.txt') || !state.image?.startsWith('data:image/png;base64,')) throw new Error(`Image quote context lost: ${JSON.stringify(state)}`);
        };
        await expectQuote();
        if (process.env.BB_CAPTURE_CHAT_COMPACT === "1") {
          await client.evaluate(`(() => { window.bbChatQuoteDraft = document.querySelector(${JSON.stringify(quotePrompt)}); return true; })()`);
          await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
          await sleep(700); await expectQuote();
          const same = await client.evaluate(`document.querySelector(${JSON.stringify(quotePrompt)}) === window.bbChatQuoteDraft`);
          if (!same) throw new Error("Resizing replaced the native quote draft");
          const clipped = await client.evaluate(`(() => {
            const root = document.querySelector(${JSON.stringify(quoteRoot)});
            return [...root.querySelectorAll('[data-promptbox] button, img[alt="Selected image area"]')].filter(node => node.checkVisibility()).filter(node => {
              const r = node.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return r.width <= 0 || r.height <= 0 || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight || !hit || !node.contains(hit);
            }).map(node => node.getAttribute('aria-label') ?? node.getAttribute('alt') ?? node.textContent);
          })()`);
          if (clipped.length) throw new Error(`The phone quote composer clips or covers controls: ${JSON.stringify(clipped)}`);
          await client.capture(join(process.cwd(), "packages/bb-studio/assets/chat-quote-mobile.png"));
          await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
          await sleep(500); await expectQuote();
        }
        await sleep(1000);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  };
  return [
    itemChat,
    // The retired Chat plugin's bridge shows the same item chat it hands over to Studio.
    { ...itemChat, id: "chat-bridge", packageDir: "bb-studio-chat", fileName: "staged-preview.png" },
  ];
};

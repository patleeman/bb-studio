import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const composerKey = ref => `path:/plugins/studio-chat/chats/item/${encodeURIComponent(JSON.stringify({ pluginId: ref.pluginId, id: ref.id }))}`;

export default ({ projectId, threadId, seedPages, seedDrawing, pluginRpc, sleep }) => [
  {
    id: "studio-chat",
    packageDir: "bb-studio-chat",
    privateSidebar: true,
    setup: async (client) => {
      const { drawing, cleanup: cleanupDrawing } = await seedDrawing();
      const { page, notes, cleanup: cleanupPages } = await seedPages();
      const drawingRef = { pluginId: "excalidraw", id: drawing.id };
      const pageRef = { pluginId: "pages", id: page.id };
      const directory = await mkdtemp(join(tmpdir(), "bb-chat-draft-capture-"));
      const attachment = join(directory, "release-review.txt");
      await writeFile(attachment, "A deterministic attachment for the new-conversation draft.\n");
      let artifactId;
      let quoteId;
      const drawingChat = `[data-studio-chat-item="excalidraw:${drawing.id}"]`;
      const pageChat = `[data-float-window="path:/plugins/pages/pages/${page.id}"] [data-studio-chat-item="pages:${page.id}"]`;
      const forget = async () => {
        await client.evaluate('sessionStorage.removeItem("bb-studio-float:windows")').catch(() => {});
        await pluginRpc("studio-chat", "unlink", drawingRef).catch(() => {});
        await cleanupDrawing();
        await cleanupPages();
        if (artifactId) await pluginRpc("artifacts", "delete", { id: artifactId });
        if (quoteId) await client.evaluate(`new Promise((resolve, reject) => {
          const request = indexedDB.open('bb-studio-chat:drafts', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const transaction = request.result.transaction('quotes', 'readwrite');
            transaction.objectStore('quotes').delete(${JSON.stringify(quoteId)});
            transaction.oncomplete = () => { request.result.close(); resolve(true); };
            transaction.onerror = () => reject(transaction.error);
          };
        })`).catch(() => {});
        await rm(directory, { recursive: true, force: true });
        await client.evaluate("delete window.bbChatDraft").catch(() => {});
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
      const expectComposer = async (title, ref = drawingRef) => {
        const root = `[data-float-window=${JSON.stringify(composerKey(ref))}]`;
        await client.waitForSelector(`${root} .studio-chat-composer [data-promptbox]`);
        const text = await client.evaluate(`document.querySelector(${JSON.stringify(`${root} .studio-chat-composer`)}).closest("section").innerText`);
        if (!text.includes(`Chat about "${title}"`)) throw new Error(`Composer targets the wrong item: ${text}`);
        return root;
      };
      const closeComposer = () => client.dragBy('[data-float-tab][aria-selected="true"] [aria-label="Close tab"]', 0, 0);
      try {
        await client.navigate(`/plugins/pages/pages/${notes.id}`);
        await client.waitForText("Release notes: October");
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await chat(drawingChat);
        await expectComposer("Checkout flow");
        await closeComposer();
        const oldBar = await client.evaluate('!!document.querySelector(".studio-chat-bar")');
        if (oldBar) throw new Error("The duplicate Float-specific corner bar is still present");

        await option(drawingChat, "Choose conversation…");
        await client.waitForSelector(`.studio-chat-picker [data-thread-id="${threadId}"]`);
        await client.dragBy(`.studio-chat-picker [data-thread-id="${threadId}"]`, 0, 0);
        await client.waitForSelector(`[data-float-tab="thread:${threadId}"][aria-selected="true"]`);
        const home = (await pluginRpc("studio-chat", "home", drawingRef)).thread;
        if (home?.threadId !== threadId) throw new Error("Choose conversation did not link the drawing");
        await chat(drawingChat);
        const duplicates = await client.evaluate(`document.querySelectorAll('[data-float-tab="thread:${threadId}"]').length`);
        if (duplicates !== 1) throw new Error(`Chat duplicated the linked thread ${duplicates} times`);
        await option(drawingChat, "New conversation");
        const root = await expectComposer("Checkout flow");
        const prompt = `${root} [data-promptbox] [contenteditable="true"]`;
        await client.dragBy(prompt, 0, 0);
        await client.command("Input.insertText", { text: "Keep the release review draft beside my work." });
        const document = await client.command("DOM.getDocument");
        const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: `${root} input[type="file"]` });
        if (!input.nodeId) throw new Error("New conversation has no native attachment input");
        await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
        await client.waitForText("release-review.txt");
        await client.evaluate(`window.bbChatDraft = document.querySelector(${JSON.stringify(prompt)})`);
        const retained = async visible => {
          const state = await client.evaluate(`(() => {
            const prompt = document.querySelector(${JSON.stringify(prompt)});
            return { same: prompt === window.bbChatDraft, visible: !!prompt?.checkVisibility(),
              text: prompt?.textContent, file: prompt?.closest('[data-float-window]')?.textContent.includes('release-review.txt'),
              tabs: document.querySelectorAll(${JSON.stringify(`[data-float-tab=${JSON.stringify(composerKey(drawingRef))}]`)}).length };
          })()`);
          if (!state.same || state.visible !== visible || !state.text?.includes("Keep the release review draft") || !state.file || state.tabs !== 1) throw new Error(`New conversation lost its draft: ${JSON.stringify(state)}`);
        };
        await option(drawingChat, "New conversation");
        await retained(true);
        await client.clickAriaButtonWithPointer("Fold floating tabs");
        await retained(false);
        await client.clickAriaButtonWithPointer("Open floating tabs");
        await retained(true);
        if ((await pluginRpc("studio-chat", "home", drawingRef)).thread?.threadId !== threadId)
          throw new Error("Opening a new composer changed the existing item link");

        // A page in Float owns its Chat action while the main pane shows the drawing.
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForText("Offline mode launch");
        await client.clickAriaButtonWithPointer("Move");
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float this");
        await client.waitForSelector(pageChat);
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector(pageChat);
        await chat(pageChat);
        await expectComposer("Offline mode launch", pageRef);
        await retained(false);
        await client.waitForSelector(`[data-studio-tab="pages:${notes.id}"] a`);
        await client.dragBy(`[data-studio-tab="pages:${notes.id}"] a`, 0, 0);
        await client.waitForSelector(`[data-studio-chat-item="pages:${notes.id}"]`);
        const route = await client.evaluate("location.pathname");
        if (route !== `/plugins/pages/pages/${notes.id}`) throw new Error(`The main pane did not navigate: ${route}`);
        await expectComposer("Offline mode launch", pageRef);
        await closeComposer();
        await client.dragBy(`[data-studio-tab="excalidraw:${drawing.id}"] a`, 0, 0);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await chat(drawingChat);
        await client.waitForSelector(`[data-float-window="thread:${threadId}"] .studio-chat-viewing`);
        await client.waitForText("Viewing: Checkout flow");
        await client.dragBy(`[data-float-tab=${JSON.stringify(composerKey(drawingRef))}]`, 0, 0);
        await retained(true);
        await client.dragBy('[data-float-resize="nw"]', -220, 0);

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
        await client.dragBy('img[alt="release-diagram.png"]', 90, 50, { atX: 130 });
        await client.clickElementWithTextAndPointer("button", "Send to thread");
        await client.waitForSelector('section[aria-label="Send to thread"]');
        await client.dragBy('textarea[aria-label="Note"]', 0, 0);
        await client.command("Input.insertText", { text: "Clarify this retry arrow before release." });
        await client.clickElementWithTextAndPointer('section[aria-label="Send to thread"] button', "Send");
        await client.waitForSelector('img[alt="Selected image area"]');
        const quotePath = await client.evaluate(`JSON.parse(sessionStorage.getItem('bb-studio-float:windows')).tabs.find(tab => tab.target.kind === 'path' && tab.target.path.startsWith('/plugins/studio-chat/chats/quote/'))?.target.path`);
        if (!quotePath) throw new Error("The image selection did not open a retained quote composer");
        quoteId = quotePath.split('/').at(-1);
        const quoteRoot = `[data-float-window=${JSON.stringify(`path:${quotePath}`)}]`;
        const quotePrompt = `${quoteRoot} [data-promptbox] [contenteditable="true"]`;
        await client.waitForSelector(quotePrompt);
        const expectQuote = async () => {
          const state = await client.evaluate(`(() => {
            const root = document.querySelector(${JSON.stringify(quoteRoot)});
            return { text: root?.textContent, image: root?.querySelector('img[alt="Selected image area"]')?.src,
              visible: root?.checkVisibility(), count: document.querySelectorAll(${JSON.stringify(quoteRoot)}).length };
          })()`);
          if (!state.visible || state.count !== 1 || !state.text.includes('Chat about "Release diagram"') || !state.text.includes('Clarify this retry arrow before release.') || !state.image?.startsWith('data:image/png;base64,')) throw new Error(`Image quote context lost: ${JSON.stringify(state)}`);
        };
        await expectQuote();
        await client.command("Page.reload", {});
        await client.waitForSelector(quotePrompt, 90000);
        await expectQuote();
        await client.clickAriaButtonWithPointer("Floating tab actions");
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Pin tab");
        await sleep(1000);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  },
];

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default ({ projectId, threadId, seedPages, sleep }) => ({
  id: "float-native-main-thread",
  packageDir: "bb-studio-float",
  fileName: "native-first-thread-preview.png",
  privateSidebar: true,
  clip: async (client) => {
    const visible = await client.evaluate(`(() => {
      const editor = document.querySelector('[data-float-window] [data-promptbox] [contenteditable="true"]');
      const box = editor?.getBoundingClientRect();
      return editor === window.bbMainThreadCapture?.editor && editor.checkVisibility() &&
        box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight;
    })()`);
    if (!visible) throw new Error("Original composer is absent from the final live screenshot");
    console.log("Verified original main editor/file input, undo/redo, navigation, docking and return after close");
  },
  setup: async (client) => {
    const fixture = await seedPages();
    const directory = await mkdtemp(join(tmpdir(), "bb-main-thread-capture-"));
    const file = join(directory, "main-thread-draft.txt");
    await writeFile(file, "An attachment selected before the first companion move.\n");
    const key = `thread:${threadId}`;
    const selector = `[data-float-window="${key}"] [data-promptbox] [contenteditable="true"]`;
    const forget = async () => {
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbMainThreadCapture`).catch(() => {});
      await fixture.cleanup();
      await rm(directory, { recursive: true, force: true });
    };
    const expectRetained = async () => {
      const result = await client.evaluate(`(() => {
        const editor = document.querySelector(${JSON.stringify(selector)});
        const body = editor?.closest('[data-float-window]');
        const box = editor?.getBoundingClientRect();
        return { same: editor === window.bbMainThreadCapture.editor,
          input: body?.querySelector('input[type="file"]') === window.bbMainThreadCapture.input,
          model: editor?.closest('[data-promptbox]')?.querySelector('button[aria-label^="Provider, model and reasoning"]')?.textContent,
          draft: editor?.textContent, attachment: body?.textContent.includes('main-thread-draft.txt'),
          visible: !!editor?.checkVisibility() && box.x < innerWidth && box.right > 0 && box.y < innerHeight && box.bottom > 0, count: document.querySelectorAll(${JSON.stringify(selector)}).length };
      })()`);
      if (!result.same || !result.input || !result.visible || result.count !== 1 ||
          !result.draft?.includes("Keep my original main-thread draft.") || !result.attachment ||
          result.model !== await client.evaluate(`window.bbMainThreadCapture.model`))
        throw new Error(`First main-thread transfer lost composer state: ${JSON.stringify(result)}`);
    };
    try {
      await client.navigate(`/plugins/pages/pages/${fixture.page.id}`);
      await client.waitForText("Offline mode launch", 90000);
      await client.navigate(`/projects/${projectId}/threads/${threadId}`);
      await client.waitForSelector('[data-promptbox] [contenteditable="true"]', 90000);
      await client.dragBy('[data-promptbox] [contenteditable="true"]', 0, 0);
      await client.command("Input.insertText", { text: "Keep my original main-thread draft." });
      await client.evaluate(`(() => { window.bbMainThreadCapture = { editor: document.querySelector('[data-promptbox] [contenteditable="true"]'), input: document.querySelector('[data-promptbox] input[type="file"]'), model: document.querySelector('[data-promptbox] button[aria-label^="Provider, model and reasoning"]')?.textContent }; return true; })()`);
      const document = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: '[data-promptbox] input[type="file"]' });
      if (!input.nodeId) throw new Error("Main-thread composer has no attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [file] });
      await client.waitForText("main-thread-draft.txt");
      await client.openThreadContextMenu();
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      await client.waitForSelector(selector);
      await expectRetained();
      await client.dragBy(selector, 0, 0);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 4 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4 });
      const undone = await client.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
      if (undone.includes("Keep my original main-thread draft.")) throw new Error("First companion move lost the main editor's undo history");
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 12 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 12 });
      await expectRetained();
      await client.dragBy(`[data-studio-tab="pages:${fixture.page.id}"] a`, 0, 0);
      await sleep(750);
      await expectRetained();
      await client.clickAriaButtonWithPointer("Floating tab actions");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Move to workbench");
      await sleep(500);
      await expectRetained();
      const mainLink = `[data-sidebar="sidebar"] a[href="/projects/${projectId}/threads/${threadId}"]`;
      await client.dragBy(mainLink, 0, 0);
      await client.waitForText("This composer is open in a companion.");
      await expectRetained();
      await client.clickElementWithTextAndPointer("button", "Main view");
      await sleep(500);
      await expectRetained();
      await client.clickElementWithTextAndPointer("button", "Workbench");
      await sleep(500);
      await client.dragBy(mainLink, 0, 0);
      await client.waitForText("This composer is open in a companion.");
      const closeLabel = await client.evaluate(`document.querySelector('[data-testid="secondary-panel-tab-strip"] [data-tab-pill-close]')?.getAttribute('aria-label')`);
      if (!closeLabel?.startsWith("Close ")) throw new Error("Native companion tab has no close control");
      await client.clickAriaButtonWithPointer(closeLabel);
      await sleep(500);
      const returned = await client.evaluate(`(() => {
        const editor = document.querySelector('[data-promptbox] [contenteditable="true"]');
        return { same: editor === window.bbMainThreadCapture.editor, input: document.querySelector('[data-promptbox] input[type="file"]') === window.bbMainThreadCapture.input,
          draft: editor?.textContent, attachment: document.body.textContent.includes('main-thread-draft.txt'), count: document.querySelectorAll('[data-promptbox] [contenteditable="true"]').length };
      })()`);
      if (!returned.same || !returned.input || returned.count !== 1 || !returned.attachment || !returned.draft.includes("Keep my original main-thread draft."))
        throw new Error(`Closing the companion lost its original main composer: ${JSON.stringify(returned)}`);
      await client.openThreadContextMenu();
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      await expectRetained();
      await client.clickAriaButtonWithPointer("Floating tab actions");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Move to workbench");
      await sleep(500);
      await client.dragBy(`[data-studio-tab="pages:${fixture.page.id}"] a`, 0, 0);
      await sleep(750);
      await expectRetained();
    } catch (error) {
      console.error(await client.evaluate(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-3500) })`).catch(() => "Capture context unavailable"));
      await forget();
      throw error;
    }
    return forget;
  },
});

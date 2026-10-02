import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default ({ threadId, seedPages, sleep }) => ({
  id: "float-native",
  packageDir: "bb-studio-float",
  fileName: "native-workbench-preview.png",
  privateSidebar: true,
  setup: async (client) => {
    const { page, cleanup } = await seedPages();
    const directory = await mkdtemp(join(tmpdir(), "bb-companion-capture-"));
    const attachment = join(directory, "release-notes.txt");
    await writeFile(attachment, "Deterministic staged attachment for the companion transfer check.\n");
    const forget = async () => {
      await client.evaluate(`sessionStorage.removeItem("bb-studio-float:windows"); sessionStorage.removeItem("bb:companion-views:v1"); delete window.bbCompanionCapture`).catch(() => {});
      await cleanup();
      await rm(directory, { recursive: true, force: true });
    };
    const threadKey = `thread:${threadId}`;
    const pageKey = `path:/plugins/pages/pages/${page.id}`;
    const composer = `[data-float-window="${threadKey}"] [data-promptbox] [contenteditable="true"]`;
    const editor = `[data-float-window="${pageKey}"] .ProseMirror[contenteditable="true"]`;
    const remember = async (name, selector) => client.evaluate(`(() => {
      window.bbCompanionCapture ??= {};
      window.bbCompanionCapture[${JSON.stringify(name)}] = document.querySelector(${JSON.stringify(selector)});
      return true;
    })()`);
    const expectRetained = async (name, selector, visible, text) => {
      const actual = await client.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        return { same: node === window.bbCompanionCapture[${JSON.stringify(name)}],
          visible: !!node?.checkVisibility(), count: document.querySelectorAll(${JSON.stringify(selector)}).length,
          text: node?.textContent ?? "",
          attachment: node?.closest('[data-float-window]')?.textContent.includes('release-notes.txt') ?? false };
      })()`);
      if (!actual.same || actual.visible !== visible || actual.count !== 1 || !actual.text.includes(text) || (name === "composer" && !actual.attachment))
        throw new Error(`Native companion lost ${name}: ${JSON.stringify(actual)}`);
    };
    const toWorkbench = async () => {
      await client.clickAriaButtonWithPointer("Floating tab actions");
      await client.waitForSelector('[role="menuitem"]');
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Move to workbench");
      await sleep(500);
    };
    try {
      const url = process.env.BB_CAPTURE_COMPANION_URL;
      if (url) await client.command("Page.navigate", { url: `${url.replace(/\/$/, "")}/plugins/pages/pages/${page.id}` });
      else await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForText("Offline mode launch", 90000);
      const available = await client.evaluate(`typeof window.__bbPluginRuntime?.pluginSdkApp?.experimental_CompanionView === 'function' && typeof window.__bbPluginRuntime?.pluginSdkApp?.experimental_CompanionOutlet === 'function'`);
      if (!available) throw new Error("float-native requires BB's native companion host; capture stable Float with --plugin float instead.");
      await client.waitForSelector(`[data-studio-tab="pages:${page.id}"]`);
      await client.openContextMenu(`[data-studio-tab="pages:${page.id}"] a`);
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      await client.waitForSelector(editor);
      await remember("page", editor);
      await expectRetained("page", editor, true, "Launch checklist");
      await toWorkbench();
      await expectRetained("page", editor, true, "Launch checklist");
      await client.clickElementWithTextAndPointer("button", "Main view");
      await sleep(500);
      await expectRetained("page", editor, true, "Launch checklist");
      await client.clickElementWithTextAndPointer("button", "Float");
      await sleep(500);
      await expectRetained("page", editor, true, "Launch checklist");

      await client.openThreadContextMenu();
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      await client.waitForSelector(composer);
      await client.dragBy(composer, 0, 0);
      await client.command("Input.insertText", { text: "Keep this roadmap draft while I review the page." });
      await remember("composer", composer);
      const document = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: `[data-float-window="${threadKey}"] input[type="file"]` });
      if (!input.nodeId) throw new Error("The live SDK composer has no attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
      await client.waitForText("release-notes.txt");
      await expectRetained("composer", composer, true, "Keep this roadmap draft");
      await expectRetained("page", editor, false, "Launch checklist");
      await toWorkbench();
      await expectRetained("composer", composer, true, "Keep this roadmap draft");
      await client.clickAriaButtonWithPointer("Pin companion");
      const pinned = await client.evaluate(`JSON.parse(sessionStorage.getItem('bb-studio-float:windows')).tabs.find(tab => tab.key === ${JSON.stringify(threadKey)})?.pinned`);
      if (!pinned) throw new Error("Native pin did not reach the shared companion state");
      await client.clickElementWithTextAndPointer("button", "Main view");
      await sleep(500);
      await expectRetained("composer", composer, true, "Keep this roadmap draft");
      await client.clickElementWithTextAndPointer("button", "Workbench");
      await sleep(500);
      await expectRetained("composer", composer, true, "Keep this roadmap draft");
      await client.clickElementWithTextAndPointer("button", "Float");
      await sleep(500);
      await expectRetained("composer", composer, true, "Keep this roadmap draft");
      await client.dragBy(`[data-float-tab="${pageKey}"]`, 0, 0);
      await expectRetained("page", editor, true, "Launch checklist");
      await expectRetained("composer", composer, false, "Keep this roadmap draft");
      await client.dragBy(`[data-float-tab="${threadKey}"]`, 0, 0);
      await toWorkbench();
      await expectRetained("composer", composer, true, "Keep this roadmap draft");
      await expectRetained("page", editor, true, "Launch checklist");
      await client.clickAriaButtonWithPointer("Floating tab actions");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Move to main view");
      await sleep(500);
      await expectRetained("composer", composer, true, "Keep this roadmap draft");
      await expectRetained("page", editor, true, "Launch checklist");
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate(`JSON.stringify({ text: document.body.innerText.slice(-4000), editors: [...document.querySelectorAll('[contenteditable]')].map(node => ({className: node.className, editable: node.getAttribute('contenteditable'), window: node.closest('[data-float-window]')?.getAttribute('data-float-window')})) })`).catch(() => "Capture context unavailable"));
      await forget();
      throw error;
    }
    return forget;
  },
});

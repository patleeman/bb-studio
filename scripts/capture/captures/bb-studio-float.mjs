import suiteTransfers from "./companion-suite-transfers.mjs";
import companionHost from "./companion-host.mjs";
import legacyCompanionTransfer from "./legacy-companion-transfer.mjs";
import companionSplit from "./companion-split.mjs";
import companionMainThread from "./companion-main-thread.mjs";
import dragCleanup from "./float-drag-cleanup.mjs";
import mainMobile from "./float-main-mobile.mjs";

const STATE_KEY = "bb-studio-float:windows";

export default context => {
  const { projectId, threadId, seedPages, seedDrawing, sleep, bbCli } = context;
  return [
  ...(process.env.BB_CAPTURE_SUITE_TRANSFERS === "1" ? suiteTransfers(context) : []),
  ...(process.env.BB_CAPTURE_MAIN_THREAD === "1" ? [companionMainThread({ projectId, threadId, seedPages, sleep })] : []),
  ...(process.env.BB_CAPTURE_COMPANION_SPLIT === "1" ? [companionSplit({ seedPages, sleep })] : []),
  ...(process.env.BB_CAPTURE_LEGACY_TRANSFER === "1" ? [legacyCompanionTransfer({ seedPages, sleep })] : []),
  ...(process.env.BB_CAPTURE_MAIN_RETENTION === "1" ? [mainMobile({ seedPages, sleep })] : []),
  ...(process.env.BB_CAPTURE_FLOAT_DRAG === "1" ? [dragCleanup({ seedPages, sleep })] : []),
  ...(process.env.BB_CAPTURE_NATIVE_COMPANION === "1" ? [companionHost({ threadId, seedPages, sleep, bbCli })] : []),
  {
    id: "float",
    packageDir: "bb-studio-float",
    privateSidebar: true,
    setup: async (client) => {
      const { page, cleanup } = await seedPages();
      const { drawing, cleanup: cleanupDrawing } = await seedDrawing();
      const forget = async () => {
        await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(STATE_KEY)})`).catch(() => {});
        await client.evaluate(`delete window.bbFloatCaptureRetained`).catch(() => {});
        await client.evaluate(`delete window.bbFloatMainEditor; delete window.bbFloatMainCanvas`).catch(() => {});
        // Float keeps its tabs in memory too; reload so later captures start without them.
        await client.command("Page.reload", {}).catch(() => {});
        await client.waitForSelector("[data-sidebar=\"sidebar\"]", 60000).catch(() => {});
        await cleanup();
        await cleanupDrawing();
      };
      const float = async (selector) => {
        await client.openContextMenu(selector);
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      };
      const tabOrder = () => client.evaluate(`[...document.querySelectorAll("[data-float-tab]")].map((element) => element.getAttribute("data-float-tab"))`);
      const place = () => client.evaluate(`document.querySelector(".bb-float-stack")?.getAttribute("data-float-place") ?? ""`);
      const expectPlace = async (expected) => {
        const actual = await place();
        if (actual !== expected) throw new Error(`The Float panel is "${actual}", not "${expected}"`);
      };
      // The header's grip, left of the tabs.
      const dragPanel = (dx, dy) => client.dragBy(".bb-float-stack header", dx, dy, { atX: 10 });
      try {
        await client.navigate("/plugins/studio/studio");
        await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(STATE_KEY)})`);
        // Visiting the page opens its Studio tab, whose menu floats it.
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForText("Offline mode launch");
        await client.waitForSelector(".ProseMirror[contenteditable=true]");
        await client.evaluate(`(() => { window.bbFloatMainEditor = document.querySelector('.ProseMirror[contenteditable=true]'); return true; })()`);
        await client.waitForSelector(`[data-studio-tab="pages:${page.id}"]`);
        await float(`[data-studio-tab="pages:${page.id}"] a`);
        await client.waitForSelector(`[data-float-window="path:/plugins/pages/pages/${page.id}"] .ProseMirror[contenteditable=true]`);
        const sameInitialPage = await client.evaluate(`document.querySelector('[data-float-window="path:/plugins/pages/pages/${page.id}"] .ProseMirror[contenteditable=true]') === window.bbFloatMainEditor`);
        if (!sameInitialPage) throw new Error("The first Float move replaced the main Pages editor");
        // A thread and a drawing opened through their real sidebar menus.
        await client.openThreadContextMenu();
        await client.waitForSelector('[role="menuitem"]');
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
        await client.navigate(`/plugins/excalidraw/drawings/${drawing.id}`);
        await client.waitForSelector("canvas.excalidraw__canvas");
        await client.evaluate(`(() => { window.bbFloatMainCanvas = document.querySelector('canvas.excalidraw__canvas'); return true; })()`);
        await client.waitForSelector(`[data-studio-tab="excalidraw:${drawing.id}"]`);
        await float(`[data-studio-tab="excalidraw:${drawing.id}"] a`);
        await client.waitForSelector(`[data-float-window="path:/plugins/excalidraw/drawings/${drawing.id}"] canvas.excalidraw__canvas`);
        const sameInitialCanvas = await client.evaluate(`document.querySelector('[data-float-window="path:/plugins/excalidraw/drawings/${drawing.id}"] canvas.excalidraw__canvas') === window.bbFloatMainCanvas`);
        if (!sameInitialCanvas) throw new Error("The first Float move replaced the main drawing canvas");
        // The tabs stay while the main view moves on, the newest showing.
        await client.navigate("/plugins/studio/studio");
        const pageKey = `path:/plugins/pages/pages/${page.id}`;
        const drawingKey = `path:/plugins/excalidraw/drawings/${drawing.id}`;
        const keys = [pageKey, `thread:${threadId}`, drawingKey];
        for (const key of keys) await client.waitForSelector(`[data-float-tab="${key}"]`);
        if (JSON.stringify(await tabOrder()) !== JSON.stringify(keys)) throw new Error(`Float's tabs are ${JSON.stringify(await tabOrder())}, not ${JSON.stringify(keys)}`);
        await client.waitForSelector(`[data-float-tab="${drawingKey}"][aria-selected="true"]`);
        const drawingTab = await client.evaluate(`document.querySelector('[data-float-tab="${drawingKey}"]').innerText`);
        if (!drawingTab.includes("Checkout flow")) throw new Error(`The drawing's tab is "${drawingTab}"`);
        await client.waitForSelector(`[data-float-window="${drawingKey}"] canvas.excalidraw__canvas`);
        const drawingVisible = await client.evaluate(`document.querySelector('[data-float-window="${drawingKey}"] canvas.excalidraw__canvas')?.checkVisibility()`);
        if (!drawingVisible) throw new Error("The floated drawing has no visible canvas");
        await expectPlace("dock");
        // Pulled off the bottom it floats free; dropped near the bottom it docks again.
        await dragPanel(-560, -300);
        await expectPlace("free");
        await dragPanel(0, 400);
        await expectPlace("dock");
        await dragPanel(-520, -260);
        await expectPlace("free");
        // Dragging the drawing's tab to the front reorders the strip.
        await client.dragBy(`[data-float-tab="${drawingKey}"]`, -400, 0);
        const reordered = [drawingKey, pageKey, `thread:${threadId}`];
        if (JSON.stringify(await tabOrder()) !== JSON.stringify(reordered)) throw new Error(`After the drag, Float's tabs are ${JSON.stringify(await tabOrder())}`);
        // Clicking the page's tab shows the page, rendered by Pages in the panel.
        // A press and release without moving is a click.
        await client.dragBy(`[data-float-tab="${pageKey}"]`, 0, 0);
        await client.waitForSelector(`[data-float-window="${pageKey}"] .float-body .pages-doc`);
        const pageText = await client.evaluate(`document.querySelector('[data-float-window="${pageKey}"]').innerText`);
        if (!pageText.includes("Launch checklist")) throw new Error("The floated page doesn't show its content");
        await client.waitForSelector(`[data-float-window="${pageKey}"] [data-studio-item-header]`);
        const clippedControls = await client.evaluate(`(() => {
          const body = document.querySelector('[data-float-window="${pageKey}"] .float-body');
          const bounds = body.getBoundingClientRect();
          return [...body.querySelectorAll('[data-studio-item-header] button')].filter(button => {
            if (!button.checkVisibility()) return false;
            const rect = button.getBoundingClientRect();
            return rect.left < bounds.left || rect.right > bounds.right;
          }).map(button => button.getAttribute('aria-label') ?? button.textContent);
        })()`);
        if (clippedControls.length) throw new Error(`The floated page clips header controls: ${JSON.stringify(clippedControls)}`);
        await expectPlace("free");

        // Exercise the real SDK composer and Pages editor, including hidden views.
        await client.evaluate(`(() => {
          window.bbFloatCaptureRetained = {
            page: document.querySelector('[data-float-window="${pageKey}"] .pages-doc'),
          };
          return true;
        })()`);
        await client.dragBy(`[data-float-tab="thread:${threadId}"]`, 0, 0);
        const composerSelector = `[data-float-window="thread:${threadId}"] [data-promptbox] [contenteditable="true"]`;
        await client.waitForSelector(composerSelector);
        await client.dragBy(composerSelector, 0, 0);
        await client.command("Input.insertText", { text: "Keep this roadmap draft while I review the page." });
        await client.evaluate(`(() => {
          window.bbFloatCaptureRetained.composer = document.querySelector(${JSON.stringify(composerSelector)});
          return true;
        })()`);
        const expectRetained = async (pageVisible) => {
          const result = await client.evaluate(`(() => {
            const page = document.querySelector('[data-float-window="${pageKey}"] .pages-doc');
            const composer = document.querySelector(${JSON.stringify(composerSelector)});
            return {
              samePage: page === window.bbFloatCaptureRetained.page,
              sameComposer: composer === window.bbFloatCaptureRetained.composer,
              pageVisible: !!page?.checkVisibility(),
              draft: composer?.textContent ?? "",
            };
          })()`);
          if (!result.samePage || !result.sameComposer || result.pageVisible !== pageVisible ||
              !result.draft.includes("Keep this roadmap draft while I review the page."))
            throw new Error(`Companion state was lost: ${JSON.stringify(result)}`);
        };
        await client.dragBy(`[data-float-tab="${pageKey}"]`, 0, 0);
        await expectRetained(true);
        await client.clickAriaButtonWithPointer("Fold floating tabs");
        await expectRetained(false);
        await client.clickAriaButtonWithPointer("Open floating tabs");
        await expectRetained(true);
        for (const visible of [false, true]) {
          await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "j", code: "KeyJ", modifiers: 12 });
          await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "j", code: "KeyJ", modifiers: 12 });
          await sleep(350);
          await expectRetained(visible);
        }
        await dragPanel(0, 400);
        await expectPlace("dock");
        await expectRetained(true);
        await dragPanel(-520, -260);
        await expectPlace("free");
        await expectRetained(true);
        await client.clickAriaButtonWithPointer("Floating tab actions");
        await client.clickElementWithTextAndPointer('[role="menuitem"]', "Pin tab");
        const pinned = await client.evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(STATE_KEY)})).tabs.find(tab => tab.key === ${JSON.stringify(pageKey)})?.pinned`);
        if (pinned !== true) throw new Error("Pin tab did not persist the live companion's pin");
        await sleep(1500);
      } catch (error) {
        await forget();
        throw error;
      }
      return forget;
    },
  },
];

};

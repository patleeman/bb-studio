export default ({ seedPages, sleep }) => ({
  id: "float-legacy-transfer",
  packageDir: "bb-studio-float",
  fileName: "legacy-transfer-preview.png",
  privateSidebar: true,
  setup: async (client) => {
    const first = await seedPages();
    const second = await seedPages();
    const third = await seedPages();
    const ordinaryPath = `/plugins/pages/pages/${third.page.id}`;
    const ordinaryMarker = "Retained neighboring draft.";
    const items = [first.page, second.page].map((page, index) => ({
      id: page.id,
      path: `/plugins/pages/pages/${page.id}`,
      key: `path:/plugins/pages/pages/${page.id}`,
      marker: `Retained ${index === 0 ? "launch" : "review"} draft.`,
    }));
    const forget = async () => {
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbSplitCapture; delete window.bbLegacyOrdinaryEditor`).catch(() => {});
      await first.cleanup();
      await second.cleanup();
      await third.cleanup();
    };
    const action = async (label) => {
      await client.clickAriaButtonWithPointer("Floating tab actions");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', label);
      await sleep(500);
    };
    const remember = async (item) => {
      const selector = `[data-studio-main-view="${item.path}"] .ProseMirror[contenteditable="true"]`;
      await client.waitForSelector(selector);
      await client.dragBy(selector, 0, 0);
      await client.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        window.bbSplitCapture ??= {};
        window.bbSplitCapture[${JSON.stringify(item.key)}] = node;
        node.focus();
        const range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return true;
      })()`);
      await client.command("Input.insertText", { text: item.marker });
    };
    const expectState = async (placements, visibility = [true, true]) => {
      const actual = await client.evaluate(`(() => {
        const state = JSON.parse(sessionStorage.getItem('bb-studio-float:windows'));
        return ${JSON.stringify(items)}.map(item => {
          const nodes = [...document.querySelectorAll('[data-float-window] .ProseMirror[contenteditable="true"]')]
            .filter(node => node.closest('[data-float-window]')?.getAttribute('data-float-window') === item.key);
          const tab = state.tabs.find(tab => tab.key === item.key);
          return { key: item.key, same: nodes[0] === window.bbSplitCapture[item.key], count: nodes.length,
            visible: !!nodes[0]?.checkVisibility(), text: nodes[0]?.textContent, placement: tab?.placement,
            pinned: tab?.pinned, tabs: state.tabs.filter(tab => tab.key === item.key).length };
        });
      })()`);
      for (const [index, result] of actual.entries()) {
        if (!result.same || result.count !== 1 || result.visible !== visibility[index] || !result.text.includes(items[index].marker) ||
            result.placement !== placements[index] || result.pinned !== (index === 0) || result.tabs !== 1)
          throw new Error(`Split/swap lost a live companion: ${JSON.stringify(actual)}`);
      }
    };
    try {
      await client.navigate(ordinaryPath);
      await client.waitForText("Offline mode launch", 90000);
      await client.waitForSelector(`[data-studio-tab="pages:${third.page.id}"]`);
      await client.navigate(items[1].path);
      await client.waitForText("Offline mode launch", 90000);
      await client.waitForSelector(`[data-studio-tab="pages:${items[1].id}"]`);
      await client.navigate(items[0].path);
      await client.waitForText("Offline mode launch", 90000);
      const native = await client.evaluate(`typeof window.__bbPluginRuntime?.pluginSdkApp?.experimental_CompanionOutlet === 'function'`);
      if (native) throw new Error("float-legacy-transfer requires the stable host without native companion support");
      await remember(items[0]);
      await client.openContextMenu(`[data-studio-tab="pages:${items[0].id}"] a`);
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      await client.waitForSelector(`[data-float-window="${items[0].key}"] .ProseMirror`);
      await action("Pin tab");
      await client.dragBy(`[data-studio-tab="pages:${items[1].id}"] a`, 0, 0);
      await remember(items[1]);
      await action("Swap with main view");
      await expectState(["main", "floating"]);
      await action("Swap with main view");
      await expectState(["floating", "main"]);
      await client.clickAriaButtonWithPointer("Floating tab actions");
      const blocked = await client.evaluate(`(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent.trim() === 'Move to split');
        return { disabled: item?.getAttribute('aria-disabled'), title: item?.getAttribute('title') };
      })()`);
      if (blocked.disabled !== "true" || !blocked.title?.includes("reuses an existing Companions pane"))
        throw new Error(`Stable host duplicate split is not guarded: ${JSON.stringify(blocked)}`);
      await expectState(["floating", "main"]);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.clickElementWithTextAndPointer('div:has(> [data-legacy-companion-outlet]) > div > button', "Float");
      await sleep(500);
      await client.dragBy(`[data-studio-tab="pages:${third.page.id}"] a`, 0, 0);
      await client.waitForSelector(`[data-studio-main-view="${ordinaryPath}"] .ProseMirror[contenteditable="true"]`);
      await client.dragBy(`[data-studio-main-view="${ordinaryPath}"] .ProseMirror[contenteditable="true"]`, 0, 0);
      await client.evaluate(`(() => {
        const editor = window.bbLegacyOrdinaryEditor = document.querySelector('[data-studio-main-view="${ordinaryPath}"] .ProseMirror[contenteditable="true"]');
        editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return true;
      })()`);
      await client.command("Input.insertText", { text: ordinaryMarker });
      await client.dragBy(`[data-float-tab="${items[0].key}"]`, 0, 0);
      await expectState(["floating", "floating"], [true, false]);
      await action("Move to split");
      await expectState(["main", "floating"]);
      const panes = await client.evaluate(`(() => {
        const outlet = document.querySelector('[data-legacy-companion-outlet="${items[0].key}"]');
        const editor = document.querySelector('[data-studio-main-view="${ordinaryPath}"] .ProseMirror[contenteditable="true"]');
        const describe = node => ({ visible: !!node?.checkVisibility(), pane: node?.closest('[data-split-pane-id]')?.getAttribute('data-split-pane-id') });
        return { companion: describe(outlet), ordinary: describe(editor), same: editor === window.bbLegacyOrdinaryEditor, text: editor?.textContent };
      })()`);
      if (!panes.same || !panes.text?.includes(ordinaryMarker) || !panes.companion.visible || !panes.ordinary.visible || !panes.companion.pane || !panes.ordinary.pane || panes.companion.pane === panes.ordinary.pane)
        throw new Error(`Stable split beside an ordinary view did not retain distinct visible panes: ${JSON.stringify(panes)}`);
      await client.dragBy(`[data-studio-main-view="${ordinaryPath}"] .ProseMirror[contenteditable="true"]`, 0, 0);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 4, windowsVirtualKeyCode: 90 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4, windowsVirtualKeyCode: 90 });
      if (await client.evaluate(`window.bbLegacyOrdinaryEditor.textContent.includes(${JSON.stringify(ordinaryMarker)})`))
        throw new Error("The neighboring main editor lost its undo history through split");
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 12, windowsVirtualKeyCode: 90 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 12, windowsVirtualKeyCode: 90 });
      if (!await client.evaluate(`window.bbLegacyOrdinaryEditor.textContent.includes(${JSON.stringify(ordinaryMarker)})`))
        throw new Error("The neighboring main editor lost its redo history through split");
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await client.command("Input.dispatchMouseEvent", { type: "mouseWheel", x: 1100, y: 650, deltaX: 0, deltaY: 80 });
      console.log(`Verified stable editor identity, two swaps, pinned tabs, duplicate-split guard and ordinary split: ${JSON.stringify(panes)}`);
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 25 });
      await sleep(700);
    } catch (error) {
      console.error(await client.evaluate(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-5000), state: sessionStorage.getItem('bb-studio-float:windows'), outlets: [...document.querySelectorAll('[data-bb-companion-outlet]')].map(node => ({ key: node.getAttribute('data-bb-companion-outlet'), html: node.outerHTML.slice(0,900) })) })`).catch(() => "Capture context unavailable"));
      await forget();
      throw error;
    }
    return forget;
  },
});

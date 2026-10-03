export default ({ seedPages, sleep }) => ({
  id: "float-native-split",
  packageDir: "bb-studio-float",
  fileName: "native-split-preview.png",
  privateSidebar: true,
  setup: async (client) => {
    const first = await seedPages();
    const second = await seedPages();
    const items = [first.page, second.page].map((page, index) => ({
      id: page.id,
      path: `/plugins/pages/pages/${page.id}`,
      key: `path:/plugins/pages/pages/${page.id}`,
      marker: `Retained ${index === 0 ? "launch" : "review"} draft.`,
    }));
    const forget = async () => {
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbSplitCapture`).catch(() => {});
      await first.cleanup();
      await second.cleanup();
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
    const expectState = async (placements) => {
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
        if (!result.same || result.count !== 1 || !result.visible || !result.text.includes(items[index].marker) ||
            result.placement !== placements[index] || result.pinned !== (index === 0) || result.tabs !== 1)
          throw new Error(`Split/swap lost a live companion: ${JSON.stringify(actual)}`);
      }
    };
    try {
      await client.navigate(items[1].path);
      await client.waitForText("Offline mode launch", 90000);
      await client.waitForSelector(`[data-studio-tab="pages:${items[1].id}"]`);
      await client.navigate(items[0].path);
      await client.waitForText("Offline mode launch", 90000);
      const native = await client.evaluate(`typeof window.__bbPluginRuntime?.pluginSdkApp?.experimental_CompanionOutlet === 'function'`);
      if (!native) throw new Error("float-native-split requires the native companion host");
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
      await action("Move to split");
      await expectState(["main", "main"]);
      const outlets = await client.evaluate(`(() => {
        const nodes = [...document.querySelectorAll('[data-bb-companion-outlet]')];
        return nodes.map(node => ({ key: node.getAttribute('data-bb-companion-outlet'), visible: node.checkVisibility(), pane: node.closest('[data-split-pane-id]')?.getAttribute('data-split-pane-id') }));
      })()`);
      if (outlets.length !== 2 || outlets.some(outlet => !outlet.visible || !outlet.pane) || new Set(outlets.map(outlet => outlet.pane)).size !== 2)
        throw new Error(`Move to split did not produce two visible panes: ${JSON.stringify(outlets)}`);
      console.log(`Verified original editors, drafts, pins and distinct main panes: ${JSON.stringify(outlets)}`);
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

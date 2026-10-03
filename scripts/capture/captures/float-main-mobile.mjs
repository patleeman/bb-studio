export default ({ seedPages, sleep }) => ({
  id: "float-main-mobile", packageDir: "bb-studio-float", fileName: "first-main-transfer-mobile.png", privateSidebar: false,
  setup: async client => {
    const { page, cleanup } = await seedPages();
    const path = `/plugins/pages/pages/${page.id}`;
    const selector = `[data-float-window="path:${path}"] .ProseMirror[contenteditable=true]`;
    const forget = async () => {
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbFirstMainMobile`).catch(() => {});
      await cleanup();
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    };
    try {
      await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await client.navigate('/plugins/studio/studio');
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1')`);
      await client.navigate(path);
      await client.waitForSelector('.ProseMirror[contenteditable=true]');
      await client.evaluate(`(() => {
        const node = document.querySelector('.ProseMirror[contenteditable=true]');
        window.bbFirstMainMobile = node; node.focus();
        const range = document.createRange(); range.selectNodeContents(node); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return true;
      })()`);
      await client.command("Input.insertText", { text: " Mobile first-move draft." });
      await client.clickAriaButtonWithPointer("Item actions");
      await client.clickAriaButtonWithPointer("Move");
      await client.clickElementWithTextAndPointer('[role=menuitem]', "Float this");
      await client.waitForSelector(selector);
      await sleep(500);
      const actual = await client.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        const panel = document.querySelector('.bb-float-stack').getBoundingClientRect();
        return { same: node === window.bbFirstMainMobile, text: node?.textContent, visible: !!node?.checkVisibility(),
          leftMain: location.pathname !== ${JSON.stringify(path)}, count: document.querySelectorAll(${JSON.stringify(selector)}).length,
          fits: panel.left >= 0 && panel.right <= innerWidth + 1 && panel.top >= 0 && panel.bottom <= innerHeight + 1 };
      })()`);
      if (!actual.same || !actual.visible || !actual.leftMain || actual.count !== 1 || !actual.fits || !actual.text?.includes('Mobile first-move draft.'))
        throw new Error(`Mobile header move lost the initial main editor: ${JSON.stringify(actual)}`);
    } catch (error) { await forget(); throw error; }
    return forget;
  },
});

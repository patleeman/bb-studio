export default ({ seedPages, sleep }) => ({
  id: "float-drag-cleanup", packageDir: "bb-studio-float", fileName: process.env.BB_CAPTURE_SUITE_HOST === "native" ? "drag-preview-native.png" : "drag-preview.png", privateSidebar: true,
  setup: async client => {
    const { page, cleanup } = await seedPages();
    const key = `path:/plugins/pages/pages/${page.id}`;
    const source = `[data-studio-tab="pages:${page.id}"] a`;
    const forget = async () => {
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows')").catch(() => {});
      await client.command("Page.navigate", { url: "about:blank" });
      await sleep(400);
      await cleanup();
    };
    const point = () => client.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(source)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    const start = async () => {
      await client.waitForSelector(source);
      const at = await point();
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, buttons: 0 });
      await client.command("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 10; step++) {
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x + step * 40, y: at.y + step * 10, button: "left", buttons: 1 });
        await sleep(25);
      }
      await client.waitForSelector("[data-float-drop]");
      return { x: at.x + 400, y: at.y + 100 };
    };
    const cleared = async () => {
      await sleep(300);
      if (await client.evaluate("!!document.querySelector('[data-float-drop]')")) throw new Error("Float's drop zone remains after the drag ended");
    };
    try {
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForText("Launch checklist");
      await client.waitForSelector(source);
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows')");
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForSelector('.pages-editor .ProseMirror');
      await client.evaluate(`(() => { window.bbDragOriginalEditor = document.querySelector('.pages-editor .ProseMirror'); return !!window.bbDragOriginalEditor; })()`);
      const end = await start();
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", buttons: 0, clickCount: 1 });
      await cleared();
      if (await client.evaluate(`!!document.querySelector('[data-float-tab="${key}"]')`)) throw new Error("Escape opened a companion");

      const interrupted = await start();
      await client.evaluate(`(() => {
        const source = document.querySelector(${JSON.stringify(source)});
        window.bbDragSource = { node: source, parent: source.parentNode, next: source.nextSibling, ended: false };
        window.bbDragEnd = () => { window.bbDragSource.ended = true; };
        document.addEventListener('dragend', window.bbDragEnd);
        source.remove();
      })()`);
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...interrupted, button: "left", buttons: 0, clickCount: 1 });
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: interrupted.x + 10, y: interrupted.y + 10, buttons: 0 });
      await cleared();
      const missingEnd = await client.evaluate(`(() => {
        const { node, parent, next, ended } = window.bbDragSource;
        parent.insertBefore(node, next);
        document.removeEventListener('dragend', window.bbDragEnd);
        return !ended;
      })()`);
      if (!missingEnd) throw new Error("The interrupted drag unexpectedly delivered dragend; missing-event recovery was not exercised");
      if (await client.evaluate(`!!document.querySelector('[data-float-tab="${key}"]')`)) throw new Error("The interrupted drag opened a companion");

      await start();
      const destination = await client.evaluate("(() => { const r = document.querySelector('[data-float-drop]').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()");
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...destination, button: "left", buttons: 1 });
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: destination.x + 1, y: destination.y + 1, button: "left", buttons: 1 });
      await sleep(200);
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...destination, button: "left", buttons: 0, clickCount: 1 });
      await client.waitForSelector(`[data-float-window="${key}"] .pages-editor .ProseMirror`);
      await cleared();
      if (await client.evaluate(`document.querySelectorAll('[data-float-tab="${key}"]').length`) !== 1) throw new Error("The dropped page did not open exactly once");
      if (!await client.evaluate(`document.querySelector('[data-float-window="${key}"] .pages-editor .ProseMirror') === window.bbDragOriginalEditor`)) throw new Error("The dropped page replaced its original main editor");
      await start();
      const existingPanel = await client.evaluate("(() => { const r = document.querySelector('[data-float-drop]').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()");
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...existingPanel, button: "left", buttons: 1 });
      await sleep(200);
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...existingPanel, button: "left", buttons: 0, clickCount: 1 });
      await cleared();
      if (!await client.evaluate(`document.querySelectorAll('[data-float-tab="${key}"]').length === 1 && document.querySelector('[data-float-window="${key}"] .pages-editor .ProseMirror') === window.bbDragOriginalEditor`)) throw new Error("Repeated drop duplicated the tab or replaced its editor");
      console.log(`Verified drag cleanup: Escape, removed source without dragend, resumed pointer input, drop and repeated drop; original main editor retained in one companion (${process.env.BB_CAPTURE_SUITE_HOST === "native" ? "native" : "stable"})`);
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate("JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-2500)})").catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

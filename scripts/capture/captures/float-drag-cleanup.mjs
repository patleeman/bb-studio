export default ({ seedPages, sleep }) => ({
  id: "float-drag-cleanup", packageDir: "bb-studio-float", fileName: "drag-preview.png", privateSidebar: true,
  setup: async client => {
    const { page, cleanup } = await seedPages();
    const key = `path:/plugins/pages/pages/${page.id}`;
    const source = `[data-studio-tab="pages:${page.id}"] a`;
    const forget = async () => {
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows')").catch(() => {});
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
      const end = await start();
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", buttons: 0, clickCount: 1 });
      await cleared();
      if (await client.evaluate(`!!document.querySelector('[data-float-tab="${key}"]')`)) throw new Error("Escape opened a companion");

      await start();
      const destination = await client.evaluate("(() => { const r = document.querySelector('[data-float-drop]').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()");
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...destination, button: "left", buttons: 1 });
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: destination.x + 1, y: destination.y + 1, button: "left", buttons: 1 });
      await sleep(200);
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...destination, button: "left", buttons: 0, clickCount: 1 });
      await client.waitForSelector(`[data-float-window="${key}"] .pages-editor .ProseMirror`);
      await cleared();
      if (await client.evaluate(`document.querySelectorAll('[data-float-tab="${key}"]').length`) !== 1) throw new Error("The dropped page did not open exactly once");
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate("JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-2500)})").catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

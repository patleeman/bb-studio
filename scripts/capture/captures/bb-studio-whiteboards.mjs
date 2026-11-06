// Whiteboards review renders (one concept, resizable in pages). Run against a
// staged BB on main with BB_WHITEBOARDS_PHASE=before, then on the prototype
// with BB_WHITEBOARDS_PHASE=after. Each shot runs in light and dark and writes
// packages/bb-studio/assets/whiteboards-review/<phase>/<shot>-<mode>.png.
import { dismissProblems } from "./bb-studio-bot.mjs";

const phase = process.env.BB_WHITEBOARDS_PHASE === "after" ? "after" : "before";
const after = phase === "after";
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

export default ({ projectId, threadId, pluginRpc, sleep }) => {
  let seed = 1;
  const element = (type, x, y, width, height, extra = {}) => ({
    id: `wb-${type}-${seed}`, type, x, y, width, height, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent",
    fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: seed++, version: 1, versionNonce: seed * 7, isDeleted: false, boundElements: null, updated: 1,
    link: null, locked: false, ...extra,
  });
  const label = (text, x, y, width, size = 20, extra = {}) => element("text", x, y, width, size * 1.25, {
    text, originalText: text, fontSize: size, fontFamily: 5, textAlign: "center", verticalAlign: "middle", containerId: null, lineHeight: 1.25, autoResize: false, ...extra,
  });
  const checkout = () => {
    const out = [];
    [["Cart", "#a5d8ff"], ["Payment", "#ffec99"], ["Confirmation", "#b2f2bb"]].forEach(([text, fill], index) => {
      const x = index * 260;
      out.push(element("rectangle", x, 0, 180, 90, { backgroundColor: fill, roundness: { type: 3 } }));
      out.push(label(text, x + 20, 30, 140));
      if (index < 2) out.push(element("arrow", x + 190, 45, 60, 0, { points: [[0, 0], [60, 0]], startArrowhead: null, endArrowhead: "arrow" }));
    });
    out.push(element("rectangle", 260, 170, 180, 80, { backgroundColor: "#ffc9c9", roundness: { type: 3 } }));
    out.push(label("Retry", 280, 197, 140));
    out.push(element("arrow", 350, 95, 0, 70, { points: [[0, 0], [0, 70]], startArrowhead: null, endArrowhead: "arrow" }));
    out.push(element("arrow", 250, 210, -150, -110, { points: [[0, 0], [-60, 0], [-150, -110]], startArrowhead: null, endArrowhead: "arrow", strokeStyle: "dashed" }));
    out.push(label("declined card → back to cart", 0, 280, 440, 16, { textAlign: "left", strokeColor: "#868e96" }));
    return out;
  };
  const retro = () => {
    const out = [];
    [["Went well", "#b2f2bb"], ["To improve", "#ffec99"], ["Try next", "#a5d8ff"]].forEach(([text, fill], column) => {
      out.push(label(text, column * 220, 0, 200, 22));
      ["", ""].forEach((_, row) => out.push(element("rectangle", column * 220 + 20, 50 + row * 110, 160, 90, { backgroundColor: fill, roughness: 0 })));
    });
    return out;
  };

  /** A page holding a whiteboard, as /whiteboard makes it. */
  const seedBoard = async ({ title, icon, name, elements, intro }) => {
    const { drawing } = await pluginRpc("studio", "drawings.createDrawing", { name, projectId });
    if (elements.length) {
      await pluginRpc("studio", "drawings.saveDrawing", { id: drawing.id, data: JSON.stringify({ type: "excalidraw", version: 2, source: "bb-capture", elements, appState: { viewBackgroundColor: "#ffffff" }, files: {} }) });
    }
    const { page } = await pluginRpc("studio", "pages.create", {
      projectId, parentId: null, title, icon,
      markdown: [intro, "```embed\n" + JSON.stringify({ kind: "drawing", target: drawing.id }) + "\n```", "Open questions: do we retry on a timeout too?"].join("\n\n"),
    });
    return { drawing, page };
  };
  const seedAll = async () => {
    const boards = [
      await seedBoard({ title: "Checkout redesign", icon: "🛒", name: "Checkout flow", elements: checkout(), intro: "The checkout steps, with the retry path we agreed on Tuesday." }),
      await seedBoard({ title: "Sprint 42 retro", icon: "🔁", name: "Retro board", elements: retro(), intro: "Add a note to each column before Friday." }),
    ];
    const made = [];
    return {
      boards,
      made,
      cleanup: async () => {
        for (const { page, drawing } of [...boards, ...made]) {
          await pluginRpc("studio", "pages.remove", { id: page.id }).catch(() => {});
          await pluginRpc("studio", "drawings.deleteDrawing", { id: drawing.id }).catch(() => {});
        }
      },
    };
  };
  const ready = async (client, mode, keepMouse) => {
    const dark = await client.evaluate(`document.documentElement.classList.contains("dark")`);
    if (dark !== (mode === "dark")) throw new Error(`BB isn't in ${mode} mode`);
    if (!keepMouse) await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1430, y: 990 });
    await sleep(800);
  };
  const openPage = async (client, page, drawing) => {
    await client.navigate(`/plugins/studio/studio/pages/${page.id}`);
    await client.waitForSelector(`svg[data-whiteboard="${drawing.id}"]`, 30000);
    await dismissProblems(client);
    await client.waitForText("Open questions");
  };
  const svgHeight = (client, id) => client.evaluate(`Math.round(document.querySelector('svg[data-whiteboard="${id}"]').getBoundingClientRect().height)`);

  /** The thread, with the page open in its side panel's Studio tab, scrolled to the whiteboard. */
  const pageInThread = async (client, page, drawing) => {
    // The thread's Studio tab lists the thread's items: link the page to it, as New there does.
    const now = Date.now();
    await pluginRpc("studio", "linkItemThread", { thread: { threadId, ref: { pluginId: "pages", id: page.id }, role: "created", state: "active", createdAt: now, updatedAt: now, metadata: {} } });
    await client.navigate(`/projects/${projectId}/threads/${threadId}`);
    await sleep(1500);
    await dismissProblems(client);
    await client.evaluate(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Show right panel"))?.click()`);
    await sleep(800);
    await client.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((each) => each.getAttribute("aria-label")?.startsWith("Open new tab")); if (!button) throw new Error("No new-tab button"); button.click(); })()`);
    await sleep(800);
    await client.clickButtonText("Studio");
    const row = `[data-studio-item="/plugins/studio/studio/pages/${page.id}"]`;
    // The tab remembers the last item it showed; a page an earlier capture deleted shows "Page unavailable".
    for (let i = 0; i < 60; i++) {
      if (await client.evaluate(`!!document.querySelector(${JSON.stringify(row)})`)) break;
      if (await client.hasText("Back to Studio", 300)) await client.clickButtonText("Back to Studio");
      await sleep(500);
    }
    await client.waitForSelector(row, 5000);
    await client.evaluate(`document.querySelector(${JSON.stringify(row)}).click()`);
    await client.waitForSelector(`svg[data-whiteboard="${drawing.id}"]`, 30000);
    await client.waitForText("Open questions");
    await client.evaluate(`document.querySelector('svg[data-whiteboard="${drawing.id}"]').scrollIntoView({ block: "center" })`);
    await sleep(600);
  };
  const inThread = (client) => client.evaluate(`location.pathname.includes("/threads/")`);
  const scrollOf = (client, id) => client.evaluate(`(() => { let el = document.querySelector('svg[data-whiteboard="${id}"]'); while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible")) el = el.parentElement; return el ? Math.round(el.scrollTop) : -1; })()`);

  const shots = {
    // The Studio sidebar and library, filtered to whiteboards.
    sidebar: { showSidebar: true, run: async (client, seeded) => {
      await client.navigate("/plugins/studio/studio/collection");
      await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:collection:view', 'grid'); localStorage.setItem('studio:query:all', 'kind:drawing')`);
      await client.navigate("/plugins/studio/studio/collection");
      await client.waitForSelector('nav[aria-label="Studio"]', 30000);
      await dismissProblems(client);
      for (const text of ["Checkout flow", "Retro board"]) await client.waitForText(text, 30000);
      const row = await client.evaluate(`!!document.querySelector('nav[aria-label="Studio"] [data-kind="drawing"]')`);
      if (row !== after) throw new Error(after ? "No Whiteboards row in the sidebar" : "main unexpectedly has a Whiteboards row");
    } },
    // The New menu beside the tab strip.
    "new-menu": { showSidebar: true, run: async (client) => {
      await client.navigate("/plugins/studio/studio/collection");
      await client.evaluate(`localStorage.removeItem('bb:studio-workspace:v1'); localStorage.setItem('studio:query:all', ''); localStorage.setItem('studio:collection:view', 'list')`);
      await client.navigate("/plugins/studio/studio/collection");
      await client.waitForSelector('input[aria-label="Search and filter studio"]', 30000);
      await dismissProblems(client);
      await client.evaluate(`new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const button = [...document.querySelectorAll('[data-studio-workspace-tabs] button[aria-label="New item"]')].find(each => each.checkVisibility() && !each.disabled);
          if (button) { button.focus(); return resolve(true); }
          if (Date.now() - started > 15000) return reject(new Error('No enabled New item'));
          setTimeout(tick, 100);
        };
        tick();
      })`, true);
      for (const type of ["rawKeyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
      await client.waitForSelector('[role="menuitem"]');
      const items = await client.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].map(each => each.innerText.trim())`);
      if (items.includes("Whiteboard") !== after) throw new Error(`New menu: ${JSON.stringify(items)}`);
      if (after && items.indexOf("Whiteboard") !== items.indexOf("Page") + 1) throw new Error(`Whiteboard isn't after Page: ${JSON.stringify(items)}`);
      await sleep(400);
      return { keepMouse: true };
    } },
    // The page's slash menu, filtered to "dra" (drawing, draw).
    slash: { run: async (client, seeded) => {
      const { page, drawing } = seeded.boards[0];
      await openPage(client, page, drawing);
      await client.evaluate(`(() => {
        const paragraph = [...document.querySelectorAll('.bn-editor [data-content-type="paragraph"]')].find(each => each.textContent.includes("Open questions"));
        const text = paragraph.querySelector('.bn-inline-content');
        const range = document.createRange();
        range.selectNodeContents(text);
        range.collapse(false);
        text.closest('[contenteditable="true"]').focus();
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      })()`);
      await sleep(200);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await sleep(200);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "/", code: "Slash", text: "/" });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "/", code: "Slash" });
      await sleep(300);
      await client.command("Input.insertText", { text: "dra" });
      await client.waitForSelector(".bn-suggestion-menu", 10000);
      await sleep(500);
      const items = await client.evaluate(`document.querySelector('.bn-suggestion-menu').innerText.split("\\n").map(each => each.trim())`);
      if (!items.includes("Whiteboard")) throw new Error(`Slash menu: ${JSON.stringify(items)}`);
      if (items.includes("Drawing") === after) throw new Error(`Slash menu: ${JSON.stringify(items)}`);
      return { keepMouse: true };
    } },
    // The page with its whiteboard at the default height.
    "page-default": { run: async (client, seeded) => {
      const { page, drawing } = seeded.boards[0];
      await openPage(client, page, drawing);
      const height = await svgHeight(client, drawing.id);
      if (height !== 320) throw new Error(`Default height is ${height}`);
      const handle = await client.evaluate(`!!document.querySelector('[data-whiteboard-resize]')`);
      if (handle !== after) throw new Error(`Resize handle present: ${handle}`);
    } },
    // Resized taller by dragging the handle, saved on the page's block.
    "page-resized": { only: "after", run: async (client, seeded) => {
      const { page, drawing } = seeded.boards[0];
      await openPage(client, page, drawing);
      await client.dragBy("[data-whiteboard-resize]", 0, 260);
      await sleep(1500);
      const height = await svgHeight(client, drawing.id);
      if (height !== 580) throw new Error(`Resized height is ${height}`);
      const { markdown } = await pluginRpc("studio", "pages.markdown", { id: page.id });
      if (!markdown.includes('"height":580')) throw new Error(`The page didn't save the height: ${markdown}`);
      // Reloaded, the page keeps it.
      await openPage(client, page, drawing);
      if (await svgHeight(client, drawing.id) !== 580) throw new Error("The height didn't survive a reload");
      // Hover the handle so it shows.
      await client.evaluate(`document.querySelector('[data-whiteboard-resize]').scrollIntoView({ block: "center" })`);
      await sleep(300);
      const at = await client.evaluate(`(() => { const r = document.querySelector('[data-whiteboard-resize]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await sleep(400);
      return { keepMouse: true };
    } },
    // In a thread: the page beside the transcript, in the side panel's Studio tab.
    "thread-page": { run: async (client, seeded) => {
      const { page, drawing } = seeded.boards[0];
      await pageInThread(client, page, drawing);
      if (!(await inThread(client))) throw new Error("Not in the thread");
    } },
    // In a thread: expand. On main it jumps to the Studio app tab; on the prototype it fills the panel.
    "thread-expand": { run: async (client, seeded) => {
      const { page, drawing } = seeded.boards[0];
      await pageInThread(client, page, drawing);
      await client.clickButtonText(after ? "Open full size" : "Open drawing");
      await client.waitForSelector("canvas.excalidraw__canvas", 30000);
      await sleep(1500);
      const stayed = await inThread(client);
      if (stayed !== after) throw new Error(after ? "Expanding left the thread" : "main unexpectedly stayed in the thread");
      if (after && !(await client.evaluate(`!!document.querySelector('[data-whiteboard-full-size="${drawing.id}"]')`))) throw new Error("No in-place full size");
      if (after && !(await client.evaluate(`[...document.querySelectorAll('[data-whiteboard-full-size] button')].some((b) => b.checkVisibility() && b.textContent.trim() === "Page")`))) throw new Error("Full size has no visible Page (Back)");
    } },
    // In a thread: Esc returns to the page at the same scroll.
    "thread-back": { only: "after", run: async (client, seeded) => {
      const { page, drawing } = seeded.boards[0];
      await pageInThread(client, page, drawing);
      const before = await scrollOf(client, drawing.id);
      await client.clickButtonText("Open full size");
      await client.waitForSelector("canvas.excalidraw__canvas", 30000);
      await sleep(1200);
      await client.evaluate(`document.activeElement?.blur?.()`);
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(800);
      if (await client.evaluate(`!!document.querySelector('[data-whiteboard-full-size]')`)) throw new Error("Esc didn't leave full size");
      if (!(await inThread(client))) throw new Error("Not in the thread");
      const now = await scrollOf(client, drawing.id);
      if (now !== before) throw new Error(`The page scrolled from ${before} to ${now}`);
      // Back (the editor's header) works too.
      await client.clickButtonText("Open full size");
      await client.waitForSelector("canvas.excalidraw__canvas", 30000);
      await client.evaluate(`(() => { const back = [...document.querySelectorAll('[data-whiteboard-full-size] button')].find((b) => /Page|Back/.test(b.getAttribute("aria-label") ?? "") || /Page/.test(b.textContent)); if (!back) throw new Error("No Back in full size"); back.click(); return true; })()`);
      await sleep(800);
      if (await client.evaluate(`!!document.querySelector('[data-whiteboard-full-size]')`)) throw new Error("Back didn't leave full size");
      if (await scrollOf(client, drawing.id) !== before) throw new Error("Back lost the scroll");
    } },
    // Open full size in the Studio app tab.
    "full-size": { run: async (client, seeded) => {
      const { page, drawing } = seeded.boards[0];
      await openPage(client, page, drawing);
      const path = await client.evaluate("location.pathname");
      await client.clickButtonText(after ? "Open full size" : "Open drawing");
      // main opens a workspace tab; the prototype expands over the page, in the same tab.
      await client.waitForSelector(after ? `[data-whiteboard-full-size="${drawing.id}"]` : `[data-studio-workspace-editor="/plugins/studio/studio/drawings/${drawing.id}"]`, 30000);
      if (after && (await client.evaluate("location.pathname")) !== path) throw new Error("Full size navigated away from the page");
      if (after && !(await client.evaluate(`[...document.querySelectorAll('[data-whiteboard-full-size] button')].some((b) => b.checkVisibility() && b.textContent.trim() === "Page")`))) throw new Error("Full size has no visible Page (Back)");
      await client.waitForSelector("canvas.excalidraw__canvas", 30000);
      await client.waitForText("Saved", 30000);
      await sleep(1500);
    } },
    // An empty whiteboard: /whiteboard's on main; New → Whiteboard's page on the prototype.
    empty: { run: async (client, seeded) => {
      if (!after) {
        const board = await seedBoard({ title: "Onboarding ideas", icon: "💡", name: "", elements: [], intro: "Sketch the first-run flow here." });
        seeded.made.push(board);
        await openPage(client, board.page, board.drawing);
        await client.waitForText("Empty whiteboard");
        return;
      }
      const { drawingId, page } = await pluginRpc("studio", "drawings.newWhiteboardPage", { projectId });
      seeded.made.push({ page, drawing: { id: drawingId } });
      await client.navigate(page.href);
      await client.waitForSelector(`svg[data-whiteboard="${drawingId}"]`, 30000);
      await dismissProblems(client);
      await client.waitForText("Empty whiteboard");
      const height = await svgHeight(client, drawingId);
      if (height !== 640) throw new Error(`New → Whiteboard's height is ${height}`);
    } },
  };

  return Object.entries(shots)
    .filter(([, shot]) => !shot.only || shot.only === phase)
    .flatMap(([name, shot]) => ["light", "dark"].map((mode) => ({
      id: `whiteboards-${name}-${mode}`,
      packageDir: "bb-studio",
      fileName: `whiteboards-review/${phase}/${name}-${mode}.png`,
      ...(shot.showSidebar ? { showSidebar: true } : { privateSidebar: true }),
      setup: async (client) => {
        await scheme(client, mode);
        const seeded = await seedAll();
        try {
          const result = await shot.run(client, seeded);
          await ready(client, mode, result?.keepMouse);
        } catch (error) {
          await seeded.cleanup();
          await scheme(client, "");
          throw error;
        }
        return async () => {
          await seeded.cleanup();
          await scheme(client, "");
        };
      },
    })));
};

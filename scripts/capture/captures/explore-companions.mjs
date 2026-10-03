import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(new URL("../../../packages/bb-studio-explore/package.json", import.meta.url));
const Database = require("better-sqlite3");

export default ({ projectId, threadId, pluginRpc, sleep }) => ({
  id: "explore-companions", packageDir: "bb-studio-explore", fileName: "companion-preview.png", privateSidebar: true,
  setup: async client => {
    const dataDir = process.env.BB_DATA_DIR;
    const manifest = await readFile(resolve(dataDir, "../capture.env"), "utf8");
    if (!manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`) || !manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`)) throw new Error("Explore fixtures require an isolated staged BB capture.env");
    const db = new Database(join(dataDir, "plugins/explore/data.db"), { fileMustExist: true });
    const id = `expl_capture_${randomUUID()}`, jobId = `job_capture_${randomUUID()}`;
    const label = "How the upload queue retries", now = Date.now();
    let page;
    const path = `/plugins/explore/explainers/${id}`, key = `path:${path}`;
    const root = `[data-float-window="${key}"]`, panel = `${root} [data-explainer-panel="${id}"]`;
    const forget = async () => {
      db.prepare("DELETE FROM explore_jobs WHERE id = ?").run(jobId);
      db.prepare("DELETE FROM explore_explainers WHERE id = ?").run(id);
      db.close();
      if (page) await pluginRpc("pages", "remove", { id: page.id });
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbExploreFrame; delete window.bbExploreScroll`).catch(() => {});
    };
    try {
      const html = '<!doctype html><html><head><style>body{font:16px system-ui;margin:28px;color:#19383d;background:#f6faf9}h1{font-size:28px}section{margin:24px 0;padding:18px;border:1px solid #b9cdca;border-radius:10px}code{font-size:14px}</style></head><body><h1>How the upload queue retries</h1><p>A saved explainer from the Orbit demo repository.</p><section><h2>1. Queue an upload</h2><p>The oldest pending upload runs first.</p></section><section><h2>2. Retry after a failure</h2><p>The worker waits before its next attempt.</p><code>delay = min(base × 2 ** attempt, cap)</code></section><section><h2>3. Keep the delay in milliseconds</h2><p>The timeout and its cap use the same unit.</p></section></body></html>';
      ({ page } = await pluginRpc("pages", "create", { title: label, projectId, parentId: null, markdown: `\`\`\`html\n${html}\n\`\`\`` }));
      db.prepare("INSERT INTO explore_explainers (id,key,thread_id,message_id,emoji,label,project_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, id, threadId, `msg_capture_${id}`, "🏗️", label, projectId, "generating", now, now);
      db.prepare("INSERT INTO explore_jobs (id,explainer_id,kind,status,label,detail,progress,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(jobId, id, "generate", "writing", "Writing", "Investigating the upload queue", 45, now, now);
      const seeded = await pluginRpc("explore", "explainers", {});
      if (!seeded.explainers.some(explainer => explainer.id === id)) throw new Error("Explore's live RPC cannot read its seeded fixture");
      await client.navigate("/plugins/explore/explainers");
      await client.waitForText(label);
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1')`);
      await client.dragBy(`button[data-explainer-open="${id}"]`, 0, 0);
      await client.waitForSelector(panel);
      await client.waitForText("Investigating the upload queue");
      await client.waitForText("45%");
      await client.dragBy(`button[data-explainer-open="${id}"]`, 0, 0);
      const count = await client.evaluate(`document.querySelectorAll(${JSON.stringify(panel)}).length`);
      if (count !== 1) throw new Error(`Repeated Explore creates ${count} panels`);

      db.prepare("UPDATE explore_jobs SET status='ready',label='Ready',detail='Saved in Pages',progress=100,updated_at=? WHERE id=?").run(now + 1, jobId);
      db.prepare("UPDATE explore_explainers SET status='ready',page_id=?,generated_at=?,updated_at=? WHERE id=?").run(page.id, now + 1, now + 1, id);
      await client.waitForSelector(`${panel} iframe`);
      await client.dragBy('[data-float-resize="nw"]', -240, 0);
      const scrollReady = `(() => {
        const frame = document.querySelector(${JSON.stringify(`${panel} iframe`)});
        let scroller = frame.parentElement;
        while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
        if (!scroller) throw new Error('Explainer has no scroll container');
        if (scroller.scrollHeight - scroller.clientHeight < 80) return false;
        window.bbExploreFrame = frame;
        window.bbExploreScroll = scroller; scroller.scrollTop = 80;
        return true;
      })()`;
      const deadline = Date.now() + 10000;
      while (!(await client.evaluate(scrollReady))) {
        if (Date.now() > deadline) throw new Error("Explainer did not load its scrollable document");
        await sleep(200);
      }
      await client.clickAriaButtonWithPointer("Floating tab actions");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Pin tab");
      await client.clickElementWithTextAndPointer(`${panel} button`, "Open in Pages");
      const pageRoot = `[data-float-window="path:/plugins/pages/pages/${page.id}"]`;
      await client.waitForSelector(`${pageRoot} .pages-editor .ProseMirror`);
      const retained = async visible => {
        const state = await client.evaluate(`(() => {
          const frame = document.querySelector(${JSON.stringify(`${panel} iframe`)});
          return { same: frame === window.bbExploreFrame, visible: !!frame?.checkVisibility(), scroll: window.bbExploreScroll?.scrollTop, height: frame?.style.height,
            tabs: document.querySelectorAll(${JSON.stringify(panel)}).length,
            pinned: JSON.parse(sessionStorage.getItem('bb-studio-float:windows')).tabs.some(tab => tab.key === ${JSON.stringify(key)} && tab.pinned) };
        })()`);
        if (!state.same || state.visible !== visible || state.tabs !== 1 || !state.pinned || (visible && state.scroll !== 80)) throw new Error(`Explainer state lost: ${JSON.stringify(state)}`);
      };
      await retained(false);
      await client.clickElementWithTextAndPointer('[role="tab"]', label);
      await retained(true);
      await client.clickElementWithTextAndPointer(`${panel} button`, "Open in Pages");
      if (await client.evaluate(`document.querySelectorAll(${JSON.stringify(`${pageRoot} .pages-editor .ProseMirror`)}).length`) !== 1) throw new Error("Open in Pages duplicates its editor");
      await client.clickElementWithTextAndPointer('[role="tab"]', label);
      await retained(true);
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate(`JSON.stringify({ path:location.pathname, text:document.body.innerText.slice(-3000) })`).catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

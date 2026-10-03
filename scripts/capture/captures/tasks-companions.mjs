import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(new URL("../../../packages/bb-studio/src/modules/tasks/package.json", import.meta.url));
const Database = require("better-sqlite3");

export default ({ projectId, seedPages, pluginRpc, bbCli, sleep }) => ({
  id: "tasks-companions", packageDir: "bb-studio/src/modules/tasks", fileName: "companion-handoffs.png", privateSidebar: true,
  setup: async client => {
    const dataDir = process.env.BB_DATA_DIR;
    const manifest = await readFile(resolve(dataDir, "../capture.env"), "utf8");
    if (!manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`) || !manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`)) throw new Error("Task fixtures require an isolated staged BB capture.env");
    const { page, cleanup } = await seedPages();
    const directory = await mkdtemp(join(tmpdir(), "bb-task-companions-"));
    const attachment = join(directory, "handoff-review.txt");
    await writeFile(attachment, "Keep this reply attachment with its handoff thread.\n");
    const threads = []; let boardId, task;
    const forget = async () => {
      if (boardId) await pluginRpc("studio", "tasks_boardDelete", { id: boardId }).catch(() => {});
      for (const threadId of threads) await bbCli(["thread", "delete", threadId, "--yes", "--json"]);
      await cleanup(); await rm(directory, { recursive: true, force: true });
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows'); delete window.bbTaskDraft").catch(() => {});
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    };
    const key = id => `thread:${id}`;
    const draft = id => `[data-float-window=${JSON.stringify(key(id))}] [data-promptbox] [contenteditable=true]`;
    const selected = id => `[data-float-tab=${JSON.stringify(key(id))}][aria-selected=true]`;
    const click = async (selector, label) => {
      const text = await client.evaluate(`(() => {
        const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent?.trim().startsWith(${JSON.stringify(label)}));
        if (!node) throw new Error(${JSON.stringify(`Missing task action: ${label}`)});
        node.scrollIntoView({ block: 'center' }); return node.textContent.trim();
      })()`);
      await sleep(200);
      await client.clickElementWithTextAndPointer(selector, text);
    };
    const assertMain = async () => {
      if (await client.evaluate("location.pathname") !== `/plugins/studio/tasks/${task.id}`) throw new Error("A handoff replaced the main task instead of opening a companion");
    };
    const assertRetained = async () => {
      const state = await client.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(draft(threads[0]))}); return {
        same: node === window.bbTaskDraft, visible: !!node?.checkVisibility(), text: node?.textContent,
        file: node?.closest('[data-float-window]')?.textContent.includes('handoff-review.txt'),
        tabs: document.querySelectorAll(${JSON.stringify(`[data-float-tab=${JSON.stringify(key(threads[0]))}]`)}).length }; })()`);
      if (!state.same || !state.visible || !state.text?.includes("Keep this handoff reply.") || !state.file || state.tabs !== 1) throw new Error(`Task handoff lost its draft: ${JSON.stringify(state)}`);
      await assertMain();
    };
    try {
      ({ board: { id: boardId } } = await pluginRpc("studio", "tasks_boardCreate", { title: "Companion handoff checks", projectId }));
      ({ task } = await pluginRpc("studio", "tasks_create", { title: "Review the offline launch", boardId, projectId, assignee: "agent", status: "review", description: "Check the rollout plan and retain feedback beside this task." }));
      for (let index = 0; index < 3; index++) {
        const { threadId } = await pluginRpc("pages", "work", { id: page.id, request: {
          projectId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", permissionMode: "full",
          executionInputSources: {}, environment: { type: "project-default" },
          input: [{ type: "text", text: "Staged handoff fixture. Do not run.", mentions: [] }], sendAt: Date.now() + 30 * 86400000,
        }});
        threads.push(threadId);
      }
      const db = new Database(join(dataDir, "plugins/studio-tasks/data.db"), { fileMustExist: true });
      try {
        const at = Date.now();
        const insert = db.prepare("INSERT INTO task_handoffs (thread_id,task_id,state,note,agent,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
        insert.run(threads[0], task.id, "ready", "Ready for your review.", "Current review", at, at);
        insert.run(threads[1], task.id, "replied", "Earlier investigation.", "Earlier investigation", at - 60000, at - 60000);
      } finally { db.close(); }
      await pluginRpc("studio", "tasks_link", { id: task.id, link: { target: "thread", pluginId: null, itemId: threads[2], label: "Release discussion", href: `/threads/${threads[2]}` } });
      const live = await pluginRpc("studio", "tasks_get", { id: task.id });
      if (live.handoffs.length !== 2 || live.handoffs[0].threadId !== threads[0] || !live.links.some(link => link.itemId === threads[2])) throw new Error("Tasks' live RPC cannot read the seeded handoffs and link");
      await client.navigate(`/plugins/studio/tasks/${task.id}`);
      await client.waitForText("Ready for your review.");
      await click("button", "Open thread");
      await client.waitForSelector(selected(threads[0])); await client.waitForSelector(draft(threads[0]));
      await client.dragBy(draft(threads[0]), 0, 0); await client.command("Input.insertText", { text: "Keep this handoff reply." });
      const doc = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: doc.root.nodeId, selector: `[data-float-window=${JSON.stringify(key(threads[0]))}] input[type=file]` });
      if (!input.nodeId) throw new Error("The handoff composer has no attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
      await client.waitForText("handoff-review.txt");
      await client.evaluate(`(() => { window.bbTaskDraft = document.querySelector(${JSON.stringify(draft(threads[0]))}); return true; })()`);
      await click("summary", "Earlier handoffs");
      await click("details button", "Earlier investigation");
      await client.waitForSelector(selected(threads[1])); await assertMain();
      await click("button", "Release discussion");
      await client.waitForSelector(selected(threads[2])); await assertMain();
      await click("button", "Release discussion");
      await client.waitForSelector(selected(threads[2]));
      for (const threadId of threads) {
        const count = await client.evaluate(`document.querySelectorAll(${JSON.stringify(`[data-float-tab=${JSON.stringify(key(threadId))}]`)}).length`);
        if (count !== 1) throw new Error(`Task navigation opened ${count} tabs for ${threadId}`);
      }
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await click("button", "Open thread");
      await client.waitForSelector(selected(threads[0])); await assertRetained();
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await click("button", "Open thread"); await assertRetained();
      await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await sleep(700);
      await client.dragBy(draft(threads[0]), 0, 0);
      await client.waitForText("handoff-review.txt"); await assertRetained();
      const clipped = await client.evaluate(`(() => [...document.querySelectorAll(${JSON.stringify(`[data-float-window=${JSON.stringify(key(threads[0]))}] [data-promptbox] button`)} )].filter(node => node.checkVisibility()).filter(node => { const r = node.getBoundingClientRect(); return r.width <= 0 || r.left < 0 || r.right > innerWidth || r.bottom > innerHeight; }).map(node => node.getAttribute('aria-label') ?? node.innerText))()`);
      if (clipped.length) throw new Error(`The phone handoff composer clips controls: ${JSON.stringify(clipped)}`);
      await client.capture(join(process.cwd(), "packages/bb-studio/src/modules/tasks/assets/companion-handoffs-mobile.png"));
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await sleep(500); await assertRetained();
    } catch (error) {
      console.error(await client.evaluate("JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-3500)})").catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export default ({ projectId, pluginRpc, bbCli, sleep }) => ({
  id: "tasks-dispatch", packageDir: "bb-studio-tasks", fileName: "companion-dispatch.png", privateSidebar: true,
  setup: async client => {
    const dataDir = process.env.BB_DATA_DIR;
    const manifest = await readFile(resolve(dataDir, "../capture.env"), "utf8");
    if (!manifest.includes(`export BB_DATA_DIR=${JSON.stringify(dataDir)}`) || !manifest.includes(`export BB_SERVER_URL=${process.env.BB_SERVER_URL}`)) throw new Error("Task dispatch requires an isolated staged BB capture.env");
    const directory = await mkdtemp(join(tmpdir(), "bb-task-dispatch-"));
    const attachment = join(directory, "dispatch-review.txt");
    await writeFile(attachment, "Retain this unsent reply beside the task.\n");
    let boardId, bot, agentTask, botTask;
    const threads = new Set();
    const botReplies = [];
    const onWire = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Network.responseReceived" && message.params.response.url.endsWith("/api/v1/plugins/studio-tasks/rpc/handOffBot")) botReplies.push(message.params);
    };
    client.socket.addEventListener("message", onWire);
    await client.command("Network.enable");
    const forget = async () => {
      client.socket.removeEventListener("message", onWire);
      for (const task of [agentTask, botTask].filter(Boolean)) {
        const result = await pluginRpc("studio-tasks", "get", { id: task.id }).catch(() => null);
        for (const handoff of result?.handoffs ?? []) threads.add(handoff.threadId);
      }
      for (const threadId of threads) await bbCli(["thread", "delete", threadId, "--yes", "--json"]);
      if (boardId) await pluginRpc("studio-tasks", "boardDelete", { id: boardId });
      if (bot) {
        await pluginRpc("bot-teams", "retire", { id: bot.id, retired: true });
      }
      await rm(directory, { recursive: true, force: true });
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows'); delete window.bbDispatchDraft").catch(() => {});
    };
    const taskPath = task => `/plugins/studio-tasks/tasks/${task.id}`;
    const root = id => `[data-float-window=${JSON.stringify(`thread:${id}`)}]`;
    const prompt = id => `${root(id)} [data-promptbox] [contenteditable=true]`;
    const selected = id => `[data-float-tab=${JSON.stringify(`thread:${id}`)}][aria-selected=true]`;
    const handoff = async task => {
      const deadline = Date.now() + 30000;
      do {
        const result = await pluginRpc("studio-tasks", "get", { id: task.id });
        if (result.handoffs[0]) { threads.add(result.handoffs[0].threadId); return result; }
        await sleep(100);
      } while (Date.now() < deadline);
      throw new Error("Task dispatch did not record a handoff");
    };
    const draft = async threadId => {
      await client.waitForSelector(selected(threadId)); await client.waitForSelector(prompt(threadId));
      await client.dragBy(prompt(threadId), 0, 0); await client.command("Input.insertText", { text: "Keep the dispatch feedback draft." });
      const doc = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: doc.root.nodeId, selector: `${root(threadId)} input[type=file]` });
      if (!input.nodeId) throw new Error("The dispatched conversation has no attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
      await client.waitForText("dispatch-review.txt");
      await client.evaluate(`(() => { window.bbDispatchDraft = document.querySelector(${JSON.stringify(prompt(threadId))}); return true; })()`);
    };
    const retained = async (task, threadId) => {
      const state = await client.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(prompt(threadId))}); return {
        same: node === window.bbDispatchDraft, visible: !!node?.checkVisibility(), text: node?.textContent,
        file: node?.closest('[data-float-window]')?.textContent.includes('dispatch-review.txt'),
        tabs: document.querySelectorAll(${JSON.stringify(`[data-float-tab=${JSON.stringify(`thread:${threadId}`)}]`)}).length,
        path: location.pathname }; })()`);
      if (!state.same || !state.visible || !state.text?.includes("Keep the dispatch feedback draft.") || !state.file || state.tabs !== 1 || state.path !== taskPath(task)) throw new Error(`Dispatch lost its originating companion: ${JSON.stringify(state)}`);
    };
    try {
      ({ board: { id: boardId } } = await pluginRpc("studio-tasks", "boardCreate", { title: "Live handoff checks", projectId }));
      const description = "This is a staged UI verification. Reply with one sentence acknowledging the fixture. Do not inspect or edit files, run commands, or create more threads. Only update this task to review if required.";
      ({ task: agentTask } = await pluginRpc("studio-tasks", "create", { title: "Verify an agent handoff", projectId, boardId, description }));
      await client.navigate(taskPath(agentTask));
      await client.waitForText("No agent yet.");
      await client.clickElementWithTextAndPointer("button", "Hand off");
      await client.waitForSelector('textarea[aria-label="Note for the agent"]');
      const panel = 'div:has(> textarea[aria-label="Note for the agent"])';
      await client.evaluate(`document.querySelector(${JSON.stringify(panel)}).scrollIntoView({ block: 'center' })`);
      await sleep(200);
      await client.clickElementWithTextAndPointer(`${panel} button`, "Project folder");
      await client.dragBy('textarea[aria-label="Note for the agent"]', 0, 0);
      await client.command("Input.insertText", { text: "Acknowledge this deterministic fixture without editing the staged repository." });
      await client.waitForSelector('button:not(:disabled)');
      const deadline = Date.now() + 15000;
      while (!(await client.evaluate(`[...document.querySelectorAll(${JSON.stringify(`${panel} button`)})].some(button => button.textContent.trim() === 'Hand off' && !button.disabled)`))) {
        if (Date.now() > deadline) throw new Error("The handoff provider defaults did not load");
        await sleep(100);
      }
      await client.clickElementWithTextAndPointer(`${panel} button`, "Hand off");
      await client.waitForText("Handed to an agent");
      const agent = await handoff(agentTask), agentThread = agent.handoffs[0].threadId;
      if (!agent.links.some(link => link.target === "thread" && link.itemId === agentThread)) throw new Error("Agent handoff did not link its created conversation");
      await client.clickElementWithTextAndPointer('[data-sonner-toast] button', "Open thread");
      await draft(agentThread);
      const agentText = await client.evaluate(`document.querySelector(${JSON.stringify(root(agentThread))}).textContent`);
      if (!agentText.includes(agentTask.id) || !agentText.includes("Acknowledge this deterministic fixture")) throw new Error("The live handoff conversation lost its task context or edited note");
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await client.clickElementWithTextAndPointer("button", "Open thread");
      await client.waitForSelector(selected(agentThread)); await retained(agentTask, agentThread);

      bot = await pluginRpc("bot-teams", "create", { name: "Companion dispatch verifier", description: "A temporary staged handoff fixture.", mission: description,
        intervalMinutes: 0, limits: { turnsPerHour: 3, turnsPerDay: 3, minutesPerTurn: 1, concurrentForks: 1 } });
      ({ task: botTask } = await pluginRpc("studio-tasks", "create", { title: "Verify a bot handoff", projectId, boardId, description, assignee: `bot:${bot.id}` }));
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await client.navigate(taskPath(botTask));
      await client.waitForText("Send to bot");
      await client.clickElementWithTextAndPointer("button", "Send to bot");
      const sent = await handoff(botTask), botThread = sent.handoffs[0].threadId;
      await client.waitForSelector(selected(botThread));
      const profile = await pluginRpc("bot-teams", "threadProfile", { threadId: botThread });
      if (profile?.botId !== bot.id || !sent.links.some(link => link.target === "thread" && link.itemId === botThread && link.label.startsWith("Bot work:"))) throw new Error("Bot handoff targeted a different profile or conversation");
      await draft(botThread);
      const botText = await client.evaluate(`document.querySelector(${JSON.stringify(root(botThread))}).textContent`);
      if (!botText.includes(botTask.id)) throw new Error("The live bot conversation lost its task context");
      await bbCli(["thread", "update", botThread, "--title", "Reviewed bot handoff", "--json"]);
      await pluginRpc("studio-tasks", "link", { id: botTask.id, link: { target: "thread", pluginId: null, itemId: botThread, label: "Reviewed bot handoff", href: `/threads/${botThread}` } });
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await client.clickElementWithTextAndPointer("button", "Send to bot");
      await client.waitForSelector(selected(botThread));
      await client.dragBy(prompt(botThread), 0, 0);
      await client.waitForText("dispatch-review.txt"); await retained(botTask, botThread);
      const resent = await pluginRpc("studio-tasks", "get", { id: botTask.id });
      if (resent.handoffs.length !== 1 || resent.handoffs[0].threadId !== botThread) throw new Error("Repeating Send to bot duplicated the handoff");
      const historyDeadline = Date.now() + 10000;
      while (botReplies.length < 2) {
        if (Date.now() > historyDeadline) throw new Error("Repeated bot dispatch did not submit another task message");
        await sleep(100);
      }
      for (const reply of botReplies) {
        const body = await client.command("Network.getResponseBody", { requestId: reply.requestId });
        const result = JSON.parse(body.base64Encoded ? Buffer.from(body.body, "base64").toString() : body.body);
        if (reply.response.status !== 200 || !result.ok || result.result.threadId !== botThread) throw new Error("The real bot-dispatch request did not return its existing thread");
      }
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate("JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-3500)})").catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

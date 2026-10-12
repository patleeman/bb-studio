// The Bot's workspace (/plugins/studio/bot). First its onboarding, while the
// staged BB has no Bot (greeting and starter chips); then a Bot with history:
// its sidebar of the threads it started (one needing the user, one running,
// a nested follow-up, a recurring automation), its main thread in BB's own
// thread view, and the right panel's Info tab; then two sub-threads open in
// the right panel's Threads tab.
const BOT_PATH = "/plugins/studio/bot";
const CHILDREN = [
  { title: "Summarize this week's ORBIT-42 threads", prompt: "Reply with one short sentence: the ORBIT-42 release is on track for Friday." },
  { title: "Check the launch checklist for blockers", prompt: "Reply with one short sentence: no blockers on the launch checklist." },
];
const HISTORY = "What's left before Friday's ORBIT-42 release? Two short bullet points, please.";

/** Staging's plugin-problem card is closed so it doesn't cover the page. */
const dismissProblems = (client) => client.evaluate(`(() => { [...document.querySelectorAll("button")].find((each) => each.textContent.trim() === "Hide")?.click(); return true; })()`);
const SIDEBAR = 'nav[aria-label="Dot threads"]';
/** Clicks a sidebar row by its title. */
const openRow = (client, title) => client.evaluate(`(() => {
  const row = [...document.querySelectorAll('${SIDEBAR} button[data-thread]')].find((each) => each.textContent.includes(${JSON.stringify(title)}));
  if (!row) throw new Error("No sidebar row " + ${JSON.stringify(title)});
  row.click();
  return true;
})()`);
const assertChat = (client) => client.evaluate(`(() => {
  const chat = document.querySelector('section[aria-label="Chat"]');
  if (!chat) throw new Error("No Bot chat");
  if (!/ORBIT-42/.test(chat.textContent)) throw new Error("The Bot chat shows none of its history");
  if (!chat.querySelector('textarea, [contenteditable="true"]')) throw new Error("The Bot chat has no composer");
  return true;
})()`);

export default ({ projectId, pluginRpc, bbCli, sleep }) => {
  const json = async (args) => JSON.parse(await bbCli([...args, "--json"]));
  /** For the workspace: a nested follow-up, a thread still running, and an automation that wakes the Bot. */
  const workspaceExtras = async (botThread) => {
    const titles = async (parent) => (await json(["thread", "list", "--parent-thread", parent]).catch(() => [])).map((thread) => thread.title);
    const children = await json(["thread", "list", "--parent-thread", botThread]).catch(() => []);
    const first = children.find((thread) => thread.title === CHILDREN[0].title);
    if (first && !(await titles(first.id)).includes("Pull the ORBIT-42 thread digests")) {
      await json(["thread", "spawn", "--project", projectId, "--parent-thread", first.id, "--title", "Pull the ORBIT-42 thread digests", "--prompt", "Reply with one short sentence: three digests pulled."]);
    }
    if (!children.some((thread) => thread.title === "Watch the ORBIT-42 staging deploy")) {
      await json(["thread", "spawn", "--project", projectId, "--parent-thread", botThread, "--title", "Watch the ORBIT-42 staging deploy", "--prompt", "Use the shell to run `sleep 900`, then reply in one sentence that the staging deploy looks healthy."]);
    }
    const shown = await json(["thread", "show", botThread]).catch(() => null);
    const botProject = shown?.thread?.projectId;
    if (!botProject) throw new Error("The Bot's thread has no project");
    const automations = await json(["automation", "list", "--project", botProject]).catch(() => []);
    if (!(Array.isArray(automations) ? automations : automations.automations ?? []).some((each) => each.name === "Inbox sweep")) {
      await bbCli(["automation", "create", "--project", botProject, "--name", "Inbox sweep", "--cron", "0 */3 * * 1-5", "--timezone", "America/New_York", "--prompt", "Sweep my inbox for anything about ORBIT-42.", "--provider", "codex", "--model", "gpt-6.1-sol", "--target-thread", botThread]);
    }
  };
  /** The Bot, with its first exchange and some history; made once per staging. */
  const seededBot = async () => {
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) {
      ({ bot } = await pluginRpc("studio", "bot_create", {
        name: "Dot", avatar: "🟣", shape: "blob", color: "#7c66dc",
        prompt: "Hi Dot. In one short sentence, say you'll keep an eye on the ORBIT-42 launch and tell me what needs me.",
      }));
    }
    const botThread = bot.threadId;
    await bbCli(["thread", "wait", botThread, "--status", "idle", "--timeout", "180"]).catch(() => {});
    const started = await json(["thread", "list", "--parent-thread", botThread]).catch(() => []);
    if (!started.length) {
      for (const child of CHILDREN) {
        const thread = await json(["thread", "spawn", "--project", projectId, "--parent-thread", botThread, "--title", child.title, "--prompt", child.prompt]);
        await bbCli(["thread", "wait", thread.id, "--status", "idle", "--timeout", "180"]);
      }
      const nextWeek = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
      await json(["thread", "spawn", "--project", projectId, "--parent-thread", botThread, "--title", "Draft Monday's status update", "--prompt", "Draft Monday's ORBIT-42 status update.", "--send-at", nextWeek]);
      // A question waiting on the user in a thread it started: a Needs-you card with Open.
      await json(["thread", "spawn", "--project", projectId, "--parent-thread", botThread, "--title", "Rotate the ORBIT-42 deploy key", "--prompt", "We need to rotate the ORBIT-42 deploy key. Use the design_ask tool to ask me one multiple-choice question: which vault holds the key (1Password, AWS Secrets Manager, or Vault). Wait for my answer."]);
      await bbCli(["thread", "wait", botThread, "--status", "idle", "--timeout", "180"]).catch(() => {});
      await bbCli(["thread", "tell", botThread, HISTORY]);
      await bbCli(["thread", "wait", botThread, "--status", "idle", "--timeout", "240"]).catch(() => {});
    }
    await workspaceExtras(botThread);
    for (let i = 0; i < 60 && !(await pluginRpc("studio", "bot_activity", {})).needsYou.length; i++) await sleep(3000);
    await pluginRpc("studio", "bot_checkin_preset", { preset: "morning" });
    return bot;
  };

  const workspace = async (client) => {
    await seededBot();
    await client.navigate(BOT_PATH);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    // The Bot's own sidebar replaces BB's here; hide BB's the way a user would (the SDK can't).
    await client.evaluate(`(() => { const nav = document.querySelector('${SIDEBAR}'); if (nav && nav.getBoundingClientRect().left > 120) [...document.querySelectorAll('button[aria-label]')].find((each) => /sidebar/i.test(each.getAttribute("aria-label")) && !/bot/i.test(each.getAttribute("aria-label")))?.click(); return true; })()`);
    for (const text of ["Needs you", "Running", "Recurring", "Recent", "Rotate the ORBIT-42 deploy key", "Watch the ORBIT-42 staging deploy", "Inbox sweep", "Pull the ORBIT-42 thread digests", ...CHILDREN.map((child) => child.title)]) await client.waitForText(text, 90000);
    // The follow-up nests under the thread that started it.
    await client.evaluate(`(() => {
      if (!document.querySelector('${SIDEBAR} li > button[data-thread] + ul button[data-thread]')) throw new Error("No nested sub-thread in the Bot sidebar");
      return true;
    })()`);
    await client.waitForText("ORBIT-42", 60000);
    await assertChat(client);
  };

  const info = async (client) => {
    await workspace(client);
    await client.evaluate(`(() => { document.querySelector('button[aria-label="Bot info"]').click(); return true; })()`);
    await client.waitForSelector('[aria-label="Dot info"]', 30000);
    for (const text of ["Check-ins", "Morning brief", "Memory", "Skills", "Activity", "Scheduled"]) await client.waitForText(text, 30000);
    await sleep(1500);
  };

  const threads = async (client) => {
    await workspace(client);
    await openRow(client, CHILDREN[0].title);
    await client.waitForSelector('[role=tablist][aria-label="Open threads"]', 30000);
    await openRow(client, "Rotate the ORBIT-42 deploy key");
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const tabs = document.querySelectorAll('[role=tablist][aria-label="Open threads"] [role=tab]');
        const chat = document.querySelector('section[aria-label="Thread"]');
        if (tabs.length === 2 && chat && /vault|1Password|deploy key/i.test(chat.textContent)) return resolve(true);
        if (Date.now() - started > 60000) return reject(new Error("The Threads tab doesn't show two sub-threads with the deploy-key question"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`);
    await sleep(1500);
  };

  return [
    {
      id: "studio-bot-create",
      packageDir: "bb-studio",
      fileName: "bot-create.png",
      setup: async (client) => {
        const { bot } = await pluginRpc("studio", "bot_get", {});
        if (bot) throw new Error("The staged BB already has a Bot; capture onboarding on a fresh staging (stop, then start).");
        await client.navigate(BOT_PATH);
        await client.waitForText("Hey! I'm your bot.", 30000);
        for (const text of ["Plan my week", "What needs me today?", "Set up a morning brief", "Customize me"]) await client.waitForText(text);
        await client.waitForSelector('textarea[aria-label="Message Bot"]');
        await client.waitForSelector("svg[data-shape=blob]");
        await sleep(600);
      },
    },
    { id: "studio-bot", packageDir: "bb-studio", fileName: "bot.png", setup: info },
    { id: "studio-bot-threads", packageDir: "bb-studio", fileName: "bot-threads.png", setup: threads },
  ];
};

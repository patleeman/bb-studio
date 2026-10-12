// The Bot's own page (/plugins/studio/bot): first its onboarding, while the
// staged BB has no Bot; then the new Bot with nothing going on (Activity
// open, one quiet line per section); then real activity: threads it started
// that ran on the staged provider, one waiting to start, one whose question
// waits on the user (the Needs-you banner), its check-in and an
// automation that wakes it.
const BOT_PATH = "/plugins/studio/bot";
const openActivity = async (client) => {
  await client.waitForSelector('button[aria-label="Show activity"], button[aria-label="Hide activity"]', 30000);
  await client.evaluate(`(() => { document.querySelector('button[aria-label="Show activity"]')?.click(); return true; })()`);
  await client.waitForSelector('aside[aria-label="Activity"]');
  // Staging has no Jev key, so a plugin-problem card covers the sidebar; it isn't the Bot's.
  await client.evaluate(`(() => { [...document.querySelectorAll("button")].find((each) => each.textContent.trim() === "Hide")?.click(); return true; })()`);
};
const CHILDREN = [
  { title: "Summarize this week's ORBIT-42 threads", prompt: "Reply with one short sentence: the ORBIT-42 release is on track for Friday." },
  { title: "Check the launch checklist for blockers", prompt: "Reply with one short sentence: no blockers on the launch checklist." },
];

export default ({ projectId, pluginRpc, bbCli, sleep }) => {
  const json = async (args) => JSON.parse(await bbCli([...args, "--json"]));
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
        await client.waitForText("Customize your bot");
        await client.waitForSelector('textarea[aria-label="First message"]');
        await client.waitForSelector("svg[data-shape=blob]");
        await sleep(400);
      },
    },
    {
      id: "studio-bot-empty",
      packageDir: "bb-studio",
      fileName: "bot-empty.png",
      setup: async (client) => {
        let { bot } = await pluginRpc("studio", "bot_get", {});
        if (!bot) {
          ({ bot } = await pluginRpc("studio", "bot_create", {
            name: "Dot", avatar: "🟣", shape: "blob", color: "#7c66dc",
            prompt: "Hi Dot. In one short sentence, say you'll keep an eye on the ORBIT-42 launch and tell me what needs me.",
          }));
        }
        await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "180"]).catch(() => {});
        const activity = await pluginRpc("studio", "bot_activity", {});
        if (activity.needsYou.length || activity.inProgress.length || activity.completed.length) throw new Error("The staged Bot already has activity; capture the empty state on a fresh staging.");
        await client.navigate(BOT_PATH);
        await client.waitForText("Dot", 30000);
        await openActivity(client);
        for (const text of ["Nothing needs you", "Nothing running", "No recent activity"]) await client.waitForText(text, 30000);
        await client.evaluate(`(() => { if (document.querySelector('section[aria-label="Needs you"]:not(aside *)')) throw new Error("Needs-you banner on an empty Bot"); const chat = document.querySelector('section[aria-label="Chat"]'); if (!chat || chat.textContent.length < 40) throw new Error("The Bot's chat is empty"); return true; })()`);
        await sleep(1000);
      },
    },
    {
      id: "studio-bot",
      packageDir: "bb-studio",
      fileName: "bot.png",
      setup: async (client) => {
        let { bot } = await pluginRpc("studio", "bot_get", {});
        if (!bot) {
          ({ bot } = await pluginRpc("studio", "bot_create", {
            name: "Dot", avatar: "🟣",
            prompt: "Hi Dot. In one short sentence, say you'll keep an eye on the ORBIT-42 launch and tell me what needs me.",
          }));
        }
        const botThread = bot.threadId;
        await bbCli(["thread", "wait", botThread, "--status", "idle", "--timeout", "180"]).catch(() => {});
        // Threads the Bot started: two that ran, one queued for next week.
        const started = await json(["thread", "list", "--parent-thread", botThread]).catch(() => []);
        if (!started.length) {
          for (const child of CHILDREN) {
            const thread = await json(["thread", "spawn", "--project", projectId, "--parent-thread", botThread, "--title", child.title, "--prompt", child.prompt]);
            await bbCli(["thread", "wait", thread.id, "--status", "idle", "--timeout", "180"]);
          }
          const nextWeek = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
          await json(["thread", "spawn", "--project", projectId, "--parent-thread", botThread, "--title", "Draft Monday's status update", "--prompt", "Draft Monday's ORBIT-42 status update.", "--send-at", nextWeek]);
          // A question waiting on the user (Studio's design_ask form): the Needs-you banner.
          await json(["thread", "spawn", "--project", projectId, "--parent-thread", botThread, "--title", "Rotate the ORBIT-42 deploy key", "--prompt", "We need to rotate the ORBIT-42 deploy key. Use the design_ask tool to ask me one multiple-choice question: which vault holds the key (1Password, AWS Secrets Manager, or Vault). Wait for my answer."]);
        }
        for (let i = 0; i < 60 && !(await pluginRpc("studio", "bot_activity", {})).needsYou.length; i++) await sleep(3000);
        // Its check-in, and an automation that wakes it.
        await pluginRpc("studio", "bot_set_run", { enabled: true, cadence: "weekdays", time: "09:00" });
        const { thread } = await json(["thread", "show", botThread]);
        const automations = await pluginRpc("automations", "automations_list", { projectId: thread.projectId });
        if (!automations.some((each) => each.name === "Friday release check")) {
          const execution = { ...automations.find((each) => each.execution?.targetThreadId === botThread).execution, prompt: "Check that the ORBIT-42 release is ready to ship." };
          await pluginRpc("automations", "automations_create", {
            projectId: thread.projectId, name: "Friday release check", enabled: true, origin: "app",
            trigger: { triggerType: "schedule", cron: "0 14 * * 5", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }, execution,
          });
        }
        // Its Memory page, and a skill it saved.
        const { pageId } = await pluginRpc("studio", "bot_memory", {});
        if (!pageId) throw new Error("The Bot has no Memory page");
        await pluginRpc("studio", "bot_skill_write", {
          name: "release-readiness", description: "Before a release: check the checklist, open blockers and the lead's last update",
          body: "1. Read the launch checklist page.\n2. List open blockers.\n3. Ask the project's lead for status if it's older than a day.",
        });
        await client.navigate(BOT_PATH);
        await client.waitForText("Dot", 30000);
        await openActivity(client);
        for (const text of ["Checks in", "Needs you · Rotate the ORBIT-42 deploy key", "Answer", "Waiting to start", "Draft Monday's status update", "Scheduled", "Recent", "Check-in (heartbeat)", "Friday release check", ...CHILDREN.map((child) => child.title)]) {
          await client.waitForText(text, 30000);
        }
        // The Bot's own chat renders inside the home.
        await client.evaluate(`(() => { const chat = document.querySelector('section[aria-label="Chat"]'); if (!chat || chat.textContent.length < 40) throw new Error("The Bot's chat is empty"); return true; })()`);
        await sleep(1000);
      },
    },
  ];
};

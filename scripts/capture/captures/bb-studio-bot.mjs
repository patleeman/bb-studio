// The Bot's home (/plugins/studio/studio/bot): first its onboarding, while the
// staged BB has no Bot, then the Bot with real activity: threads it started
// that ran on the staged provider, one waiting to start, its check-in and an
// automation that wakes it.
const BOT_PATH = "/plugins/studio/studio/bot";
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
        await client.waitForText("Create your bot", 30000);
        await client.waitForText("First message");
        await client.waitForSelector('input[aria-label="Bot name"]');
        await client.waitForSelector('button[aria-label="Avatar 🧭"]');
        await sleep(400);
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
        }
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
        await client.navigate(BOT_PATH);
        await client.waitForText("Dot", 30000);
        for (const text of ["Active", "Chat", "Needs you", "In progress", "Scheduled", "Completed", "Check-in (heartbeat)", "Friday release check", ...CHILDREN.map((child) => child.title)]) {
          await client.waitForText(text, 30000);
        }
        // The Bot's own chat renders inside the home.
        await client.evaluate(`(() => { const chat = document.querySelector('section[aria-label="Chat"]'); if (!chat || chat.textContent.length < 40) throw new Error("The Bot's chat is empty"); return true; })()`);
        await sleep(1000);
      },
    },
  ];
};

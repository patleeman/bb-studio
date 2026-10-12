// The Bot's own page (/plugins/studio/bot). First its onboarding, while the
// staged BB has no Bot (greeting and starter chips); then a Bot with history:
// BB's own thread view (ThreadChat) of its thread under the compact header,
// a Needs-you banner for a thread it started, and Activity open beside it.
const BOT_PATH = "/plugins/studio/bot";
const CHILDREN = [
  { title: "Summarize this week's ORBIT-42 threads", prompt: "Reply with one short sentence: the ORBIT-42 release is on track for Friday." },
  { title: "Check the launch checklist for blockers", prompt: "Reply with one short sentence: no blockers on the launch checklist." },
];
const HISTORY = "What's left before Friday's ORBIT-42 release? Two short bullet points, please.";

/** Opens or closes the Activity panel; staging's plugin-problem card is closed so it doesn't cover the page. */
const activity = (open) => async (client) => {
  await client.waitForSelector('button[aria-label="Show activity"], button[aria-label="Hide activity"]', 30000);
  await client.evaluate(`(() => { document.querySelector('button[aria-label="${open ? "Show" : "Hide"} activity"]')?.click(); return true; })()`);
  await client.waitForSelector(open ? 'aside[aria-label="Activity"]' : 'button[aria-label="Show activity"]');
  await client.evaluate(`(() => { [...document.querySelectorAll("button")].find((each) => each.textContent.trim() === "Hide")?.click(); return true; })()`);
};
const assertChat = (client) => client.evaluate(`(() => {
  const chat = document.querySelector('section[aria-label="Chat"]');
  if (!chat) throw new Error("No Bot chat");
  if (!/ORBIT-42/.test(chat.textContent)) throw new Error("The Bot chat shows none of its history");
  if (!chat.querySelector('textarea, [contenteditable="true"]')) throw new Error("The Bot chat has no composer");
  return true;
})()`);

export default ({ projectId, pluginRpc, bbCli, sleep }) => {
  const json = async (args) => JSON.parse(await bbCli([...args, "--json"]));
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
    for (let i = 0; i < 60 && !(await pluginRpc("studio", "bot_activity", {})).needsYou.length; i++) await sleep(3000);
    await pluginRpc("studio", "bot_checkin_preset", { preset: "morning" });
    return bot;
  };

  const history = async (client) => {
    await seededBot();
    await client.navigate(BOT_PATH);
    await client.waitForText("Dot", 30000);
    await activity(true)(client);
    for (const text of ["Checks in", "Needs you", "Rotate the ORBIT-42 deploy key", "Scheduled", "Recent", "Waiting to start", ...CHILDREN.map((child) => child.title)]) await client.waitForText(text, 60000);
    await client.waitForSelector('[role=status][aria-label="Needs you"] button', 30000);
    await client.waitForText("ORBIT-42", 60000);
    await assertChat(client);
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
    { id: "studio-bot", packageDir: "bb-studio", fileName: "bot.png", setup: history },
  ];
};

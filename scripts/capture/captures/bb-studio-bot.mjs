// The Bot's workspace (/plugins/studio/bot). First its onboarding, while the
// staged BB has no Bot (greeting and starter chips); then a Bot with history:
// the Bots list in BB's sidebar (it replaces BB's thread list on the Bot page)
// with the threads it started (one needing the user, one running,
// a nested follow-up, a recurring automation), its main thread in BB's own
// thread view, and the right panel's Info tab; then two sub-threads open in
// the right panel's Threads tab; then a normal thread page, where BB's own
// thread list is back. Last, two runners (src/runners.ts): one that logs,
// one that tells and then raises something urgent; the Bots sidebar's
// Runners group, the Info tab's Runners section, and a runner's thread in
// the Threads tab, with the Bot's chat holding only the runner's lines.
// Then several bots: New bot opening the create flow, and a second bot,
// Scout, selected, with Dot listed above it. Where BB has a sidebar
// navigation provider preference, the navigation row says New bot (Studio's
// replaces BB's on the Bot page); BB 0.46 has none, so New bot is the Bots
// list's + and the row keeps BB's New thread.
const BOT_PATH = "/plugins/studio/bot";
const CHILDREN = [
  { title: "Summarize this week's ORBIT-42 threads", prompt: "Reply with one short sentence: the ORBIT-42 release is on track for Friday." },
  { title: "Check the launch checklist for blockers", prompt: "Reply with one short sentence: no blockers on the launch checklist." },
];
const HISTORY = "What's left before Friday's ORBIT-42 release? Two short bullet points, please.";

/** Staging's plugin-problem card is closed so it doesn't cover the page. */
const dismissProblems = (client) => client.evaluate(`(() => { [...document.querySelectorAll("button")].find((each) => each.textContent.trim() === "Hide")?.click(); return true; })()`);
const SIDEBAR = 'nav[aria-label="Bots"]';
const LIST_PREF = "sidebar.threadListProvider";
const SCOUT = { name: "Scout", avatar: "🛰️", shape: "hexagon", color: "#2ba59a", prompt: "Hi Scout. In one short sentence, say you'll watch competitors' release notes for anything that affects ORBIT-42." };
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
    const pref = JSON.parse(await bbCli(["settings", "ui", "get", LIST_PREF]));
    if (pref !== "studio/bot") throw new Error(`On the Bot page the thread list is ${pref}, not studio/bot`);
    // The Bots list sits in BB's sidebar itself, left of the page, not a column inside it.
    await client.evaluate(`(() => { if (document.querySelector('${SIDEBAR}').getBoundingClientRect().left > 120) throw new Error("The Bots list isn't in BB's sidebar"); return true; })()`);
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
    for (const text of ["Automations", "Check-in", "Weekdays 8:00", "Memory", "Skills", "Activity", "Scheduled"]) await client.waitForText(text, 30000);
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

  /**
   * Two runners on short schedules. Inbox watch only logs; Deploy watch tells
   * on its first run and raises an urgent report on its second (Run now).
   * The Bot's thread must get their tell lines and no child notices.
   */
  const RUNNERS = [
    { name: "Inbox watch", job: "On your first run call runner_report with level log and summary \"Inbox: two newsletters, nothing for you.\" On later runs there is nothing new: finish without any message.", schedule: { cadence: "every15minutes", time: "09:00" } },
    { name: "Deploy watch", job: "On your first run call runner_report with level tell and summary \"ORBIT-42 staging deploy finished: build 418 is healthy.\" On your second run call runner_report with level urgent and summary \"ORBIT-42 staging is down: health check failing since build 419.\" After that there is nothing new: finish without any message.", schedule: { cadence: "every30minutes", time: "09:00" } },
  ];
  const seededRunners = async () => {
    const bot = await seededBot();
    let { runners } = await pluginRpc("studio", "bot_runners", {});
    for (const spec of RUNNERS) {
      if (runners.some((runner) => runner.name === spec.name)) continue;
      await pluginRpc("studio", "bot_runner_create", spec);
    }
    ({ runners } = await pluginRpc("studio", "bot_runners", {}));
    const byName = (name) => runners.find((runner) => runner.name === name);
    for (const runner of runners) await bbCli(["thread", "wait", runner.threadId, "--status", "idle", "--timeout", "300"]).catch(() => {});
    const deploy = byName("Deploy watch");
    ({ runners } = await pluginRpc("studio", "bot_runners", {}));
    if (byName("Deploy watch").lastLevel === "tell") {
      await pluginRpc("studio", "bot_runner_run_now", { id: deploy.id });
      await sleep(5000);
      await bbCli(["thread", "wait", deploy.threadId, "--status", "idle", "--timeout", "300"]).catch(() => {});
    }
    for (let i = 0; i < 40; i++) {
      ({ runners } = await pluginRpc("studio", "bot_runners", {}));
      if (byName("Inbox watch")?.lastLevel === "log" && byName("Deploy watch")?.lastLevel === "urgent") break;
      await sleep(3000);
    }
    if (byName("Inbox watch")?.lastLevel !== "log") throw new Error("Inbox watch didn't log its first run");
    if (byName("Deploy watch")?.lastLevel !== "urgent") throw new Error("Deploy watch didn't raise its urgent report");
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
    return { bot, runners };
  };

  /** The Bot's sidebar shows Runners; Info shows the Runners section with both. */
  const runnersInfo = async (client) => {
    await seededRunners();
    await workspace(client);
    for (const text of ["Runners", "Inbox watch", "Deploy watch"]) await client.waitForText(text, 60000);
    await client.evaluate(`(() => { document.querySelector('button[aria-label="Bot info"]').click(); return true; })()`);
    await client.waitForSelector('[aria-label$=" info"] section[aria-label=Automations] [data-kind=runner]', 30000);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const section = document.querySelector('[aria-label$=" info"] section[aria-label=Automations]');
        const text = section?.textContent ?? "";
        if (/Inbox watch/.test(text) && /Deploy watch/.test(text) && /two newsletters/.test(text) && /health check failing/.test(text) && /New/.test(text)) {
          section.scrollIntoView({ block: "start" });
          return resolve(true);
        }
        if (Date.now() - started > 60000) return reject(new Error("The Info tab's Automations don't show both runners and their reports"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`);
    await sleep(1500);
  };

  /** A runner's thread in the Threads tab, opened from the sidebar's Runners group. */
  const runnerThread = async (client) => {
    await seededRunners();
    await workspace(client);
    await client.waitForText("Deploy watch", 60000);
    await client.waitForSelector('button[aria-label="Bot info"]', 30000);
    // The right panel is open (Info) before the runner opens in its Threads tab.
    await client.evaluate(`(() => { document.querySelector('button[aria-label="Bot info"]').click(); return true; })()`);
    await client.waitForSelector('[aria-label$=" info"] section[aria-label=Automations]', 30000);
    await client.evaluate(`(() => {
      const row = [...document.querySelectorAll('${SIDEBAR} section[aria-label="Runners"] button[data-runner]')].find((each) => each.textContent.includes("Deploy watch"));
      if (!row) throw new Error("No Deploy watch row under Runners");
      row.click();
      return true;
    })()`);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        // The Threads tab, or BB's thread page where the host declines a fixed-tab target (stable BB 0.46 does).
        const tab = document.querySelector('[role=tablist][aria-label="Open threads"]') && document.querySelector('section[aria-label="Thread"]');
        const page = location.pathname.includes("/threads/thr_") ? document.body : null;
        const chat = tab ?? page;
        if (chat && /Deploy watch/.test(chat.textContent) && /runner_report/.test(chat.textContent)) return resolve(true);
        if (Date.now() - started > 60000) return reject(new Error("The Threads tab doesn't show the Deploy watch runner's thread"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`);
    // The Bot's own thread holds the runner's tell lines and no notice about a runner's thread.
    const { bot, runners } = await seededRunners();
    const log = JSON.stringify(await json(["thread", "log", bot.threadId, "--all"]));
    if (!log.includes("From runner Deploy watch: ORBIT-42 staging deploy finished")) throw new Error("The Bot's thread has no tell line from Deploy watch");
    for (const runner of runners) if (new RegExp(`@thread:${runner.threadId} (completed|failed|was interrupted|needs)`).test(log)) throw new Error(`A notice about ${runner.name} reached the Bot's thread`);
    await sleep(1500);
  };

  /** Leaving the Bot page: a normal thread, with BB's own thread list back. */
  const leave = async (client) => {
    const bot = await seededBot();
    await client.navigate(BOT_PATH);
    await client.waitForSelector(SIDEBAR, 30000);
    await client.navigate(`/threads/${bot.threadId}`);
    for (let i = 0; i < 40 && JSON.parse(await bbCli(["settings", "ui", "get", LIST_PREF])) !== "thread-list/thread-list"; i++) await sleep(500);
    const pref = JSON.parse(await bbCli(["settings", "ui", "get", LIST_PREF]));
    if (pref !== "thread-list/thread-list") throw new Error(`After leaving the Bot page the thread list is ${pref}, not BB's`);
    await client.waitForText("New thread", 30000);
    await client.waitForText(CHILDREN[0].title, 30000);
    await client.evaluate(`(() => { if (document.querySelector('${SIDEBAR}')) throw new Error("The Bots list is still showing"); return true; })()`);
    await dismissProblems(client);
    await sleep(1500);
  };

  /** On the Bot page the Bots list's New bot button opens the create flow. */
  const newBot = async (client) => {
    await seededBot();
    await client.navigate(BOT_PATH);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    // BB keeps its New thread row; New bot is the Bots list's +.
    await client.evaluate(`(() => {
      const button = document.querySelector('${SIDEBAR} [data-testid=bot-new]');
      if (!button) throw new Error("No New bot button in the Bots list");
      button.click();
      return true;
    })()`);
    await client.waitForText("Hey! I'm a new bot.", 30000);
    for (const text of ["Customize me", "Dot"]) await client.waitForText(text, 30000);
    await client.waitForSelector(`${SIDEBAR} [data-testid=bot-new-row]`, 30000);
    await client.waitForSelector('textarea[aria-label="Message New bot"]', 30000);
    if (!(await client.evaluate("location.pathname")).endsWith("/plugins/studio/bot/new")) throw new Error("New bot didn't open /plugins/studio/bot/new");
    await sleep(800);
  };

  /** A second bot, Scout, selected: its page, its expanded sidebar entry and Info; Dot is listed above it. */
  const twoBots = async (client) => {
    await seededBot();
    let { bots } = await pluginRpc("studio", "bot_list", {});
    let scout = bots.find((bot) => bot.name === SCOUT.name);
    if (!scout) ({ bot: scout } = await pluginRpc("studio", "bot_create", SCOUT));
    if (scout.primary !== false) throw new Error("Scout was made the primary bot");
    await bbCli(["thread", "wait", scout.threadId, "--status", "idle", "--timeout", "180"]).catch(() => {});
    await pluginRpc("studio", "bot_checkin_preset", { botId: scout.id, preset: "evening" });
    ({ bots } = await pluginRpc("studio", "bot_list", {}));
    if (bots[0]?.name !== "Dot" || bots.length < 2) throw new Error("Dot isn't the primary bot listed first");
    await client.navigate(`${BOT_PATH}/${scout.id}`);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const nav = document.querySelector('${SIDEBAR}');
        const main = nav?.querySelector('[data-testid=bot-main]');
        const other = nav?.querySelector('[data-testid=bot-row]');
        const chat = document.querySelector('section[aria-label="Chat"]');
        if (main && /Scout/.test(main.textContent) && other && /Dot/.test(other.textContent) && chat && /release notes|competitor/i.test(chat.textContent)) return resolve(true);
        if (Date.now() - started > 90000) return reject(new Error("The Bot page doesn't show Scout selected with Dot listed and Scout's chat"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`);
    await client.evaluate(`(() => { document.querySelector('button[aria-label="Bot info"]').click(); return true; })()`);
    await client.waitForSelector('[aria-label="Scout info"]', 30000);
    for (const text of ["Evening wrap-up", "Memory", "Runners"]) await client.waitForText(text, 30000);
    await sleep(1500);
  };

  /**
   * Relay, a bot whose thread switches models (src/bot.ts switchModel): Codex
   * → Claude Code Opus (a handoff), Opus → Sonnet (in place), then Claude →
   * Codex (a handoff). Real agent replies; made once per staging.
   */
  const RELAY = { name: "Relay", avatar: "🔁", shape: "pill", color: "#d9822b", prompt: "Hi Relay. In one short sentence, say you'll keep notes on the ORBIT-42 launch." };
  const relayBot = async () => {
    await seededBot();
    const find = async () => (await pluginRpc("studio", "bot_list", {})).bots.find((bot) => bot.name === RELAY.name);
    let relay = await find();
    if (!relay) ({ bot: relay } = await pluginRpc("studio", "bot_create", RELAY));
    const idle = (threadId) => bbCli(["thread", "wait", threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
    await idle(relay.threadId);
    const view = async () => (await pluginRpc("studio", "bot_get", { botId: relay.id })).bot;
    relay = await view();
    if (relay.providerId === "codex" && (await pluginRpc("studio", "bot_chain", { botId: relay.id })).threadIds.length === 1) {
      const { change, threadId } = await pluginRpc("studio", "thread_handoff_to_model", { threadId: relay.threadId, providerId: "claude-code", model: "claude-opus-5-5", reasoning: "low" });
      if (change !== "handoff") throw new Error(`Codex → Claude was ${change}, not a handoff`);
      await idle(threadId);
      relay = await view();
    }
    if (relay.providerId === "claude-code" && relay.model !== "claude-sonnet-5-5") {
      const { change, threadId } = await pluginRpc("studio", "thread_handoff_to_model", { threadId: relay.threadId, providerId: "claude-code", model: "claude-sonnet-5-5", reasoning: "low" });
      if (change !== "in-place" || threadId !== relay.threadId) throw new Error(`Opus → Sonnet was ${change} on ${threadId}, not in place`);
      relay = await view();
    }
    if (relay.providerId !== "claude-code" || relay.model !== "claude-sonnet-5-5") throw new Error(`Relay runs on ${relay.providerId} · ${relay.model}, not Claude Code · Sonnet`);
    return relay;
  };
  const openRelay = async (client, relay) => {
    await client.navigate(`${BOT_PATH}/${relay.id}`);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    await client.waitForSelector('section[aria-label="Chat"]', 30000);
  };
  /** Switch model…: BB's picker, the bot's thread on Claude Code Sonnet after an in-place switch from Opus. */
  const switchModel = async (client) => {
    const relay = await relayBot();
    await openRelay(client, relay);
    await client.clickAriaButtonWithPointer("Bot menu");
    await client.waitForText("Switch model…", 15000);
    await client.clickElementWithTextAndPointer('[role="menuitem"]', "Switch model…");
    await client.waitForSelector('[data-testid="switch-model"]', 15000);
    await client.evaluate(`(() => {
      const dialog = document.querySelector('[data-testid="switch-model"]');
      if (!/Now on Claude Code · claude-sonnet-5-5/.test(dialog.textContent)) throw new Error("The dialog doesn't say the thread runs on Claude Code Sonnet: " + dialog.textContent);
      if (!/Sonnet/.test(dialog.textContent)) throw new Error("BB's picker doesn't show Sonnet");
      return true;
    })()`);
    await sleep(800);
  };
  /** Claude → Codex: a handoff; the chat is the new Codex thread, its Claude threads under Earlier conversations. */
  const handoff = async (client) => {
    let relay = await relayBot();
    const before = relay.threadId;
    const { change, threadId } = await pluginRpc("studio", "thread_handoff_to_model", { threadId: relay.threadId, providerId: "codex", model: "gpt-6.1-sol", reasoning: "low" });
    if (change !== "handoff" || threadId === before) throw new Error(`Claude → Codex was ${change}, not a handoff`);
    await bbCli(["thread", "wait", threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
    relay = (await pluginRpc("studio", "bot_get", { botId: relay.id })).bot;
    if (relay.threadId !== threadId || relay.providerId !== "codex") throw new Error("Relay didn't follow the handoff to Codex");
    const { threadIds } = await pluginRpc("studio", "bot_chain", { botId: relay.id });
    if (threadIds.length !== 3) throw new Error(`Relay's chain has ${threadIds.length} threads, not 3`);
    await openRelay(client, relay);
    await client.evaluate(`(() => { const group = document.querySelector('${SIDEBAR} section[aria-label="Earlier conversations"] > button'); if (!group) throw new Error("No Earlier conversations"); if (group.getAttribute("aria-expanded") !== "true") group.click(); return true; })()`);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const earlier = document.querySelectorAll('${SIDEBAR} section[aria-label="Earlier conversations"] button[type=button]');
        const chat = document.querySelector('section[aria-label="Chat"]');
        if (earlier.length >= 3 && chat && chat.textContent.trim().length > 40) return resolve(true);
        if (Date.now() - started > 90000) return reject(new Error("The handoff chat or its earlier conversations aren't showing"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`);
    await sleep(1500);
  };

  /**
   * Automations (src/automations.ts): the original check-in (Morning brief
   * preset) and an evening one, a reminder two hours out, a watcher whose
   * script prints once and then stays quiet (run twice: one wake-up, one
   * "Nothing new"), and the runners above.
   */
  const WATCHER_SCRIPT = 'if [ ! -f fired ]; then touch fired; echo "ORBIT-42 v1.4.0 is out on the release page"; fi\nexit 0';
  const seededAutomations = async () => {
    const { bot } = await seededRunners();
    let { automations } = await pluginRpc("studio", "bot_automations", {});
    const has = (name) => automations.some((each) => each.name === name);
    if (!has("Evening wrap-up")) await pluginRpc("studio", "bot_automation_create", { kind: "checkin", name: "Evening wrap-up", instruction: "Wrap up what got done on ORBIT-42 today and what's left for tomorrow.", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["18:00"] } });
    if (!has("Check the deploy")) await pluginRpc("studio", "bot_automation_create", { kind: "reminder", name: "Check the deploy", instruction: "Check whether the ORBIT-42 production deploy finished and tell me.", schedule: { type: "once", at: Date.now() + 2 * 3600_000 } });
    if (!has("Release watch")) await pluginRpc("studio", "bot_automation_create", { kind: "watcher", name: "Release watch", instruction: "Tell me in one line, and only if it's ORBIT-42.", schedule: { type: "interval", every: 15, unit: "minutes", days: [0, 1, 2, 3, 4, 5, 6], quiet: { from: "22:00", to: "07:00" } }, script: { body: WATCHER_SCRIPT, interpreter: "bash", timeoutMs: 30000 } });
    ({ automations } = await pluginRpc("studio", "bot_automations", {}));
    const watcherId = automations.find((each) => each.name === "Release watch").id;
    // Two finished runs: the first prints (a wake-up), the second prints nothing. One at a time.
    const finished = async () => (await pluginRpc("studio", "bot_automation_runs", { id: watcherId })).runs.filter((run) => run.outcome !== "Running");
    for (let want = 1; want <= 2; want++) {
      if ((await finished()).length >= want) continue;
      await pluginRpc("studio", "bot_automation_run_now", { id: watcherId });
      for (let j = 0; j < 30 && (await finished()).length < want; j++) await sleep(2000);
    }
    ({ automations } = await pluginRpc("studio", "bot_automations", {}));
    const watcher = automations.find((each) => each.name === "Release watch");
    // Studio's minute tick posts the finding to the Bot's thread.
    for (let i = 0; i < 50 && !(await pluginRpc("studio", "bot_automations", {})).automations.find((each) => each.id === watcher.id)?.lastOutcome?.startsWith("Woke"); i++) await sleep(3000);
    const runs = (await pluginRpc("studio", "bot_automation_runs", { id: watcher.id })).runs.map((run) => run.outcome);
    if (!runs.some((each) => each.startsWith("Woke it: ORBIT-42 v1.4.0")) || !runs.includes("Nothing new")) throw new Error(`The watcher's runs are ${JSON.stringify(runs)}, not one wake-up and one quiet run`);
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
    const transcript = await bbCli(["thread", "log", bot.threadId]).catch(() => "");
    if (!/Watcher Release watch: ORBIT-42 v1\.4\.0/.test(transcript)) throw new Error("The Bot's thread didn't get the watcher's finding");
    return watcher;
  };
  const openInfoAutomations = async (client) => {
    await workspace(client);
    await client.evaluate(`(() => { document.querySelector('button[aria-label="Bot info"]').click(); return true; })()`);
    await client.waitForSelector('[aria-label$=" info"] section[aria-label=Automations] [data-kind=watcher]', 30000);
  };
  const automationsList = async (client) => {
    await seededAutomations();
    await openInfoAutomations(client);
    await client.evaluate(`(() => { document.querySelector('section[aria-label=Automations] [data-kind=watcher] button[aria-expanded]').click(); return true; })()`);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const section = document.querySelector('[aria-label$=" info"] section[aria-label=Automations]');
        const text = section?.textContent ?? "";
        const kinds = [...section.querySelectorAll('[data-kind]')].map((each) => each.dataset.kind);
        const checkins = kinds.filter((kind) => kind === "checkin").length;
        if (checkins === 2 && kinds.includes("reminder") && kinds.includes("runner") && /Evening wrap-up/.test(text) && /Check the deploy/.test(text) && /Woke it: ORBIT-42 v1.4.0/.test(text) && /Nothing new/.test(text) && /Weekdays 8:00/.test(text)) {
          section.scrollIntoView({ block: "start" });
          return resolve(true);
        }
        if (Date.now() - started > 60000) return reject(new Error("Automations don't show two check-ins, a reminder, the watcher's runs and runners: " + kinds.join(",")));
        setTimeout(tick, 300);
      };
      tick();
    }))()`);
    await sleep(1500);
  };
  const scheduleEditor = async (client) => {
    await seededAutomations();
    await openInfoAutomations(client);
    await client.evaluate(`(() => {
      const row = document.querySelector('section[aria-label=Automations] [data-kind=watcher]');
      row.querySelector('button[aria-expanded]').click();
      return true;
    })()`);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const edit = [...document.querySelectorAll('section[aria-label=Automations] [data-kind=watcher] button')].find((each) => each.textContent.trim() === "Edit");
        if (edit) { edit.click(); return resolve(true); }
        if (Date.now() - started > 10000) return reject(new Error("No Edit on the watcher"));
        setTimeout(tick, 200);
      };
      tick();
    }))()`);
    await client.waitForSelector('[data-testid=automation-editor] [data-testid=schedule-preview]', 30000);
    await client.evaluate(`(() => {
      const editor = document.querySelector('[data-testid=automation-editor]');
      const text = editor.textContent;
      for (const want of ["Edit Release watch", "Script", "Every 15 min, every day · quiet 22:00–7:00", "*/15 7-21 * * *", "Quiet hours", "Timezone", "Morning and evening"]) if (!text.includes(want)) throw new Error("The schedule editor lacks " + want);
      if (!editor.querySelector('[role=group][aria-label=Days] [aria-pressed=true]')) throw new Error("No day chips on");
      return true;
    })()`);
    await sleep(1000);
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
    { id: "studio-bot-leave", packageDir: "bb-studio", fileName: "bot-leave.png", setup: leave },
    { id: "studio-bot-runners", packageDir: "bb-studio", fileName: "bot-runners.png", setup: runnersInfo },
    { id: "studio-bot-automations", packageDir: "bb-studio", fileName: "bot-automations.png", setup: automationsList },
    { id: "studio-bot-schedule-editor", packageDir: "bb-studio", fileName: "bot-schedule-editor.png", setup: scheduleEditor },
    { id: "studio-bot-runner-thread", packageDir: "bb-studio", fileName: "bot-runner-thread.png", setup: runnerThread },
    { id: "studio-bot-new", packageDir: "bb-studio", fileName: "bot-new.png", setup: newBot },
    { id: "studio-bot-two", packageDir: "bb-studio", fileName: "bot-two.png", setup: twoBots },
    { id: "studio-bot-switch-model", packageDir: "bb-studio", fileName: "bot-switch-model.png", setup: switchModel },
    { id: "studio-bot-handoff", packageDir: "bb-studio", fileName: "bot-handoff.png", setup: handoff },
  ];
};

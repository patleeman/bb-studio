// The Bot's workspace. First its onboarding, while the staged BB has no Bot
// (the welcome, then the first chat Create opens; that Bot then becomes Dot);
// then a Bot with history: Studio's list in BB's sidebar (`studio/bot`, on
// every page but the Studio panel), Threads on top and the Bots below, with
// the threads Dot started (one needing the user, one running, a nested
// follow-up, a scheduled automation), and its chat opened from its row as BB's
// own thread page. The row's ⓘ opens its Info, the Bot page under the Studio
// panel (/plugins/studio/studio/bot[/<botId>]). Then Home on the rail and a
// thread no Bot owns opened from the Threads section: the same list stays,
// and the Bot's threads show only under Dot, not in Threads.
// Last, two runners (src/runners.ts): one that logs, one that tells and then
// raises something urgent; the Bots sidebar's Runners group, Info's Runners
// in Automations, and a runner's thread opened from the sidebar as BB's
// thread page, with the Bot's chat holding only the runner's lines.
// Then several bots: New bot (the Bots heading's +) opening the create flow,
// and a second bot, Scout, selected, with Dot listed above it.
import { backdateLatestTokenUsage } from "./bot-capture-fixtures.mjs";

export const BOT_PATH = "/plugins/studio/studio/bot";
const CHILDREN = [
  { title: "Summarize this week's ORBIT-42 threads", prompt: "Reply with one short sentence: the ORBIT-42 release is on track for Friday." },
  { title: "Check the launch checklist for blockers", prompt: "Reply with one short sentence: no blockers on the launch checklist." },
];
/** The staged project's own threads (staged-bb.mjs), in BB's list. */
export const ORBIT_TITLES = ["Draft the ORBIT-42 release notes", "Review the launch checklist"];
/** What the first-time flow's capture asks its new Bot to help with. */
const FIRST_GOAL = "Keep an eye on the ORBIT-42 launch and tell me each morning what needs me.";
const HISTORY = "What's left before Friday's ORBIT-42 release? Two short bullet points, please.";
const PROFILE_DESCRIPTION = "I track ORBIT-42 health and blockers.";

/** Staging's plugin-problem card is closed so it doesn't cover the page. */
export const dismissProblems = (client) => client.evaluate(`(() => new Promise((resolve) => {
  // The card can render a moment after the page: look for it for a few seconds.
  const started = Date.now();
  const tick = () => {
    const hide = [...document.querySelectorAll("button")].find((each) => each.textContent.trim() === "Hide");
    if (hide) { hide.click(); return resolve(true); }
    if (Date.now() - started > 4000) return resolve(false);
    setTimeout(tick, 200);
  };
  tick();
}))()`, true);
export const SIDEBAR = 'nav[aria-label="Bots"]';
/** The Threads section above the Bots (ThreadsSection.tsx). */
export const THREADS = 'section[data-testid="threads-section"]';
export const LIST_PREF = "sidebar.threadListProvider";
const SCOUT = { name: "Scout", avatar: "🛰️", shape: "hexagon", color: "#2ba59a", prompt: "Hi Scout. In one short sentence, say you'll watch competitors' release notes for anything that affects ORBIT-42." };
/** The selected Bot's row opens its chat as BB's thread page; the Bots list stays. `text` must show in the chat, outside the sidebar. */
const openChat = async (client, threadId, text) => {
  await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main]').click(); return true; })()`);
  await client.evaluate(`(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const onThread = location.pathname.endsWith("/threads/${threadId}");
      const composer = document.querySelector('textarea, [contenteditable="true"]');
      const nav = document.querySelector('${SIDEBAR}');
      const outside = nav ? document.body.textContent.replace(nav.textContent, "") : "";
      if (onThread && composer && nav && ${text}.test(outside)) return resolve(true);
      if (Date.now() - started > 55000) return reject(new Error("The Bot's chat didn't open as BB's thread page with the Bots list and its history"));
      setTimeout(tick, 300);
    };
    tick();
  }))()`, true);
};
/** The selected Bot's ⓘ: its Info, the Bot page, with the Bots list still in the sidebar. */
const openInfo = async (client, name = "Dot") => {
  await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main] + [data-testid=bot-info]').click(); return true; })()`);
  await client.evaluate(`(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (location.pathname.includes("${BOT_PATH}") && document.querySelector('[aria-label="${name} info"]') && document.querySelector('${SIDEBAR}')) return resolve(true);
      if (Date.now() - started > 30000) return reject(new Error("The ⓘ didn't open ${name}'s Info as the Bot page with the Bots list"));
      setTimeout(tick, 300);
    };
    tick();
  }))()`, true);
};

/**
 * Home on BB's rail. BB counts thread pages as Home, so on a thread the click
 * doesn't navigate; from elsewhere it goes back to the last Home route. The
 * sidebar keeps Studio's list either way.
 */
export const clickHome = async (client) => {
  await client.clickAriaButtonWithPointer("Home", 'nav[aria-label="Primary navigation"]');
  await sleepMs(1000);
  if ((await client.evaluate("location.pathname")).startsWith(BOT_PATH)) throw new Error("Home stayed on the Bot page");
};
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Opens a thread from BB's own thread list by its title, with the pointer, and waits for its thread page. */
export const openFromBbList = async (client, title) => {
  const point = await client.evaluate(`(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]');
      const hit = sidebar && [...sidebar.querySelectorAll("a, button, [role=button], [role=link]")].filter((each) => each.textContent.includes(${JSON.stringify(title)}) && each.getBoundingClientRect().height > 0)
        .sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (hit) {
        hit.scrollIntoView({ block: "center" });
        const rect = hit.getBoundingClientRect();
        return resolve({ x: rect.left + Math.min(rect.width / 2, 80), y: rect.top + rect.height / 2 });
      }
      if (Date.now() - started > 30000) return reject(new Error("BB's thread list has no row ${title.replace(/"/g, "")}"));
      setTimeout(tick, 300);
    };
    tick();
  }))()`, true);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await client.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
  }
  await client.evaluate(`(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (/\\/threads\\/[^/]+/.test(location.pathname)) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error("${title.replace(/"/g, "")} didn't open from BB's list"));
      setTimeout(tick, 200);
    };
    tick();
  }))()`, true);
};

/** The Bot fixtures (seeders) and its captures; scripts/check-bot-sidebar.mjs seeds with them too. */
export function botFixtures({ projectId, pluginRpc, bbCli, sleep }) {
  const json = async (args) => JSON.parse(await bbCli([...args, "--json"]));
  /** For the workspace: a nested follow-up, a thread still running, and an automation that wakes the Bot. */
  const workspaceExtras = async (botThread) => {
    const titles = async (parent) => (await json(["thread", "list", "--parent-thread", parent, "--include-hidden"]).catch(() => [])).map((thread) => thread.title);
    const children = await json(["thread", "list", "--parent-thread", botThread, "--include-hidden"]).catch(() => []);
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
    const chain = await pluginRpc("studio", "bot_chain", { botId: bot.id }).catch(() => ({ threadIds: [botThread] }));
    const started = (await Promise.all((chain.threadIds ?? [botThread]).map((parent) => json(["thread", "list", "--parent-thread", parent, "--include-hidden"]).catch(() => [])))).flat();
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
    const bot = await seededBot();
    await client.navigate(BOT_PATH);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    const pref = JSON.parse(await bbCli(["settings", "ui", "get", LIST_PREF]));
    if (pref !== "studio/bot") throw new Error(`On the Bot page the thread list is ${pref}, not studio/bot`);
    // The Bots list sits in BB's sidebar itself, left of the page, not a column inside it.
    await client.evaluate(`(() => { if (document.querySelector('${SIDEBAR}').getBoundingClientRect().left > 120) throw new Error("The Bots list isn't in BB's sidebar"); return true; })()`);
    for (const text of ["Needs you", "Running", "Schedule", "Recent", "Rotate the ORBIT-42 deploy key", "Watch the ORBIT-42 staging deploy", "Inbox sweep", "Pull the ORBIT-42 thread digests", ...CHILDREN.map((child) => child.title)]) await client.waitForText(text, 90000);
    // The follow-up nests under the thread that started it.
    await client.evaluate(`(() => {
      if (!document.querySelector('${SIDEBAR} li > button[data-thread] + ul button[data-thread]')) throw new Error("No nested sub-thread in the Bot sidebar");
      return true;
    })()`);
    // The bot's row opens its chat as BB's thread page, and the Bots list stays.
    await openChat(client, bot.threadId, "/What's left before Friday/");
    const still = JSON.parse(await bbCli(["settings", "ui", "get", LIST_PREF]));
    if (still !== "studio/bot") throw new Error(`On the Bot's chat the thread list is ${still}, not studio/bot`);
  };

  /** The Bot's chat, BB's own thread page, with the Bots list and the threads it started in the sidebar. */
  const chat = async (client) => {
    const { bot } = await seededRunners();
    let { automations } = await pluginRpc("studio", "bot_automations", { botId: bot.id });
    let reminder = automations.find(item => item.name === "Dot · Deploy reminder");
    if (!reminder) reminder = await pluginRpc("studio", "bot_automation_create", {
      botId: bot.id, kind: "reminder", name: "Dot · Deploy reminder", instruction: "Check the deploy.",
      schedule: { type: "once", at: Date.now() + 86400_000 },
    });
    if (reminder.state === "active") await pluginRpc("studio", "bot_automation_pause", { botId: bot.id, id: reminder.id });
    await workspace(client);
    await dismissProblems(client);
    ({ automations } = await pluginRpc("studio", "bot_automations", { botId: bot.id }));
    const upcoming = automations.filter(item => item.nextRunAt !== null).sort((a, b) => a.nextRunAt - b.nextRunAt || a.name.localeCompare(b.name));
    if (!upcoming.some(item => item.kind === "runner") || !upcoming.some(item => item.kind === "checkin")) throw new Error("Agenda fixture needs an upcoming runner and check-in");
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const nav = document.querySelector('${SIDEBAR}');
        const schedule = [...(nav?.querySelectorAll("section") ?? [])].find(section => section.getAttribute("aria-label") === "Schedule");
        const runners = [...(nav?.querySelectorAll("section") ?? [])].find(section => section.getAttribute("aria-label") === "Runners");
        const ids = [...(schedule?.querySelectorAll("[data-agenda]") ?? [])].map(row => row.dataset.agenda);
        const expected = ${JSON.stringify(upcoming.map(item => item.id))};
        const done = [...(schedule?.querySelectorAll("button") ?? [])].find(button => /^\\d+ done$/.test(button.textContent.trim()));
        if (expected.every((id, i) => ids.indexOf(id) >= 0 && (i === 0 || ids.indexOf(id) > ids.indexOf(expected[i - 1]))) && done && done.getAttribute("aria-expanded") === "false" && /reported|quiet/.test(runners?.textContent ?? "")) return resolve(true);
        if (Date.now() - started > 30000) return reject(new Error("Bot sidebar lacks the sorted runner/check-in agenda, collapsed done reminders, or last-run outcome"));
        setTimeout(tick, 250);
      };
      tick();
    }))()`, true);
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
    await openInfo(client);
    for (const text of ["Memory", "Skills", "Activity", "Weekdays 8:00"]) await client.waitForText(text, 30000);
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
        if (Date.now() - started > 60000) return reject(new Error("Info's Automations don't show both runners and their reports"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`, true);
    await sleep(1500);
  };

  /** A runner's thread, opened from the sidebar's Runners group as BB's thread page. */
  const runnerThread = async (client) => {
    await seededRunners();
    await workspace(client);
    await client.waitForText("Deploy watch", 60000);
    await client.evaluate(`(() => {
      const row = [...document.querySelectorAll('${SIDEBAR} section[aria-label="Runners"] button[data-runner]')].find((each) => each.textContent.includes("Deploy watch"));
      if (!row) throw new Error("No Deploy watch row under Runners");
      row.click();
      return true;
    })()`);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        // BB's own thread page, as from BB's thread list.
        // The Bots list stays beside it.
        const page = location.pathname.includes("/threads/thr_") ? document.body : null;
        if (page && document.querySelector('${SIDEBAR}') && /Deploy watch/.test(page.textContent) && /runner_report/.test(page.textContent)) return resolve(true);
        if (Date.now() - started > 60000) return reject(new Error("The Deploy watch runner's thread didn't open as BB's thread page with the Bots list"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`, true);
    // The Bot's own thread holds the runner's tell lines and no notice about a runner's thread.
    const { bot, runners } = await seededRunners();
    const log = JSON.stringify(await json(["thread", "log", bot.threadId, "--all"]));
    if (!log.includes("From runner Deploy watch: ORBIT-42 staging deploy finished")) throw new Error("The Bot's thread has no tell line from Deploy watch");
    for (const runner of runners) if (new RegExp(`@thread:${runner.threadId} (completed|failed|was interrupted|needs)`).test(log)) throw new Error(`A notice about ${runner.name} reached the Bot's thread`);
    await sleep(1500);
  };

  /**
   * Leaving the Bot page: Home on the rail, then a thread no Bot owns opened
   * from the Threads section. Studio's list stays (Threads above Bots), and
   * the threads Dot started show under Dot, not in Threads.
   */
  const OTHER = "Plan the ORBIT-42 retro";
  const leave = async (client) => {
    await seededBot();
    let other = (await json(["thread", "list"]).catch(() => [])).find((thread) => thread.title === OTHER);
    if (!other) {
      other = await json(["thread", "spawn", "--project", projectId, "--title", OTHER, "--prompt", "Reply with one short sentence: the ORBIT-42 retro is Monday at 10."]);
      await bbCli(["thread", "wait", other.id, "--status", "idle", "--timeout", "180"]).catch(() => {});
    }
    await client.navigate(BOT_PATH);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    // The rail has no Bot item: the Bot page lives under the Studio panel.
    await client.evaluate(`(() => {
      const rail = document.querySelector('nav[aria-label="Primary navigation"]');
      if (rail && [...rail.querySelectorAll("button, a")].some((each) => (each.getAttribute("aria-label") ?? each.textContent.trim()) === "Bot")) throw new Error("The rail still has a Bot item");
      return true;
    })()`);
    await clickHome(client);
    await client.waitForSelector(THREADS, 30000);
    await openFromBbList(client, OTHER);
    if (!(await client.evaluate("location.pathname")).endsWith(`/threads/${other.id}`)) throw new Error(`The Threads section didn't open ${OTHER}`);
    await sleep(1000);
    const pref = JSON.parse(await bbCli(["settings", "ui", "get", LIST_PREF]));
    if (pref !== "studio/bot") throw new Error(`After leaving the Bot page the thread list is ${pref}, not studio/bot`);
    for (const title of ORBIT_TITLES) await client.waitForText(title, 30000);
    const botOwned = ["Rotate the ORBIT-42 deploy key", "Watch the ORBIT-42 staging deploy", ...CHILDREN.map((child) => child.title)];
    await client.evaluate(`(() => {
      const threads = document.querySelector('${THREADS}');
      const bots = document.querySelector('${SIDEBAR}');
      if (!threads || !bots) throw new Error("The sidebar lacks Threads or Bots");
      if (!(threads.compareDocumentPosition(bots) & Node.DOCUMENT_POSITION_FOLLOWING)) throw new Error("Threads isn't above Bots");
      const text = threads.textContent;
      for (const title of ${JSON.stringify([OTHER, ...ORBIT_TITLES])}) if (!text.includes(title)) throw new Error("Threads lacks " + title);
      const shown = ${JSON.stringify(botOwned)}.filter((title) => text.includes(title));
      if (shown.length) throw new Error("Threads repeats the Bot's threads: " + shown.join(", "));
      return true;
    })()`);
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
    await client.waitForText("Make another Bot", 30000);
    for (const text of ["What should your Bot help with?", "Create Bot", "Dot"]) await client.waitForText(text, 30000);
    await client.waitForSelector(`${SIDEBAR} [data-testid=bot-new-row]`, 30000);
    await client.waitForSelector("textarea#bot-welcome-goal", 30000);
    if (!(await client.evaluate("location.pathname")).endsWith("/plugins/studio/studio/bot/new")) throw new Error("New bot didn't open /plugins/studio/studio/bot/new");
    await sleep(800);
  };

  /**
   * The first-time flow, on a fresh staging right after studio-bot-create:
   * the welcome's Create makes the Bot (Chief of Staff, a blob) and opens its
   * chat as BB's thread page, where it answers the setup with questions. It
   * doesn't rename itself before they're answered. Afterwards it becomes Dot,
   * the Bot the later captures expect (seededBot keeps an existing Bot).
   */
  const firstChat = async (client) => {
    const { bot: before } = await pluginRpc("studio", "bot_get", {});
    if (before) throw new Error("The staged BB already has a Bot; capture the first chat on a fresh staging (stop, then start).");
    await client.navigate(BOT_PATH);
    await dismissProblems(client);
    await client.waitForSelector("textarea#bot-welcome-goal", 30000);
    await client.evaluate(`(() => {
      const field = document.querySelector("textarea#bot-welcome-goal");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(FIRST_GOAL)});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    await client.evaluate(`(() => { [...document.querySelectorAll("button")].find((each) => each.textContent.trim() === "Create Bot").click(); return true; })()`);
    let bot = null;
    for (let i = 0; i < 40 && !bot?.threadId; i++) { ({ bot } = await pluginRpc("studio", "bot_get", {})); if (!bot?.threadId) await sleep(500); }
    if (!bot?.threadId) throw new Error("Create Bot made no Bot with a chat");
    if (bot.name !== "Chief of Staff" || bot.shape !== "blob") throw new Error(`The new Bot is ${bot.name} (${bot.shape}), not Chief of Staff (blob)`);
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const nav = document.querySelector('${SIDEBAR}');
        const outside = nav ? document.body.textContent.replace(nav.textContent, "") : "";
        const at = outside.indexOf("set them with bot_profile_update");
        // The Bot's reply, after the setup message, asks something.
        if (location.pathname.endsWith("/threads/${bot.threadId}") && nav?.textContent.includes("Chief of Staff") && at >= 0 && outside.slice(at).includes("?")) return resolve(true);
        if (Date.now() - started > 60000) return reject(new Error("The new Bot's chat didn't open as BB's thread page with the setup message and a question back"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`, true);
    await dismissProblems(client);
    await sleep(1500);
    return async () => {
      await pluginRpc("studio", "bot_set", { name: "Dot", avatar: "🟣", shape: "blob", color: "#7c66dc", role: "" });
    };
  };

  /** A second bot, Scout, selected: its page (its Info), its expanded sidebar entry; Dot is listed above it. */
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
        const info = document.querySelector('[aria-label="Scout info"]');
        if (main && /Scout/.test(main.textContent) && other && /Dot/.test(other.textContent) && info) return resolve(true);
        if (Date.now() - started > 55000) return reject(new Error("The Bot page doesn't show Scout selected with Dot listed and Scout's Info"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`, true);
    // Scout's own check-in (the Evening wrap-up preset) and its own Memory and Skills.
    for (const text of ["Checks in weekdays at 18:00", "Weekdays 6:00 PM", "Memory", "Skills", "Open chat"]) await client.waitForText(text, 30000);
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
    await client.waitForSelector('[aria-label="Relay info"]', 30000);
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
    // Its chat, the new Codex thread, opens as BB's thread page from its row.
    await openChat(client, relay.threadId, "/Codex|gpt-6/");
    await client.evaluate(`(() => { const group = document.querySelector('${SIDEBAR} section[aria-label="Earlier conversations"] > button'); if (!group) throw new Error("No Earlier conversations"); if (group.getAttribute("aria-expanded") !== "true") group.click(); return true; })()`);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        // The group's toggle and one titled row per earlier thread.
        const rows = [...document.querySelectorAll('${SIDEBAR} section[aria-label="Earlier conversations"] button[type=button]:not([aria-expanded])')];
        if (rows.length >= 2 && rows.every((row) => row.textContent.trim())) return resolve(true);
        if (Date.now() - started > 55000) return reject(new Error("The handoff chat or its earlier conversations (with their titles) aren't showing"));
        setTimeout(tick, 300);
      };
      tick();
    }))()`, true);
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
    await openInfo(client);
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
        // The two check-ins plus the Skill curator, which lists as one.
        const checkins = kinds.filter((kind) => kind === "checkin").length;
        if (checkins === 3 && /Skill curator/.test(text) && kinds.includes("reminder") && kinds.includes("runner") && /Evening wrap-up/.test(text) && /Check the deploy/.test(text) && /Woke it: ORBIT-42 v1.4.0/.test(text) && /Nothing new/.test(text) && /Weekdays 8:00/.test(text)) {
          section.scrollIntoView({ block: "start" });
          return resolve(true);
        }
        if (Date.now() - started > 60000) return reject(new Error("Automations don't show two check-ins, a reminder, the watcher's runs and runners: " + kinds.join(",")));
        setTimeout(tick, 300);
      };
      tick();
    }))()`, true);
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
    }))()`, true);
    await client.waitForSelector('[data-testid=automation-editor] [data-testid=schedule-preview]', 30000);
    await client.evaluate(`(() => {
      const editor = document.querySelector('[data-testid=automation-editor]');
      const text = editor.textContent;
      for (const want of ["Edit Release watch", "Script", "Every 15 min, every day · quiet 10:00 PM–7:00 AM", "*/15 7-21 * * *", "Quiet hours", "Timezone", "Morning and evening"]) if (!text.includes(want)) throw new Error("The schedule editor lacks " + want);
      if (!editor.querySelector('[role=group][aria-label=Days] [aria-pressed=true]')) throw new Error("No day chips on");
      return true;
    })()`);
    await sleep(1000);
  };

  const seededSkills = async () => {
    const { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) throw new Error("The staged BB has no Bot for its Skills capture");
    const name = "system-report";
    const description = "A concise, repeatable read-only system report.";
    await pluginRpc("studio", "bot_skill_write", {
      botId: bot.id, name, description,
      body: "# System report\n\nCollect the OS name and version, CPU count, and free disk space. Keep the report to a short Markdown table. Use read-only commands and do not change files.",
    });
    await pluginRpc("studio", "bot_skill_write", {
      botId: bot.id, name, description,
      body: "# System report\n\nCollect the OS name and version, CPU count, and free disk space. Return exactly a four-row Markdown table with OS, macOS, CPUs, and Free disk. Use read-only commands and do not change files.",
    });
    const { skills } = await pluginRpc("studio", "bot_skills", { botId: bot.id });
    const saved = skills.find((skill) => skill.name === name && skill.state !== "archived");
    if (!saved) throw new Error("The staged Bot skill write was not saved immediately");
    const { versions } = await pluginRpc("studio", "bot_skill_history", { botId: bot.id });
    if (!versions.some((version) => version.name === name)) throw new Error("The staged skill write has no history version");
    return [saved];
  };
  const skillsSection = async (client) => {
    const skills = await seededSkills();
    // From the Bot page (Info by id; the bare page opens the chat): the lessons made the chat long, so it isn't the way in.
    const { bot: primary } = await pluginRpc("studio", "bot_get", {});
    await client.navigate(`${BOT_PATH}/${primary.id}`);
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 700, deviceScaleFactor: 1, mobile: false });
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    await openInfo(client);
    await client.waitForSelector('button[aria-label="Manage skills"]', 30000);
    await client.evaluate(`(() => { document.querySelector('button[aria-label="Manage skills"]').click(); return true; })()`);
    await client.waitForSelector('[aria-label="Learn from work"]', 30000);
    for (const text of ["Learn from work", "turns", "Review model", "Curator merges overlapping skills", skills[0].name, "Skill history"]) await client.waitForText(text, 30000);
    await client.evaluate(`(() => {
      const section = document.querySelector('section[aria-label="Skills"]');
      if (/Waiting for your approval|Review skills before saving/i.test(section?.textContent ?? "")) throw new Error("Skills still shows a save-approval state");
      const history = section?.querySelector('button[aria-controls="bot-skill-history"]');
      if (!history?.textContent.includes("Skill history")) throw new Error("Skill history is missing");
      if (history.getAttribute("aria-expanded") !== "true") history.click();
      const version = section.querySelector("#bot-skill-history [data-skill-version]");
      if (!version) throw new Error("Skill history has no saved version");
      const toggle = version.querySelector(":scope > button[aria-expanded]");
      if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
      if (!version.querySelector('button[aria-label^="Revert "]')) throw new Error("The saved version has no Revert action");
      section.scrollIntoView({ block: "start" });
      return true;
    })()`);
    await client.waitForText("Revert", 15000);
    await sleep(1000);
  };

  /** Ask Dot to make one real, reversible self-edit through its profile tool. */
  const seededProfileChanges = async () => {
    const { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) throw new Error("The staged BB has no Bot for the profile captures");
    let { changes } = await pluginRpc("studio", "bot_profile_changes", { botId: bot.id });
    if (!changes.some((change) => change.field === "role" && change.newValue === PROFILE_DESCRIPTION)) {
      await bbCli(["thread", "tell", bot.threadId, `Use bot_profile_update to set only your description to exactly: ${PROFILE_DESCRIPTION} Keep your name and avatar unchanged. Then reply with one short confirmation.`]);
      await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]);
      for (let i = 0; i < 40; i++) {
        ({ changes } = await pluginRpc("studio", "bot_profile_changes", { botId: bot.id }));
        if (changes.some((change) => change.field === "role" && change.newValue === PROFILE_DESCRIPTION)) break;
        await sleep(1000);
      }
    }
    if (!changes.some((change) => change.field === "role" && change.newValue === PROFILE_DESCRIPTION)) throw new Error("Dot did not record the staged profile description change");
    return bot;
  };

  const botInfoProfile = async (client) => {
    const bot = await seededProfileChanges();
    await client.navigate(`${BOT_PATH}/${bot.id}`);
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 560, deviceScaleFactor: 1, mobile: false });
    await client.waitForSelector(`[aria-label="${bot.name} info"]`, 30000);
    await dismissProblems(client);
    await client.evaluate(`(() => {
      const profile = document.querySelector('[data-testid="bot-profile-section"]');
      const status = profile?.querySelector('[data-testid="bot-info-status"]')?.textContent.trim();
      if (!profile || !status) throw new Error("Bot info has no collapsed profile or status");
      if (!profile.querySelector('button[aria-label="Edit profile"]')) throw new Error("The collapsed profile has no Edit button");
      if (profile.querySelector('#bot-profile-editor')) throw new Error("The profile editor should start collapsed");
      if (!profile.textContent.includes(${JSON.stringify(PROFILE_DESCRIPTION)})) throw new Error("The profile description is missing");
      return true;
    })()`);
    await sleep(700);
  };

  const botProfileEdit = async (client) => {
    const bot = await seededProfileChanges();
    await client.navigate(`${BOT_PATH}/${bot.id}`);
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 650, deviceScaleFactor: 1, mobile: false });
    await client.waitForSelector('[data-testid="bot-profile-section"] button[aria-label="Edit profile"]', 30000);
    await client.evaluate(`(() => { document.querySelector('[data-testid="bot-profile-section"] button[aria-label="Edit profile"]').click(); return true; })()`);
    await client.waitForSelector('#bot-profile-editor textarea[aria-label="Description"]', 15000);
    await client.evaluate(`(() => {
      const editor = document.querySelector('#bot-profile-editor');
      if (!editor?.querySelector('input[aria-label="Bot name"]') || !editor.querySelector('button:not([disabled])')) throw new Error("The profile edit form is incomplete");
      if (editor.querySelector('textarea[aria-label="Description"]')?.value !== ${JSON.stringify(PROFILE_DESCRIPTION)}) throw new Error("The profile edit form has the wrong description");
      return true;
    })()`);
    await sleep(700);
  };

  const botProfileChanges = async (client) => {
    const bot = await seededProfileChanges();
    await client.navigate(`${BOT_PATH}/${bot.id}`);
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 560, deviceScaleFactor: 1, mobile: false });
    await client.waitForSelector('[data-testid="bot-profile-section"] button[aria-controls="bot-profile-changes-content"]', 30000);
    await client.evaluate(`(() => { document.querySelector('[aria-controls="bot-profile-changes-content"]').click(); return true; })()`);
    await client.waitForSelector('[data-testid="bot-profile-change"] button[aria-label="Revert description"]', 15000);
    await client.evaluate(`(() => {
      const profile = document.querySelector('[data-testid="bot-profile-section"]');
      const history = profile?.querySelector('#bot-profile-changes-content');
      if (!history || history.hidden || !history.textContent.includes("Changed by Dot")) throw new Error("Profile changes did not open with Dot's recorded edit");
      if (!history.textContent.includes(${JSON.stringify(PROFILE_DESCRIPTION)})) throw new Error("Profile changes omit the saved description");
      return true;
    })()`);
    await sleep(700);
  };

  /** Use a live Claude thread to capture the real warm and expired header states. */
  const cacheBot = async () => {
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (bot.providerId !== "claude-code" || bot.model !== "claude-sonnet-5-5") {
      const switched = await pluginRpc("studio", "thread_handoff_to_model", { threadId: bot.threadId, providerId: "claude-code", model: "claude-sonnet-5-5", reasoning: "low" });
      if (switched.change !== "handoff" && switched.change !== "in-place") throw new Error(`Dot's cache capture model switch was ${switched.change}`);
      await bbCli(["thread", "wait", switched.threadId, "--status", "idle", "--timeout", "300"]).catch(() => {});
      ({ bot } = await pluginRpc("studio", "bot_get", {}));
    }
    await bbCli(["thread", "tell", bot.threadId, "For the staged cache header fixture, reply exactly [PASS]."]);
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "300"]);
    await pluginRpc("studio", "bot_cache_set", { botId: bot.id, thresholdTokens: 10_000 });
    return bot;
  };

  const cacheHeader = (state, ageMs, filenameCheck) => async (client) => {
    const bot = await cacheBot();
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    backdateLatestTokenUsage(bot.threadId, ageMs);
    // BotCacheWarmer memoizes observed usage for 20s; let that cache expire before checking.
    await sleep(20_500);
    const cache = await pluginRpc("studio", "bot_cache_state", { threadId: bot.threadId });
    if (cache.state !== state) throw new Error(`The cache fixture is ${cache.state}, not ${state}`);
    await client.navigate(`${BOT_PATH}/${bot.id}`);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    await openChat(client, bot.threadId, "/PASS/");
    await client.command("Page.reload");
    await client.waitForSelector('[data-testid="bot-info-header"]', 30000);
    await client.waitForSelector('[data-testid="bot-cache-chip"]', 30000);
    await client.evaluate(`(() => {
      const info = document.querySelector('[data-testid="bot-info-header"]');
      const chip = document.querySelector('[data-testid="bot-cache-chip"]');
      if (!info || !chip) throw new Error("The Bot thread header is missing Bot info or the cache indicator");
      if (!chip.textContent.includes(${JSON.stringify(filenameCheck)})) throw new Error("The cache chip reads " + chip.textContent);
      if (chip.getAttribute("aria-label") !== ${JSON.stringify(state === "warm" ? "Prompt cache: 59m left" : "Prompt cache: cold")}) throw new Error("The cache chip label is " + chip.getAttribute("aria-label"));
      return true;
    })()`);
    await sleep(700);
  };

  const regularThreadHeader = async (client) => {
    const regular = (await json(["thread", "list", "--project", projectId])).find((thread) => thread.title === "Plan the Friday release window" && !thread.parentThreadId && !thread.environmentId);
    const thread = regular?.id;
    if (!thread) throw new Error("The staged seed has no regular thread without a workspace");
    const rows = JSON.parse(await bbCli(["automation", "list", "--project", projectId, "--json"]));
    const list = Array.isArray(rows) ? rows : rows.automations ?? [];
    if (!list.some((row) => row.name === "Thread header fixture" && row.execution?.targetThreadId === thread)) {
      await bbCli(["automation", "create", "--project", projectId, "--name", "Thread header fixture", "--cron", "0 0 1 1 *", "--timezone", "UTC", "--prompt", "Reply exactly [PASS].", "--provider", "codex", "--model", "gpt-6.1-sol", "--target-thread", thread, "--json"]);
    }
    await client.navigate(BOT_PATH);
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await dismissProblems(client);
    await clickHome(client);
    await client.waitForSelector(THREADS, 30000);
    const title = JSON.parse(await bbCli(["thread", "show", thread, "--json"])).thread.title;
    await openFromBbList(client, title);
    await client.waitForSelector('[data-testid="app-page-header-content-row"]', 30000);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const header = document.querySelector('[data-testid="app-page-header-content-row"]');
        const button = header && [...header.querySelectorAll("button")].find((each) => /automation.*wake this thread/i.test(each.getAttribute("aria-label") ?? each.title));
        const vscode = [...(header?.querySelectorAll("button") ?? [])].find((each) => /visual studio code|vs code|vscode/i.test((each.getAttribute("aria-label") ?? "") + " " + each.title + " " + each.textContent));
        if (button) {
          if (vscode) return reject(new Error("The regular thread header still has a VS Code button"));
          return resolve(true);
        }
        if (Date.now() - started > 30000) return reject(new Error("The regular thread header has no Automations button"));
        setTimeout(tick, 250);
      };
      tick();
    }))()`, true);
    await sleep(700);
  };

  const captures = [
    {
      id: "studio-bot-create",
      packageDir: "bb-studio",
      fileName: "bot-create.png",
      setup: async (client) => {
        const { bot } = await pluginRpc("studio", "bot_get", {});
        if (bot) throw new Error("The staged BB already has a Bot; capture onboarding on a fresh staging (stop, then start).");
        await client.navigate(BOT_PATH);
        await dismissProblems(client);
        await client.waitForText("Meet your Bot", 30000);
        for (const text of ["What should your Bot help with?", "Create Bot", "Watch my projects", "Morning brief", "picks its own name and look"]) await client.waitForText(text);
        await client.waitForSelector("textarea#bot-welcome-goal");
        await client.waitForSelector("[data-testid=bot-welcome] svg[data-shape=blob]");
        await client.waitForSelector(`${SIDEBAR} [data-testid=bot-new-row]`, 30000);
        await sleep(600);
      },
    },
    { id: "studio-bot-first-chat", packageDir: "bb-studio", fileName: "bot-first-chat.png", setup: firstChat },
    { id: "studio-bot", packageDir: "bb-studio", fileName: "bot.png", setup: chat },
    { id: "studio-bot-info", packageDir: "bb-studio", fileName: "bot-info.png", setup: botInfoProfile },
    { id: "studio-bot-profile-edit", packageDir: "bb-studio", fileName: "bot-profile-edit.png", setup: botProfileEdit },
    { id: "studio-bot-profile-changes", packageDir: "bb-studio", fileName: "bot-profile-changes.png", setup: botProfileChanges },
    { id: "studio-bot-cache-warm", packageDir: "bb-studio", fileName: "bot-header-cache-warm.png", setup: cacheHeader("warm", 61_000, "59m") },
    { id: "studio-bot-cache-cold", packageDir: "bb-studio", fileName: "bot-header-cache-cold.png", setup: cacheHeader("cold", 61 * 60_000, "cold") },
    { id: "studio-thread-header-automations", packageDir: "bb-studio", fileName: "thread-header-automations.png", setup: regularThreadHeader },
    { id: "studio-bot-leave", packageDir: "bb-studio", fileName: "bot-leave.png", setup: leave },
    { id: "studio-bot-runners", packageDir: "bb-studio", fileName: "bot-runners.png", setup: runnersInfo },
    { id: "studio-bot-automations", packageDir: "bb-studio", fileName: "bot-automations.png", setup: automationsList },
    { id: "studio-bot-schedule-editor", packageDir: "bb-studio", fileName: "bot-schedule-editor.png", setup: scheduleEditor },
    { id: "studio-bot-runner-thread", packageDir: "bb-studio", fileName: "bot-runner-thread.png", setup: runnerThread },
    { id: "studio-bot-new", packageDir: "bb-studio", fileName: "bot-new.png", setup: newBot },
    { id: "studio-bot-two", packageDir: "bb-studio", fileName: "bot-two.png", setup: twoBots },
    { id: "studio-bot-switch-model", packageDir: "bb-studio", fileName: "bot-switch-model.png", setup: switchModel },
    { id: "studio-bot-handoff", packageDir: "bb-studio", fileName: "bot-handoff.png", setup: handoff },
    // Last: teaching Dot a skill adds turns to its chat that other shots should not show.
    { id: "studio-bot-skills", packageDir: "bb-studio", fileName: "bot-skills.png", setup: skillsSection },
  ];
  return { captures, json, seededBot, seededRunners, CHILDREN };
}

export default (context) => botFixtures(context).captures;

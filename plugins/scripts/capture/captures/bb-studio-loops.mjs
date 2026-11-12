// The Attention Router's README captures (docs/attention-router/backend.md):
// loop cards in the Bot's chat, the morning card, and the Bot page's Loops tab,
// in dark and light. Loops are written straight into the staged Studio
// database with fixed ids, so every run shows the same records; the Bot posts
// the `::loop` lines itself, as it does when the scheduler releases a loop.
//
// The Loops pane (src/loops/ui/LoopsPane.tsx) is captured beside the Bot's
// chat: opened from the chat header's Loops button, a row's ⋯ menu, Change
// trigger under its row, and the `::loops{open="pane"}` card that opens it.
// Discuss (src/loops/reference.ts): the menu item, the `@loop` chip it puts
// in the composer, a row dragged over the composer and dropped, the Bot's
// real reply to the chip, and Discuss on the Loops tab.
//
// BB_CAPTURE_LOOPS_BEFORE=1 captures the same surfaces without asserting the
// new UI, for before-and-after renders against an older Studio.
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

import { readStagedInstance } from "../../staged-instance.mjs";
import { BOT_PATH, dismissProblems } from "./bb-studio-bot.mjs";
import { clickHeaderAction } from "../header-actions.mjs";

const require = createRequire(import.meta.url);
const BEFORE = process.env.BB_CAPTURE_LOOPS_BEFORE === "1";
const DAY = 86_400_000;
const MIN = 60_000;
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

const at = (dayOffset, hour, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, minute, 0, 0); return d.getTime(); };
/** The next given weekday (0 = Sunday) at a time, at least tomorrow. */
const next = (weekday, hour, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + (((weekday - d.getDay() + 7) % 7) || 7)); d.setHours(hour, minute, 0, 0); return d.getTime(); };

function loops({ larkspurLead }) {
  const now = Date.now();
  const base = { why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "surfaced", due: null, area: null, createdAt: now - DAY, updatedAt: now - 10 * MIN, closedAt: null, closedBy: null };
  const l = (id, fields) => ({ ...base, id: `loop_capture-${id}`, ...fields });
  return [
    l("deck", { kind: "decide", title: "Choose the deck contractor", why: "Both are licensed and insured. Bayside can start sooner; Hudson is cheaper and has the better reviews.", options: ["Bayside Decks · $4,200 · starts Nov 9", "Hudson Carpentry · $3,650 · starts Dec 1"], source: { kind: "Inbox watch", ref: "2 quotes in email" }, area: "Home", due: next(5, 17) }),
    l("sam", { title: "Reply to Sam about the Q3 planning doc", why: "He asked whether you can own the budget section; the doc locks Friday. A two-line yes or no is enough.", source: { kind: "email", ref: "Email from Sam B." }, area: "Job", due: next(5, 17), trigger: { type: "time", at: now - 30 * MIN } }),
    l("tax", { title: "Pay the property tax installment", why: "$2,140 on the county portal", area: "Home", due: at(0, 23, 0) }),
    l("vendor", { kind: "read", title: "Your vendor demo moved to Thu 2:00 PM", why: "Same Zoom link. Nothing else changed.", source: { kind: "Calendar watch", ref: "Calendar" }, area: "Job" }),
    l("plumber", { status: "queued", title: "Call the plumber about the slow drain", trigger: { type: "place", place: "home", direction: "arrive" }, push: true, area: "Home" }),
    l("expense", { status: "snoozed", title: "Send the October expense report", trigger: { type: "time", at: next(5, 15) }, area: "Job" }),
    l("resume", { status: "queued", title: "Send Sam your budget numbers", trigger: { type: "event", event: "reply:sam" }, area: "Job" }),
    l("cleaning", { status: "queued", title: "Pick up the dry cleaning", trigger: { type: "place", place: "office", direction: "leave" }, area: "Home" }),
    l("benefits", { status: "queued", title: "Benefits enrollment opens", trigger: { type: "time", at: next(1, 9) + 7 * DAY }, area: "Job" }),
    l("larkspur", { status: "in_progress", owner: `thread:${larkspurLead}`, title: "Draft the Larkspur Q4 lead summary", why: "Pull the four Q4 threads into one page for Monday.", source: { kind: "thread", ref: larkspurLead }, area: "Larkspur", updatedAt: now - 12 * MIN }),
    l("lisbon", { status: "in_progress", owner: "cos", title: "Find three Lisbon hotels under €250", area: "Job", updatedAt: now - 3 * MIN }),
    l("lease", { kind: "waiting", status: "queued", title: "Signed lease addendum", why: "Dana said she’d send it by Friday. Nothing yet.", source: { kind: "email", ref: "Email" }, area: "Home", createdAt: now - 4 * DAY }),
    l("railing", { kind: "waiting", status: "queued", title: "Revised quote with railing", why: "Asked Hudson Carpentry for a quote with the railing.", area: "Home", createdAt: now - 2 * 3_600_000 }),
    l("hosting", { status: "done", title: "Cancel the hosting Pro trial before it bills", area: "Systems", closedAt: now - 40 * MIN, closedBy: "patrick" }),
    l("caterer", { status: "done", kind: "decide", title: "Pick a caterer for Mom’s birthday", options: ["Café Grumpy", "Sam’s Deli"], area: "Home", closedAt: now - 3 * 3_600_000, closedBy: "patrick" }),
  ];
}
const HISTORY = {
  larkspur: [["handed_off", 12 * MIN, {}]],
  sam: [["surfaced", 30 * MIN, {}]],
  deck: [["surfaced", 50 * MIN, {}]],
  vendor: [["surfaced", 20 * MIN, {}]],
  lease: [["surfaced", 15 * MIN, {}]],
  vercel: [["closed", 40 * MIN, { action: "done" }]],
  caterer: [["closed", 3 * 60 * MIN, { action: "choose", option: "Café Grumpy" }]],
};

/** Replace the fixture loops in the staged Studio database. */
function writeLoops(records) {
  const { dataDir } = readStagedInstance();
  const Database = require("../../../packages/bb-studio/node_modules/better-sqlite3");
  const db = new Database(join(dataDir, "plugins/studio/data.db"), { timeout: 5000 });
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM loop_events WHERE loop_id LIKE 'loop_capture-%'").run();
      db.prepare("DELETE FROM bot_loops WHERE id LIKE 'loop_capture-%'").run();
      for (const loop of records) db.prepare("INSERT INTO bot_loops VALUES (?, ?)").run(loop.id, JSON.stringify(loop));
      for (const [key, events] of Object.entries(HISTORY)) {
        for (const [type, ago, data] of events) db.prepare("INSERT INTO loop_events (loop_id, type, at, data) VALUES (?, ?, ?, ?)").run(`loop_capture-${key}`, type, Date.now() - ago, JSON.stringify(data));
      }
    })();
  } finally {
    db.close();
  }
}

const id = (key) => `loop_capture-${key}`;
const CARDS = ["deck", "sam", "vendor", "lease"].map((key) => `::loop{id="${id(key)}"}`).join("\n\n");
const PROGRESS = ["larkspur", "vercel", "caterer"].map((key) => `::loop{id="${id(key)}"}`).join("\n\n");
const morning = () => [
  `## ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`,
  "",
  "**Calendar**",
  "- 9:30 AM · Standup · Zoom",
  "- 12:30 PM · Lunch with Sam · Café Grumpy",
  "- 4:00 PM · Dentist · Dr. Patel",
  "",
  "**On today's list**",
  "",
  ...["tax", "deck", "sam", "vendor"].map((key) => `::loop{id="${id(key)}" row="1"}`),
  '::loops{more="3"}',
  "",
  "**Good to know**",
  "- Rain from 3 PM. Take an umbrella to the dentist.",
  "- Mom’s birthday is Saturday. The gift you saved is still in stock.",
].join("\n");

export default ({ pluginRpc, bbCli, sleep }) => {
  const json = async (args) => JSON.parse(await bbCli([...args, "--json"]));
  let fixture = null;

  /** The Bot, a Larkspur project with a lead, the phone's places, the loops, and the Bot's posts. */
  async function seed() {
    if (fixture) return fixture;
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) {
      ({ bot } = await pluginRpc("studio", "bot_create", { name: "Chief of Staff", avatar: "🟢", shape: "blob", color: "#2ba59a", prompt: "Hi. In one short sentence, say you'll keep track of what needs me." }));
    }
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "180"]).catch(() => {});
    // A Larkspur project whose lead takes handed-off loops.
    const projects = await json(["project", "list"]);
    let larkspur = (Array.isArray(projects) ? projects : projects.projects ?? []).find((project) => project.name === "Larkspur");
    if (!larkspur) {
      const { instance } = { instance: readStagedInstance() };
      const root = join(instance.directory, "larkspur");
      await mkdir(root, { recursive: true });
      const [machine] = await json(["machine", "list"]);
      larkspur = await json(["project", "create", "--name", "Larkspur", "--root", root, "--machine", machine.id]);
    }
    let lead = (await pluginRpc("studio", "project_lead", { projectId: larkspur.id })).leadThreadId;
    if (!lead) {
      const thread = await json(["thread", "spawn", "--project", larkspur.id, "--title", "Larkspur lead", "--prompt", "Larkspur lead.", "--send-at", "30d"]);
      lead = (await pluginRpc("studio", "project_set_lead", { projectId: larkspur.id, threadId: thread.id })).leadThreadId;
    }
    if (!BEFORE) await pluginRpc("studio", "loops.setPlaces", { names: ["Home", "Office", "Mom’s", "Gym"] });
    writeLoops(loops({ larkspurLead: lead }));
    fixture = { bot, lead };
    return fixture;
  }

  /** The Bot posts `text` as its newest reply, as it does when the scheduler asks it to. */
  const post = async (bot, label, text) => {
    await bbCli(["thread", "tell", bot.threadId, `Capture fixture (${label}). Don't call any tools. Reply with exactly the text between the markers, unchanged, and nothing else.\n<<<\n${text}\n>>>`]);
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
  };
  const setEnabled = (on) => bbCli(["studio", "settings", "set", "loopsEnabled", on ? "true" : "false"]);
  const chatPath = (bot) => `/threads/${bot.threadId}`;
  /** Scroll the chat so `selector`'s first match is near the top. */
  /** The newest reply's text: the last element holding `text`, scrolled to the top of the chat. */
  const scrollToText = (client, text) => client.evaluate(`(() => { const all = [...document.querySelectorAll("p, h2, li, div")].filter((e) => e.children.length === 0 && e.textContent.includes(${JSON.stringify(text)})); const el = all.at(-1); if (!el) return false; el.scrollIntoView({ block: "start" }); return true; })()`);
  const scrollTo = (client, selector, index = -1) => client.evaluate(`(() => { const list = document.querySelectorAll(${JSON.stringify(selector)}); const el = list[${index} < 0 ? list.length + ${index} : ${index}]; if (!el) throw new Error("Nothing matches ${selector.replace(/"/g, "'")}"); el.scrollIntoView({ block: "start" }); for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { p.scrollTop -= 60; break; } return true; })()`);
  const hover = async (client, selector, index = 0) => {
    const point = await client.evaluate(`(() => { const r = [...document.querySelectorAll(${JSON.stringify(selector)})].at(${index}).getBoundingClientRect(); return { x: r.left + 40, y: r.top + 14 }; })()`);
    await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons: 0 });
    await sleep(300);
  };
  /** Click the newest `selector` with `text` with the pointer (Radix menus open on pointerdown). */
  const press = async (client, selector, text, within = null) => {
    const point = await client.evaluate(`(() => {
      const root = ${JSON.stringify(within)} ? document.querySelectorAll(${JSON.stringify(within?.[0] ?? "")})[${within?.[1] ?? 0}] : document;
      const el = [...root.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.textContent?.trim() === ${JSON.stringify(text)}).at(-1);
      if (!el) throw new Error("Nothing to press: ${text}");
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await client.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
    }
    await sleep(400);
  };

  const chatCapture = (captureId, fileName, color, [label, text], after) => ({
    id: captureId,
    packageDir: "bb-studio",
    fileName,
    showSidebar: true,
    setup: async (client) => {
      await scheme(client, color);
      const { bot } = await seed();
      await setEnabled(true);
      await post(bot, label, typeof text === "function" ? text() : text);
      await client.navigate(chatPath(bot));
      await dismissProblems(client);
      if (BEFORE) { await client.waitForText("Capture fixture", 60000); await scrollToText(client, text === CARDS || text === PROGRESS ? 'loop_capture' : "On today's list"); await sleep(1500); }
      else await after(client, bot);
      return async () => { await scheme(client, ""); };
    },
  });

  const loopsTab = (captureId, fileName, color, after = async () => {}) => ({
    id: captureId,
    packageDir: "bb-studio",
    fileName,
    showSidebar: true,
    setup: async (client) => {
      await scheme(client, color);
      const { bot } = await seed();
      await setEnabled(true);
      // The Discuss capture's real reply would otherwise count as unread in Needs you now.
      await bbCli(["thread", "read", bot.threadId]).catch(() => {});
      await client.navigate(`${BOT_PATH}/${bot.id}/loops`);
      await dismissProblems(client);
      if (BEFORE) { await client.waitForText("Activity", 30000); await sleep(1000); return async () => { await scheme(client, ""); }; }
      await client.waitForSelector("[data-testid=loops-tab]", 30000);
      for (const text of ["Needs you now", "Coming up", "Agents on it", "Waiting on others", "Done · last 7 days", "Reply to Sam about the Q3 planning doc", "When you get home", "When Sam replies", "Larkspur lead", "Nudge them", "All loops"]) await client.waitForText(text, 30000);
      await after(client);
      return async () => { await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }).catch(() => {}); await scheme(client, ""); };
    },
  });

  /** Press the first element matching `selector` with the pointer, inside `within` when given. */
  const pressAt = async (client, selector) => {
    const point = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Nothing to press: ${selector.replace(/"/g, "'")}");
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await client.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
    }
    await sleep(400);
  };
  const PANE_TEXTS = ["Needs you now", "Coming up", "Reply to Sam about the Q3 planning doc", "Choose the deck contractor", "When you get home", "Agents on it"];
  const OPEN_CARD = "Sure. Here’s everything open, beside our chat so we can go through it.\n\n::loops{open=\"pane\"}";
  let paneChat = null;
  /** The Bot's chat with the `::loops{open="pane"}` card as its newest reply, posted once per run. */
  const openPaneChat = async (client) => {
    const { bot } = await seed();
    await setEnabled(true);
    if (paneChat !== bot.threadId) { await post(bot, "loops pane", OPEN_CARD); paneChat = bot.threadId; }
    await bbCli(["thread", "read", bot.threadId]).catch(() => {});
    await client.navigate(chatPath(bot));
    await dismissProblems(client);
    await client.waitForSelector("[data-testid=loops-open]", 60000);
    await scrollTo(client, "[data-testid=loops-open]");
    return bot;
  };
  /** The pane open beside the chat, from the header's Loops button (a header action: "Loops · 4"). */
  const openPane = async (client) => {
    await clickHeaderAction(client, "^Loops( · \\d+)?$");
    await client.waitForSelector("[data-testid=loops-pane]", 30000);
    for (const text of PANE_TEXTS) await client.waitForText(text, 30000);
    await sleep(800);
  };
  const paneCapture = (captureId, fileName, color, after = async () => {}) => ({
    id: captureId,
    packageDir: "bb-studio",
    fileName,
    showSidebar: true,
    setup: async (client) => {
      await scheme(client, color);
      await openPaneChat(client);
      await after(client);
      return async () => { await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }).catch(() => {}); await scheme(client, ""); };
    },
  });
  const rowMenu = (title) => `[data-testid=loops-pane] button[aria-label=${JSON.stringify(`Actions: ${title}`)}]`;
  const EDITOR = "[data-promptbox] [contenteditable=true]";
  /** Waits until `expression` is true in the page. */
  const until = async (client, expression, what, timeoutMs = 15000) => {
    const started = Date.now();
    while (!(await client.poll(expression))) {
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
      await sleep(250);
    }
  };
  /** Empties the Bot chat's draft, which BB keeps across reloads. */
  const clearComposer = async (client) => {
    await client.waitForSelector(EDITOR, 30000);
    await client.evaluate(`(() => { const editor = document.querySelector(${JSON.stringify(EDITOR)}); editor.focus(); document.execCommand("selectAll"); document.execCommand("delete"); return true; })()`);
    await until(client, `document.querySelector(${JSON.stringify(EDITOR)}).textContent.trim() === ""`, "an empty composer");
  };
  const composerHas = (client, text) => until(client, `!!document.querySelector(${JSON.stringify(EDITOR)})?.textContent.includes(${JSON.stringify(text)})`, `the composer to hold ${text}`);
  const SAM = "Reply to Sam about the Q3 planning doc";
  /** Discuss on the Sam row: the chip in the draft. */
  const discussSam = async (client) => {
    await openPane(client);
    await clearComposer(client);
    await pressAt(client, rowMenu(SAM));
    await client.waitForText("Discuss");
    await press(client, "[role=menuitem]", "Discuss");
    await composerHas(client, SAM);
    const chip = await client.evaluate(`!!document.querySelector(${JSON.stringify(EDITOR)}).querySelector("[data-prompt-mention], .prompt-mention-pill, [data-type=mention]")`);
    if (!chip) throw new Error("Discuss put no mention chip in the composer");
  };
  /**
   * Drags the row titled `title` onto the composer: the row's own dragstart
   * fills a DataTransfer in the page, and CDP delivers that data to the
   * composer through the browser's drop path. Stops before the drop unless `drop`.
   */
  const dragRowToComposer = async (client, title, drop) => {
    const plan = await client.evaluate(`(() => {
      const row = [...document.querySelectorAll("[data-testid=loops-pane] [draggable=true]")].find((each) => each.textContent.includes(${JSON.stringify(title)}));
      if (!row) throw new Error("No draggable row: ${title}");
      const transfer = new DataTransfer();
      row.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const editor = document.querySelector(${JSON.stringify(EDITOR)}).getBoundingClientRect();
      return { text: transfer.getData("text/plain"), x: editor.left + 40, y: editor.top + editor.height / 2 };
    })()`);
    if (!plan.text.startsWith('::loop{id="')) throw new Error("The row's drag carries no ::loop line: " + JSON.stringify(plan.text));
    const data = { items: [{ mimeType: "text/plain", data: plan.text }], dragOperationsMask: 1 };
    for (const type of drop ? ["dragEnter", "dragOver", "drop"] : ["dragEnter", "dragOver"]) {
      await client.command("Input.dispatchDragEvent", { type, x: plan.x, y: plan.y, data });
      await sleep(150);
    }
    return plan;
  };

  const panes = BEFORE ? [] : [
    paneCapture("studio-loops-pane", "loops-pane.png", "dark", openPane),
    paneCapture("studio-loops-pane-light", "loops-pane-light.png", "light", openPane),
    paneCapture("studio-loops-pane-menu", "loops-pane-menu.png", "dark", async (client) => {
      await openPane(client);
      await pressAt(client, rowMenu("Reply to Sam about the Q3 planning doc"));
      for (const text of ["Discuss", "Done", "Snooze", "Hand off", "Change trigger…", "Drop"]) await client.waitForText(text);
      await client.evaluate(`(() => { const sub = [...document.querySelectorAll("[role=menuitem]")].find((e) => e.textContent.trim() === "Snooze"); if (!sub) throw new Error("No Snooze submenu"); return true; })()`);
    }),
    paneCapture("studio-loops-pane-discuss", "loops-pane-discuss.png", "dark", async (client) => {
      await discussSam(client);
      await client.command("Input.insertText", { text: "Is a two-line yes enough here, or should I ask about the team first?" });
      await composerHas(client, "two-line yes");
      await sleep(500);
    }),
    paneCapture("studio-loops-pane-drag", "loops-pane-drag.png", "dark", async (client) => {
      await openPane(client);
      await clearComposer(client);
      await dragRowToComposer(client, "Choose the deck contractor", false);
      await sleep(400);
    }),
    paneCapture("studio-loops-pane-dropped", "loops-pane-dropped.png", "dark", async (client) => {
      await openPane(client);
      await clearComposer(client);
      await dragRowToComposer(client, "Choose the deck contractor", true);
      await composerHas(client, 'About: Choose the deck contractor');
      await composerHas(client, '::loop{id="loop_capture-deck"}');
      await sleep(400);
    }),
    paneCapture("studio-loops-pane-discuss-reply", "loops-pane-discuss-reply.png", "dark", async (client) => {
      const bot = await openPaneChat(client);
      await discussSam(client);
      await client.command("Input.insertText", { text: "Is a two-line yes enough here? Say why in one sentence." });
      await composerHas(client, "two-line yes");
      await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await sleep(2000);
      await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
      await client.waitForText("Say why in one sentence.", 30000);
      await sleep(1500);
      await scrollToText(client, "Say why in one sentence.");
      await sleep(800);
    }),
    paneCapture("studio-loops-pane-trigger", "loops-pane-trigger.png", "dark", async (client) => {
      await openPane(client);
      await pressAt(client, rowMenu("Call the plumber about the slow drain"));
      await client.waitForText("Change trigger…");
      await press(client, "[role=menuitem]", "Change trigger…");
      await client.waitForSelector("[data-testid=loops-pane] [data-testid=loop-trigger-inline]", 10000);
      for (const text of ["Time", "Event", "Place", "Anytime", "Office", "Mom’s", "Send to iPhone when it fires"]) await client.waitForText(text);
      await client.evaluate(`(() => { document.querySelector("[data-testid=loop-trigger-inline]").scrollIntoView({ block: "center" }); return true; })()`);
      await sleep(500);
    }),
    paneCapture("studio-loops-pane-row-hover", "loops-pane-row-hover.png", "dark", async (client) => {
      await openPane(client);
      const circle = `[data-testid=loops-pane] [role=checkbox][aria-label=${JSON.stringify("Mark done: Reply to Sam about the Q3 planning doc")}]`;
      await client.waitForSelector(circle, 10000);
      const point = await client.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(circle)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, buttons: 0 });
      await sleep(500);
      // The kind icon hides and the check shows.
      const shown = await client.evaluate(`[...document.querySelector(${JSON.stringify(circle)}).children].map((each) => getComputedStyle(each).display !== "none")`);
      if (JSON.stringify(shown) !== "[false,true]") throw new Error("The circle shows no check on hover: " + JSON.stringify(shown));
    }),
    paneCapture("studio-loops-pane-row-done", "loops-pane-row-done.png", "dark", async (client) => {
      await openPane(client);
      await pressAt(client, `[data-testid=loops-pane] [role=checkbox][aria-label=${JSON.stringify("Mark done: Reply to Sam about the Q3 planning doc")}]`);
      await client.waitForSelector("[data-testid=loops-pane] [data-testid=loop-just-done]", 10000);
      for (const text of ["Done · just now", "Undo"]) await client.waitForText(text);
      // After the refetch it stays in place.
      await sleep(2500);
      await client.waitForSelector("[data-testid=loops-pane] section[aria-label='Needs you now'] [data-testid=loop-just-done]", 5000);
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 900, buttons: 0 });
      await sleep(400);
    }),
    paneCapture("studio-loops-pane-card", "loops-pane-card.png", "dark", async (client) => {
      await client.waitForText("Open Loops beside the chat", 30000);
      if (!/\d+ need/.test(await client.evaluate(`document.querySelector("[data-testid=loops-open]").textContent`))) throw new Error("The Loops card has no summary");
      // Focus the chat's pane first: with the side panel focused, BB takes the
      // first press in the chat to move focus there (base Studio too).
      await press(client, "[data-testid=loops-open] span", "Loops");
      await press(client, "[data-testid=loops-open] button", "Open Loops beside the chat");
      await client.waitForSelector("[data-testid=loops-pane]", 30000);
      for (const text of PANE_TEXTS) await client.waitForText(text, 30000);
      await scrollTo(client, "[data-testid=loops-open]");
      await sleep(800);
    }),
  ];

  return [
    ...panes,
    chatCapture("studio-loops-cards", "loops-cards.png", "dark", ["cards", CARDS], async (client) => {
      await client.waitForSelector("[data-testid=loop-card][data-kind=decide]", 60000);
      for (const text of ["Choose the deck contractor", "Hudson Carpentry", "Reply to Sam about the Q3 planning doc", "Hand off", "Got it", "Nudge them"]) await client.waitForText(text, 30000);
      await scrollTo(client, "[data-testid=loop-card][data-kind=decide]");
      await sleep(800);
    }),
    chatCapture("studio-loops-cards-light", "loops-cards-light.png", "light", ["cards", CARDS], async (client) => {
      await client.waitForSelector("[data-testid=loop-card][data-kind=decide]", 60000);
      await scrollTo(client, "[data-testid=loop-card][data-kind=decide]");
      await sleep(800);
    }),
    chatCapture("studio-loops-snooze", "loops-snooze.png", "dark", ["cards", CARDS], async (client) => {
      await client.waitForSelector("[data-testid=loop-card][data-kind=do]", 60000);
      await scrollTo(client, "[data-testid=loop-card][data-kind=do]");
      await sleep(500);
      await press(client, "[data-testid=loop-card][data-kind=do] button", "Snooze");
      for (const text of ["Snooze until", "Later today", "Tonight", "Tomorrow", "This weekend", "When I’m home", "Pick a time…"]) await client.waitForText(text);
    }),
    chatCapture("studio-loops-progress", "loops-progress.png", "dark", ["progress", PROGRESS], async (client) => {
      await client.waitForSelector("[data-testid=loop-progress]", 60000);
      for (const text of ["Larkspur lead is on it", "Take it back", "Cancel the hosting Pro trial", "Café Grumpy"]) await client.waitForText(text, 30000);
      await scrollTo(client, "[data-testid=loop-progress]");
      await client.evaluate(`window.scrollBy(0, -120)`);
      await sleep(800);
    }),
    chatCapture("studio-loops-morning", "loops-morning.png", "dark", ["morning", morning], async (client) => {
      await client.waitForSelector("[data-testid=loops-more]", 60000);
      for (const text of ["On today's list", "Pay the property tax installment", "Due today", "2 options", "3 more in Loops", "Good to know"]) await client.waitForText(text, 30000);
      await scrollTo(client, "[data-testid=loop-row]");
      await client.evaluate(`(() => { const h = [...document.querySelectorAll("h2")].filter((e) => /day,/.test(e.textContent)).at(-1); h?.scrollIntoView({ block: "start" }); return true; })()`);
      await sleep(800);
    }),
    loopsTab("studio-loops-tab", "loops-tab.png", "dark", async (client) => { await hover(client, "[data-testid=loop-needs]", 1); await client.waitForText("Discuss"); }),
    loopsTab("studio-loops-tab-light", "loops-tab-light.png", "light"),
    loopsTab("studio-loops-tab-discussed", "loops-tab-discussed.png", "dark", async (client) => {
      // Start from an empty draft in the Bot chat, then come back to the tab.
      const { bot } = await seed();
      await client.navigate(chatPath(bot));
      await clearComposer(client);
      await client.navigate(`${BOT_PATH}/${bot.id}/loops`);
      await client.waitForSelector("[data-testid=loops-tab] [data-testid=loop-needs]", 30000);
      await hover(client, "[data-testid=loop-needs]", 1);
      await press(client, "button", "Discuss", ["[data-testid=loop-needs]", 1]);
      await client.waitForSelector("[data-promptbox]", 30000);
      await composerHas(client, "Reply to Sam about the Q3 planning doc");
      await sleep(800);
    }),
    loopsTab("studio-loops-tab-lower", "loops-tab-lower.png", "dark", async (client) => {
      await client.evaluate(`(() => { document.querySelector('section[aria-label="Agents on it"]').scrollIntoView({ block: "start" }); return true; })()`);
      await sleep(500);
    }),
    loopsTab("studio-loops-trigger", "loops-trigger.png", "dark", async (client) => {
      await hover(client, "[data-testid=loop-coming]", 0);
      await press(client, "button", "Change trigger", ["[data-testid=loop-coming]", 0]);
      for (const text of ["Time", "Event", "Place", "Anytime", "Office", "Mom’s", "Send to iPhone when it fires"]) await client.waitForText(text);
    }),
    loopsTab("studio-loops-owner", "loops-owner.png", "dark", async (client) => {
      await press(client, "[data-testid=loops-tab] button", "Owner: Anyone");
      for (const text of ["Anyone", "Me", "Chief of Staff", "Larkspur lead"]) await client.waitForText(text);
    }),
    {
      id: "studio-loops-off",
      packageDir: "bb-studio",
      fileName: "loops-off.png",
      showSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const { bot } = await seed();
        await setEnabled(false);
        await client.navigate(chatPath(bot));
        await dismissProblems(client);
        if (!BEFORE) {
          await client.waitForSelector("[data-testid=loop-off]", 60000);
          await client.waitForText("Attention Router is off");
          if (await client.hasText("All loops", 1500)) throw new Error("All loops shows with the Attention Router off");
          await scrollTo(client, "[data-testid=loop-off]");
        }
        await sleep(800);
        return async () => { await setEnabled(true); await scheme(client, ""); };
      },
    },
  ];
};

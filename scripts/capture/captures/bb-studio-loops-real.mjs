// Before-and-after renders of the Loops tab and a handed-off card with
// Patrick's loops as loops_list returned them at 22:26 on Oct 31 (titles,
// owners, triggers, statuses). Opt in with BB_CAPTURE_LOOPS_REAL=1; it writes
// loops-real-*.png to packages/bb-studio/assets for copying elsewhere, not
// for the README. The staged thread that owns the in-progress loop has the
// real thread's title. Run it at night to see quiet hours.
//
// BB_CAPTURE_LOOPS_BEFORE=1 skips the assertions on the new UI, for an older
// Studio.
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

import { readStagedInstance } from "../../staged-instance.mjs";
import { BOT_PATH, dismissProblems } from "./bb-studio-bot.mjs";

const require = createRequire(import.meta.url);
const BEFORE = process.env.BB_CAPTURE_LOOPS_BEFORE === "1";
const MIN = 60_000;
const OWNER_TITLE = "Kensico v2: first slice (raw → insights)";
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });

function loops(ownerThread) {
  const now = Date.now();
  const base = { why: "", source: null, kind: "do", options: [], owner: "patrick", trigger: { type: "none" }, priority: "normal", push: false, status: "queued", due: null, area: null, createdAt: now - 3 * 3_600_000, updatedAt: now - 2 * 3_600_000, closedAt: null, closedBy: null };
  const l = (id, fields) => ({ ...base, id: `loop_real-${id}`, ...fields });
  return [
    l("resume", { title: "Review the OpenAI FDE resume, then send it to Yassine", area: "Job" }),
    l("vercel", { title: "Vercel recruiter call", kind: "decide", options: ["Take the call", "Pass"], area: "Job" }),
    l("desktop", { title: "Update the Linux desktop: sudo pacman -Syu, then reboot", trigger: { type: "event", event: "desktop:online" }, priority: "low", area: "Systems" }),
    l("tailscale", { title: "Remove the stale Tailscale node bb-server-red4", priority: "low", area: "Systems" }),
    l("speech", { title: "Silent-speech Long read on other form factors?", kind: "decide", options: ["Write it", "Skip"], priority: "low", area: "Kensico" }),
    l("ghsa", { title: "Check whether GitHub resumed security advisories (GHSA)", owner: "cos", trigger: { type: "time", at: 1793631600000 }, area: "Kensico" }),
    l("leads", { title: "Review the Kensico lead's quieter notifications; decide on other leads", owner: "cos", trigger: { type: "time", at: 1794074400000 }, area: "Systems" }),
    l("utilities", { title: "Add the remaining utilities to the AI power Long read", owner: `thread:${ownerThread}`, trigger: { type: "time", at: 1794148200000 }, status: "in_progress", area: "Kensico", updatedAt: now - MIN }),
    l("php", { title: "Remove red4's PHP upload-progress mitigation once Unraid ships a fix", owner: "cos", trigger: { type: "event", event: "unraid:php-cve-2026-115560-fixed" }, priority: "low", area: "Systems" }),
    l("replies", { title: "Replies from Nicole Thurn (OpenAI) and Lewis Fegan (Reflection AI)", kind: "waiting", owner: "cos", trigger: { type: "time", at: 1793718000000 }, area: "Job" }),
  ];
}

/** Replace every fixture loop in the staged Studio database with these. */
function writeLoops(records) {
  const { dataDir } = readStagedInstance();
  const Database = require("../../../packages/bb-studio/node_modules/better-sqlite3");
  const db = new Database(join(dataDir, "plugins/studio/data.db"), { timeout: 5000 });
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM loop_events WHERE loop_id LIKE 'loop_capture-%' OR loop_id LIKE 'loop_real-%'").run();
      db.prepare("DELETE FROM bot_loops WHERE id LIKE 'loop_capture-%' OR id LIKE 'loop_real-%'").run();
      for (const loop of records) db.prepare("INSERT INTO bot_loops VALUES (?, ?)").run(loop.id, JSON.stringify(loop));
      db.prepare("INSERT INTO loop_events (loop_id, type, at, data) VALUES (?, ?, ?, ?)").run("loop_real-utilities", "handed_off", Date.now() - MIN, "{}");
    })();
  } finally {
    db.close();
  }
}

export default ({ pluginRpc, bbCli, sleep }) => {
  if (process.env.BB_CAPTURE_LOOPS_REAL !== "1") return [];
  const json = async (args) => JSON.parse(await bbCli([...args, "--json"]));
  let fixture = null;

  /** The Bot, a Kensico project with the thread that owns the in-progress loop, and the loops. */
  async function seed() {
    if (fixture) return fixture;
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) ({ bot } = await pluginRpc("studio", "bot_create", { name: "Chief of Staff", avatar: "🟢", shape: "blob", color: "#2ba59a", prompt: "Hi. In one short sentence, say you'll keep track of what needs me." }));
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "180"]).catch(() => {});
    const projects = await json(["project", "list"]);
    let kensico = (Array.isArray(projects) ? projects : projects.projects ?? []).find((project) => project.name === "Kensico");
    if (!kensico) {
      const root = join(readStagedInstance().directory, "kensico");
      await mkdir(root, { recursive: true });
      const [machine] = await json(["machine", "list"]);
      kensico = await json(["project", "create", "--name", "Kensico", "--root", root, "--machine", machine.id]);
    }
    const threads = await json(["thread", "list", "--project", kensico.id]).catch(() => []);
    let owner = (Array.isArray(threads) ? threads : threads.threads ?? []).find((thread) => thread.title === OWNER_TITLE);
    // Its first message is scheduled weeks out, so no agent runs.
    owner ??= await json(["thread", "spawn", "--project", kensico.id, "--title", OWNER_TITLE, "--prompt", "Add the remaining utilities.", "--send-at", "30d"]);
    writeLoops(loops(owner.id));
    // Off, then on: the new Studio ticks the scheduler when the Attention Router turns on.
    await bbCli(["studio", "settings", "set", "loopsEnabled", "false"]);
    await sleep(1000);
    await bbCli(["studio", "settings", "set", "loopsEnabled", "true"]);
    fixture = { bot, owner };
    return fixture;
  }

  const tab = (captureId, fileName, after) => ({
    id: captureId,
    packageDir: "bb-studio",
    fileName,
    showSidebar: true,
    setup: async (client) => {
      await scheme(client, "dark");
      const { bot } = await seed();
      await client.navigate(`${BOT_PATH}/${bot.id}/loops`);
      await dismissProblems(client);
      await client.waitForSelector("[data-testid=loops-tab]", 30000);
      for (const text of ["Coming up", "Agents on it", "Waiting on others", "Remove the stale Tailscale node bb-server-red4"]) await client.waitForText(text, 30000);
      if (!BEFORE) {
        // Released at night as chat cards, within the budget.
        for (const text of ["Needs you now", "Review the OpenAI FDE resume", "Chief of Staff will do it", "Tomorrow morning card", OWNER_TITLE]) await client.waitForText(text, 90000);
        for (const text of ["Waiting to start", "An agent", "Anytime"]) if (await client.hasText(text, 500)) throw new Error(`The Loops tab still shows "${text}"`);
      }
      await after(client);
      return async () => { await scheme(client, ""); };
    },
  });

  return [
    tab("studio-loops-real-tab", "loops-real-tab.png", async () => { await sleep(800); }),
    tab("studio-loops-real-tab-lower", "loops-real-tab-lower.png", async (client) => {
      await client.evaluate(`(() => { document.querySelector('section[aria-label="Agents on it"]').scrollIntoView({ block: "start" }); return true; })()`);
      await sleep(800);
    }),
    {
      id: "studio-loops-real-card",
      packageDir: "bb-studio",
      fileName: "loops-real-card.png",
      showSidebar: true,
      setup: async (client) => {
        await scheme(client, "dark");
        const { bot } = await seed();
        await bbCli(["thread", "tell", bot.threadId, "Capture fixture (card). Don't call any tools. Reply with exactly the text between the markers, unchanged, and nothing else.\n<<<\n::loop{id=\"loop_real-utilities\"}\n>>>"]);
        await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
        await client.navigate(`/threads/${bot.threadId}`);
        await dismissProblems(client);
        await client.waitForSelector("[data-testid=loop-progress]", 60000);
        if (!BEFORE) for (const text of [`${OWNER_TITLE} is on it`, "Open thread", "Take it back"]) await client.waitForText(text, 30000);
        await client.evaluate(`(() => { const all = document.querySelectorAll("[data-testid=loop-progress]"); all[all.length - 1].scrollIntoView({ block: "center" }); return true; })()`);
        await sleep(800);
        return async () => { await scheme(client, ""); };
      },
    },
  ];
};

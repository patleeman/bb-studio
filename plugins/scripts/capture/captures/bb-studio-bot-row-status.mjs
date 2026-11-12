// Bot rows' status in the sidebar (src/ui/bot/rowState.ts, BotSidebar.tsx),
// next to BB's icon rail. Four Bots, one per state, each made from a thread
// (bot_create with threadId):
//
// - Ivy, idle: the primary, its chat's first message scheduled for next month.
// - Rex, running: its chat runs `sleep 3600` in the shell.
// - Uma, unread: its chat replied once and nobody has opened it.
// - Nia, needs you: its chat asks a question through design_ask and waits.
//
// The page is one of the staged project's own threads, so no Bot is selected
// and Ivy (the primary) is the expanded one. BB_ROW_STATUS_PHASE names the
// files, assets/bot-row-status/<phase>-<view>-<mode>.png: "before" (main
// without the marks), "after" (BB's status glyph) or "dots" (the Threads
// section's dots and pills on Bot rows, for comparison). `sidebar` is the
// rail and the open sidebar; `rail` is the rail with the sidebar collapsed.
import { dismissProblems, SIDEBAR } from "./bb-studio-bot.mjs";
import { stagedPendingInteraction } from "./bot-capture-fixtures.mjs";

const PHASES = new Set(["before", "after", "dots"]);
const PHASE = PHASES.has(process.env.BB_ROW_STATUS_PHASE) ? process.env.BB_ROW_STATUS_PHASE : "after";
const PERSONAL = "proj_personal";
const MODEL = ["--provider", "codex", "--model", "gpt-6.1-sol", "--reasoning-level", "low"];
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const WANT = { Rex: "working", Uma: "unread", Nia: "needs-you" };

export default ({ projectId, threadId, pluginRpc, bbCli, sleep }) => {
  const json = async (args) => JSON.parse(await bbCli([...args, "--json"]));
  let seeded = null;

  async function seed() {
    if (seeded) return seeded;
    const { bots } = await pluginRpc("studio", "bot_list", {});
    const byName = new Map(bots.map((bot) => [bot.name, bot]));
    const make = async (name, look, spawnArgs) => {
      if (byName.has(name)) return byName.get(name);
      const thread = await json(["thread", "spawn", "--project", PERSONAL, "--title", name, ...spawnArgs]);
      const { bot } = await pluginRpc("studio", "bot_create", { name, ...look, threadId: thread.id });
      byName.set(name, bot);
      return bot;
    };
    // The primary first: it's the one the sidebar expands.
    const ivy = await make("Ivy", { avatar: "🌿", shape: "blob", color: "#2ba59a" }, ["--prompt", "Plan next month's ORBIT-43 kickoff.", "--send-at", "30d"]);
    const uma = await make("Uma", { avatar: "📬", shape: "hexagon", color: "#5b8def" }, [...MODEL, "--prompt", "Reply with one short sentence: the ORBIT-42 launch checklist is done."]);
    const nia = await make("Nia", { avatar: "❓", shape: "star", color: "#e0913a" }, [...MODEL, "--prompt", "We need to pick the ORBIT-42 release day. Use the design_ask tool to ask me one multiple-choice question: Thursday, Friday or Monday. Then wait for my answer."]);
    const rex = await make("Rex", { avatar: "⚙️", shape: "square", color: "#7c66dc" }, [...MODEL, "--prompt", "Use the shell to run `sleep 3600`, then reply in one short sentence that the ORBIT-42 deploy is healthy."]);
    await bbCli(["thread", "wait", uma.threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
    for (let i = 0; i < 80 && stagedPendingInteraction(nia.threadId)?.status !== "pending"; i++) await sleep(3000);
    if (stagedPendingInteraction(nia.threadId)?.status !== "pending") throw new Error("Nia's chat has no pending question");
    for (let i = 0; i < 40; i++) {
      const shown = await json(["thread", "show", rex.threadId]).catch(() => null);
      if (["active", "starting"].includes(shown?.thread?.status)) break;
      await sleep(3000);
    }
    const attention = (await pluginRpc("studio", "bot_attention", { botId: uma.id })).attention;
    if (!attention?.unread) throw new Error(`Uma has no unread reply: ${JSON.stringify(attention)}`);
    seeded = { ivy, uma, nia, rex };
    return seeded;
  }

  /** The rail and the sidebar, full height. */
  const clipSidebar = (client) => client.evaluate(`(() => {
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    const right = sidebar ? sidebar.getBoundingClientRect().right : 420;
    return { x: 0, y: 0, width: Math.ceil(right) + 8, height: window.innerHeight };
  })()`);
  const clipRail = (client) => client.evaluate(`({ x: 0, y: 0, width: 240, height: window.innerHeight })`);

  const check = async (client) => {
    // Each Bot's row, and the status it draws (after and dots) or none (before).
    const rows = await client.evaluate(`(() => {
      const nav = document.querySelector(${JSON.stringify(SIDEBAR)});
      if (!nav) return null;
      const out = {};
      for (const row of nav.querySelectorAll("[data-testid=bot-row], [data-testid=bot-main]")) {
        const name = row.textContent.match(/Ivy|Rex|Uma|Nia/)?.[0];
        const mark = row.querySelector("[data-testid=bot-status]");
        if (name) out[name] = { state: mark?.getAttribute("data-state") ?? null, drawn: !!mark && mark.getBoundingClientRect().width > 0, glyph: !!mark?.firstElementChild };
      }
      return out;
    })()`);
    if (!rows || !["Ivy", "Rex", "Uma", "Nia"].every((name) => rows[name])) return `Missing Bot rows: ${JSON.stringify(rows)}`;
    if (PHASE === "before") return Object.values(rows).some((row) => row.state) ? `Before shows a status: ${JSON.stringify(rows)}` : null;
    if (rows.Ivy.state) return `Ivy is idle, but shows ${rows.Ivy.state}`;
    for (const [name, want] of Object.entries(WANT)) {
      if (rows[name].state !== want || !rows[name].drawn) return `${name} shows ${rows[name].state}, not ${want}: ${JSON.stringify(rows)}`;
      if (PHASE === "after" && !rows[name].glyph) return `${name}'s mark isn't BB's glyph`;
    }
    return null;
  };

  const open = async (client, mode) => {
    await scheme(client, mode);
    await seed();
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
    await client.navigate(`/projects/${projectId}/threads/${threadId}`);
    await client.waitForSelector('button[aria-label^="Toggle sidebar" i]', 30000);
    // A rail capture before this one left BB's sidebar collapsed: open it again.
    const reopened = await client.evaluate(`(() => {
      const sidebar = document.querySelector('[data-sidebar="sidebar"]');
      const closed = ['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'));
      if (closed) document.querySelector('button[aria-label^="Toggle sidebar" i]').click();
      return closed;
    })()`);
    if (reopened) await sleep(600);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    // bot_attention polls every 30 seconds; wait for every row to settle.
    let problem = "not checked";
    for (let i = 0; i < 50 && problem; i++) { problem = await check(client); if (problem) await sleep(1500); }
    if (problem) throw new Error(problem);
    // The spinner and the shine animate: let them settle into a frame.
    await sleep(800);
  };

  // The rail captures last: each leaves the sidebar collapsed.
  const sidebarCaptures = ["dark", "light"].map((mode) => ({
    id: `studio-bot-row-status-sidebar-${mode}`, packageDir: "bb-studio", fileName: `bot-row-status/${PHASE}-sidebar-${mode}.png`, privateSidebar: false,
    clip: clipSidebar,
    setup: async (client) => { try { await open(client, mode); } catch (error) { await scheme(client, ""); throw error; } },
  }));
  const railCaptures = ["dark", "light"].map((mode) => ({
    id: `studio-bot-row-status-rail-${mode}`, packageDir: "bb-studio", fileName: `bot-row-status/${PHASE}-rail-${mode}.png`, privateSidebar: false,
    clip: clipRail,
    setup: async (client) => {
      try {
        await open(client, mode);
        // The rail alone: BB's sidebar collapsed. It has no Bot entries to mark.
        const collapsed = await client.evaluate(`(() => { const button = document.querySelector('button[aria-label^="Toggle sidebar" i]'); if (!button) return false; button.click(); return true; })()`);
        if (!collapsed) throw new Error("No sidebar toggle");
        await sleep(600);
        const state = await client.evaluate(`(() => {
          const nav = document.querySelector(${JSON.stringify(SIDEBAR)});
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          return { state: sidebar?.closest('[data-state]')?.getAttribute('data-state') ?? null, navRight: nav ? nav.getBoundingClientRect().right : 0 };
        })()`);
        // Collapsed, the Bots list is off screen, left of the rail's edge.
        if (!["closed", "collapsed"].includes(state.state) || state.navRight > 120) throw new Error(`The sidebar didn't collapse: ${JSON.stringify(state)}`);
      } catch (error) { await scheme(client, ""); throw error; }
    },
  }));
  return [...sidebarCaptures, ...railCaptures];
};

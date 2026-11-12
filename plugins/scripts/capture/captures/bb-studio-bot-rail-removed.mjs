// The rail and the sidebar with the primary Bot needing you (its released
// loops, seeded by the Loops captures), on one of the staged project's own
// threads. BB_RAIL_REMOVED_PHASE: "before" (a build with the rail's Bots item:
// it must show with a count) or "after" (no Bots item on the rail; the
// sidebar's Bot row shows BB's needs-you glyph). Then the Bot's row opens its
// chat, whose header has the Bot's button: the Bots stay in reach.
// Files: assets/bot-rail-removed/<phase>-<view>-<mode>.png.
import { dismissProblems, SIDEBAR } from "./bb-studio-bot.mjs";

const PHASE = process.env.BB_RAIL_REMOVED_PHASE === "before" ? "before" : "after";
const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const HEADER = '[data-testid="app-page-header-content-row"]';

export default ({ projectId, threadId, pluginRpc, bbCli, sleep }) => {
  const open = async (client, mode) => {
    await scheme(client, mode);
    await bbCli(["studio", "settings", "set", "loopsEnabled", "true"]);
    const { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot?.threadId) throw new Error("The staged BB has no Bot with a chat; run a Loops capture first.");
    const { attention } = await pluginRpc("studio", "bot_attention", { botId: bot.id });
    if (!attention || attention.count - (attention.unread ?? 0) <= 0) throw new Error(`The Bot doesn't need you: ${JSON.stringify(attention)}`);
    await client.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
    await client.navigate(`/projects/${projectId}/threads/${threadId}`);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    let state = null;
    for (let i = 0; i < 40; i++) {
      state = await client.evaluate(`(() => {
        const rail = document.querySelector('[data-nav-rail-item="studio/bots"]');
        const row = document.querySelector('${SIDEBAR} [data-testid=bot-main]');
        return { rail: rail ? rail.textContent.trim() || "icon" : null, row: row?.querySelector("[data-testid=bot-status]")?.getAttribute("data-state") ?? null, name: row?.textContent ?? "" };
      })()`);
      const ok = PHASE === "before" ? state.rail === "1" : state.rail === null && state.row === "needs-you";
      if (ok) break;
      if (i === 39) throw new Error(`${PHASE}: ${JSON.stringify(state)}`);
      await sleep(750);
    }
    await sleep(800);
    return bot;
  };
  const clipSidebar = (client) => client.evaluate(`(() => {
    const right = document.querySelector('[data-sidebar="sidebar"]')?.getBoundingClientRect().right ?? 420;
    return { x: 0, y: 0, width: Math.ceil(right) + 8, height: Math.min(window.innerHeight, 760) };
  })()`);
  const sidebar = ["dark", "light"].map((mode) => ({
    id: `studio-bot-rail-removed-sidebar-${mode}`, packageDir: "bb-studio", fileName: `bot-rail-removed/${PHASE}-sidebar-${mode}.png`, privateSidebar: false,
    clip: clipSidebar,
    setup: async (client) => { try { await open(client, mode); } catch (error) { await scheme(client, ""); throw error; } },
  }));
  // The Bot's row opens its chat; the header's main button is the Bot.
  const chat = ["dark", "light"].map((mode) => ({
    id: `studio-bot-rail-removed-chat-${mode}`, packageDir: "bb-studio", fileName: `bot-rail-removed/${PHASE}-chat-${mode}.png`, privateSidebar: false,
    setup: async (client) => {
      try {
        const bot = await open(client, mode);
        await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main]').click(); return true; })()`);
        let header = null;
        for (let i = 0; i < 40 && !(header?.path.endsWith(bot.threadId) && header.buttons.includes(bot.name)); i++) {
          await sleep(500);
          header = await client.evaluate(`({ path: location.pathname, buttons: [...(document.querySelector('${HEADER}')?.querySelectorAll("button") ?? [])].map((each) => each.textContent.trim()) })`);
        }
        if (!header?.path.endsWith(bot.threadId) || !header.buttons.includes(bot.name)) throw new Error(`The Bot's row didn't open its chat with the Bot's header button: ${JSON.stringify(header)}`);
        await sleep(1500);
      } catch (error) { await scheme(client, ""); throw error; }
    },
  }));
  return [...sidebar, ...chat];
};

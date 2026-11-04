// The rail's Bots item and its badge (src/ui/bot/BotsRail.tsx), with BB's
// sidebar collapsed so the rail stands alone. The staged BB's primary Bot
// (seeded by the Loops captures) is put in each state through Studio's
// settings and BB's read state, no agent runs:
//
// - needs-you: the Attention Router on, so its released loops need you (a count);
// - unread: the Router off and its chat marked unread (a dot);
// - idle: the Router off and its chat read (no badge).
//
// Files: assets/bots-rail/<state>-<mode>.png.
import { BOT_PATH, dismissProblems } from "./bb-studio-bot.mjs";

const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const STATES = ["idle", "unread", "needs-you"];

export default ({ pluginRpc, bbCli, sleep }) => {
  const put = async (state) => {
    const { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot?.threadId) throw new Error("The staged BB has no Bot with a chat; run a Loops capture first.");
    await bbCli(["studio", "settings", "set", "loopsEnabled", state === "needs-you" ? "true" : "false"]);
    if (state === "unread") await bbCli(["thread", "unread", bot.threadId]);
    if (state === "idle") await bbCli(["thread", "read", bot.threadId]);
    const { bots } = await pluginRpc("studio", "bot_attention_all", {});
    const mine = bots.find((each) => each.botId === bot.id)?.attention ?? null;
    const needs = (mine?.count ?? 0) - (mine?.unread ?? 0) > 0;
    const unread = (mine?.unread ?? 0) > 0;
    if (state === "needs-you" ? !needs : state === "unread" ? needs || !unread : needs || unread) throw new Error(`Couldn't put the Bot in ${state}: ${JSON.stringify(mine)}`);
  };
  /** The rail's Bots item: its accessible name, and whether a badge is drawn in it. */
  const railItem = (client) => client.evaluate(`(() => {
    const item = [...document.querySelectorAll("a, button")].find((each) => each.offsetParent && /^Bots\\b/.test(each.getAttribute("aria-label") ?? each.getAttribute("title") ?? ""));
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    return { label: item.getAttribute("aria-label") ?? item.getAttribute("title"), text: item.textContent.trim(), left: rect.left };
  })()`);

  return STATES.flatMap((state) => ["dark", "light"].map((mode) => ({
    id: `studio-bots-rail-${state}-${mode}`, packageDir: "bb-studio", fileName: `bots-rail/${state}-${mode}.png`, privateSidebar: false,
    clip: (client) => client.evaluate(`({ x: 0, y: 0, width: 200, height: Math.min(window.innerHeight, 640) })`),
    setup: async (client) => {
      try {
        await scheme(client, mode);
        await put(state);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
        await client.navigate(BOT_PATH);
        await client.waitForSelector('button[aria-label^="Toggle sidebar" i]', 30000);
        await dismissProblems(client);
        const want = state === "needs-you" ? /needs you/ : state === "unread" ? /haven't read/ : null;
        let item = null;
        for (let i = 0; i < 40; i++) {
          item = await railItem(client);
          if (item && item.left < 80 && (want ? want.test(item.label ?? "") : !/needs you|haven't read/.test(item.label ?? ""))) break;
          await sleep(750);
          if (i === 39) throw new Error(`The rail's Bots item doesn't show ${state}: ${JSON.stringify(item)}`);
        }
        if (state === "needs-you" && !/\b1\b/.test(item.text)) throw new Error(`No count on the Bots item: ${JSON.stringify(item)}`);
        await client.evaluate(`(() => {
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          const closed = ['closed', 'collapsed'].includes(sidebar?.closest('[data-state]')?.getAttribute('data-state'));
          if (!closed) document.querySelector('button[aria-label^="Toggle sidebar" i]').click();
          return true;
        })()`);
        await sleep(700);
      } catch (error) { await scheme(client, ""); throw error; }
    },
  })));
};

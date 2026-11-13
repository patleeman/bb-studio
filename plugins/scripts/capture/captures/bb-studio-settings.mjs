// Studio's settings after the settings cleanup (src/settings): Settings ▸
// Plugins ▸ Studio at its full scroll (BB's API key fields, then Studio's
// Voice, Recordings and calls, Agent replies, Threads, Jev and Advanced
// sections, then Phone notifications for Studio Mobile), Bot ▸ Controls ▸
// Attention, BB's Settings ▸ Mobile page and Studio Mobile's own settings.
// Each in dark and light. (Stable BB draws plugin sections on its Mobile page
// only for the machine-access plugin, so push status is on Studio's page.)
//
// BB_SETTINGS_RENDER=before captures the same pages from a Studio before the
// cleanup (installed from a local git ref), for the review: it skips the new
// sections' assertions and the Attention view, which didn't exist yet.
// The after settings page and Attention go to assets/settings/ (the README);
// the rest, and every before render, to assets/settings-review/ for the review.
import { BOT_PATH } from "./bb-studio-bot.mjs";

const scheme = (client, value) => client.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
const WIDTH = 1440;
const HEIGHT = 1000;
const STAGE = process.env.BB_SETTINGS_RENDER === "before" ? "before" : "after";

/** Grow the viewport to the page's scroll height, so one shot holds the whole page; the cleanup puts it back. */
async function fullHeight(client) {
  const height = await client.evaluate(`(() => {
    let max = document.documentElement.scrollHeight;
    for (const el of document.querySelectorAll('*')) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
      max = Math.max(max, el.getBoundingClientRect().top + el.scrollHeight + 48);
    }
    return Math.ceil(max);
  })()`);
  await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: Math.min(Math.max(height, HEIGHT), 16000), deviceScaleFactor: 1, mobile: false });
  return height;
}
const restore = (client) => async () => {
  await client.command("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await scheme(client, "");
};

/** Waits until none of `texts` is on the page, or throws. */
async function absent(client, texts) {
  const found = await client.evaluate(`(${JSON.stringify(texts)}).filter((text) => document.body.innerText.includes(text))`);
  if (found.length) throw new Error(`Old settings still on the page: ${found.join(", ")}`);
}

export default ({ pluginRpc, bbCli, sleep }) => {
  const settingsPage = (mode) => ({
    id: `studio-settings-page-${mode}`,
    packageDir: "bb-studio",
    fileName: STAGE === "after" ? `settings/settings-page-${mode}.png` : `settings-review/before/settings-page-${mode}.png`,
    privateSidebar: false,
    setup: async (client) => {
      await scheme(client, mode);
      await client.navigate("/settings/plugins/studio");
      await client.waitForText("OpenAI API key", 30000);
      if (STAGE === "after") {
        // Values the sections show: a changed setting from the CLI, so the page isn't all defaults.
        await bbCli(["studio", "settings", "set", "loopsEnabled", "true"]);
        for (const text of ["Voice", "Hold-to-talk key", "Hands-free model", "Monthly limit (USD)", "Recordings and calls", "Transcribe calls", "Agent replies", "Next row", "Quote the selected text", "Threads", "Smart Queue", "Attention Router", "Smart Queue model", "If Jev doesn’t answer, use", "Advanced", "Smart Queue batch confidence", "Phone notifications", "Push status", "Send a test push", "xAI API key", "TypeSafe API key"]) await client.waitForText(text, 30000);
        await absent(client, ["Explore: ", "Hands-free voice: ", "Segment length", "Jev timeout", "Bot avatars: OpenAI API key", "Attention time zone", "Daily attention budget", "Saved reactions", "Talk models", "Jev connection"]);
      } else {
        await client.waitForText("Hands-free voice", 30000);
      }
      await sleep(1200);
      const height = await fullHeight(client);
      await sleep(800);
      process.stdout.write(`  settings page height ${height}px\n`);
      return restore(client);
    },
  });

  const attention = (mode) => ({
    id: `studio-settings-attention-${mode}`,
    packageDir: "bb-studio",
    fileName: STAGE === "after" ? `settings/bot-controls-${mode}.png` : `settings-review/before/bot-controls-${mode}.png`,
    privateSidebar: true,
    setup: async (client) => {
      await scheme(client, mode);
      const { bot } = await pluginRpc("studio", "bot_get", {});
      if (!bot) throw new Error("The staged BB has no Bot; start it with the Studio fixtures.");
      await client.navigate(`${BOT_PATH}/${encodeURIComponent(bot.id)}/controls${STAGE === "after" ? "#attention" : ""}`);
      await client.waitForText("Controls", 30000);
      if (STAGE === "after") {
        for (const text of ["Attention", "Interruptions a day", "Quiet hours", "Time zone", "from this Mac", "Prompt cache"]) await client.waitForText(text, 30000);
        await client.evaluate(`document.getElementById('controls-attention')?.scrollIntoView({ block: 'start' })`);
      } else {
        await client.waitForText("Prompt cache", 30000);
        await client.evaluate(`document.getElementById('controls-checkins')?.scrollIntoView({ block: 'start' })`);
      }
      await sleep(800);
      return restore(client);
    },
  });

  const mobilePage = (mode) => ({
    id: `studio-settings-mobile-${mode}`,
    packageDir: "bb-studio",
    fileName: `settings-review/${STAGE}/mobile-page-${mode}.png`,
    privateSidebar: false,
    setup: async (client) => {
      await scheme(client, mode);
      await client.navigate("/settings/mobile");
      await client.waitForText("Mobile", 30000);
      await client.waitForText("Accessing bb from your phone", 30000);
      await sleep(800);
      await fullHeight(client);
      return restore(client);
    },
  });

  const mobilePlugin = (mode) => ({
    id: `studio-settings-mobile-plugin-${mode}`,
    packageDir: "bb-studio",
    fileName: `settings-review/${STAGE}/mobile-plugin-${mode}.png`,
    privateSidebar: false,
    setup: async (client) => {
      await scheme(client, mode);
      await client.navigate("/settings/plugins/mobile");
      await client.waitForText("Studio Mobile", 30000);
      if (STAGE === "after") {
        for (const text of ["APNs key", "Key ID"]) await client.waitForText(text, 30000);
        await absent(client, ["APNs auth key file", "Apple team ID", "App bundle ID", "APNs environment", "Expo push URL"]);
      } else {
        await client.waitForText("Expo push URL for non-APNs tokens", 30000);
      }
      await sleep(800);
      await fullHeight(client);
      return restore(client);
    },
  });

  const both = (make) => ["dark", "light"].map(make);
  return [
    ...both(settingsPage),
    ...both(attention),
    ...both(mobilePage),
    ...both(mobilePlugin),
  ];
};

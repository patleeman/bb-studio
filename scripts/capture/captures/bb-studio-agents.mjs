// Studio Agents (packages/bb-studio-agents) and external bots. staged-bb.mjs
// starts the local fixtures (packages/bb-studio-agents/scripts: Hermes with
// HERMES_FIXTURE_REPLY set, and Grok) and points Studio Agents at them, with
// hermes and grok enabled; OpenClaw and Dot stay off. Captures: the plugin's settings
// page; Import bot's dialog (Hermes and Grok ready, OpenClaw and Dot not
// configured); an imported Hermes bot's Info (the Bot page, saying its memory
// and tools live on the provider) and an imported Grok bot's chat (BB's
// thread page) after one exchange each.
const BOT_PATH = "/plugins/studio/studio/bot";
const SIDEBAR = 'nav[aria-label="Bots"]';
const IMPORTS = [
  { name: "Hermes", shape: "cloud", color: "#7c66dc", providerId: "hermes", reply: /I'm Hermes/ },
  { name: "Grok", shape: "star", color: "#1f9d75", providerId: "grok", reply: /Grok fixture/ },
];
const dismissProblems = (client) => client.evaluate(`(() => new Promise((resolve) => {
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

export default ({ pluginRpc, bbCli, sleep }) => {
  /** A Studio bot first (an import is never the primary), without waiting on its reply. */
  const firstBot = async () => {
    const { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) await pluginRpc("studio", "bot_create", { name: "Dot", avatar: "🟣", shape: "blob", color: "#5b8def", prompt: "Hi Dot. Reply with one short sentence: you'll keep an eye on ORBIT-42." });
  };
  const ready = async () => {
    const { installed, providers } = await pluginRpc("studio", "bot_external_providers", {});
    if (!installed) throw new Error("Studio Agents isn't installed in the staged BB");
    for (const id of ["hermes", "grok"]) {
      const provider = providers.find((each) => each.id === id);
      if (provider?.status !== "ready" || !provider.models.length) throw new Error(`${id} isn't ready in staging: ${provider?.message}. Start its fixture and enable it in Studio Agents settings.`);
    }
    return providers;
  };
  /** The imported bot, made once, after its first exchange. */
  const imported = async (spec) => {
    await firstBot();
    const providers = await ready();
    let { bots } = await pluginRpc("studio", "bot_list", {});
    let bot = bots.find((each) => each.name === spec.name);
    if (!bot) {
      const model = providers.find((each) => each.id === spec.providerId).models[0].id;
      ({ bot } = await pluginRpc("studio", "bot_create", { name: spec.name, avatar: "🤖", shape: spec.shape, color: spec.color, external: { providerId: spec.providerId, model } }));
    }
    if (bot.kind !== "external" || bot.providerId !== spec.providerId) throw new Error(`${spec.name} isn't an external ${spec.providerId} bot`);
    await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "120"]).catch(() => {});
    return bot;
  };
  /** An imported bot's Info (the Bot page), or with `chat` its chat, opened from its row as BB's thread page. */
  const botPage = (spec, { chat = false } = {}) => async (client) => {
    const bot = await imported(spec);
    // Its first exchange reached the provider and came back.
    const log = await bbCli(["thread", "log", bot.threadId]).catch(() => "");
    if (!spec.reply.test(log)) throw new Error(`${spec.name}'s chat has no reply from its provider`);
    await client.navigate(`${BOT_PATH}/${bot.id}`);
    await client.waitForSelector(SIDEBAR, 30000);
    await dismissProblems(client);
    await client.waitForSelector(`${SIDEBAR} [data-testid=bot-main] [data-provider="${spec.providerId}"]`, 30000);
    await client.waitForSelector(`[aria-label="${spec.name} info"]`, 30000);
    await client.waitForText(`Runs on ${spec.name} — its memory and tools live there.`, 30000);
    if (chat) {
      await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-main]').click(); return true; })()`);
      await client.evaluate(`(() => new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const nav = document.querySelector('${SIDEBAR}');
          const outside = nav ? document.body.textContent.replace(nav.textContent, "") : "";
          if (location.pathname.endsWith("/threads/${bot.threadId}") && nav?.querySelector('[data-provider="${spec.providerId}"]') && ${spec.reply}.test(outside)) return resolve(true);
          if (Date.now() - started > 60000) return reject(new Error("${spec.name}'s chat didn't open as BB's thread page with its provider's reply and the Bots list"));
          setTimeout(tick, 300);
        };
        tick();
      }))()`, true);
    }
    await sleep(1200);
  };
  return [
    {
      id: "external-agents",
      packageDir: "bb-studio-agents",
      clip: (client) => client.evaluate(`(() => {
        const back = [...document.querySelectorAll('a,button')].find(node => node.textContent.trim() === 'Plugin details');
        const last = [...document.querySelectorAll('*')].find(node => node.childElementCount === 0 && node.textContent.trim() === 'Enable Dot (experimental — one shared ChatGPT conversation; private API)');
        let column = back;
        while (column && !column.contains(last)) column = column.parentElement;
        if (!column) throw new Error('Studio Agents settings column not found for capture');
        const rect = column.getBoundingClientRect();
        return { x: rect.x - 20, y: Math.max(48, rect.y - 20), width: rect.width + 40, height: Math.min(rect.height + 40, 2400) };
      })()`),
      setup: async (client) => {
        await ready();
        await client.navigate("/settings/plugins/external-agents");
        await client.waitForText("Studio Agents", 30000);
        for (const text of ["Enable Hermes", "Hermes API URL", "Enable Grok", "xAI API URL", "xAI API key environment variable", "Enable OpenClaw", "OpenClaw token environment variable"]) await client.waitForText(text, 30000);
        // staged-bb.mjs points Grok at its fixture's port.
        const grokUrl = process.env.BB_CAPTURE_GROK_URL;
        if (!grokUrl) throw new Error("Set BB_CAPTURE_GROK_URL (staged-bb.mjs writes it to capture.env).");
        for (const value of ["STAGED_XAI_KEY", grokUrl, "STAGED_HERMES_TOKEN"]) {
          let shown = false;
          for (let i = 0; i < 60 && !shown; i++) { shown = !!(await client.poll(`[...document.querySelectorAll("input")].some((input) => input.value === ${JSON.stringify(value)})`)); if (!shown) await sleep(250); }
          if (!shown) throw new Error(`Studio Agents settings don't show ${value}`);
        }
        await dismissProblems(client);
        await sleep(600);
      },
    },
    {
      id: "studio-bot-import",
      packageDir: "bb-studio",
      fileName: "bot-import.png",
      setup: async (client) => {
        await firstBot();
        await ready();
        await client.navigate(BOT_PATH);
        await client.waitForSelector(`${SIDEBAR} [data-testid=bot-import]`, 30000);
        await dismissProblems(client);
        await client.evaluate(`(() => { document.querySelector('${SIDEBAR} [data-testid=bot-import]').click(); return true; })()`);
        await client.waitForText("Import bot", 15000);
        await client.evaluate(`(() => new Promise((resolve, reject) => {
          const started = Date.now();
          const tick = () => {
            const radio = (id) => document.querySelector('[role=radio][data-provider="' + id + '"]');
            const ok = radio("hermes")?.getAttribute("aria-checked") === "true" && /Ready/.test(radio("grok")?.textContent ?? "") && radio("openclaw")?.disabled && /Not configured/.test(radio("openclaw").textContent) && radio("dot")?.disabled;
            if (ok && document.querySelector('select[aria-label="Model"]')?.value === "hermes-fixture") return resolve(true);
            if (Date.now() - started > 30000) return reject(new Error("Import bot doesn't show Hermes picked with its model, Grok ready, and OpenClaw and Dot not configured"));
            setTimeout(tick, 300);
          };
          tick();
        }))()`, true);
        await sleep(800);
      },
    },
    { id: "studio-bot-external", packageDir: "bb-studio", fileName: "bot-external.png", setup: botPage(IMPORTS[0]) },
    { id: "studio-bot-external-grok", packageDir: "bb-studio", fileName: "bot-external-grok.png", setup: botPage(IMPORTS[1], { chat: true }) },
  ];
};

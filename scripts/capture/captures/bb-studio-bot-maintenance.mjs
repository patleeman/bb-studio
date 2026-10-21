// Real Bot info capture, to run after the maintenance commit reaches main.
// The capture runner requires the isolated staged BB's capture.env.
export default function maintenanceCaptures({ pluginRpc, sleep }) {
  return [{
    id: "studio-bot-maintenance", packageDir: "bb-studio", fileName: "bot-maintenance.png",
    setup: async (client) => {
      let { bot } = await pluginRpc("studio", "bot_get", {});
      if (!bot) ({ bot } = await pluginRpc("studio", "bot_create", { name: "Dot", avatar: "🟣", prompt: "This is a staged maintenance UI fixture. Reply exactly [PASS]." }));
      // Explicit dry run: this capture must never enable live maintenance.
      await pluginRpc("studio", "bot_maintenance_run", { botId: bot.id, dryRun: true });
      const state = await pluginRpc("studio", "bot_maintenance_get", { botId: bot.id });
      if (!state.runs[0]?.dryRun || !state.runs[0]?.summary.startsWith("Dry run:")) throw new Error("Maintenance did not record its dry-run summary");
      await client.navigate(`/plugins/studio/studio/bot/${bot.id}`);
      await client.waitForSelector('[data-testid="bot-maintenance"]', 30000);
      await client.evaluate(`(() => {
        const section = document.querySelector('[data-testid="bot-maintenance"]');
        if (!section) throw new Error('Maintenance section is missing');
        section.scrollIntoView({ block: 'start' });
        section.querySelector('details').open = true;
        return true;
      })()`);
      for (const text of ["Maintenance", "Daily maintenance", "Dry run:", "Finished threads", "Hidden workers", "Memory word budget", "Run now", "Dry run"]) await client.waitForText(text, 30000);
      await client.evaluate(`(() => {
        const section = document.querySelector('[data-testid="bot-maintenance"]');
        if (!section.textContent.includes('8000') && section.querySelector('input[type=number]')?.value !== '8000') throw new Error('The staged memory budget is missing');
        if (section.querySelector('[role=alert]')) throw new Error('Maintenance rendered an error');
        return true;
      })()`);
      await sleep(300);
    },
  }];
}

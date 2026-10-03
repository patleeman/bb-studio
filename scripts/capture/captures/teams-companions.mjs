import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default ({ pluginRpc, launchRoomThread, getLaunchRoomId, bbCli, sleep }) => ({
  id: "bots-companions", packageDir: "bb-studio/src/modules/teams", fileName: "companion-preview.png",
  setup: async client => {
    await launchRoomThread();
    const id = getLaunchRoomId();
    const { bots } = await pluginRpc("studio", "teams_list", null);
    const bot = bots.find(b => b.handle === "atlas");
    if (!bot) throw new Error("Missing staged Atlas profile");
    const before = new Set((await pluginRpc("studio", "teams_profileThreads", { id: bot.id })).map(t => t.threadId));
    const directory = await mkdtemp(join(tmpdir(), "bb-teams-companions-"));
    const attachment = join(directory, "release-review.txt");
    await writeFile(attachment, "Deterministic attachment retained by the saved-view composer.\n");
    const viewKey = `path:/plugins/studio/channels/${id}`;
    const botKey = `path:/plugins/studio/bots/${bot.id}`;
    const composer = `[data-float-window="${viewKey}"] [data-view-composer] [contenteditable="true"]`;
    const forget = async () => {
      await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbTeamsCompanionComposer`).catch(() => {});
      for (const thread of await pluginRpc("studio", "teams_profileThreads", { id: bot.id })) if (!before.has(thread.threadId)) await bbCli(["thread", "delete", thread.threadId, "--yes", "--json"]);
      await rm(directory, { recursive: true, force: true });
    };
    const retained = async visible => {
      const result = await client.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(composer)});
        return { same: node === window.bbTeamsCompanionComposer, count: document.querySelectorAll(${JSON.stringify(composer)}).length,
          visible: !!node?.checkVisibility(), draft: node?.textContent, attachment: node?.closest('[data-view-composer]')?.textContent.includes('release-review.txt') };
      })()`);
      if (!result.same || result.count !== 1 || result.visible !== visible || !result.draft?.includes("Keep the release review draft.") || !result.attachment) throw new Error(`Saved-view state was lost: ${JSON.stringify(result)}`);
    };
    try {
      await client.navigate(`/plugins/studio/bots/${bot.id}/profile`);
      await client.waitForText("Research and verify the facts");
      await client.navigate(`/plugins/studio/channels/${id}`);
      await client.waitForSelector('[data-thread-view]');
      await client.waitForSelector(`[data-studio-tab="bot-teams:${id}"] a`);
      await client.openContextMenu(`[data-studio-tab="bot-teams:${id}"] a`);
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      await client.waitForSelector(composer);
      await client.waitForSelector(`[data-float-window="${viewKey}"] [data-view-header]`);
      await client.dragBy('[data-float-resize="nw"]', -320, -250);
      await client.dragBy(composer, 0, 0);
      await client.command("Input.insertText", { text: "Keep the release review draft." });
      await client.evaluate(`(() => { window.bbTeamsCompanionComposer = document.querySelector(${JSON.stringify(composer)}); return true; })()`);
      const document = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: `[data-float-window="${viewKey}"] input[type="file"]` });
      if (!input.nodeId) throw new Error("Saved view has no real attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
      await client.waitForText("release-review.txt");
      await retained(true);
      const ownChat = await pluginRpc("studio", "chat_viewing", { path: `/plugins/studio/channels/${id}` });
      if (ownChat.item) throw new Error("Saved view still triggers automatic Studio Chat");

      await client.dragBy(`[data-studio-tab="bot-teams:${bot.id}"] a`, 0, 0);
      await client.waitForText("Research and verify the facts");
      await retained(true);
      await client.clickAriaButtonWithPointer("Move");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float this");
      await client.waitForSelector(`[data-float-window="${botKey}"] [data-studio-item-header]`);
      await retained(false);
      const conversation = await pluginRpc("studio", "teams_conversation", { id: bot.id });
      const baseline = (await pluginRpc("studio", "teams_profileThreads", { id: bot.id })).length;
      await client.clickElementWithTextAndPointer(`[data-float-window="${botKey}"] [data-studio-item-header] button`, "Chat");
      await client.waitForSelector(`[data-float-window="thread:${conversation.threadId}"] [data-promptbox]`);
      if ((await pluginRpc("studio", "teams_profileThreads", { id: bot.id })).length !== baseline) throw new Error("Bot Chat created a duplicate conversation");
      await retained(false);
      await client.dragBy(`[data-float-tab="${viewKey}"]`, 0, 0);
      await retained(true);
      await client.clickAriaButtonWithPointer("Fold floating tabs");
      await retained(false);
      await client.clickAriaButtonWithPointer("Open floating tabs");
      await retained(true);
      const controls = await client.evaluate(`(() => {
        const root = document.querySelector('[data-float-window="${viewKey}"]');
        const header = root.querySelector('[data-view-header]');
        return { named: header.textContent.includes('Launch work'), edit: !!header.querySelector('button[aria-label="Edit view"]'), duplicate: !!root.querySelector('[data-studio-chat-item]') };
      })()`);
      if (!controls.named || !controls.edit || controls.duplicate) throw new Error(`Companion lost its own title controls: ${JSON.stringify(controls)}`);
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-3500) })`).catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget();
      throw error;
    }
    return forget;
  },
});

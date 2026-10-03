import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export default ({ projectId, seedPages, pluginRpc, bbCli, sleep }) => ({
  id: "talk-companion-return", packageDir: "bb-studio/src/modules/talk", fileName: "companion-dictation.png", privateSidebar: true,
  setup: async client => {
    const { page, cleanup } = await seedPages();
    const directory = await mkdtemp(join(tmpdir(), "bb-talk-companion-"));
    const attachment = join(directory, "release-review.txt");
    await writeFile(attachment, "Preserve this attachment while dictating.\n");
    const records = new Set(); let threadId, disabled = false;
    const forget = async () => {
      const stop = await client.evaluate("!!document.querySelector('button[aria-label=\"Stop without inserting\"]')").catch(() => false);
      if (stop) await client.clickAriaButtonWithPointer("Stop without inserting").catch(() => {});
      for (const id of records) await pluginRpc("studio", "talk_recording_delete", { id }).catch(() => {});
      if (threadId) await bbCli(["thread", "delete", threadId, "--yes", "--json"]);
      if (disabled) await bbCli(["plugin", "enable", "studio-chat", "--json"]);
      await cleanup(); await rm(directory, { recursive: true, force: true });
      await client.evaluate("sessionStorage.removeItem('bb-studio-float:windows'); delete window.bbTalkSource").catch(() => {});
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    };
    const newConversation = async () => {
      await client.clickAriaButtonWithPointer("Chat options");
      await client.clickElementWithTextAndPointer('[role=menuitem]', "New conversation");
    };
    const attach = async root => {
      const document = await client.command("DOM.getDocument");
      const input = await client.command("DOM.querySelector", { nodeId: document.root.nodeId, selector: `${root} input[type=file]` });
      if (!input.nodeId) throw new Error("The dictation composer has no attachment input");
      await client.command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [attachment] });
      await client.waitForText("release-review.txt");
    };
    const root = key => `[data-float-window=${JSON.stringify(key)}]`;
    const prompt = key => `${root(key)} [data-promptbox] [contenteditable=true]`;
    const start = async key => {
      await client.waitForSelector(`${root(key)} button[aria-label="Start voice input"][data-talk-mic]`);
      const point = await client.evaluate(`(() => {
        const mic = document.querySelector(${JSON.stringify(`${root(key)} button[aria-label="Start voice input"]`)});
        const rect = mic.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, buttons: 0 });
      await client.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
      await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
      await client.waitForSelector('html[data-bb-talk-phase="recording"]');
      const saved = await client.evaluate("JSON.parse(localStorage.getItem('bb-plugin-talk:active'))");
      if (!saved?.recordingId) throw new Error("The real microphone did not create a durable capture");
      records.add(saved.recordingId);
      await client.clickAriaButtonWithPointer("Pause");
      await client.waitForSelector('html[data-bb-talk-phase="paused"]');
      return saved;
    };
    const assertRetained = async (key, text) => {
      const state = await client.evaluate(`(() => { const draft = document.querySelector(${JSON.stringify(prompt(key))}); return {
        same: draft === window.bbTalkSource, visible: !!draft?.checkVisibility(), text: draft?.textContent,
        file: draft?.closest('[data-float-window]')?.textContent.includes('release-review.txt'),
        tabs: document.querySelectorAll(${JSON.stringify(`[data-float-tab=${JSON.stringify(key)}]`)}).length }; })()`);
      if (!state.same || !state.visible || !state.text?.includes(text) || !state.file || state.tabs !== 1) throw new Error(`Talk lost its originating draft: ${JSON.stringify(state)}`);
      if (await client.evaluate("location.pathname") !== `/plugins/pages/pages/${page.id}`) throw new Error("Talk replaced the main page instead of focusing its companion");
    };
    try {
      await bbCli(["plugin", "disable", "studio-chat", "--json"]); disabled = true;
      ({ threadId } = await pluginRpc("pages", "work", { id: page.id, request: {
        projectId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "medium", permissionMode: "full",
        executionInputSources: {}, environment: { type: "project-default" },
        input: [{ type: "text", text: "Review the offline launch checklist.", mentions: [] }], sendAt: Date.now() + 30 * 86400000,
      }}));
      await client.navigate(`/plugins/pages/pages/${page.id}`);
      await client.waitForText("Launch checklist");
      await client.clickElementWithTextAndPointer('[data-studio-item-header] button', "Chat");
      const threadKey = `thread:${threadId}`, composeKey = `path:/plugins/pages/pages/${page.id}/compose`;
      await client.waitForSelector(prompt(threadKey));
      await client.dragBy(prompt(threadKey), 0, 0); await client.command("Input.insertText", { text: "Keep the thread draft." });
      await attach(root(threadKey));
      await client.evaluate(`(() => { window.bbTalkSource = document.querySelector(${JSON.stringify(prompt(threadKey))}); return true; })()`);
      const threadCapture = await start(threadKey);
      if (threadCapture.threadId !== threadId) throw new Error("Talk associated the companion microphone with the main thread");
      const { recording } = await pluginRpc("studio", "talk_recording_get", { id: threadCapture.recordingId });
      if (recording.threadId !== threadId || recording.projectId !== projectId) throw new Error("Talk stored the wrong thread or project");
      await newConversation(); await client.waitForSelector(prompt(composeKey));
      await client.waitForAriaButton("Back to where you're dictating");
      await client.clickAriaButtonWithPointer("Back to where you're dictating");
      await client.waitForSelector(`[data-float-tab="${threadKey}"][aria-selected=true]`);
      await assertRetained(threadKey, "Keep the thread draft.");
      await client.clickAriaButtonWithPointer("Stop without inserting");
      await client.waitForSelector('html[data-bb-talk="idle"]');

      await newConversation(); await client.waitForSelector(prompt(composeKey));
      await client.dragBy(prompt(composeKey), 0, 0); await client.command("Input.insertText", { text: "Keep this page dictation draft." });
      await attach(root(composeKey));
      await client.evaluate(`(() => { window.bbTalkSource = document.querySelector(${JSON.stringify(prompt(composeKey))}); return true; })()`);
      const composeCapture = await start(composeKey);
      if (composeCapture.threadId !== null || composeCapture.composePath !== `/plugins/pages/pages/${page.id}/compose`) throw new Error("Talk did not remember the new conversation's exact route");
      const composeRecording = await pluginRpc("studio", "talk_recording_get", { id: composeCapture.recordingId });
      if (composeRecording.recording.projectId !== projectId) throw new Error("Talk ignored the conversation's selected project");
      await client.dragBy(`[data-float-tab="${threadKey}"]`, 0, 0);
      await client.waitForAriaButton("Back to where you're dictating");
      await client.clickAriaButtonWithPointer("Back to where you're dictating");
      await client.waitForSelector(`[data-float-tab=${JSON.stringify(composeKey)}][aria-selected=true]`);
      await assertRetained(composeKey, "Keep this page dictation draft.");
      await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await sleep(700);
      await assertRetained(composeKey, "Keep this page dictation draft.");
      const clipped = await client.evaluate(`(() => [...document.querySelectorAll('[data-talk-inline] button, [data-talk-overlay] button')].filter(button => button.checkVisibility()).filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight;
      }).map(button => button.getAttribute('aria-label') ?? button.innerText))()`);
      if (clipped.length) throw new Error(`Talk clips its companion controls on a phone: ${JSON.stringify(clipped)}`);
      await client.capture(join(process.cwd(), "packages/bb-studio-talk/assets/companion-dictation-mobile.png"));
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await sleep(500);
    } catch (error) {
      console.error(await client.evaluate("JSON.stringify({capture:localStorage.getItem('bb-plugin-talk:active'),phase:document.documentElement.dataset.bbTalkPhase,mics:[...document.querySelectorAll('button[aria-label=\"Start voice input\"]')].map(button=>({html:button.outerHTML,bounds:button.getBoundingClientRect().toJSON()}))})").catch(() => "Mic unavailable"));
      console.error(await client.evaluate("JSON.stringify({path:location.pathname,text:document.body.innerText.slice(-3500)})").catch(() => "Capture unavailable"));
      if (process.env.BB_CAPTURE_DEBUG_PATH) await client.capture(process.env.BB_CAPTURE_DEBUG_PATH).catch(() => {});
      await forget(); throw error;
    }
    return forget;
  },
});

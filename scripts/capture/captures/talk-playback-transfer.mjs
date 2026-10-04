export default ({ projectId, seedTalkRecording, seedPages, talkRpc, sleep }) => ({
  id: "talk-playback-transfer",
  packageDir: "bb-studio-talk",
  fileName: "companion-playback.png",
  privateSidebar: true,
  setup: async (client) => {
    const recordingId = await seedTalkRecording(projectId, { transcribe: false, title: "Playback continuity check" });
    const page = await seedPages();
    const path = `/plugins/talk/recordings/${recordingId}`;
    const key = `path:${path}`;
    let previous = 0;
    const forget = async () => {
      await client.evaluate(`window.bbPlaybackTransfer?.audio?.pause(); sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbPlaybackTransfer`).catch(() => {});
      await talkRpc("recording_delete", { id: recordingId });
      await page.cleanup();
    };
    const check = async () => {
      await sleep(400);
      const result = await client.evaluate(`(() => {
        const original = window.bbPlaybackTransfer;
        return { same: window.__talkTransferAudio === original.audio, connected: original.controls.isConnected,
          time: original.audio.currentTime, duration: original.audio.duration, playing: !original.audio.paused,
          source: original.audio.src, rate: original.audio.playbackRate, volume: original.audio.volume,
          count: document.querySelectorAll('section[aria-label="Audio playback"]').length };
      })()`);
      if (!result.same || !result.connected || !result.playing || result.time <= previous ||
          result.time >= result.duration || result.rate !== 0.75 || Math.abs(result.volume - 0.35) > 0.01 || result.count !== 1)
        throw new Error(`Talk playback restarted or stopped during placement: ${JSON.stringify(result)}`);
      previous = result.time;
    };
    const action = async (label) => {
      await client.clickAriaButtonWithPointer("Floating tab actions");
      await client.clickElementWithTextAndPointer('[role="menuitem"]', label);
    };
    try {
      await client.navigate(`/plugins/pages/pages/${page.page.id}`);
      await client.waitForText("Offline mode launch", 90000);
      await client.navigate(path);
      await client.waitForSelector('section[aria-label="Audio playback"]', 90000);
      await client.evaluate(`window.Audio = class extends window.Audio { constructor(...args) { super(...args); window.__talkTransferAudio = this; } }`);
      await client.evaluate(`(() => {
        const rate = document.querySelector('select[aria-label="Playback speed"]'); rate.value = '0.75'; rate.dispatchEvent(new Event('change', { bubbles: true }));
        const volume = document.querySelector('input[aria-label="Playback volume"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(volume, '0.35'); volume.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await client.clickAriaButtonWithPointer("Play recording");
      await client.evaluate(`window.bbPlaybackTransfer = { audio: window.__talkTransferAudio, controls: document.querySelector('section[aria-label="Audio playback"]') }; true`);
      await check();
      await client.openContextMenu(`[data-studio-tab="talk:${recordingId}"] a`);
      await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float");
      await check();
      const native = await client.evaluate(`typeof window.__bbPluginRuntime?.pluginSdkApp?.experimental_CompanionView === 'function'`);
      if (native) {
        await action("Move to workbench");
        await check();
        await client.clickElementWithTextAndPointer("button", "Main view");
        await check();
        await client.clickElementWithTextAndPointer("button", "Float");
        await check();
      }
      await client.dragBy(`[data-studio-tab="pages:${page.page.id}"] a`, 0, 0);
      await check();
      await client.dragBy(`[data-studio-tab="talk:${recordingId}"] a`, 0, 0);
      await client.waitForText("This view is open in a companion.");
      await action("Close tab");
      await check();
      const returned = await client.evaluate(`document.querySelector('section[aria-label="Audio playback"]') === window.bbPlaybackTransfer.controls`);
      if (!returned) throw new Error("Closing Talk's companion replaced its original playback controls");
      await client.clickAriaButtonWithPointer("Pause playback");
      const paused = await client.evaluate(`window.bbPlaybackTransfer.audio.paused && window.bbPlaybackTransfer.audio.currentTime >= ${previous}`);
      if (!paused) throw new Error("The returned Talk player did not pause at the retained position");
      console.log("Verified original audio/control nodes, advancing position, speed/volume, navigation and return after close");
    } catch (error) {
      console.error(await client.evaluate(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-3000) })`).catch(() => "Talk capture context unavailable"));
      await forget();
      throw error;
    }
    return forget;
  },
});

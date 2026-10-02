import { resolve } from "node:path";

const scrollToTop = `(() => {
  for (let node = document.querySelector('input[aria-label="Title"]'); node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight) node.scrollTop = 0;
  }
  window.scrollTo(0, 0);
})()`;

export default ({ projectId, seedTalkRecording, talkRpc, sleep }) => [
  {
    id: "talk",
    packageDir: "bb-studio-talk",
    privateSidebar: true,
    setup: async (client) => {
      const recordingId = await seedTalkRecording(projectId);
      const original = await talkRpc("recording_get", { id: recordingId });
      const cleanup = async () => { await talkRpc("recording_delete", { id: recordingId }); };
      try {
        // Meetings are optional. Generate this fixture's notes explicitly.
        await talkRpc("meeting_regenerate", { id: recordingId });
        await client.navigate(`/plugins/talk/recordings/${recordingId}`);
        await client.waitForText("Weekly product sync");
        await client.waitForText("offline mode beta");
        await client.waitForText("guided import spec");
        await client.waitForText("Meeting notes");
        const notes = await client.evaluate(`document.querySelector('details[aria-label="Meeting notes"] p')?.textContent?.trim() ?? ""`);
        if (!notes || notes.startsWith("Notes appear")) throw new Error("Seeded meeting summary is missing.");
        await client.waitForSelector('input[aria-label="Recording position"]');
        await client.waitForSelector('input[aria-label="Playback volume"]');
        await client.waitForText("Send to agent");
        await client.clickButtonText("Clean up transcript");
        await client.waitForText("Cleanup saved", 180000);
        await client.waitForText("Original text and audio kept");
        const cleaned = await talkRpc("recording_get", { id: recordingId });
        if (cleaned.segments.some((segment, index) => segment.text !== original.segments[index].text || !segment.cleanedText)) {
          throw new Error("Cleanup must save every cleaned section and retain every original section.");
        }
        await client.clickButtonText("Original");
        const originalSelected = await client.evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Original' && button.getAttribute('aria-pressed') === 'true')`);
        if (!originalSelected) throw new Error("Original transcript view did not open.");
        await client.clickButtonText("Cleaned");
        // Observe real audio objects while driving the live controls.
        await client.evaluate(`window.Audio = class extends window.Audio { constructor(...args) { super(...args); window.__talkCaptureAudio = this; } }`);
        await client.clickAriaButtonWithPointer("Play recording");
        await sleep(1500);
        const started = await client.evaluate(`window.__talkCaptureAudio?.currentTime > 0 && !window.__talkCaptureAudio.paused`);
        if (!started) {
          const detail = await client.evaluate(`({ audio: window.__talkCaptureAudio ? { src: window.__talkCaptureAudio.src, time: window.__talkCaptureAudio.currentTime, paused: window.__talkCaptureAudio.paused, ready: window.__talkCaptureAudio.readyState, error: window.__talkCaptureAudio.error?.message } : null, notices: [...document.querySelectorAll('[data-sonner-toast]')].map(item => item.textContent) })`);
          throw new Error(`The seeded recording did not play: ${JSON.stringify(detail)}`);
        }
        const second = cleaned.segments[1];
        await client.evaluate(`(() => {
          const input = document.querySelector('input[aria-label="Recording position"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${second.offsetMs + 2000});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const volume = document.querySelector('input[aria-label="Playback volume"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(volume, '0.5');
          volume.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await sleep(1500);
        const sought = await client.evaluate(`window.__talkCaptureAudio?.src.includes('segment=${second.id}') && window.__talkCaptureAudio.currentTime >= 2 && window.__talkCaptureAudio.volume === 0.5 && document.querySelector('[aria-current="true"]')?.textContent.includes('Onboarding')`);
        if (!sought) throw new Error("Scrubbing must seek the real audio, adjust volume, and highlight the matching transcript.");
        await client.clickFirstButtonWithAria("Pause playback");
        const paused = await client.evaluate(`window.__talkCaptureAudio?.paused === true`);
        if (!paused) throw new Error("The recording did not pause.");
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await client.evaluate(scrollToTop);
        await sleep(350);
        const fits = await client.evaluate(`(() => {
          const player = document.querySelector('section[aria-label="Audio playback"]');
          const controls = [...player.querySelectorAll('button, input, select')];
          return controls.every(control => { const rect = control.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; });
        })()`);
        if (!fits) throw new Error("Playback controls overflow the mobile viewport.");
        const titleClear = await client.evaluate(`(() => {
          const input = document.querySelector('input[aria-label="Title"]');
          const title = input.getBoundingClientRect();
          const surface = input.closest('.studio-root').parentElement;
          const back = [...surface.querySelectorAll('button')].find(button => button.textContent.trim() === 'Studio').getBoundingClientRect();
          return title.top >= back.bottom + 8;
        })()`);
        if (!titleClear) throw new Error("The mobile recording title is covered by the toolbar.");
        const setPausedPosition = `(() => {
          const set = (label, value) => {
            const input = document.querySelector('input[aria-label="' + label + '"]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set('Recording position', ${second.offsetMs + 2000});
          set('Playback volume', 0.5);
        })()`;
        await client.evaluate(setPausedPosition);
        await sleep(350);
        await client.capture(resolve('packages/bb-studio-talk/assets/staged-mobile.png'));
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(350);
        await client.evaluate(setPausedPosition);
        // Keep the title and full player in the published frame after follow-scroll.
        await client.evaluate(scrollToTop);
        await sleep(350);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];

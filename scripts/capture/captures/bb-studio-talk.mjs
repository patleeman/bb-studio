import { resolve } from "node:path";

const scrollToTop = `(() => {
  for (let node = document.querySelector('input[aria-label="Title"]'); node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight) node.scrollTop = 0;
  }
  window.scrollTo(0, 0);
})()`;

export default ({ projectId, threadId, bbCli, seedTalkRecording, talkRpc, sleep }) => [
  {
    id: "talk-inline",
    packageDir: "bb-studio-talk",
    fileName: "inline-dictation.png",
    privateSidebar: true,
    setup: async (client) => {
      let recordingId;
      const cleanup = async () => {
        if (await client.evaluate(`!!document.querySelector('button[aria-label="Stop without inserting"]')`)) await client.clickAriaButtonWithPointer("Stop without inserting");
        if (recordingId) await talkRpc("recording_delete", { id: recordingId }).catch(() => {});
      };
      const checkInline = async () => {
        await client.waitForSelector("[data-promptbox] [data-talk-inline]");
        if (await client.evaluate(`!!document.querySelector('[data-talk-overlay]')`)) throw new Error("Dictation has duplicate floating controls while docked.");
        const fits = await client.evaluate(`(() => {
          const root = document.querySelector('[data-talk-inline]');
          const composer = root.closest('[data-promptbox]').getBoundingClientRect();
          return [...root.querySelectorAll('button')].every(button => {
            const r = button.getBoundingClientRect();
            return r.width >= 24 && r.left >= composer.left && r.right <= composer.right && r.top >= 0 && r.bottom <= innerHeight;
          });
        })()`);
        if (!fits) throw new Error("Inline dictation controls overflow their input or viewport.");
      };
      try {
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForSelector('[data-talk-composer-bridge]');
        await client.waitForSelector('html[data-bb-talk="idle"]');
        await client.waitForSelector('[data-promptbox] button[data-talk-mic]');
        await client.waitForSelector('[data-promptbox] [contenteditable="true"]');
        await client.evaluate(`document.querySelector('[data-promptbox] [contenteditable="true"]').focus()`);
        await client.command("Input.insertText", { text: "Turn this brain dump into a short plan." });
        await client.clickAriaButtonWithPointer("Start voice input");
        await checkInline();
        await client.waitForAriaButton("Pause");
        recordingId = await client.evaluate(`JSON.parse(localStorage.getItem('bb-plugin-talk:active')).recordingId`);
        await client.clickAriaButtonWithPointer("Pause");
        await client.waitForAriaButton("Resume recording");
        await checkInline();
        await client.clickAriaButtonWithPointer("Resume recording");
        await client.waitForAriaButton("Pause");
        await client.clickAriaButtonWithPointer("Expand dictation transcript");
        await client.waitForSelector("[data-talk-overlay]");
        await client.waitForText("Text appears here as each piece is transcribed.");
        if (await client.evaluate(`!!document.querySelector('[data-talk-inline]')`)) throw new Error("Expanded dictation stayed inside the input.");
        await client.clickAriaButtonWithPointer("Collapse dictation transcript");
        await checkInline();
        if (!await client.evaluate(`!!document.activeElement?.closest('[data-talk-inline]')`)) throw new Error("Collapsing the transcript lost keyboard focus.");
        // Use the native nav without reloading the recorder's window.
        await client.clickButtonText("Studio");
        await client.waitForSelector("[data-talk-overlay]");
        await client.waitForAriaButton("Back to where you're dictating");
        if (await client.evaluate(`JSON.parse(localStorage.getItem('bb-plugin-talk:active')).recordingId !== ${JSON.stringify(recordingId)}`)) throw new Error("Navigation replaced the ongoing dictation.");
        await client.clickAriaButtonWithPointer("Back to where you're dictating");
        await checkInline();
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.click()`);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await sleep(500);
        await checkInline();
        await client.capture(resolve("packages/bb-studio-talk/assets/inline-dictation-mobile.png"));
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.click()`);
        await sleep(500);
        await checkInline();
      } catch (error) {
        await client.capture(`${process.env.TMPDIR ?? "/tmp/"}talk-inline-error.png`);
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "talk-composer",
    packageDir: "bb-studio-talk",
    fileName: "dictation-message.png",
    privateSidebar: true,
    setup: async (client) => {
      const recordingId = await seedTalkRecording(projectId, { kind: "dictation", title: "Launch brain dump" });
      let threadId;
      const cleanup = async () => {
        if (threadId) {
          await bbCli(["thread", "stop", threadId]).catch(() => {});
          await bbCli(["thread", "delete", threadId, "--yes"]);
        }
        await talkRpc("recording_delete", { id: recordingId });
      };
      try {
        const thread = JSON.parse(await bbCli([
          "thread", "spawn", "--project", projectId, "--provider", "codex",
          "--model", "gpt-6.1-sol", "--reasoning-level", "low", "--title", "Onboarding brain dump",
          "--prompt", "Reply only Ready. Do not use tools.", "--json",
        ]));
        threadId = thread.id;
        // Stable BB resolves saved-item context on follow-up messages. The
        // initial dictation also carries its spoken text and saved source.
        await bbCli(["thread", "wait", threadId, "--timeout", "60s", "--json"]);
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForSelector("[data-talk-composer-bridge]");
        // Exercise the same recovered delivery as finishing a dictation away
        // from its input. Audio and transcription come from the live seeder.
        const pending = { [threadId]: {
          text: "What is the onboarding problem in the attached Talk item? Answer in one sentence using only the supplied context. Do not use tools.",
          recordings: [{ id: recordingId, title: "Launch brain dump", kind: "dictation" }],
        } };
        await client.evaluate(`localStorage.setItem('bb-plugin-talk:pending-inserts', ${JSON.stringify(JSON.stringify(pending))})`);
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        const mentionSelector = `[data-promptbox] [data-prompt-mention-resource*="${recordingId}"]`;
        await client.waitForSelector(mentionSelector);
        if (await client.evaluate(`document.querySelector('[data-promptbox] [contenteditable="true"]').textContent.includes('/plugins/talk/recordings/')`)) throw new Error("Dictation injected a separate recording link into the draft.");
        const source = await client.evaluate(`JSON.parse(document.querySelector(${JSON.stringify(mentionSelector)}).getAttribute('data-prompt-mention-resource'))`);
        if (source?.pluginId !== "talk" || source.itemId !== `recordings:${recordingId}`) throw new Error("Recovered dictation did not attach its native Talk mention.");
        // The delivery toast otherwise covers the submit button while hovered.
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, buttons: 0 });
        await sleep(5000);
        await client.clickAriaButtonWithPointer("Submit (Enter)");
        const linkSelector = `[data-talk-recording-link="/plugins/talk/recordings/${recordingId}"]`;
        await client.waitForSelector(linkSelector);
        if (await client.evaluate(`!!document.querySelector('a[href="/plugins/talk/recordings/${recordingId}"]')`)) throw new Error("Dictation injected a separate recording link into the message.");
        await bbCli(["thread", "wait", threadId, "--timeout", "60s", "--json"]);
        const events = JSON.parse(await bbCli(["thread", "messages", threadId, "--json"]));
        const input = events.findLast(event => event.type === "client/turn/requested")?.data.input;
        if (!input?.some(part => part.mentions?.some(mention => mention.resource.itemId === `recordings:${recordingId}`))) throw new Error("Sent message lost its Talk mention.");
        const reply = events.findLast(event => event.type === "item/completed" && event.data.item.type === "agentMessage")?.data.item.text ?? "";
        if (!/import/i.test(reply) || !/stall|stuck|struggl|drop|abandon/i.test(reply)) throw new Error(`The agent did not receive the saved onboarding transcript: ${reply}`);
        await client.waitForText(reply.trim());
        // The pill must open the saved source and remain valid after Keep.
        await client.evaluate(`document.querySelector(${JSON.stringify(linkSelector)}).click()`);
        await client.waitForSelector('input[aria-label="Title"]');
        await client.waitForText("Onboarding is the next focus");
        await talkRpc("recording_keep", { id: recordingId });
        const { recording: kept } = await talkRpc("recording_get", { id: recordingId });
        if (kept.id !== recordingId || kept.kind !== "recording") throw new Error("Keeping a dictation broke its saved reference.");
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForSelector(linkSelector);
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.click()`);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await sleep(350);
        const fits = await client.evaluate(`(() => {
          const pill = document.querySelector(${JSON.stringify(linkSelector)}).getBoundingClientRect();
          return pill.left >= 0 && pill.right <= innerWidth;
        })()`);
        if (!fits) throw new Error("Dictation source pill overflows the mobile message.");
        await client.capture(resolve("packages/bb-studio-talk/assets/dictation-message-mobile.png"));
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.click()`);
        await sleep(350);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "talk",
    packageDir: "bb-studio-talk",
    privateSidebar: true,
    setup: async (client) => {
      const recordingId = await seedTalkRecording(projectId);
      const original = await talkRpc("recording_get", { id: recordingId });
      const cleanup = async () => { await talkRpc("recording_delete", { id: recordingId }); };
      try {
        // Summaries are optional. Generate this fixture's summary explicitly.
        await talkRpc("meeting_regenerate", { id: recordingId });
        await client.navigate(`/plugins/talk/recordings/${recordingId}`);
        await client.waitForText("Weekly product sync");
        await client.waitForText("offline mode beta");
        await client.waitForText("guided import spec");
        await client.waitForText("Summary");
        const notes = await client.evaluate(`document.querySelector('details[aria-label="Summary"] p')?.textContent?.trim() ?? ""`);
        if (!notes || notes.startsWith("Notes appear")) throw new Error("Seeded recording summary is missing.");
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

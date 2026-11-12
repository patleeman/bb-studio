// Talk, built into Studio: its Models settings, dictation at the composer, a
// dictated message's saved source, a recording page as a Studio tab, a call
// being recorded, and the unsent-audio banner in the library.
import { resolve } from "node:path";

const scrollToTop = `(() => {
  for (let node = document.querySelector('input[aria-label="Title"]'); node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight) node.scrollTop = 0;
  }
  window.scrollTo(0, 0);
})()`;

/** Opens a recording from its old Talk address and checks it lands as a Studio tab. */
async function openRecording(client, id) {
  await client.navigate(`/plugins/talk/recordings/${id}`);
  await client.waitForSelector(`[data-studio-workspace-editor="/plugins/studio/studio/recordings/${id}"]`, 30000);
  const path = await client.evaluate("location.pathname");
  if (path !== "/plugins/studio/studio") throw new Error(`The old recording address didn't open in Studio's workspace: ${path}`);
}

export default ({ projectId, threadId, bbCli, seedTalkRecording, seedPages, pluginRpc, talkRpc, sleep }) => [
  {
    id: "talk-settings",
    packageDir: "bb-studio",
    fileName: "recordings-model-settings.png",
    setup: async (client) => {
      const original = await talkRpc("models.get", null);
      const choice = { providerId: "codex", model: "gpt-6-luna", reasoningLevel: "low" };
      const cleanup = async () => {
        for (const [purpose, selection] of Object.entries(original)) await talkRpc("models.set", { purpose, selection });
      };
      try {
        await talkRpc("models.set", { purpose: "cleanup", selection: null });
        await client.navigate("/settings/plugins/studio");
        await client.waitForSelector("[data-talk-model-settings]");
        await client.waitForText("Studio Decisions");
        await client.evaluate(`document.querySelector('[aria-label="Cleanup model source"]').click()`);
        await client.waitForText("A specific model");
        await client.evaluate(`[...document.querySelectorAll('[role="option"]')].find(el => el.textContent.includes('A specific model')).click()`);
        await client.waitForSelector('[data-talk-model-purpose="cleanup"] button[data-state]');
        // A real catalog choice must have been saved by the settings control.
        let selected;
        for (let attempt = 0; attempt < 40; attempt++) {
          selected = (await talkRpc("models.get", null)).cleanup;
          if (selected) break;
          await sleep(250);
        }
        if (!selected?.providerId || !selected?.model) throw new Error("Talk's model source picker did not save a catalog choice.");
        await talkRpc("models.set", { purpose: "cleanup", selection: choice });
        await client.navigate("/settings/plugins/studio");
        await client.waitForText("6-Luna");
        await client.evaluate(`document.querySelector('[data-talk-model-settings]').scrollIntoView({ block: 'center' })`);
        const text = await client.evaluate(`document.querySelector('[data-talk-model-settings]').innerText`);
        for (const label of ["Cleanup", "Titles", "Summaries", "A specific model", "6-Luna"]) {
          if (!text.includes(label)) throw new Error(`Missing Talk model setting: ${label}`);
        }
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "talk-inline",
    packageDir: "bb-studio",
    fileName: "recordings-inline-dictation.png",
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
        // Use the sidebar's Studio entry (a row, or BB 0.46's icon rail) without reloading the recorder's window.
        await client.evaluate(`(() => { const entry = [...document.querySelectorAll('[data-sidebar="sidebar"] :is(a, button)')].find((each) => each.innerText.trim() === "Studio" || each.getAttribute("aria-label")?.startsWith("Studio")); if (!entry) throw new Error("No Studio entry in the sidebar"); entry.click(); })()`);
        await client.waitForSelector("[data-talk-overlay]");
        await client.waitForAriaButton("Back to where you're dictating");
        if (await client.evaluate(`JSON.parse(localStorage.getItem('bb-plugin-talk:active')).recordingId !== ${JSON.stringify(recordingId)}`)) throw new Error("Navigation replaced the ongoing dictation.");
        await client.clickAriaButtonWithPointer("Back to where you're dictating");
        await checkInline();
        await client.evaluate(`document.querySelector('button[aria-label^="Toggle sidebar"]')?.click()`);
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await sleep(500);
        await checkInline();
        await client.capture(resolve("packages/bb-studio/assets/recordings-inline-dictation-mobile.png"));
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
    packageDir: "bb-studio",
    fileName: "recordings-dictation-message.png",
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
        if (await client.evaluate(`document.querySelector('[data-promptbox] [contenteditable="true"]').textContent.includes('/recordings/rec_')`)) throw new Error("Dictation injected a separate recording link into the draft.");
        const source = await client.evaluate(`JSON.parse(document.querySelector(${JSON.stringify(mentionSelector)}).getAttribute('data-prompt-mention-resource'))`);
        if (source?.pluginId !== "studio" || source.itemId !== `recordings:${recordingId}`) throw new Error("Recovered dictation did not attach its native Talk mention.");
        // The delivery toast otherwise covers the submit button while hovered.
        await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, buttons: 0 });
        await sleep(5000);
        await client.clickAriaButtonWithPointer("Submit (Enter)");
        const linkSelector = `[data-talk-recording-link="/plugins/studio/studio/recordings/${recordingId}"]`;
        await client.waitForSelector(linkSelector);
        if (await client.evaluate(`!!document.querySelector('a[href*="/recordings/${recordingId}"]')`)) throw new Error("Dictation injected a separate recording link into the message.");
        await bbCli(["thread", "wait", threadId, "--timeout", "60s", "--json"]);
        const events = JSON.parse(await bbCli(["thread", "messages", threadId, "--json"]));
        const input = events.findLast(event => event.type === "client/turn/requested")?.data.input;
        if (!input?.some(part => part.mentions?.some(mention => mention.resource.itemId === `recordings:${recordingId}`))) throw new Error("Sent message lost its Talk mention.");
        const reply = events.findLast(event => event.type === "item/completed" && event.data.item.type === "agentMessage")?.data.item.text ?? "";
        if (!/import/i.test(reply) || !/stall|stuck|struggl|drop|abandon/i.test(reply)) throw new Error(`The agent did not receive the saved onboarding transcript: ${reply}`);
        await client.waitForText(reply.trim());
        // The pill must open the saved source and remain valid after Keep.
        await client.clickElementWithTextAndPointer(linkSelector, "Launch brain dump");
        await client.waitForSelector('input[aria-label="Title"]');
        await client.waitForText("Onboarding is the next focus");
        await talkRpc("recording_keep", { id: recordingId });
        const { recording: kept } = await talkRpc("recording_get", { id: recordingId });
        if (kept.id !== recordingId || kept.kind !== "recording") throw new Error("Keeping a dictation broke its saved reference.");
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForSelector(linkSelector);
        await client.evaluate(`document.querySelector(${JSON.stringify(linkSelector)}).focus()`);
        await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await client.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await client.waitForSelector('input[aria-label="Title"]');
        await client.waitForText("Onboarding is the next focus");
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
        await client.capture(resolve("packages/bb-studio/assets/recordings-dictation-message-mobile.png"));
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
    id: "talk-page",
    packageDir: "bb-studio",
    fileName: "recordings-preview.png",
    privateSidebar: true,
    setup: async (client) => {
      const recordingId = await seedTalkRecording(projectId);
      const original = await talkRpc("recording_get", { id: recordingId });
      let notesPageId = null;
      const cleanup = async () => {
        await talkRpc("recording_delete", { id: recordingId });
        if (notesPageId) await pluginRpc("studio", "pages.remove", { id: notesPageId }).catch(() => {});
      };
      try {
        // Summaries are optional. Generate this fixture's summary explicitly.
        await talkRpc("meeting_regenerate", { id: recordingId });
        await openRecording(client, recordingId);
        await client.waitForText("Weekly product sync");
        await client.waitForText("offline mode beta");
        await client.waitForText("guided import spec");
        await client.waitForText("Summary");
        const notes = await client.evaluate(`document.querySelector('details[aria-label="Summary"] p')?.textContent?.trim() ?? ""`);
        if (!notes || notes.startsWith("Notes appear")) throw new Error("Seeded recording summary is missing.");
        // Make notes writes one Studio Page with a checklist and links both ways.
        await client.clickButtonText("Make notes");
        await client.waitForText("Open notes", 180000);
        const { recording: withNotes } = await talkRpc("recording_get", { id: recordingId });
        if (!withNotes.notesPageId) throw new Error("Make notes did not save the notes page on the recording.");
        notesPageId = withNotes.notesPageId;
        const { markdown: notesMarkdown } = await pluginRpc("studio", "pages.markdown", { id: notesPageId });
        if (!notesMarkdown.includes(`(item:talk:${recordingId})`) || !/## Action items\n\n- \[ \] /.test(notesMarkdown) || !notesMarkdown.includes("## Decisions")) {
          throw new Error(`The notes page is missing its recording link, decisions, or action-item checklist: ${notesMarkdown}`);
        }
        await client.waitForText("Update notes");
        const { pageId: updatedPageId, created: createdAgain } = await talkRpc("notes_make", { id: recordingId });
        if (updatedPageId !== notesPageId || createdAgain) throw new Error("Updating notes made a second page.");
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
          // The Studio bar, in BB's title bar or atop the view.
          const bars = [...document.querySelectorAll('[data-studio-bar]')].filter(bar => bar.checkVisibility()).map(bar => bar.closest('header') ?? bar);
          return bars.length > 0 && bars.every(bar => title.top >= bar.getBoundingClientRect().bottom + 8);
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
        await client.capture(resolve('packages/bb-studio/assets/recordings-staged-mobile.png'));
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
  },
  {
    // Recording a call: the picker (after the one-time notice), then the red
    // bar over the recording's page while the Me / Them transcript fills in.
    // The staged BB's helper is the stub (scripts/staged-bb.mjs), which plays
    // a short made-up call in fake mode: no tap, no mic, no prompt.
    id: "talk-call",
    packageDir: "bb-studio",
    fileName: "recordings-call.png",
    privateSidebar: true,
    setup: async (client) => {
      let recordingId = null;
      const cleanup = async () => {
        const { active } = await talkRpc("call_status", null).catch(() => ({ active: null }));
        if (active) await talkRpc("call_stop", { id: active.recordingId }).catch(() => {});
        if (recordingId) await talkRpc("recording_delete", { id: recordingId }).catch(() => {});
      };
      try {
        const sources = await talkRpc("call_sources", null);
        if (!sources.supported || !sources.apps.some((app) => app.name === "zoom.us")) {
          throw new Error(`The staged BB has no fake call helper: ${JSON.stringify(sources)}. Start it with scripts/staged-bb.mjs.`);
        }
        await client.navigate("/plugins/studio/studio");
        await client.waitForSelector("[data-studio-bar]", 30000);
        await client.evaluate(`window.dispatchEvent(new CustomEvent("bb-studio:talk:new-call"))`);
        if ((await talkRpc("call_status", null)).consented === false) {
          await client.waitForText("Before you record a call");
          await client.waitForText("Heads up: I'm recording this call");
          await client.clickButtonText("I understand");
        }
        await client.waitForText("Record a call");
        await client.waitForText("All system audio");
        await client.waitForText("Record my microphone");
        const picker = await client.evaluate(`document.querySelector('[role="radiogroup"][aria-label="Call audio source"]')?.innerText ?? ""`);
        for (const label of ["zoom.us", "Google Chrome", "Playing", "FaceTime"]) {
          if (!picker.includes(label)) throw new Error(`The call picker is missing ${label}: ${picker}`);
        }
        await client.evaluate(`[...document.querySelectorAll('[role="radiogroup"] label')].find((row) => row.textContent.includes('zoom.us'))?.querySelector('input').click()`);
        await sleep(300);
        await client.capture(resolve("packages/bb-studio/assets/recordings-call-picker.png"));
        await client.clickButtonText("Start recording");
        await client.waitForSelector("[data-call-bar]", 20000);
        recordingId = (await talkRpc("call_status", null)).active?.recordingId ?? null;
        if (!recordingId) throw new Error("Start recording didn't start a call.");
        await client.waitForText("Recording call: zoom.us");
        // The stub's call takes about 8 seconds; wait for its last turn.
        await client.waitForText("book a follow-up for the week after launch", 30000);
        await client.waitForText("where your mic picked up the others");
        const transcript = await client.evaluate(`[...document.querySelectorAll('[aria-label="Call transcript"] section')].map((turn) => turn.innerText.replace(/\\s+/g, " ").trim())`);
        const expected = [
          ["Them", "launch date for the iOS app"],
          ["Me", "ship on the twelfth"],
          ["Them", "release notes by Friday"],
          ["Me", "share the page with you"],
          ["Them", "follow-up for the week after launch"],
        ];
        if (transcript.length !== expected.length || expected.some(([who, words], index) => !transcript[index]?.startsWith(who) || !transcript[index].includes(words))) {
          throw new Error(`The call transcript isn't the expected Me / Them turns: ${JSON.stringify(transcript)}`);
        }
        const bar = await client.evaluate(`document.querySelector('[data-call-bar]').innerText`);
        if (!/Recording call: zoom\.us · 0:\d\d/.test(bar) || !bar.includes("Stop")) throw new Error(`The recording bar is wrong: ${bar}`);
        const { recording } = await talkRpc("recording_get", { id: recordingId });
        if (recording.call?.app !== "zoom.us" || recording.status !== "recording") throw new Error(`The call recording is wrong: ${JSON.stringify(recording)}`);
        // The bar stays on other screens too.
        await client.navigate("/settings/plugins/studio");
        await client.waitForSelector("[data-call-bar]");
        await client.waitForText("Call transcription");
        await client.navigate(`/plugins/studio/studio/recordings/${recordingId}`);
        await client.waitForText("follow-up for the week after launch", 30000);
        await client.evaluate(scrollToTop);
        await sleep(500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    // The library filtered to recordings, with the banner for audio this
    // device kept unsent. The piece is set aside in the browser's store the
    // way the uploader leaves one the server refused.
    id: "talk-unsent",
    packageDir: "bb-studio",
    fileName: "recordings-unsent.png",
    privateSidebar: true,
    setup: async (client) => {
      const recordingId = await seedTalkRecording(projectId, { transcribe: false, title: "Standup on the train" });
      const outbox = (body) => `new Promise((done, fail) => {
        const req = indexedDB.open("bb-plugin-talk", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("segments", { keyPath: ["recordingId", "sessionId", "index"] });
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction("segments", "readwrite");
          const store = tx.objectStore("segments");
          ${body}
          tx.oncomplete = () => { req.result.close(); done(true); };
          tx.onerror = () => fail(tx.error);
        };
      })`;
      const key = { recordingId, sessionId: "unsentseed1", index: 0 };
      const cleanup = async () => {
        await client.evaluate(outbox(`store.delete([${JSON.stringify(recordingId)}, "unsentseed1", 0]);`)).catch(() => {});
        await talkRpc("recording_delete", { id: recordingId }).catch(() => {});
      };
      try {
        await client.navigate("/plugins/studio/studio");
        await client.waitForSelector("[data-studio-workspace]", 30000);
        const segment = { ...key, startedAt: Date.now() - 5 * 60_000, mimeType: "audio/webm;codecs=opus", lastPartAt: Date.now() - 5 * 60_000, durationMs: 21_000, complete: true, rejected: "The server refused this piece: durationMs is longer than 10 minutes.", parts: [] };
        await client.evaluate(outbox(`store.put({ ...${JSON.stringify(segment)}, parts: [new Uint8Array(48000).buffer] });`));
        // A fresh load reads the store, as after a refusal and a reload.
        await client.navigate("/plugins/studio/studio/recordings");
        await client.waitForSelector("[data-talk-unsent-notice]", 30000);
        await client.waitForText("A piece of audio couldn't be uploaded and is kept on this device.");
        await client.waitForText("Standup on the train");
        const filtered = await client.evaluate(`[...document.querySelectorAll('button, [role="combobox"]')].some((each) => /Recordings?/.test(each.textContent ?? ""))`);
        if (!filtered) throw new Error("The library isn't filtered to recordings.");
        // Review opens the unsent-audio page, which lists the piece; then back to the library for the frame.
        await client.clickButtonText("Review");
        await client.waitForText("Unsent audio");
        await client.waitForSelector('[data-studio-workspace-tabs] button[aria-label="Close Unsent audio"]');
        await client.waitForText("durationMs is longer than 10 minutes");
        // Close the unsent-audio tab Review opened, back to the filtered library.
        await client.evaluate(`document.querySelector('button[aria-label="Close Unsent audio"]')?.click()`);
        await client.navigate("/plugins/studio/studio/recordings");
        await client.waitForSelector("[data-talk-unsent-notice]", 30000);
        const tabs = await client.evaluate(`[...document.querySelectorAll('[data-studio-workspace-tabs] [role="tab"]')].map((tab) => tab.textContent.trim())`);
        if (tabs.some((tab) => /unsent/i.test(tab))) throw new Error(`The unsent-audio tab stayed open: ${JSON.stringify(tabs)}`);
        await sleep(500);
      } catch (error) {
        await client.capture(`${process.env.TMPDIR ?? "/tmp/"}talk-unsent-error.png`);
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
];

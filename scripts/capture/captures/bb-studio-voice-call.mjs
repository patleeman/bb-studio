// Voice calls with the Bot (packages/bb-studio/src/voice/call), with no
// OpenAI call: the capture seeds a call row in the staged Studio's database
// and hands the page a fake Realtime transport (the call bar's staging hook,
// window.__studioVoiceCallFixture). Everything else is real: the header's
// Call button starts it, the bar reports transcripts and usage to the real
// voice_call_event (so the cost is the server's estimate), send_to_bot posts
// to the Bot's chat through voice_call_tool, and End runs voice_call_end,
// which saves the record page and posts the line in the chat.
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../../../packages/bb-studio/package.json", import.meta.url));
const BOT = { name: "Dot", avatar: "🫧", shape: "blob", color: "#5b8def" };
const SENT = "Reply with one short sentence: you'll check the ORBIT-42 launch checklist for blockers after the call.";

/** The staged Studio's database: the server keeps it open in WAL mode, so a second writer is fine. */
function seedCall({ botId, botName, threadId, startedAt }) {
  const Database = require("better-sqlite3");
  const db = new Database(join(process.env.BB_DATA_DIR, "plugins", "studio", "data.db"));
  try {
    const id = `vc_${randomBytes(8).toString("hex")}`;
    db.prepare("INSERT INTO voice_calls (id, bot_id, bot_name, thread_id, model, voice, transcribe_model, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, botId, botName, threadId, "gpt-realtime-2.1", "marin", "gpt-4o-mini-transcribe", startedAt);
    return id;
  } finally {
    db.close();
  }
}

/** The page's fake transport: scripted server events, and levels that make the voice look like it's talking. */
const fixtureScript = (callId, botName) => `(() => {
  let listener = () => {};
  const emit = (event) => listener(event);
  const usage = (audioOut, audioIn) => ({ input_token_details: { text_tokens: 2100, audio_tokens: audioIn, cached_tokens: 1600, cached_tokens_details: { text_tokens: 1600, audio_tokens: 0 } }, output_token_details: { text_tokens: 60, audio_tokens: audioOut } });
  window.__studioVoiceCallFixture = {
    callId: ${JSON.stringify(callId)},
    botName: ${JSON.stringify(botName)},
    transport: {
      send: () => {},
      onEvent: (next) => {
        listener = next;
        // After the session subscribes: the start of the call, as OpenAI would send it.
        setTimeout(() => {
          emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Hey Dot, what needs me before Friday's launch?", usage: { type: "tokens", input_tokens: 90, output_tokens: 14 } });
          emit({ type: "response.created" });
          emit({ type: "response.output_audio_transcript.done", transcript: "Two things: the release notes are waiting on your review, and the launch checklist still has one open item." });
          emit({ type: "response.done", response: { usage: usage(1900, 260) } });
          emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "Can you have the Bot check the checklist for blockers?", usage: { type: "tokens", input_tokens: 80, output_tokens: 12 } });
          emit({ type: "response.created" });
          emit({ type: "response.function_call_arguments.done", call_id: "call_fixture_1", name: "send_to_bot", arguments: JSON.stringify({ message: ${JSON.stringify(SENT)} }) });
          emit({ type: "response.done", response: { usage: usage(300, 220) } });
          emit({ type: "response.created" });
          emit({ type: "response.output_audio_transcript.done", transcript: "On it. I've asked Dot to check the checklist." });
          emit({ type: "response.done", response: { usage: usage(1200, 0) } });
          // The voice is talking again when the bar is captured.
          emit({ type: "response.created" });
        }, 300);
      },
      onClose: () => {},
      setMic: () => {},
      levels: () => ({ mic: 0, voice: 0.35 + 0.3 * Math.abs(Math.sin(Date.now() / 140)) }),
      close: () => {},
    },
  };
  return true;
})()`;

export default ({ projectId, threadId, pluginRpc, bbCli, sleep }) => {
  let callId = null;
  let botName = BOT.name;
  let botThread = threadId;
  let chatPath = null;
  return [
    {
      id: "studio-voice-call-bar",
      packageDir: "bb-studio",
      fileName: "voice-call-bar.png",
      privateSidebar: true,
      setup: async (client) => {
        // A Bot with its own chat, as the Bot capture makes it (one short agent turn in the staged BB).
        let { bot } = await pluginRpc("studio", "bot_get", {});
        if (!bot) {
          ({ bot } = await pluginRpc("studio", "bot_create", { ...BOT, prompt: "Hi Dot. In one short sentence, say you'll keep an eye on the ORBIT-42 launch and tell me what needs me." }));
        }
        await bbCli(["thread", "wait", bot.threadId, "--status", "idle", "--timeout", "180"]).catch(() => {});
        botName = bot.name;
        botThread = bot.threadId;
        // The personal project's threads open at /threads/<id>.
        const botProject = JSON.parse(await bbCli(["thread", "show", botThread, "--json"])).thread.projectId;
        chatPath = botProject === "proj_personal" ? `/threads/${botThread}` : `/projects/${botProject}/threads/${botThread}`;
        callId = seedCall({ botId: bot.id, botName, threadId: botThread, startedAt: Date.now() - 4 * 60_000 });
        await client.navigate(chatPath);
        await client.waitForSelector("[data-testid=voice-call-button]", 30_000);
        await client.evaluate(fixtureScript(callId, botName));
        await client.evaluate(`(() => { document.querySelector("[data-testid=voice-call-button]").click(); return true; })()`);
        await client.waitForSelector("[data-testid=voice-call-bar][data-state=live]");
        // The bar shows the call: the Bot's name, the timer running, the voice speaking, and the server's cost.
        const timer = await client.poll(`document.querySelector("[data-testid=voice-call-timer]")?.textContent ?? ""`);
        if (!/^\d+:\d\d$/.test(timer)) throw new Error(`The call bar's timer reads ${JSON.stringify(timer)}.`);
        const cost = await client.poll(`document.querySelector("[data-testid=voice-call-cost]")?.textContent ?? ""`);
        for (let tries = 0; tries < 40; tries++) {
          const text = await client.poll(`document.querySelector("[data-testid=voice-call-cost]")?.textContent ?? ""`);
          if (/≈\$0\.(?!00)\d\d/.test(text)) break;
          if (tries === 39) throw new Error(`The call bar's cost didn't come from the server (still ${JSON.stringify(text || cost)}).`);
          await sleep(250);
        }
        const speaker = await client.poll(`document.querySelector("[data-testid=voice-call-speaker]")?.textContent ?? ""`);
        if (speaker !== "Speaking") throw new Error(`The call bar should show the voice speaking, not ${JSON.stringify(speaker)}.`);
        // send_to_bot went through the real tool: the chat has the call's message.
        await client.waitForText("📞 From the call:", 20_000);
        // A few seconds on the clock.
        await sleep(4000);
      },
    },
    {
      id: "studio-voice-call-record",
      packageDir: "bb-studio",
      fileName: "voice-call-record.png",
      privateSidebar: true,
      setup: async (client) => {
        if (!callId) throw new Error("Capture studio-voice-call-bar first: it starts the call this one ends.");
        await client.evaluate(`(() => { document.querySelector("[data-testid=voice-call-end]").click(); return true; })()`);
        await client.waitForText("Transcript", 20_000);
        const record = await pluginRpc("studio", "voice_call_get", { callId });
        if (!record.endedAt || !record.pageId || record.transcript.length < 4 || record.sent.length !== 1 || !(record.costUsd > 0)) {
          throw new Error(`The call's record is incomplete: ${JSON.stringify(record).slice(0, 400)}`);
        }
        // The line in the chat waits behind the Bot's reply to what the call sent, then gets its [PASS].
        await bbCli(["thread", "wait", botThread, "--status", "idle", "--timeout", "180"]).catch(() => {});
        await sleep(3000);
        await bbCli(["thread", "wait", botThread, "--status", "idle", "--timeout", "180"]).catch(() => {});
        await client.navigate(chatPath);
        await client.waitForText("sent you 1 message", 120_000);
        const line = await client.poll(`document.body.innerText.match(/Call · \\d+ min · ≈\\$\\d+\\.\\d\\d · sent you 1 message · Transcript/)?.[0] ?? ""`);
        if (!line) throw new Error("The chat's call line should read Call · N min · ≈$X · sent you 1 message · Transcript.");
        await sleep(800);
      },
    },
    {
      id: "studio-voice-call-transcript",
      packageDir: "bb-studio",
      fileName: "voice-call-transcript.png",
      privateSidebar: true,
      setup: async (client) => {
        if (!callId) throw new Error("Capture studio-voice-call-bar first.");
        const record = await pluginRpc("studio", "voice_call_get", { callId });
        await client.navigate(`/plugins/studio/studio/pages/${record.pageId}`);
        await client.waitForText(`Call with ${botName}`, 30_000);
        await client.waitForText("Hey Dot, what needs me before Friday's launch?", 15_000);
        await client.waitForText(`Sent to ${botName}`, 5_000);
      },
    },
  ];
};

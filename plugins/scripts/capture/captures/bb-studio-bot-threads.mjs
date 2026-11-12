// Threads on a Bot's replies (src/ui/bot/reply-in-thread.ts): the Bot's chat
// with "Reply in thread" under each of its replies and none under yours, one
// reply with a side thread of two replies ("💬 2 replies"); then the last
// reply's Reply in thread clicked, its new side thread open beside the chat.
// Seeds its own Bot when the staged BB has none: a chat of three replies, and
// a side thread on the second, answered twice. The click forks the chat
// through side-chat, so run it on a throwaway staging.
import { serverUrl } from "../bb.mjs";

const REPLY = "[data-studio-reply-in-thread]";
const ASKS = [
  "What's left before Friday's ORBIT-42 release? Two short bullet points, please.",
  "And who owns the launch checklist? One sentence.",
];
const SIDE_ASKS = ["Which of those two is riskier? One sentence.", "Thanks. Say who to ask, in one sentence."];

export default ({ pluginRpc, bbCli, sleep }) => {
  const wait = (threadId) => bbCli(["thread", "wait", threadId, "--status", "idle", "--timeout", "240"]).catch(() => {});
  const timeline = async (threadId) => {
    const response = await fetch(`${serverUrl}/api/v1/threads/${threadId}/timeline?segmentLimit=40`);
    return ((await response.json()).rows ?? []).filter((row) => row.kind === "conversation" && row.role === "assistant" && row.text?.trim());
  };

  /** A Bot chat of three replies, the second with a two-reply side thread. */
  const seeded = async () => {
    let { bot } = await pluginRpc("studio", "bot_get", {});
    if (!bot) ({ bot } = await pluginRpc("studio", "bot_create", { name: "Dot", avatar: "🟣", shape: "blob", color: "#7c66dc", prompt: "Hi Dot. In one short sentence, say you will keep an eye on the ORBIT-42 launch." }));
    await wait(bot.threadId);
    let replies = await timeline(bot.threadId);
    for (const ask of ASKS.slice(Math.max(0, replies.length - 1))) {
      await bbCli(["thread", "tell", bot.threadId, ask]);
      await wait(bot.threadId);
    }
    replies = await timeline(bot.threadId);
    if (replies.length < 3) throw new Error(`The Bot's chat has ${replies.length} replies, not 3`);
    let { threads } = await pluginRpc("studio", "bot_side_threads", { threadId: bot.threadId });
    if (!threads.some((thread) => thread.replies >= 2)) {
      const { threadId } = await pluginRpc("studio", "bot_side_thread_open", { threadId: bot.threadId, messageId: replies[1].id });
      for (const ask of SIDE_ASKS) {
        await bbCli(["thread", "tell", threadId, ask]);
        await wait(threadId);
      }
      for (let i = 0; i < 20 && !threads.some((thread) => thread.replies === 2); i++) {
        await sleep(1000);
        ({ threads } = await pluginRpc("studio", "bot_side_threads", { threadId: bot.threadId }));
      }
      if (!threads.some((thread) => thread.replies === 2)) throw new Error("The side thread didn't count two replies");
    }
    return { bot, replies, threads };
  };

  /** The chat, with a footer under every reply of its own and none under yours. */
  const showChat = async (client) => {
    const fixture = await seeded();
    await client.navigate(`/threads/${fixture.bot.threadId}`);
    await client.waitForText("2 replies", 30000);
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const rows = [...document.querySelectorAll("[data-timeline-row-id]")];
        const replies = rows.filter((row) => row.getAttribute("data-timeline-row-id").startsWith("${fixture.bot.threadId}:assistant:"));
        const withButton = replies.filter((row) => row.querySelector('${REPLY}')?.textContent === "Reply in thread" && row.querySelector('${REPLY}').getBoundingClientRect().height > 0);
        const onYours = rows.filter((row) => row.getAttribute("data-timeline-row-id").includes(":user-seed:") && row.querySelector('${REPLY}'));
        const count = [...document.querySelectorAll("[data-studio-side-thread]")].filter((row) => /^💬 2 replies/.test(row.textContent));
        if (replies.length >= 3 && withButton.length === replies.length && !onYours.length && count.length === 1) return resolve(true);
        if (Date.now() - started > 30000) return reject(new Error("Reply in thread isn't under each of the Bot's replies only, or the 2 replies row is missing: " + JSON.stringify({ replies: replies.length, withButton: withButton.length, onYours: onYours.length, count: count.length })));
        setTimeout(tick, 250);
      };
      tick();
    }))()`, true);
    await sleep(800);
    return fixture;
  };
  // A setup's return value is its cleanup.
  const chat = async (client) => { await showChat(client); };

  /** Reply in thread on the last reply, a real pointer click: its side thread opens beside the chat. */
  const opened = async (client) => {
    const { bot } = await showChat(client);
    const before = (await pluginRpc("studio", "bot_side_threads", { threadId: bot.threadId })).threads.length;
    const point = await client.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('${REPLY}')];
      const last = buttons.at(-1);
      last.scrollIntoView({ block: "center" });
      const rect = last.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id: last.closest("[data-timeline-row-id]").getAttribute("data-timeline-row-id") };
    })()`);
    const lastId = point.id;
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await client.command("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
    }
    let side = null;
    for (let i = 0; i < 40 && !side; i++) {
      await sleep(500);
      const { threads } = await pluginRpc("studio", "bot_side_threads", { threadId: bot.threadId });
      if (threads.length > before) side = threads.find((thread) => thread.messageId === lastId);
    }
    if (!side) throw new Error("Reply in thread made no side thread on the last reply");
    // Its chat shows beside the Bot's, from the fork's history: rows carrying its own id.
    await client.evaluate(`(() => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (document.querySelector('[data-timeline-row-id^="${side.threadId}:"]')) return resolve(true);
        if (Date.now() - started > 30000) return reject(new Error("The new side thread didn't open beside the chat"));
        setTimeout(tick, 250);
      };
      tick();
    }))()`, true);
    await sleep(2500);
  };

  return [
    { id: "studio-bot-reply-in-thread", packageDir: "bb-studio", fileName: "bot-reply-in-thread.png", setup: chat },
    { id: "studio-bot-reply-in-thread-open", packageDir: "bb-studio", fileName: "bot-reply-in-thread-open.png", setup: opened },
  ];
};

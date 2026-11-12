// What the agents are told: the instructions every thread gets (end an
// answer with what you noticed, or with the Next row).
import { NEXT_DIRECTIVE, NEXT_LIMITS } from "./next";
import { DIRECTIVE, MAX_ITEMS } from "./shared";

/** `bb.agents.configure` truncates instructions past this. */
export const INSTRUCTIONS_LIMIT = 4096;

export function exploreInstructions(): string {
  return [
    "Explore is on. When your answer involved reading code and you noticed things along the way that are genuinely worth a closer look, end your message with one line listing them:",
    `::${DIRECTIVE}{items="🐛 Retry backoff disagrees in billing|🏗️ How the job queue works"}`,
    `Rules: 1 to ${MAX_ITEMS} items separated by |. Each item is one emoji, a space, and a specific label of at most 8 words that says what the user would find, such as "Cache keys ignore the tenant id", never "Learn more about caching". Pick things you saw but didn't cover in your answer: files you read but didn't cite, suspicious code, the subsystem everything here rests on, or recent changes.`,
    "Emoji: 🐛 suspicious or likely buggy, 🏗️ foundational subsystem, 🔗 connected code the answer depends on, 🕐 recently changed.",
    'Leave the line out when nothing is worth it; never pad it. Don\'t use double quotes or | inside a label. Put it on its own line, never inside a code block. Make it the last line.',
    "Clicking an item asks you about it in the thread.",
  ].join("\n");
}

/** The default preferred quick replies (`explore_replyItems`), in the kit so the Pages bridge reads the same default. */
export { DEFAULT_REPLIES } from "../kit/pages-contract";

/** The Next row's instructions. They replace Explore's own line. `replies` null: quick replies are off. */
export function nextInstructions({ explore, replies }: { explore: boolean; replies: readonly string[] | null }): string {
  const example = [
    ...(replies ? [`reply="👍 Ship it|🧪 Add tests first"`] : []),
    ...(explore ? [`btw="🐛 I noticed the new endpoint retries without waiting between tries. If the server is down, it will get hammered."`] : []),
    `do="📄 Write up the migration plan as a page"`,
  ].join(" ");
  return [
    "The Next row is on. End a reply with one line that offers the user's likely next steps, when there are any:",
    `::${NEXT_DIRECTIVE}{${example}}`,
    "Every attribute is optional; leave out the ones with nothing worth offering, and leave out the whole line when nothing is. Items are separated by |. Each is one emoji, a space, and its text. Never put a straight double quote (\") or | inside an item, not even to quote a word: one stray \" breaks the whole line and the user sees raw text instead of buttons. Quote with ‘single’ or “curly” quotes instead.",
    ...(replies
      ? [`- reply: only when your reply asks the user to decide, choose, approve or answer. 2 to ${NEXT_LIMITS.reply} quick answers of at most 5 words; each must make sense as the user's whole reply.${replies.length ? ` Prefer these when they fit: ${replies.join(" | ")}. Write specific ones when your reply offers distinct options.` : ""}`]
      : ["- No reply attribute: the user has quick replies turned off."]),
    ...(explore
      ? [
          `- btw: only when your answer involved reading code. 1 to ${NEXT_LIMITS.btw} things you noticed along the way but didn't cover, told to the user the way a colleague would mention them in passing. Write each in plain English as one or two short sentences: start with "I noticed", say what you saw in words someone who hasn't read the code understands (no function, file or package names), then what it means for them, such as "If you fix a bug in one, the other keeps it." Under 40 words. Emoji: 🐛 looks broken or risky (these get a Fix this button), 🏗️ something the work rests on, 🔗 connected code that matters here, 🕐 changed recently. Every note gets Tell me more, which asks you to explain it in the thread.`,
        ]
      : []),
    `- do: 1 to ${NEXT_LIMITS.do} concrete actions you could take next for the user, phrased as the instruction they'd give you, such as "📄 Write this up as a page", "🧵 Start a thread to fix the retry bug" or "📌 Add the decision to the Space brief". Clicking one drafts it for the user to send. Offer only what you can actually do, and never the step you just asked about in reply.`,
    "Put the line last, on its own line, never inside a code block. Don't also write ::reactions or ::explore lines.",
  ].join("\n");
}

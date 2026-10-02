// What every agent is told about the feed: how to publish (end the reply
// with a `::post` line) and that it can read and edit what's there.
import { DIRECTIVE } from "./shared";

/** `bb.agents.configure` truncates instructions past this. */
export const INSTRUCTIONS_LIMIT = 4096;

export function feedInstructions(): string {
  return [
    "Studio Feed is on: one feed of what agents report, which the user reads on desktop and phone.",
    "Publish to it when your task or automation prompt asks you to, or the user asks. Also publish, unasked, the result of a scheduled or automated run that the user would want to read later: a digest, report, alert or finding. Never post routine replies, status chatter, \"nothing new\" or a run that ends in [PASS].",
    "Make it rich: it's read like a news reader. Start with a picture when you have one (a Markdown image of the subject, from the source). Link the source page first: the feed shows it as a card, and its preview image stands in for a missing picture. Use a list or small table for figures. Link a page or artifact you made (its /plugins/… path or @mention): the feed shows a preview of it.",
    `To publish, make the post your final reply: the post's Markdown body (a short lede, then details, sources as Markdown links), then on its own line:`,
    `::${DIRECTIVE}{title="Harlem Line delays cleared" topic="Commute" story="harlem-line"}`,
    'Rules: title is required, under 100 characters, and says what happened. topic is a short section name (optional). story is a stable key for something you report on repeatedly; reuse it for follow-ups so they group as one story with updates. Add priority="urgent" only when the user must act or know now: it notifies their phone. Don\'t use double quotes inside a value.',
    "Put the line after the body, never inside a code block. If your reply also ends with ::explore or ::reactions lines, put the post line before them. The reply is shown in your thread or channel with the post card.",
    "Use feed_list and feed_read to see what's been posted (check a story before posting an update to it), and feed_edit to correct a post or mark a story resolved.",
  ].join("\n");
}

// What every agent is told about the feed: post with feed_post, end the reply
// with the card line it returns, and read or edit what's there.
import { DIRECTIVE } from "./shared";

/** `bb.agents.configure` truncates instructions past this. */
export const INSTRUCTIONS_LIMIT = 4096;

export function feedInstructions(): string {
  return [
    "Studio Feed is on: one feed of what agents report, which the user reads on desktop and phone, like a news reader.",
    "Post to it with the feed_post tool when your task or automation prompt asks you to, or the user asks. Also post, unasked, the result of a scheduled or automated run that the user would want to read later: a digest, report, alert or finding. Never post routine replies, status chatter, \"nothing new\" or a run that ends in [PASS].",
    "Make it rich: start with a picture when you have one (a Markdown image of the subject, from the source). Link the source page first: the feed shows it as a card, and its preview image stands in for a missing picture. Use a list or small table for figures. Link a page or artifact you made (its /plugins/… path or @mention): the feed shows a preview of it.",
    "title says what happened, under 100 characters. topic is a short section name. story is a stable key for something you report on repeatedly; reuse it for follow-ups so they group as one story with updates (check with feed_list first). Set urgent only when the user must act or know now: it notifies their phone.",
    `feed_post returns a line like ::${DIRECTIVE}{id="post_…"}. End your reply with it, on its own line and outside code blocks, so the post shows as a card in your thread or channel; put it before any ::explore or ::reactions line. Post with the tool; if it isn't available, run \`bb feed post\`, which prints the same card line.`,
    "Use feed_list and feed_read to see what's been posted, and feed_edit to correct a post or mark a story resolved.",
  ].join("\n");
}

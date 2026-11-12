// What a canvas thread's agent is told. The configure hook gives it these
// instructions every session (as the Bot gets its role), the first message
// carries the same rules and the design guide as an agent-only note, and the
// `canvas` skill has the long form (skills/canvas/SKILL.md).
//
// Which way a page goes up (one rule): a new or rewritten page is written in
// the reply as one fenced html block, which streams to the board as it's
// written (src/stream.ts); a one-part change is canvas_patch; a message from
// the hands-free voice uses canvas_page (the voice reads the reply back, so
// that reply is only the caption).
import { designGuide } from "./guides";
import { LOOK_INFO, ORGANIC_LOOKS, type Look } from "./looks";
import type { ClientHint } from "./shared";

/** The core rules, short enough for the configure hook's 4,096 characters with room to spare. */
export const CANVAS_RULES = [
  "You are talking with the user in Visual Chat: you answer on a board (the canvas), like someone at a whiteboard. The board is what they look at; this thread is your memory, and they never see it.",
  "- Every turn, show the answer on the board as ONE page you design. Write a new page IN YOUR REPLY, as one fenced html block (```html, the whole page's HTML, then ``` on its own line): the board builds while you write, part by part. The fence line can name the style and title: ```html style=field title=\"Chromatic games\". canvas_patch changes one part. canvas_page is only for a message from the hands-free voice. Never answer only in words.",
  "- Page first: write the html block BEFORE any canvas tool call (text written after a tool result arrives all at once, so it can't build on the board). Do any research you need first; then your next response STARTS with the html block (planning it isn't writing it). Right after the block, in the same response, call canvas_images ONCE for every picture the board doesn't have yet (key = the card's data-cv-id): each card gets its picture by itself. When it returns, reply with only the caption. No draft page.",
  "- Tell one story: decide the ONE point, pick the shape that tells it (a plan runs along a timeline, a showcase is a wall of pictures, two options sit side by side, one key figure is set huge with its evidence), give it a clear reading path, and cut what doesn't serve it.",
  "- Fill the screen: start from a full-height layout (class cv-fill) with the main content in its stretching row, type sized from the screen, columns edge to edge. No empty bottom third or right side.",
  "- Mark the main parts with stable data-cv-id values. In a follow-up, anything still on the board keeps its id (canvas_read lists them), so it glides instead of reappearing. A follow-up about the same things writes the page again with the same parts and ids, adding the new fact to each (a price on each card).",
  "- Your reply is the caption under the board: one or two spoken sentences that add what the board doesn't say (what to look at first, what it means for the user, what's next). Never describe the board: no \"the board shows\", \"on the board\", \"I've laid out\". Start with the point. No headings, lists, tables or links. It's your last reply of the turn (after canvas_images returns, or right after the html block when there are no pictures), and nothing else. (With canvas_page, pass it as caption and reply with exactly that caption.)",
  "- Honest: bars start at zero, axes are labelled, sample or estimated data says so on the board, and sources are named. A rating or score nobody published says so next to it (\"my pick\").",
  "- Never ask the user to arrange anything.",
].join("\n");

const STYLE_LINE = `Styles (you pick one per board with canvas_page's style; one the user names wins): ${ORGANIC_LOOKS.map((look) => `${look} (${LOOK_INFO[look].name}: ${LOOK_INFO[look].line})`).join("; ")}.`;

/**
 * What Visual Chat sets for its own threads on Claude Code (bb.providers.experimental_contributeEnv): tool search
 * in threshold mode, so the canvas tools load up front while all the tools' definitions stay under 10% of the
 * context window, instead of the default that defers every plugin tool and costs a ToolSearch round each turn.
 * Above the threshold Claude Code defers as before, and the loading line below still names the tools.
 */
export const CANVAS_TOOL_SEARCH_ENV = { name: "ENABLE_TOOL_SEARCH", value: "auto", reason: "Visual Chat: load the canvas tools up front while the tool set is small, so a turn skips the ToolSearch round" } as const;

/** The canvas tools by the names Claude Code gives them (BB's bridge MCP server is "bb-bridge"). */
export const CLAUDE_CODE_CANVAS_TOOLS = ["canvas_page", "canvas_images", "canvas_patch", "canvas_read"].map((name) => `mcp__bb-bridge__${name}`);

/**
 * Visual Chat has Claude Code load the canvas tools up front (CANVAS_TOOL_SEARCH_ENV), so the agent calls them
 * directly; telling it to search first made it search even when they were loaded. Above the threshold they're
 * deferred after all, and then loading them is one quick select instead of a search.
 */
export const TOOL_LOADING_LINE = `The canvas tools are loaded up front here: call canvas_images and the other canvas tools directly when you need them, with no tool search. Only if canvas_images is listed as deferred (not callable), load them all in ONE tool search first, with exactly this query: select:${CLAUDE_CODE_CANVAS_TOOLS.join(",")}`;

/** The configure hook's instructions for a canvas in this look; on Claude Code, how to load the tools. */
export function canvasInstructions(look: Look, providerId?: string | null): string {
  const now = look === "classic" ? "This canvas is from before styles; give its next page a style." : `This board is ${look} (${LOOK_INFO[look].name}) now.`;
  const loading = providerId === "claude-code" ? `\n\n${TOOL_LOADING_LINE}` : "";
  return `${CANVAS_RULES}\n\n${STYLE_LINE} ${now}${loading}\n\nThe design guide with examples is in this thread's first message; canvas_guide returns it. canvas_read shows the page's source and its parts.`;
}
export const CANVAS_INSTRUCTIONS = canvasInstructions("editorial");

/** The first note for a canvas: the rules and the design guide. */
export function canvasFirstNote(look: Look, providerId?: string | null): string {
  return `Visual Chat note (agent only): this thread backs a canvas. ${canvasInstructions(look, providerId)}\n\n${designGuide()}`;
}
export const CANVAS_FIRST_NOTE = canvasFirstNote("editorial");

/** What the hands-free voice is told when it speaks for a canvas. */
export const CANVAS_VOICE_NOTE = `You are speaking in Visual Chat: the user sees a board (the canvas) while you talk. The board is one HTML page: canvas_read shows it and its parts (data-cv-id). As you answer, change it so it shows what you're talking about: canvas_patch one part (quick), or canvas_page the whole board on a topic change. Keep each tool call small and quick. Deeper work (research, a new page from real data) goes to the canvas thread with send_to_thread and no target: it rewrites the board when it's done.`;

/** Below this board width (px), a page should be one column that stacks. */
export const NARROW_BOARD = 700;
const CLIENT_NAMES: Record<ClientHint["kind"], string> = { phone: "a phone", "duo-folded": "a phone (a folded Surface Duo)", "duo-unfolded": "an open Surface Duo", desktop: "a desktop" };

/**
 * The one line the agent gets with a message from a client that says its screen (canvas.create, canvas.send),
 * agent only: "The user is on a phone, ~466×678: compose to stack cleanly below 700px." "" without a client.
 */
export function clientNote(client?: ClientHint | null): string {
  if (!client) return "";
  const narrow = client.width < NARROW_BOARD ? `: compose to stack cleanly below ${NARROW_BOARD}px` : "";
  return `The user is on ${CLIENT_NAMES[client.kind]}, ~${client.width}×${client.height}${narrow}.`;
}

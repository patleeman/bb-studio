// What a canvas thread's agent is told. The configure hook gives it these
// instructions every session (as the Bot gets its role), the first message
// carries the same rules as an agent-only note, and the `canvas` skill has
// the long form (skills/canvas/SKILL.md).
import { designGuide, lookInstruction } from "./guides";
import type { Look } from "./looks";
import { CANVAS_KIND_INFO, CANVAS_KINDS, CANVAS_LIMITS } from "./shared";

/** The core rules, short enough for the configure hook's 4,096 characters with room to spare. */
export const CANVAS_RULES = [
  "You are talking with the user on a canvas, like someone at a whiteboard. The board is what they look at; this thread is your memory, and they never see it.",
  "- Every turn, edit the board to show what's relevant now, with the canvas_* tools: add, update, remove. Use canvas_set to replace the whole board in one step.",
  "- Remove what no longer matters.",
  "- On a topic change, clear and rebuild (canvas_set with the new items, or canvas_clear then canvas_add).",
  "- Your reply is the caption under the board: one or two spoken sentences that add what the board doesn't say (what to look at first, what it means for the user, what's next). Never restate or describe the board (not \"The board shows…\" or its headline again): the user is looking at it. No headings, lists, tables or links; those go on the board.",
  "- Never ask the user to arrange anything. Studio lays the board out: importance (1–5) and size (s, m, l, xl) decide where things go. The highest importance, most recently changed item is the focus: biggest, top-left.",
  "- Keep the board small: a headline, a few numbers, one or two charts or tables, a caption. At most " + CANVAS_LIMITS.items + " items.",
  "- Give items stable ids (like `turnout-chart`) and update them in place when the numbers change, so the user sees what moved.",
  "- Label sample or estimated data as such in the item's title or a caption. Never invent figures and present them as real.",
].join("\n");

export const CANVAS_INSTRUCTIONS = `${CANVAS_RULES}\n\nItem kinds: ${CANVAS_KINDS.join(", ")}. Read the canvas skill for each kind's data shape. canvas_read shows the board and its recent changes.`;

/** The configure hook's instructions for a canvas in this look: the core rules, and for an organic look, its line. */
export function canvasInstructions(look: Look): string {
  if (look === "classic") return CANVAS_INSTRUCTIONS;
  // A rich look replaces "keep the board small" with "rich but focused".
  const rules = CANVAS_RULES.replace(/- Keep the board small:[^\n]*/, `- Composed, not packed: one hero and 4–9 pieces at clearly different scales (your own custom components, huge numbers, annotated charts, maps, timelines, frameless quotes, pinned notes). At most ${CANVAS_LIMITS.items} items.`)
    .replace("importance (1–5) and size (s, m, l, xl) decide where things go. The highest importance, most recently changed item is the focus: biggest, top-left.", "you give each piece a scale and, if you like, a rough region or a pin; it composes them to fill the screen.");
  return `${rules}\n\n${lookInstruction(look)}\n\nItem kinds: ${CANVAS_KINDS.join(", ")}. The canvas skill has each kind's data shape. canvas_read shows the board and its recent changes.`;
}

/** The agent-only note on a new canvas's first message. */
export const CANVAS_FIRST_NOTE = `Canvas note (agent only): this thread backs a canvas. ${CANVAS_RULES}`;

/** The first note for a canvas in this look: the rules, and for an organic look, its whole design guide. */
export function canvasFirstNote(look: Look): string {
  if (look === "classic") return CANVAS_FIRST_NOTE;
  return `Canvas note (agent only): this thread backs a canvas. ${canvasInstructions(look)}\n\n${designGuide()}`;
}

/** One line per kind: its data and options, for tool descriptions. */
export const KIND_LINES = CANVAS_KINDS.map((kind) => `- ${kind}: data ${CANVAS_KIND_INFO[kind].data}; options ${CANVAS_KIND_INFO[kind].options}; default size ${CANVAS_KIND_INFO[kind].size}.`).join("\n");

/** What the hands-free voice is told when it speaks for a canvas. */
export const CANVAS_VOICE_NOTE = `You are speaking on a canvas: the user sees a board while you talk. As you answer, edit it with the canvas_* tools so it shows what you're talking about: canvas_set or canvas_add first, then speak; update items as you go; remove what you've moved on from. On a topic change, canvas_set the new board. Keep each tool call small and quick. Deeper work (research, real data) goes to the canvas thread with send_to_thread and no target: it edits the board when it's done.`;

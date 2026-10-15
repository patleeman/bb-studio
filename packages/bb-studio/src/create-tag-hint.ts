// Nudges agents to tag what they make: Studio's create tools say to reuse an
// existing tag, and their result names the tags there are. Never tags anything itself.

/** Studio's agent tools that make a new item. */
export const CREATE_TOOLS: ReadonlySet<string> = new Set(["pages_create", "design_create", "dashboard_create", "excalidraw_create_drawing"]);

export const TAG_DESCRIPTION = " If a tag fits, add it with studio_tag_items, reusing an existing tag rather than making a near-duplicate.";
const MAX_NAMES = 12;

/** The line a create tool's result ends with; null when there are no tags yet. */
export function tagHint(names: readonly string[]): string | null {
  if (!names.length) return null;
  const shown = names.slice(0, MAX_NAMES).join(", ");
  return `Existing tags: ${shown}${names.length > MAX_NAMES ? `, +${names.length - MAX_NAMES} more` : ""}.`;
}

type Tool = { name: string; description: string; execute: (input: never, ctx: never) => unknown };

/** The tool with the tag nudge, when it is a create tool; a text result gets the existing tags. */
export function withTagHint<T extends Tool>(tool: T, tagNames: () => readonly string[]): T {
  if (!CREATE_TOOLS.has(tool.name)) return tool;
  return {
    ...tool,
    description: tool.description + TAG_DESCRIPTION,
    execute: async (input: never, ctx: never) => {
      const result = await tool.execute(input, ctx);
      if (typeof result !== "string") return result;
      const hint = tagHint(tagNames());
      return hint ? `${result}\n${hint}` : result;
    },
  };
}

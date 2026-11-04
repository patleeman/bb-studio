// BB Studio Canvas's one BB setting: the Exa API key canvas_image searches
// with. A BB secret (kept in BB's secret store, never sent to a browser);
// the server reads it only to call Exa, and never logs it or puts it in an
// answer or an error. Without it, canvas_image takes a page's main picture.
export const EXA_KEY_SETTING = "exaApiKey";

export const CANVAS_KEY_SETTINGS = {
  [EXA_KEY_SETTING]: { type: "string", label: "Exa API key", description: "Lets the canvas agent search for pictures (box art, covers, product shots) with Exa. Without it, the agent takes the main picture of a page it found.", secret: true, default: "" },
} as const;

/** The key, or "" when none is set. */
export function exaKey(settings: Record<string, unknown> = {}): string {
  const value = settings[EXA_KEY_SETTING];
  return typeof value === "string" ? value.trim() : "";
}

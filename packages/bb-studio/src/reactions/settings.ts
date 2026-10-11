import { DEFAULT_EMOJI_ITEMS } from "./emoji-items";
import { parseQuotePosition } from "./draft";

/** The settings captured by the host's static message-action registrations. */
export function menuSettings(values: Record<string, unknown> = {}) {
  return {
    emojiItems: typeof values.emojiItems === "string" ? values.emojiItems : DEFAULT_EMOJI_ITEMS,
    quoteSelection: values.quoteSelection !== false,
    quotePosition: parseQuotePosition(values.quotePosition),
    showInSelectionMenu: values.showInSelectionMenu !== false,
    showInAssistantBar: values.showInAssistantBar !== false,
    showInUserBar: values.showInUserBar !== false,
  };
}

export type MenuSettings = ReturnType<typeof menuSettings>;

export function needsMenuReload(applied: MenuSettings, saved: MenuSettings): boolean {
  return Object.keys(applied).some((key) => applied[key as keyof MenuSettings] !== saved[key as keyof MenuSettings]);
}

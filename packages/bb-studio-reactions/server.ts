// @bb-studio/emoji-react — backend entry.
//
// Owns the plugin settings: the emoji reaction list shown in the
// assistant-message text-selection menu (a "emoji label" comma-separated
// string, mirroring NeonPilot's system-reply-actions `emojiPickerItems`)
// and a flag for whether reactions quote the highlighted text.
//
// Smart reactions (off by default) is the one server behavior: when enabled,
// it adds instructions that ask the assistant to end replies needing an answer
// with a `::reactions{items="…"}` line, which the frontend renders as buttons.
//
// Everything else lives in the frontend (app.tsx): the selection menu reads the
// settings synchronously at frontend-interpretation time, so a settings
// change takes effect after the plugin's frontend is re-interpreted (the
// settings editor performs a disable/enable cycle to apply immediately).
import type { BbPluginApi } from "@bb/plugin-sdk";
import { DEFAULT_EMOJI_ITEMS, parseEmojiItems } from "./src/emoji-items";
import { smartReactionInstructions } from "./src/smart-reactions";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    emojiItems: {
      type: "string",
      label: "Emoji reactions (comma separated)",
      default: DEFAULT_EMOJI_ITEMS,
      description:
        "Each item is shown as an emoji-only button in the assistant-message text-selection menu (the menu is a single horizontal row) and drafted as the reply text. Format: emoji + label, e.g. \"👍 Agree\". Empty removes all reaction buttons.",
    },
    quoteSelection: {
      type: "boolean",
      label: "Quote the highlighted text in the reply",
      default: true,
      description:
        "When enabled, reacting drafts the highlighted text as a quote block, so the agent sees exactly what you reacted to.",
    },
    quotePosition: {
      type: "select",
      label: "Quote position",
      options: ["before", "after"],
      default: "before",
      description:
        "Where the quote block goes relative to the reaction text: \"before\" drafts the quote first, then the reaction; \"after\" drafts the reaction first, then the quote.",
    },
    showInSelectionMenu: {
      type: "boolean",
      label: "Show in text selection menu",
      default: true,
      description:
        "When enabled, reactions appear in the floating text-selection menu (when you select text) and in the right-click context menu.",
    },
    showInAssistantBar: {
      type: "boolean",
      label: "Show at bottom of assistant messages",
      default: true,
      description:
        "When enabled, reactions appear as buttons at the bottom of assistant messages (the per-message action bar).",
    },
    showInUserBar: {
      type: "boolean",
      label: "Show at bottom of user messages",
      default: true,
      description:
        "When enabled, reactions appear as buttons at the bottom of your own messages.",
    },
    smartReactions: {
      type: "boolean",
      label: "Smart reactions",
      default: false,
      description:
        "When enabled, the assistant suggests reactions that fit each reply that needs an answer, shown as buttons under the message. It prefers the reactions above. Applies to threads started or resumed after the change.",
    },
  });

  // `configure` is synchronous, so keep the latest values in memory.
  let current = await settings.get();

  settings.onChange((next) => {
    current = next;
    bb.log.info(
      `emoji reactions updated (${String(next.emojiItems ?? "").split(/[,;\n]/).filter((part) => part.trim().length > 0).length} items, quoteSelection=${String(next.quoteSelection)}, quotePosition=${String(next.quotePosition)}, showInSelectionMenu=${String(next.showInSelectionMenu)}, showInAssistantBar=${String(next.showInAssistantBar)}, showInUserBar=${String(next.showInUserBar)}, smartReactions=${String(next.smartReactions)})`,
    );
  });

  bb.agents.configure(() => ({
    tools: [],
    skills: [],
    ...(current.smartReactions === true
      ? {
          instructions: smartReactionInstructions(
            parseEmojiItems(
              typeof current.emojiItems === "string"
                ? current.emojiItems
                : DEFAULT_EMOJI_ITEMS,
            ),
          ),
        }
      : {}),
  }));
}

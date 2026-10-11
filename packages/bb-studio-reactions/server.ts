// @bb-studio/emoji-react — backend entry.
//
// Owns the plugin settings: the emoji reaction list shown in the
// assistant-message text-selection menu (a "emoji label" comma-separated
// string, mirroring NeonPilot's system-reply-actions `emojiPickerItems`)
// and a flag for whether reactions quote the highlighted text.
//
// Quick replies the agent suggests live in Studio Pages' Next row.
//
// Everything else lives in the frontend (app.tsx): the selection menu reads the
// settings synchronously at frontend-interpretation time, so a settings
// change takes effect after the plugin's frontend is re-interpreted. The
// settings preview offers a window reload without disabling the plugin.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DEFAULT_EMOJI_ITEMS } from "./src/emoji-items";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    emojiItems: {
      type: "string",
      label: "Reactions",
      experimental_multiline: true,
      default: DEFAULT_EMOJI_ITEMS,
      description:
        "Up to eight emoji and label pairs, such as \"👍 Agree\", separated by lines or commas. Each shows as its emoji and is drafted as your reply. Leave empty to hide the buttons.",
    },
    quoteSelection: {
      type: "boolean",
      label: "Quote the highlighted text",
      default: true,
      description:
        "Reacting drafts the text you selected as a quote, so the agent sees what you reacted to.",
    },
    quotePosition: {
      type: "select",
      label: "Quote position",
      options: ["before", "after"],
      default: "before",
      description:
        "Put the quote \"before\" or \"after\" the reaction.",
    },
    showInSelectionMenu: {
      type: "boolean",
      label: "In the text selection menu",
      default: true,
      description:
        "Show reactions in the menu that opens when you select text, and in the right-click menu.",
    },
    showInAssistantBar: {
      type: "boolean",
      label: "Under assistant messages",
      default: true,
      description:
        "Show reactions in the bar under assistant messages.",
    },
    showInUserBar: {
      type: "boolean",
      label: "Under your messages",
      default: true,
      description:
        "Show reactions in the bar under your own messages.",
    },
  });

  settings.onChange((next) => {
    bb.log.info(
      `emoji reactions updated (${String(next.emojiItems ?? "").split(/[,;\n]/).filter((part) => part.trim().length > 0).length} items, quoteSelection=${String(next.quoteSelection)}, quotePosition=${String(next.quotePosition)}, showInSelectionMenu=${String(next.showInSelectionMenu)}, showInAssistantBar=${String(next.showInAssistantBar)}, showInUserBar=${String(next.showInUserBar)})`,
    );
  });
}

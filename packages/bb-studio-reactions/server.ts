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
// Studio Pages' Next row includes quick replies, so while it's on, smart
// reactions add nothing (src/next-row.ts).
//
// Everything else lives in the frontend (app.tsx): the selection menu reads the
// settings synchronously at frontend-interpretation time, so a settings
// change takes effect after the plugin's frontend is re-interpreted. The
// settings preview offers a window reload without disabling the plugin.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { DEFAULT_EMOJI_ITEMS, parseEmojiItems } from "./src/emoji-items";
import { smartReactionInstructions } from "./src/smart-reactions";
import { trackPagesNextRow } from "./src/next-row";

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
    smartReactions: {
      type: "boolean",
      label: "Smart reactions",
      default: false,
      description:
        "When a reply asks you something, the assistant adds buttons with reactions that fit it, preferring yours. Studio Pages' Next row does this too, so this does nothing while that's on. Applies to threads that start or resume after the change.",
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

  const nextRow = await trackPagesNextRow(bb.sdk);
  bb.onDispose(() => nextRow.dispose());

  bb.agents.configure(() => {
    // Recheck for the next session; this one uses the latest answer.
    void nextRow.refresh();
    return {
      tools: [],
      skills: [],
      ...(current.smartReactions === true && !nextRow.on()
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
    };
  });
}

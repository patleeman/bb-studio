// Reactions (built in; was the Studio Reactions plugin, `emoji-react`).
//
// 1. Reactions: one `messageAction` per configured emoji item, shown in the
//    assistant-message text-selection menu (next to "Add to chat") and as an
//    icon button in the per-message action bar. Clicking one drafts a reply:
//    the highlighted text quoted first, the reaction text (e.g. "👍 Agree")
//    below it. Both surfaces render the emoji itself, not Studio's icon; see
//    the content script at the bottom.
//
// 2. Legacy smart reactions: older replies may end with
//    `::reactions{items="…"}`; a messageDirective still renders it as reaction
//    buttons so it never shows as raw text. Agents no longer write it.
//
// 3. Settings: Studio settings (src/settings), edited in Studio's Agent
//    replies section. Static action registrations read one snapshot at setup.
//
// Drafting goes through the kit's composer bridge, which Explore's
// registration mounts in every composer (registerExploreApp).
import { toast } from "sonner";
import {
  type PluginAppBuilder,
  type PluginComposerApi,
  type PluginMessageActionContext,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "../kit/ui/index";
import { parseEmojiItems } from "./emoji-items";
import { menuSettings, setAppliedMenuSettings, type MenuSettings } from "./settings";
import { readStudioSettingsNow } from "../settings/ui/use-settings";
import { mountActionDecoration } from "./action-decoration";
import { composerFor } from "../kit/composer";
import {
  appendQuote,
  composeReactionDraft,
  type QuotePosition,
} from "./draft";
import {
  parseSmartReactions,
  SMART_REACTIONS_DIRECTIVE,
} from "./smart-reactions";

// Settings snapshot read synchronously at setup (slot registrations are
// static per frontend interpretation): Studio's settings RPC, so a change
// applies after a window reload (Studio's Agent replies section says so).
function readSettingsSnapshot(): MenuSettings {
  return menuSettings(readStudioSettingsNow());
}

/** Draft the reaction: quote and reaction text in the configured order. */
function draftReaction(
  composer: PluginComposerApi,
  itemText: string,
  selectedText: string | null,
  quoteSelection: boolean,
  quotePosition: QuotePosition,
): void {
  const quoted =
    quoteSelection &&
    selectedText !== null &&
    selectedText.trim().length > 0;
  composer.replace((current) => {
    const draftBeforeQuote = current.text;
    // The stable composer has no quote helper, so append the quote block here;
    // composeReactionDraft then slots the reaction text in before or after it.
    const withQuote = quoted ? appendQuote(draftBeforeQuote, selectedText) : draftBeforeQuote;
    const text = composeReactionDraft(withQuote, itemText, quoted, quotePosition, draftBeforeQuote);
    // The user's draft stays a prefix, so its mentions keep their offsets.
    return { text, mentions: current.mentions.filter((mention) => mention.to <= text.length) };
  });
  composer.focus();
}

// ---------------------------------------------------------------------------
// Legacy smart reactions: `::reactions{items="👍 Ship it|❓ Why"}` in an
// older assistant message renders as a row of reaction buttons, so the raw
// directive line never shows.
// ---------------------------------------------------------------------------

function SmartReactions({ attributes, message }: PluginMessageDirectiveProps) {
  const items = parseSmartReactions(attributes.items);
  if (items.length === 0) return null;
  return (
    <div
      className="my-2 flex flex-wrap gap-1.5"
      role="group"
      aria-label="Suggested reactions"
    >
      {items.map((item) => (
        <Button
          key={item.text}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-full px-2.5 text-xs font-normal"
          onClick={() => {
            const composer = composerFor(message.threadId);
            if (composer === null) {
              toast.error(
                "Open this thread's composer to react.",
              );
              return;
            }
            draftReaction(composer, item.text, null, false, "before");
          }}
        >
          <span aria-hidden="true">{item.emoji}</span>
          <span>{item.label}</span>
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerReactionsApp(app: PluginAppBuilder) {
  const snapshot = readSettingsSnapshot();
  setAppliedMenuSettings(snapshot);
  const items = parseEmojiItems(snapshot.emojiItems);
  const quoteSelection = snapshot.quoteSelection;
  const quotePosition = snapshot.quotePosition;
  const showInSelectionMenu = snapshot.showInSelectionMenu;
  const showInAssistantBar = snapshot.showInAssistantBar;
  const showInUserBar = snapshot.showInUserBar;

  const anySurfaceEnabled =
    showInSelectionMenu || showInAssistantBar || showInUserBar;

  // One selection-menu action per configured reaction. The button label is
  // the emoji only (the host's selection menu is a horizontal row, so labeled
  // buttons get wide), while the drafted reply still uses the full item text
  // ("👍 Agree") captured in the run closure.
  // If every surface is disabled we skip registration entirely — the reactions
  // are hidden everywhere until the user re-enables a location.
  if (items.length > 0 && anySurfaceEnabled) {
    items.forEach((item, index) => {
      app.slots.messageAction({
        id: `emoji-react-${index + 1}`,
        title: item.emoji || item.label || item.text,
        run(context: PluginMessageActionContext) {
          const composer = composerFor(context.threadId);
          if (composer === null) {
            toast.error(
              "Open this thread's composer to react.",
            );
            return;
          }
          draftReaction(
            composer,
            item.text,
            context.selectedText ?? null,
            quoteSelection,
            quotePosition,
          );
        },
      });
    });
  }

  // Older replies may still carry the directive.
  app.slots.messageDirective({
    id: SMART_REACTIONS_DIRECTIVE,
    component: SmartReactions,
  });

  app.contentScripts.register({
    id: "emoji-glyph-actions",
    mount: ({ signal }) => mountActionDecoration(snapshot, signal),
  });
}

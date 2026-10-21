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
// 3. Settings: Studio's settings form holds them (./server.ts). A read-only
//    preview shows whether saved menu settings need a window reload. Static
//    action registrations read one snapshot at setup.
//
// Drafting goes through the kit's composer bridge, which Explore's
// registration mounts in every composer (registerExploreApp).
import { toast } from "sonner";
import {
  useSettings,
  type PluginAppBuilder,
  type PluginComposerApi,
  type PluginMessageActionContext,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "../kit/ui/index";
import { parseEmojiItems } from "./emoji-items";
import { menuSettings, needsMenuReload, type MenuSettings } from "./settings";
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

const PLUGIN_ID = "studio";

// ---------------------------------------------------------------------------
// Settings snapshot read synchronously at setup (slot registrations are
// static per frontend interpretation, and `useSettings` is hook-only).
// ---------------------------------------------------------------------------

function readSettingsSnapshot(): MenuSettings {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/api/v1/plugins/${PLUGIN_ID}/settings`, false);
    xhr.send();
    if (xhr.status !== 200) return menuSettings();
    const body = JSON.parse(xhr.responseText) as { values?: Record<string, unknown> };
    return menuSettings(body.values);
  } catch {
    return menuSettings();
  }
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
                "Open this thread's composer to react, in the main view or a split.",
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
// The host owns editing and persistence. This section only previews saved
// settings and makes static menu registration state explicit.
// ---------------------------------------------------------------------------

function ReactionsPreview({ applied }: { applied: MenuSettings }) {
  const { values, isLoading } = useSettings();
  const saved = menuSettings(values ?? {});
  const items = parseEmojiItems(saved.emojiItems);
  const pending = needsMenuReload(applied, saved);
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Edit and save your reactions in the settings above. Each button drafts its reaction into the conversation.</p>
    <div className="flex flex-wrap gap-2" aria-label="Saved reaction preview">
      {items.map((item, index) => <span key={index} className="rounded-md border border-border px-2 py-1 text-sm">{item.text}</span>)}
      {!items.length && <span className="text-sm text-muted-foreground">No reaction buttons configured.</span>}
    </div>
    <p role="status" className="text-sm text-muted-foreground">{isLoading ? "Loading saved settings…" : !values ? "Saved settings are unavailable. Reopen settings when connected." : pending
      ? "Your changes are saved. Reload this window to apply them to message menus."
      : "Saved menu settings are applied in this window."}</p>
    {pending && !isLoading && values && <Button type="button" size="sm" onClick={() => window.location.reload()}>Reload window to apply</Button>}
  </div>;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerReactionsApp(app: PluginAppBuilder) {
  const snapshot = readSettingsSnapshot();
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
              "Open this thread's composer to react, in the main view or a split.",
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

  app.slots.settingsSection({
    id: "emoji-reactions-editor",
    title: "Saved reactions",
    component: () => <ReactionsPreview applied={snapshot} />,
  });

  app.contentScripts.register({
    id: "emoji-glyph-actions",
    mount: ({ signal }) => mountActionDecoration(snapshot, signal),
  });
}

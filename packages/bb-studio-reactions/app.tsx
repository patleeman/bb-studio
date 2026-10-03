// @bb-studio/emoji-react — frontend.
//
// Port of NeonPilot's system-reply-actions extension for bb:
//
// 1. Reactions — one `messageAction` per configured emoji item, shown in the
//    assistant-message text-selection menu (next to "Add to chat") and as an
//    icon button in the per-message action bar. Clicking one drafts a reply:
//    the highlighted text quoted first, the reaction text (e.g. "👍 Agree")
//    below it. Both surfaces render the emoji itself, not the plugin icon —
//    see the content script at the bottom.
//
// 2. Smart reactions (off by default) — the assistant ends a reply that needs
//    an answer with `::reactions{items="…"}`; a messageDirective renders it as
//    reaction buttons under that message. Clicking one drafts the reaction.
//
// 3. Settings — BB owns the single settings form. A read-only preview shows
//    whether saved menu settings need a window reload. Applying never disables
//    the plugin. Static action registrations read one snapshot at setup.
import { useEffect } from "react";
import { toast } from "sonner";
import {
  definePluginApp,
  useComposer,
  useSettings,
  type PluginComposerApi,
  type PluginMessageActionContext,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb-studio/kit/ui";
import { parseEmojiItems } from "./src/emoji-items";
import { menuSettings, needsMenuReload, type MenuSettings } from "./src/settings";
import { mountActionDecoration } from "./src/action-decoration";
import { pickComposer } from "./src/composer-target";
import {
  composeReactionDraft,
  type QuotePosition,
} from "./src/draft";
import {
  parseSmartReactions,
  SMART_REACTIONS_DIRECTIVE,
} from "./src/smart-reactions";

const PLUGIN_ID = "emoji-react";

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

// ---------------------------------------------------------------------------
// Composer bridge: `messageAction` runs are host chrome (plain callbacks, no
// hooks), so a banner component registers the bound `useComposer()` API in a
// module list. Banners mount in every composer layout (actions do not mount in
// compact), and the bridge renders nothing. Several composers can be mounted
// at once (a floating chat over the main view); `pickComposer` finds the one
// for the reacted-to message's thread.
// ---------------------------------------------------------------------------

const mountedComposers: PluginComposerApi[] = [];

function ComposerBridge() {
  const composer = useComposer();
  useEffect(() => {
    mountedComposers.push(composer);
    return () => {
      const index = mountedComposers.indexOf(composer);
      if (index !== -1) mountedComposers.splice(index, 1);
    };
  }, [composer]);
  return null;
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
  if (quoted) {
    // `addQuote` appends the quote block to the draft; composeReactionDraft
    // then slots the reaction text in before or after it.
    composer.addQuote(selectedText);
  }
  composer.updateText((current) =>
    composeReactionDraft(current, itemText, quoted, quotePosition),
  );
  composer.focus();
}

// ---------------------------------------------------------------------------
// Smart reactions: `::reactions{items="👍 Ship it|❓ Why"}` in an assistant
// message renders as a row of reaction buttons. The buttons stay on older
// messages too, and still render if the setting is later turned off, so the
// raw directive line never shows.
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
            const composer = pickComposer(mountedComposers, message.threadId);
            if (composer === null) {
              toast.error(
                "Open this thread's composer to react, in the main view or Studio Chat.",
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
    <p className="text-xs text-muted-foreground">Smart reactions use saved settings when a thread starts or resumes.</p>
  </div>;
}

// ---------------------------------------------------------------------------
// Plugin app setup
// ---------------------------------------------------------------------------

export default definePluginApp((app) => {
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
          const composer = pickComposer(mountedComposers, context.threadId);
          if (composer === null) {
            toast.error(
              "Open this thread's composer to react, in the main view or Studio Chat.",
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

  // Keeps `useComposer()` available to the messageAction runs above. Mounts
  // in every composer layout and renders nothing.
  app.composer.customize({
    id: "emoji-react-composer",
    banners: [
      { id: "composer-bridge", chrome: "bare", component: ComposerBridge },
    ],
  });

  // Registered even when smart reactions are off, so replies that already
  // carry the directive keep rendering as buttons.
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
});

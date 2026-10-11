// "Along the way" at the bottom of a reply (the `::explore{items="🐛 …|🏗️ …"}`
// directive): what the agent noticed, as full-width rows. Clicking one drafts
// "Tell me more" about it in the thread's composer.
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useMemo } from "react";
import { toast } from "sonner";
import { composerFor } from "@bb-studio/kit/composer";
import { cn, Icon } from "@bb-studio/kit/ui";
import { PLUGIN_ID } from "../constants";
import { labelKey, parseExploreItems, type ExploreItem } from "../shared";
import { appendDraft } from "./composer";

/** Where the Explore setting lives: this plugin's page in Settings. */
const SETTINGS_HREF = `/settings/plugins/${PLUGIN_ID}`;
const EXPLORE_ICON = "pages/explore";
/** Drafted by Tell me more; matches the Next row and the iOS app. */
const MORE_EMOJI = "💬";

/** `::explore{items="…"}` at the end of a reply. */
export function ExploreDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const raw = attributes.items;
  const items = useMemo(() => parseExploreItems(raw), [raw]);
  if (!items.length) return null;
  return <ExploreRows items={items} threadId={message.threadId} />;
}

function ExploreRows({ items, threadId }: { items: readonly ExploreItem[]; threadId: string }) {
  const more = (item: ExploreItem) => {
    const composer = composerFor(threadId);
    if (!composer) {
      toast.error("Open this thread's composer to use it, in the main view or a split.");
      return;
    }
    composer.replace((current) => ({ text: appendDraft(current.text, `${MORE_EMOJI} Tell me more: ${item.emoji} ${item.label}`), mentions: current.mentions }));
    composer.focus();
  };
  return (
    <section aria-label="Along the way" className="my-3 w-full overflow-hidden rounded-lg border border-border/70 bg-background">
      <header className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs text-muted-foreground">
        <Icon name={EXPLORE_ICON} fallback="Search" className="size-3.5" />
        Along the way
        <a
          href={SETTINGS_HREF}
          title="Stop agents from ending answers with things to explore. Applies to new agent sessions."
          className="ml-auto text-[11px] text-muted-foreground/60 hover:text-foreground hover:underline"
        >
          Turn off in settings
        </a>
      </header>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {items.map((item) => (
          <li key={labelKey(item.label)}>
            <button
              type="button"
              onClick={() => more(item)}
              title="Ask the agent to explain this here, in the thread"
              className={cn("group flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-state-hover")}
            >
              <span aria-hidden className="w-5 shrink-0 text-center text-base leading-none">
                {item.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground group-hover:text-foreground">Tell me more</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

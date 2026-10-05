// The Next row at the end of a reply (`::next{reply="…" explore="…" do="…"}`):
// quick replies and actions as buttons that draft into the composer, and
// things to explore as Explore's rows. Each message logs its suggestions once
// as shown, and every click, so `bb pages explore stats` can tell which kinds
// earn their place.
import { useComposer, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Icon } from "@bb-studio/kit/ui";
import { useExploreRpc } from "../../client";
import { PLUGIN_ID } from "../constants";
import { NEXT_KINDS, nextItemCount, parseNextItems, type NextKind } from "../next";
import type { ExploreItem } from "../shared";
import { appendDraft, mountedComposers, pickComposer } from "./composer";
import { ExploreRows } from "./rows";

const SETTINGS_HREF = `/settings/plugins/${PLUGIN_ID}`;

/** Keeps each mounted composer's API where message directives can reach it. Renders nothing. */
export function ComposerBridge() {
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

export function NextDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const rpc = useExploreRpc();
  const items = useMemo(() => parseNextItems(attributes), [attributes]);
  const { threadId, id: messageId } = message;
  const shown = useMemo(() => NEXT_KINDS.flatMap((kind) => items[kind].map((item) => ({ kind, ...item }))), [items]);
  const shownKey = JSON.stringify(shown);

  useEffect(() => {
    if (!shown.length) return;
    rpc.call("nextShown", { threadId, messageId, items: shown }).catch(() => undefined);
    // `shownKey` stands for `shown`; the log ignores repeats anyway.
  }, [rpc, threadId, messageId, shownKey]);

  if (nextItemCount(items) === 0) return null;

  const logClick = (kind: NextKind, item: ExploreItem) =>
    void rpc.call("nextClicked", { threadId, messageId, kind, ...item }).catch(() => undefined);

  const draft = (kind: NextKind, item: ExploreItem) => {
    const composer = pickComposer(mountedComposers, threadId);
    if (!composer) {
      toast.error("Open this thread's composer to use it, in the main view or Float.");
      return;
    }
    logClick(kind, item);
    composer.updateText((current) => appendDraft(current, `${item.emoji} ${item.label}`));
    composer.focus();
  };

  const chips = [...items.reply.map((item) => ({ kind: "reply" as const, item })), ...items.do.map((item) => ({ kind: "do" as const, item }))];

  return (
    <section aria-label="Next" className="my-3 w-full overflow-hidden rounded-lg border border-border/70 bg-background">
      <header className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs text-muted-foreground">
        <Icon name="CornerDownRight" fallback="ArrowRight" className="size-3.5" />
        Next
        <a
          href={SETTINGS_HREF}
          title="Stop agents from ending replies with a Next row. Applies to new agent sessions."
          className="ml-auto text-[11px] text-muted-foreground/60 hover:text-foreground hover:underline"
        >
          Turn off in settings
        </a>
      </header>
      {chips.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pt-1 pb-2.5" role="group" aria-label="Replies and actions">
          {chips.map(({ kind, item }) => (
            <button
              key={`${kind}:${item.label}`}
              type="button"
              onClick={() => draft(kind, item)}
              title={kind === "do" ? "Draft this request to the agent" : "Draft this reply"}
              className={
                kind === "do"
                  ? "inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border bg-transparent px-2.5 text-xs text-foreground hover:bg-state-hover"
                  : "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-transparent px-2.5 text-xs text-foreground hover:bg-state-hover"
              }
            >
              <span aria-hidden="true">{item.emoji}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {items.explore.length ? (
        <ExploreRows
          items={items.explore}
          threadId={threadId}
          messageId={messageId}
          turnId={message.turnId}
          title="Things to explore"
          onExplore={(item) => logClick("explore", item)}
          className="my-0 rounded-none border-x-0 border-b-0"
        />
      ) : null}
    </section>
  );
}

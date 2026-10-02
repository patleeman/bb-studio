// The bar floating over every Studio item view: a back pill on the left,
// then the view's own breadcrumb or status, and its buttons on the right.
import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { mentionPrompt } from "../contract";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { FLOATING, FLOATING_BUTTON } from "./pieces";
import { RelatedPanel, type RelatedRef } from "./related-panel";
import { SpacePicker } from "./space-picker";

export type ItemThread = { title: string; href: string; ref?: RelatedRef };

export function openNewItemThread(navigate: ReturnType<typeof useBbNavigate>, item: ItemThread) {
  navigate.toCompose({ initialPrompt: mentionPrompt([item]), focusPrompt: true });
}

/** The shared action used by item headers and narrow-screen menus. */
export function useNewItemThread(item: ItemThread | undefined) {
  const navigate = useBbNavigate();
  return () => {
    if (item) openNewItemThread(navigate, item);
  };
}

export function ItemHeader({
  backLabel,
  onBack,
  leading,
  trailing,
  thread,
  className,
}: {
  backLabel: string;
  onBack(): void;
  /** Breadcrumbs or status beside the back pill. */
  leading?: ReactNode;
  /** The view's buttons, built from ICON_BUTTON and FLOATING_BUTTON. */
  trailing?: ReactNode;
  /** Adds the standard New thread action for this item. */
  thread?: ItemThread;
  className?: string;
}) {
  const newThread = useNewItemThread(thread);
  const path = thread?.href.split(/[?#]/)[0]?.split("/") ?? [];
  const relatedRef = thread?.ref ?? (path[1] === "plugins" && path[2] && path[4]
    ? { pluginId: path[2], id: decodeURIComponent(path[4]) }
    : null);
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-3 max-md:p-2",
        className,
      )}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          className={cn(
            FLOATING,
            "flex h-8 shrink-0 items-center gap-1 rounded-md pr-3 pl-2 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
          onClick={onBack}
        >
          <Icon name="ChevronLeft" className="size-4" /> {backLabel}
        </button>
        {leading}
      </div>
      {trailing || thread ? <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
        {relatedRef ? <SpacePicker item={relatedRef} /> : null}
        {relatedRef ? <RelatedPanel ref={relatedRef} /> : null}
        {thread ? <button type="button" className={cn(FLOATING_BUTTON, "max-md:hidden")} onClick={newThread}>
          <Icon name="MessageSquarePlus" /> New thread
        </button> : null}
        {trailing}
      </div> : null}
    </div>
  );
}

/** An item title that turns into a text field on click. */
export function EditableTitle({
  title,
  placeholder = "Untitled",
  onRename,
  className,
}: {
  title: string;
  placeholder?: string;
  onRename(title: string): void;
  className?: string;
}) {
  return (
    <input
      aria-label="Title"
      defaultValue={title}
      key={title}
      placeholder={placeholder}
      maxLength={200}
      className={cn(
        "w-full min-w-0 bg-transparent text-[32px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 max-md:text-[28px]",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = title;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next && next !== title) onRename(next);
        else event.currentTarget.value = title;
      }}
    />
  );
}

// Links to Studio items in plain-text fields: comments, task descriptions,
// space descriptions, table text cells. A link is a Markdown link to the item's view, the same
// text Copy reference puts on the clipboard, so pasting one works with no
// extra handling. Typing @ in an ItemLinkTextarea searches Studio and inserts
// one; ItemLinkText and ITEM_LINK_PILLS show them as pills.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type KeyboardEvent, type MouseEvent } from "react";
import { z } from "zod";
import { STUDIO_PLUGIN_ID } from "../contract";
import { untitled } from "../format";
import { Icon } from "../ui/icon";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { cn } from "../ui/utils";
import { itemReferenceText } from "./item-reference";
import { openAppPath } from "./nav";
import { studioItemProps } from "./studio-item";

/** The look of an item link: a quiet chip, like a mention on a page. */
export const ITEM_PILL =
  "inline-flex max-w-full items-center gap-1 rounded bg-foreground/6 px-1 align-baseline font-medium text-foreground no-underline hover:bg-foreground/10";

/** For a wrapper around rendered Markdown: its links to Studio items show as pills. */
export const ITEM_LINK_PILLS =
  "[&_a[href^='/plugins/']]:rounded [&_a[href^='/plugins/']]:bg-foreground/6 [&_a[href^='/plugins/']]:px-1 [&_a[href^='/plugins/']]:font-medium [&_a[href^='/plugins/']]:text-foreground [&_a[href^='/plugins/']]:no-underline [&_a[href^='/plugins/']:hover]:bg-foreground/10";

const LINK = /\[([^\]\n]*)\]\((\/plugins\/[^)\s]+)\)/g;

/** Text and item links, in order. */
export function splitItemLinks(text: string): ({ text: string } | { title: string; href: string })[] {
  const parts: ({ text: string } | { title: string; href: string })[] = [];
  let at = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ title: match[1]!, href: match[2]! });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

export function ItemPill({ href, title, icon = "GridView", onMouseDown }: { href: string; title: string; icon?: string; onMouseDown?(event: MouseEvent): void }) {
  return (
    <a
      href={href}
      className={ITEM_PILL}
      {...studioItemProps({ href, title: untitled(title) })}
      onMouseDown={onMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        openAppPath(href);
      }}
    >
      <Icon name={icon} className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">{untitled(title)}</span>
    </a>
  );
}

/** Plain text with its item links shown as pills. */
export function ItemLinkText({ text, className, onPillMouseDown }: { text: string; className?: string; onPillMouseDown?(event: MouseEvent): void }) {
  return (
    <span className={className}>
      {splitItemLinks(text).map((part, index) =>
        "href" in part ? <ItemPill key={index} href={part.href} title={part.title} onMouseDown={onPillMouseDown} /> : <span key={index}>{part.text}</span>,
      )}
    </span>
  );
}

const resultSchema = z.array(z.object({ ref: z.object({ pluginId: z.string(), id: z.string() }), kind: z.string(), title: z.string(), href: z.string() }).passthrough());
type Result = z.infer<typeof resultSchema>[number];

const KIND_ICONS: Record<string, string> = {
  page: "FileText",
  task: "CircleCheck",
  board: "studio-tasks/board",
  drawing: "Palette",
  artifact: "File",
  recording: "Mic",
  dictation: "Mic",
  table: "Rows2",
  space: "Layers",
  bot: "Bot",
};

/** The @ query being typed just before the caret, and where it starts. */
export function mentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@[\]()]{0,40})$/.exec(value.slice(0, caret));
  return match ? { start: caret - match[1]!.length - 1, query: match[1]! } : null;
}

/** Studio items matching `query`, newest first when it's empty; none without Studio. */
function useItemSearch(query: string | null, exclude?: string) {
  const sdk = useSdk();
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    if (query === null) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      sdk.plugins
        .callRpc({ pluginId: STUDIO_PLUGIN_ID, method: "searchAll", input: { query, limit: 8 } as never, outputSchema: resultSchema })
        .then((found) => {
          if (!live) return;
          // A search can find one item twice, as indexed and as a fallback match.
          const seen = new Set<string>(exclude ? [exclude] : []);
          setResults(found.filter((result) => result.href.startsWith("/plugins/") && !seen.has(result.href) && seen.add(result.href)));
        })
        .catch(() => live && setResults([]));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sdk, query, exclude]);
  return results;
}

type TextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onValueChange(value: string): void;
  /** The item being edited, left out of the @ menu. */
  selfHref?: string;
  wrapperClassName?: string;
};

/** A textarea where @ links a Studio item. */
export const ItemLinkTextarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function ItemLinkTextarea(
  { value, onValueChange, selfHref, wrapperClassName, onKeyDown, className, ...props },
  ref,
) {
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => field.current!);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const results = useItemSearch(mention?.query ?? null, selfHref);
  const open = mention !== null && results.length > 0;

  const track = (element: HTMLTextAreaElement) => {
    const next = mentionQuery(element.value, element.selectionStart);
    setMention(next);
    if (next?.query !== mention?.query) setActive(0);
  };

  const pick = (result: Result) => {
    const element = field.current;
    if (!element || !mention) return;
    const link = `${itemReferenceText({ href: result.href, title: result.title })} `;
    const caret = element.selectionStart;
    const next = value.slice(0, mention.start) + link + value.slice(caret);
    onValueChange(next);
    setMention(null);
    const at = mention.start + link.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(at, at);
    });
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) event.stopPropagation();
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
        return;
      }
      if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "Tab") {
        event.preventDefault();
        pick(results[Math.min(active, results.length - 1)]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    onKeyDown?.(event);
  };

  return (
    // The list is a popover, so a scrolling grid or a dialog doesn't clip it.
    <Popover open={open} onOpenChange={(next) => !next && setMention(null)}>
      <PopoverAnchor asChild>
        <div className={cn("relative w-full", wrapperClassName)}>
          <textarea
            {...props}
            ref={field}
            value={value}
            className={className}
            onChange={(event) => {
              onValueChange(event.target.value);
              track(event.target);
            }}
            onSelect={(event) => track(event.currentTarget)}
            onKeyDown={keyDown}
            onBlur={(event) => {
              setMention(null);
              props.onBlur?.(event);
            }}
          />
        </div>
      </PopoverAnchor>
      {open ? (
        <PopoverContent
          align="start"
          role="listbox"
          aria-label="Link a Studio item"
          className="max-h-64 w-[max(16rem,var(--radix-popover-trigger-width))] overflow-y-auto p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === field.current) event.preventDefault();
          }}
        >
          {results.map((result, index) => (
            <button
              key={`${result.ref.pluginId}:${result.ref.id}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", index === active && "bg-state-hover")}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(result)}
            >
              <Icon name={KIND_ICONS[result.kind] ?? "GridView"} className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{untitled(result.title)}</span>
              <span className="shrink-0 text-xs text-muted-foreground capitalize">{result.kind}</span>
            </button>
          ))}
        </PopoverContent>
      ) : null}
    </Popover>
  );
});

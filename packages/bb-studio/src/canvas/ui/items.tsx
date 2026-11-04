// What each board item looks like. Widgets are Dashboards' renderers
// (src/dashboards/ui/widgets.tsx), fed the item's data as a static value; a
// headline is big type straight on the board, a caption is Studio's markdown.
import type { ReactNode } from "react";
import { cn } from "../../kit/ui/index";
import type { WidgetTheme } from "../../dashboards/ui/custom-frame";
import { Markdown } from "../../dashboards/ui/markdown";
import { WidgetBody } from "../../dashboards/ui/widgets";
import type { WidgetType, WidgetView } from "../../dashboards/shared";
import { captionOf, headlineOf, type CanvasItem } from "../shared";

/** A canvas item as Dashboards' renderers read a widget. */
export function asWidget(item: CanvasItem): WidgetView {
  return {
    id: item.id,
    type: item.kind as WidgetType,
    title: item.title,
    options: item.options,
    source: { kind: "static", data: item.data },
    customType: null,
    html: item.html,
    script: null,
  };
}

/** Kinds drawn straight on the board, without a card. */
export const BARE_KINDS: ReadonlySet<string> = new Set(["headline", "caption"]);

const TONE: Record<string, string> = {
  neutral: "text-foreground",
  good: "text-emerald-700 dark:text-emerald-300",
  bad: "text-red-700 dark:text-red-300",
  accent: "text-primary",
};

function Headline({ item, height }: { item: CanvasItem; height: number }) {
  const headline = headlineOf(item.data);
  if (!headline) return null;
  // Big when there's room: the headline is read from across the room.
  const size = height >= 190 ? "text-5xl" : height >= 130 ? "text-4xl" : "text-3xl";
  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-1.5 px-1" data-canvas-body="headline">
      {headline.kicker ? <div className="truncate text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{headline.kicker}</div> : null}
      <h2 className={cn("line-clamp-2 text-balance font-semibold leading-[1.05] tracking-tight", size, TONE[headline.tone])}>{headline.text}</h2>
      {headline.subtitle ? <p className="line-clamp-2 text-base text-muted-foreground">{headline.subtitle}</p> : null}
    </div>
  );
}

function Caption({ item }: { item: CanvasItem }) {
  const text = captionOf(item.data);
  if (!text) return null;
  return (
    <div className="h-full min-h-0 overflow-hidden px-1 text-[15px] leading-relaxed text-foreground/85" data-canvas-body="caption">
      {item.title ? <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{item.title}</div> : null}
      <Markdown source={text} />
    </div>
  );
}

/** The item's content, sized to its cell. */
export function ItemBody({ item, width, height, theme }: { item: CanvasItem; width: number; height: number; theme: WidgetTheme }): ReactNode {
  if (item.kind === "headline") return <Headline item={item} height={height} />;
  if (item.kind === "caption") return <Caption item={item} />;
  return <WidgetBody widget={asWidget(item)} value={item.data} width={width} height={height} theme={theme} types={[]} />;
}

/** The small title over a card, when the item has one. */
export function itemLabel(item: CanvasItem): string | null {
  if (BARE_KINDS.has(item.kind)) return null;
  return item.title ?? (item.kind === "stat" && typeof item.options.label === "string" ? item.options.label : null);
}

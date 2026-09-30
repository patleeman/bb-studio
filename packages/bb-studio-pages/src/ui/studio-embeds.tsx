// Embeds of other Studio add-ons' items: a drawing shows its picture, an
// artifact its content, and recordings, tasks and the rest a card. Each opens
// the item in its own add-on.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { StudioEmbedItem } from "../contract";
import { STUDIO_EMBEDS, studioEmbedFor, studioRef, studioSubtitle, type StudioEmbedKind } from "../schema-config";
import { usePagesUi, type ArtifactView } from "./context";

export function useStudioItems(enabled = true): StudioEmbedItem[] | null {
  const ui = usePagesUi();
  const [items, setItems] = useState<StudioEmbedItem[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    ui.studioItems()
      .then((next) => live && setItems(next))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [ui, enabled]);
  return items;
}

export function useStudioItem(kind: string, target: string): { item: StudioEmbedItem | null; loading: boolean } {
  const ref = studioRef(kind, target);
  const items = useStudioItems(ref !== null);
  const item = ref && items ? (items.find((each) => each.pluginId === ref.pluginId && each.id === ref.id) ?? null) : null;
  return { item, loading: ref !== null && items === null };
}

export function kindLabel(kind: StudioEmbedKind | "item"): string {
  return kind === "item" ? "Studio item" : STUDIO_EMBEDS[kind].label;
}

function ItemIcon({ item, fallback, className }: { item: StudioEmbedItem | null; fallback: string; className?: string }) {
  if (item?.icon) return <span className={cn("leading-none", className)}>{item.icon}</span>;
  return <Icon name={item?.kindIcon ?? fallback} className={cn("size-4", className)} />;
}

const FALLBACK_ICONS: Record<StudioEmbedKind | "item", string> = {
  drawing: "Palette",
  artifact: "File",
  recording: "Mic",
  task: "CircleCheck",
  item: "GridView",
};

function ItemHeader({ item, kind, target, loading, onEdit }: {
  item: StudioEmbedItem | null;
  kind: StudioEmbedKind | "item";
  target: string;
  loading: boolean;
  onEdit?: () => void;
}) {
  const ui = usePagesUi();
  const sub = item ? studioSubtitle(item) : loading ? "Loading…" : `${kindLabel(kind)} not found`;
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-3 p-2 text-left"
      onClick={() => item && ui.openPath(item.href)}
      onDoubleClick={onEdit}
      title={item ? `Open ${item.title}` : undefined}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-lg text-muted-foreground">
        <ItemIcon item={item} fallback={FALLBACK_ICONS[kind]} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item?.title ?? (loading ? "" : target)}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      {item ? <Icon name="ArrowUpRight" className="size-4 shrink-0 text-muted-foreground" /> : null}
    </button>
  );
}

function ArtifactBody({ id }: { id: string }) {
  const ui = usePagesUi();
  const [view, setView] = useState<ArtifactView | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    ui.artifactView(id)
      .then((next) => live && setView(next))
      .catch(() => live && setView(null));
    return () => {
      live = false;
    };
  }, [ui, id]);
  if (!view) return null;
  const frame = "block w-full border-0 border-t border-border bg-white";
  switch (view.type) {
    case "image":
      return <img src={view.url} alt={view.name} loading="lazy" className="block max-h-[480px] w-full border-t border-border bg-background object-contain" />;
    case "html":
      // The artifact's own sandbox CSP applies too; scripts run, but not as BB.
      return <iframe title={view.name} src={view.url} sandbox="allow-scripts" loading="lazy" className={cn(frame, "h-[360px]")} />;
    case "pdf":
      return <iframe title={view.name} src={view.url} loading="lazy" className={cn(frame, "h-[520px]")} />;
    case "markdown":
    case "code":
    case "text":
      return view.text ? (
        <pre className="max-h-80 overflow-auto border-t border-border bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
          {view.text}
        </pre>
      ) : null;
    default:
      return null;
  }
}

/** The body of a Studio embed: a picture, content, or the item's preview. */
function ItemBody({ item }: { item: StudioEmbedItem }) {
  const ui = usePagesUi();
  const [failed, setFailed] = useState(false);
  if (item.pluginId === "artifacts") return <ArtifactBody id={item.id} />;
  if (item.thumbnailUrl && !failed) {
    return (
      <button type="button" className="block w-full cursor-pointer border-t border-border bg-background" onClick={() => ui.openPath(item.href)}>
        <img
          src={item.thumbnailUrl}
          alt={item.title}
          loading="lazy"
          // Thumbnails are drawn for a light background, as in Studio.
          className="mx-auto block max-h-[420px] w-full object-contain p-3 dark:invert-[0.9] dark:hue-rotate-180"
          onError={() => setFailed(true)}
        />
      </button>
    );
  }
  return item.preview ? <div className="line-clamp-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">{item.preview}</div> : null;
}

export function StudioEmbed({ kind, target, onEdit }: { kind: StudioEmbedKind | "item"; target: string; onEdit?: () => void }) {
  const { item, loading } = useStudioItem(kind, target);
  return (
    <div className="overflow-hidden">
      <ItemHeader item={item} kind={kind} target={target} loading={loading} onEdit={onEdit} />
      {item ? <ItemBody item={item} /> : null}
    </div>
  );
}

/** Search the add-on's items and pick one; "item" searches every add-on. */
export function StudioPicker({ kind, onPick, onCancel }: { kind: StudioEmbedKind | "item"; onPick(target: string): void; onCancel?: () => void }) {
  const items = useStudioItems();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const pluginId = kind === "item" ? null : STUDIO_EMBEDS[kind].pluginId;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? [])
      .filter((item) => !pluginId || item.pluginId === pluginId)
      .filter((item) => words.every((word) => `${item.title} ${item.kindLabel} ${item.preview ?? ""}`.toLowerCase().includes(word)))
      .slice(0, 8);
  }, [items, kind, query]);
  const pick = (item: StudioEmbedItem | undefined) => {
    if (!item) return;
    onPick(kind === "item" ? studioEmbedFor(item.pluginId, item.id).target : item.id);
  };
  return (
    <div className="flex flex-col gap-1 p-2">
      <input
        autoFocus
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
        placeholder={`Search ${kind === "item" ? "Studio" : STUDIO_EMBEDS[kind].label.toLowerCase() + "s"}…`}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(matches[active]);
          } else if (event.key === "Escape") onCancel?.();
        }}
      />
      {items === null ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
      ) : matches.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {query ? "Nothing matches." : kind === "item" ? "No Studio items yet." : `No ${STUDIO_EMBEDS[kind].label.toLowerCase()}s yet.`}
        </p>
      ) : (
        <ul className="flex flex-col">
          {matches.map((item, index) => (
            <li key={`${item.pluginId}:${item.id}`}>
              <button
                type="button"
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", index === active && "bg-state-hover")}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(item)}
              >
                <ItemIcon item={item} fallback={FALLBACK_ICONS[kind]} className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{item.kindLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

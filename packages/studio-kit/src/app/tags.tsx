// Tags in the collection: chips on items, the checklist that adds and removes
// them, and the box that names a new one.
import { useState } from "react";
import { DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";

export interface CollectionTag {
  id: string;
  name: string;
  /** A CSS colour for the tag's dot. */
  color: string;
}

export function TagDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

export function TagChip({ tag, onClick }: { tag: CollectionTag; onClick?(): void }) {
  return (
    <button
      type="button"
      title={`Show items tagged ${tag.name}`}
      className="inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-full border border-border px-1.5 text-[11px] font-normal text-muted-foreground hover:bg-state-hover hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <TagDot color={tag.color} className="size-1.5" />
      <span className="truncate">{tag.name}</span>
    </button>
  );
}

/** An item's chips, the first few and then a count. */
export function TagChips({ ids, tags, max = 2, onPick }: { ids: readonly string[] | undefined; tags: ReadonlyMap<string, CollectionTag>; max?: number; onPick(tag: CollectionTag): void }) {
  const shown = (ids ?? []).flatMap((id) => tags.get(id) ?? []);
  if (!shown.length) return null;
  const rest = shown.length - max;
  return (
    <>
      {shown.slice(0, max).map((tag) => (
        <TagChip key={tag.id} tag={tag} onClick={() => onPick(tag)} />
      ))}
      {rest > 0 ? (
        <span className="shrink-0 text-[11px] text-muted-foreground" title={shown.slice(max).map((tag) => tag.name).join(", ")}>
          +{rest}
        </span>
      ) : null}
    </>
  );
}

/** A text box inside a menu; Enter submits. The menu's typeahead doesn't see the keys. */
export function TagNameInput({ placeholder, initial = "", onSubmit }: { placeholder: string; initial?: string; onSubmit(name: string): void }) {
  const [name, setName] = useState(initial);
  return (
    <input
      autoFocus
      aria-label={placeholder}
      placeholder={placeholder}
      maxLength={40}
      value={name}
      className="mx-1 my-1 h-8 w-[calc(100%-0.5rem)] rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-foreground/30"
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") return;
        event.stopPropagation();
        if (event.key === "Enter" && name.trim()) {
          event.preventDefault();
          onSubmit(name.trim());
          setName("");
        }
      }}
    />
  );
}

/**
 * Menu rows that add or remove each tag on the chosen items, then a box for
 * a new tag. `state` is whether every item, some, or none have the tag.
 */
export function TagMenuItems({
  tags,
  state,
  onToggle,
  onCreate,
}: {
  tags: readonly CollectionTag[];
  state(tag: CollectionTag): boolean | "mixed";
  onToggle(tag: CollectionTag, add: boolean): void;
  onCreate(name: string): void;
}) {
  return (
    <>
      {tags.map((tag) => {
        const has = state(tag);
        return (
          <DropdownMenuItem
            key={tag.id}
            // Stay open, so several tags can be set in one go.
            onSelect={(event) => {
              event.preventDefault();
              onToggle(tag, has !== true);
            }}
          >
            <TagDot color={tag.color} />
            <span className="truncate">{tag.name}</span>
            {has === true ? <Icon name="Check" className="ml-auto size-3.5" /> : has === "mixed" ? <Icon name="Minus" className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        );
      })}
      {tags.length ? <DropdownMenuSeparator /> : null}
      <TagNameInput placeholder={tags.length ? "New tag" : "Name your first tag"} onSubmit={onCreate} />
    </>
  );
}

// The collection's filter bar and facet rail. Both edit one query
// (src/query.ts): the bar shows its filters as chips and completes fields and
// values as they're typed; the rail lists each field's values with how many
// items each would show, and clicking one adds or takes out its filter.
import { cn, Icon, TagDot } from "@bb-studio/kit/app";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@bb-studio/kit/ui";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { SavedViewView, SpaceView, TagView } from "../contract";
import {
  describeFilter,
  fieldValues,
  formatQuery,
  parseQuery,
  resolveValue,
  sameFilter,
  suggest,
  toggleFilter,
  UNTAGGED,
  type FacetCounts,
  type FieldValue,
  type Filter,
  type FilterField,
  type Query,
  type QueryVocabulary,
  type Suggestion,
} from "../query";
import { SpaceGlyph } from "./Spaces";

const FIELD_HINTS: Record<FilterField, string> = {
  kind: "Pages, recordings, drawings…",
  project: "A project, or global",
  tag: "A tag, or none",
  space: "A space's items",
  is: "Archived or templates",
};
const SHOWN_VALUES = 8;

/** The word being typed at the end of the text: after its last space, or its open quote. */
function pendingWord(text: string): string {
  if (/\s$/.test(text)) return "";
  const quotes = text.split('"').length - 1;
  if (quotes % 2) {
    const open = text.lastIndexOf('"');
    const start = text.lastIndexOf(" ", open) + 1;
    return text.slice(start);
  }
  return /\S*$/.exec(text)![0];
}

/** Moves finished filters out of the text into chips. */
function absorb(query: Query, text: string): Query {
  const word = pendingWord(text);
  const head = parseQuery(text.slice(0, text.length - word.length));
  if (!head.filters.length) return { ...query, text };
  const filters = [...query.filters];
  for (const filter of head.filters) if (!filters.some((each) => sameFilter(each, filter))) filters.push(filter);
  return { filters, text: [head.text, word].filter(Boolean).join(" ") };
}

function withoutWord(text: string, word: string): string {
  return text.slice(0, text.length - word.length).trimEnd();
}

export function QueryBar({
  query,
  vocabulary,
  onChange,
  onOpenFilters,
}: {
  query: Query;
  vocabulary: QueryVocabulary;
  onChange(query: Query): void;
  /** Opens the rail where there's no room for it. */
  onOpenFilters?(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState(-1);
  const word = pendingWord(query.text);
  const suggestions = useMemo(
    () => suggest(word, vocabulary).filter((each) => each.type === "field" || !query.filters.some((filter) => sameFilter(filter, { field: each.field, value: each.value, negate: each.negate }))),
    [word, vocabulary, query.filters],
  );
  const open = focused && suggestions.length > 0;
  // Tab completes what's being typed, so it takes the first suggestion when none is picked.
  const tabTarget = !open ? -1 : picked >= 0 ? picked : word ? 0 : -1;

  const setText = (text: string) => {
    const next = absorb(query, text);
    onChange(next);
    // Picking is for building a filter; plain words search on Enter.
    setPicked(pendingWord(next.text).includes(":") ? 0 : -1);
  };
  const apply = (suggestion: Suggestion) => {
    const rest = withoutWord(query.text, word);
    if (suggestion.type === "field") {
      onChange({ ...query, text: `${rest ? `${rest} ` : ""}${suggestion.negate ? "-" : ""}${suggestion.field}:` });
      setPicked(0);
    } else {
      const filter: Filter = { field: suggestion.field, value: suggestion.value, ...(suggestion.negate ? { negate: true } : {}) };
      onChange({ filters: [...query.filters.filter((each) => !(each.field === filter.field && each.value.toLowerCase() === filter.value.toLowerCase())), filter], text: rest });
      setPicked(-1);
    }
    input.current?.focus();
  };
  const removeFilter = (filter: Filter) => onChange({ ...query, filters: query.filters.filter((each) => each !== filter) });
  const flipFilter = (filter: Filter) =>
    onChange({ ...query, filters: query.filters.map((each) => (each === filter ? { ...each, negate: !each.negate || undefined } : each)) });

  return (
    <div className="relative flex min-w-0 items-center gap-2">
      <div
        className="flex min-h-9 min-w-0 flex-1 cursor-text flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus-within:border-foreground/30"
        onClick={() => input.current?.focus()}
      >
        <Icon name="Search" className="ml-1 size-4 shrink-0 text-muted-foreground" />
        {query.filters.map((filter, index) => {
          const { field, value } = describeFilter(filter, vocabulary);
          const unknown = resolveValue(filter, vocabulary) === undefined;
          return (
            <span
              key={`${index}:${filter.field}:${filter.value}`}
              className={cn(
                "flex h-6 max-w-64 items-center gap-1 rounded border border-border bg-foreground/[0.04] pr-0.5 pl-1.5 text-xs",
                unknown && "border-destructive/50 text-destructive",
              )}
            >
              <button
                type="button"
                title={filter.negate ? "Excluded. Click to include instead." : "Click to exclude instead"}
                className="flex min-w-0 items-center gap-1"
                onClick={(event) => {
                  event.stopPropagation();
                  flipFilter(filter);
                }}
              >
                <span className="text-muted-foreground">{filter.negate ? `Not ${field.toLowerCase()}` : field}:</span>
                <span className={cn("truncate", filter.negate && "line-through decoration-foreground/40")}>{value}</span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${field} ${value}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  removeFilter(filter);
                }}
              >
                <Icon name="X" className="size-3" />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          aria-label="Search and filter studio"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          placeholder={query.filters.length ? "" : "Search, or filter by kind:, project:, tag:, space:"}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
          value={query.text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && open) {
              event.preventDefault();
              setPicked((picked + 1) % suggestions.length);
            } else if (event.key === "ArrowUp" && open) {
              event.preventDefault();
              setPicked(picked <= 0 ? suggestions.length - 1 : picked - 1);
            } else if (event.key === "Enter" && open && picked >= 0) {
              event.preventDefault();
              apply(suggestions[picked]!);
            } else if (event.key === "Tab" && !event.shiftKey && tabTarget >= 0) {
              event.preventDefault();
              apply(suggestions[tabTarget]!);
            } else if (event.key === "Enter") {
              setText(`${query.text} `);
            } else if (event.key === "Backspace" && !query.text && query.filters.length) {
              removeFilter(query.filters.at(-1)!);
            } else if (event.key === "Escape") {
              if (open) setFocused(false);
              else if (query.text || query.filters.length) onChange({ filters: [], text: "" });
              else return;
              event.preventDefault();
            }
          }}
        />
        {query.text || query.filters.length ? (
          <button
            type="button"
            aria-label="Clear search and filters"
            className="mr-1 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onChange({ filters: [], text: "" });
            }}
          >
            <Icon name="X" className="size-3.5" />
          </button>
        ) : null}
      </div>
      {onOpenFilters ? (
        <button
          type="button"
          aria-label="Filters"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-state-hover hover:text-foreground md:hidden"
          onClick={onOpenFilters}
        >
          <Icon name="SlidersHorizontal" className="size-4" />
        </button>
      ) : null}
      {open ? (
        <div role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md">
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.type === "field" ? `field:${suggestion.field}` : `${suggestion.field}:${suggestion.value}`}
              role="option"
              aria-selected={index === picked}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 aria-selected:bg-state-active hover:bg-state-hover"
              // Keep focus in the input.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(suggestion)}
              onMouseEnter={() => setPicked(index)}
            >
              {suggestion.type === "field" ? (
                <>
                  <span className="font-mono text-xs">
                    {suggestion.negate ? "-" : ""}
                    {suggestion.field}:
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{suggestion.negate ? "Exclude" : FIELD_HINTS[suggestion.field]}</span>
                </>
              ) : (
                <>
                  <span className="shrink-0 text-xs text-muted-foreground">{suggestion.negate ? `Not ${suggestion.field}` : suggestion.field}</span>
                  <span className="truncate">{suggestion.label}</span>
                </>
              )}
              {index === tabTarget ? <kbd className="ml-auto shrink-0 rounded border border-border px-1 font-sans text-[10px] text-muted-foreground">Tab</kbd> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RailHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-5 mb-1 flex h-6 items-center justify-between px-2 text-xs font-medium text-muted-foreground">
      {children}
      {action}
    </div>
  );
}

function RailRow({
  label,
  count,
  active,
  excluded,
  onClick,
  onExclude,
  onRemove,
  glyph,
}: {
  label: string;
  count?: number;
  active?: boolean;
  excluded?: boolean;
  onClick(): void;
  onExclude?(): void;
  onRemove?(): void;
  glyph?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/facet flex h-7 items-center rounded-md text-sm hover:bg-state-hover",
        active && "bg-state-active text-foreground",
        !active && "text-muted-foreground hover:text-foreground",
      )}
    >
      <button type="button" aria-pressed={active} className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left" onClick={onClick}>
        {glyph}
        <span className={cn("truncate", excluded && "line-through decoration-foreground/40", count === 0 && !active && "opacity-60")}>{label}</span>
      </button>
      {onExclude ? (
        <button
          type="button"
          aria-label={excluded ? `Include ${label}` : `Exclude ${label}`}
          title={excluded ? "Include" : "Exclude"}
          className="hidden size-6 shrink-0 items-center justify-center rounded text-muted-foreground group-hover/facet:flex hover:text-foreground"
          onClick={onExclude}
        >
          <Icon name={excluded ? "Plus" : "Minus"} className="size-3.5" />
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Delete ${label}`}
          title="Delete"
          className="hidden size-6 shrink-0 items-center justify-center rounded text-muted-foreground group-hover/facet:flex hover:text-foreground"
          onClick={onRemove}
        >
          <Icon name="Trash2" className="size-3.5" />
        </button>
      ) : null}
      {count !== undefined ? <span className="shrink-0 pr-2 pl-1 text-xs tabular-nums text-muted-foreground group-hover/facet:hidden">{count}</span> : null}
    </div>
  );
}

function FacetSection({
  title,
  field,
  values,
  countOf,
  query,
  onChange,
  glyph,
}: {
  title: string;
  field: FilterField;
  values: readonly FieldValue[];
  countOf(value: FieldValue): number;
  query: Query;
  onChange(query: Query): void;
  glyph?(value: FieldValue): ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const stateOf = (value: FieldValue) => {
    const filter = query.filters.find((each) => each.field === field && each.value.toLowerCase() === value.value.toLowerCase());
    return filter ? (filter.negate ? "excluded" : "included") : null;
  };
  // Values in use first, then the most items; empty ones only when in use.
  const ranked = values
    .map((value) => ({ value, count: countOf(value), state: stateOf(value) }))
    .filter((each) => each.count > 0 || each.state)
    .sort((a, b) => Number(!!b.state) - Number(!!a.state) || b.count - a.count);
  if (!ranked.length) return null;
  const shown = expanded ? ranked : ranked.slice(0, SHOWN_VALUES);
  return (
    <section aria-label={title}>
      <RailHeading>{title}</RailHeading>
      {shown.map(({ value, count, state }) => (
        <RailRow
          key={value.value}
          label={value.label}
          count={count}
          active={state === "included"}
          excluded={state === "excluded"}
          glyph={glyph?.(value)}
          onClick={() => onChange(toggleFilter(query, { field, value: value.value }))}
          onExclude={() => onChange(toggleFilter(query, { field, value: value.value, negate: true }))}
        />
      ))}
      {ranked.length > SHOWN_VALUES ? (
        <button type="button" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show ${ranked.length - SHOWN_VALUES} more`}
        </button>
      ) : null}
    </section>
  );
}

export function FacetRail({
  query,
  vocabulary,
  counts,
  onChange,
  spaces,
  spaceCounts,
  currentSpace,
  onOpenSpace,
  onNewSpace,
  views,
  onSaveView,
  onDeleteView,
  tags,
}: {
  query: Query;
  vocabulary: QueryVocabulary;
  counts: FacetCounts;
  onChange(query: Query): void;
  spaces: readonly SpaceView[];
  /** Live items per space id, and in all. */
  spaceCounts: { all: number; bySpace: ReadonlyMap<string, number> };
  currentSpace: string | null;
  onOpenSpace(id: string | null): void;
  onNewSpace(): void;
  views: readonly SavedViewView[];
  onSaveView(): void;
  onDeleteView(view: SavedViewView): void;
  tags: readonly TagView[];
}) {
  const current = formatQuery(query);
  const tagColor = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag.color]));
  const spaceByName = new Map(spaces.map((space) => [space.name.toLowerCase(), space]));
  const idOf = (value: FieldValue) => resolveValue(value, vocabulary);
  const archived = query.filters.find((filter) => filter.field === "is" && filter.value.toLowerCase() === "archived");
  return (
    <nav aria-label="Filters" className="max-h-[calc(100vh-2rem)] overflow-auto pb-6 [&>:first-child]:mt-0">
      <RailHeading
        action={
          current ? (
            <button type="button" aria-label="Save view" title="Save this search as a view" className="rounded p-0.5 hover:bg-state-hover hover:text-foreground" onClick={onSaveView}>
              <Icon name="Plus" className="size-3.5" />
            </button>
          ) : null
        }
      >
        Views
      </RailHeading>
      {views.map((view) => (
        <RailRow
          key={view.id}
          label={view.name}
          active={view.query === current}
          glyph={<Icon name="Bookmark" className="size-3.5 shrink-0" />}
          onClick={() => onChange(view.query === current ? { filters: [], text: "" } : parseQuery(view.query))}
          onRemove={() => onDeleteView(view)}
        />
      ))}
      {!views.length ? <p className="px-2 text-xs text-muted-foreground">{current ? "Save this search with +." : "Filter, then save it here."}</p> : null}

      <RailHeading
        action={
          <button type="button" aria-label="New space" title="New space" className="rounded p-0.5 hover:bg-state-hover hover:text-foreground" onClick={onNewSpace}>
            <Icon name="Plus" className="size-3.5" />
          </button>
        }
      >
        Spaces
      </RailHeading>
      <RailRow label="All items" count={spaceCounts.all} active={currentSpace === null} glyph={<Icon name="Layers" className="size-3.5 shrink-0" />} onClick={() => onOpenSpace(null)} />
      {spaces.map((space) => (
        <RailRow
          key={space.id}
          label={space.name}
          count={spaceCounts.bySpace.get(space.id) ?? 0}
          active={currentSpace === space.id}
          glyph={<SpaceGlyph space={space} className="w-3.5 shrink-0 text-center text-xs" />}
          onClick={() => onOpenSpace(space.id)}
        />
      ))}

      <FacetSection title="Kind" field="kind" values={fieldValues("kind", vocabulary)} countOf={(value) => counts.kind.get(value.value) ?? 0} query={query} onChange={onChange} />
      <FacetSection
        title="Project"
        field="project"
        values={fieldValues("project", vocabulary)}
        countOf={(value) => counts.project.get(idOf(value) ?? "") ?? 0}
        query={query}
        onChange={onChange}
      />
      <FacetSection
        title="Tag"
        field="tag"
        values={fieldValues("tag", vocabulary)}
        countOf={(value) => counts.tag.get(idOf(value) ?? UNTAGGED) ?? 0}
        query={query}
        onChange={onChange}
        glyph={(value) => (value.value === UNTAGGED ? null : <TagDot color={tagColor.get(value.value.toLowerCase()) ?? "currentColor"} />)}
      />
      {currentSpace === null ? (
        <FacetSection
          title="In space"
          field="space"
          values={fieldValues("space", vocabulary)}
          countOf={(value) => counts.space.get(idOf(value) ?? "") ?? 0}
          query={query}
          onChange={onChange}
          glyph={(value) => {
            const space = spaceByName.get(value.value.toLowerCase());
            return space ? <SpaceGlyph space={space} className="w-3.5 shrink-0 text-center text-xs" /> : null;
          }}
        />
      ) : null}

      <RailHeading>Status</RailHeading>
      <RailRow
        label="Archived"
        count={counts.archived}
        active={!!archived && !archived.negate}
        glyph={<Icon name="Archive" className="size-3.5 shrink-0" />}
        onClick={() => onChange(toggleFilter(query, { field: "is", value: "archived" }))}
      />
    </nav>
  );
}

/** The rail in a sheet, where the page has no room beside the list. */
export function FiltersDialog({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Filters</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

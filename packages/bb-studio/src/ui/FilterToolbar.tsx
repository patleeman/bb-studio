// Filter choices live above the collection, leaving its full width for items.
import { cn, Icon, TagDot } from "@bb-studio/kit/app";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Popover, PopoverContent, PopoverTrigger } from "@bb-studio/kit/ui";
import { useState, type ReactNode } from "react";
import type { SavedViewView, SpaceView, TagView } from "../contract";
import { fieldValues, formatQuery, parseQuery, resolveValue, toggleFilter, UNTAGGED, type FacetCounts, type FieldValue, type FilterField, type Query, type QueryVocabulary } from "../query";
import { SpaceGlyph } from "./Spaces";

const BUTTON = "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

interface ChoicesProps {
  field: FilterField;
  label: string;
  query: Query;
  vocabulary: QueryVocabulary;
  onChange(query: Query): void;
  countOf?(value: FieldValue): number;
  glyph?(value: FieldValue): ReactNode;
}

function FilterChoices({ field, label, query, vocabulary, onChange, countOf, glyph }: ChoicesProps) {
  const [search, setSearch] = useState("");
  const values = fieldValues(field, vocabulary);
  const visible = values.filter((value) => value.label.toLowerCase().includes(search.toLowerCase()));
  const selected = (value: FieldValue) => query.filters.find((filter) => filter.field === field && resolveValue(filter, vocabulary) === resolveValue(value, vocabulary));
  return (
    <div>
      {values.length > 8 ? (
        <input aria-label={`Find ${label.toLowerCase()}`} placeholder={`Find ${label.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)} className="mb-1 h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring" />
      ) : null}
      <div className="max-h-60 overflow-y-auto">
        {visible.map((value) => {
          const filter = selected(value);
          return (
            <button key={value.value} type="button" aria-pressed={!!filter && !filter.negate} aria-label={value.label} className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-ring" onClick={() => {
              // Stored queries can use an id, singular label or plural label.
              // Always remove the resolved choice, regardless of its spelling.
              const rest = { ...query, filters: query.filters.filter((each) => each !== filter) };
              onChange(filter && !filter.negate ? rest : toggleFilter(rest, value));
            }}>
              <span className="flex size-4 shrink-0 items-center justify-center rounded border border-border" aria-hidden="true">{filter && !filter.negate ? <Icon name="Check" className="size-3" /> : null}</span>
              {glyph?.(value)}
              <span className="min-w-0 flex-1 truncate">{value.label}</span>
              {filter?.negate ? <span className="text-xs text-muted-foreground">Excluded</span> : null}
              {countOf ? <span className="text-xs tabular-nums text-muted-foreground">{countOf(value)}</span> : null}
            </button>
          );
        })}
        {!visible.length ? <p className="px-2 py-3 text-sm text-muted-foreground">No matches.</p> : null}
      </div>
    </div>
  );
}

function FilterPicker(props: ChoicesProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Filter by ${props.label.toLowerCase()}`} className={BUTTON}>
          {props.label}<Icon name="ChevronDown" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={`${props.label} filters`} className="w-64 max-w-[calc(100vw-2rem)]">
        <FilterChoices {...props} />
      </PopoverContent>
    </Popover>
  );
}

export function FilterToolbar({ query, vocabulary, counts, onChange, spaces, views, tags, onSaveView, onDeleteView }: {
  query: Query;
  vocabulary: QueryVocabulary;
  counts: FacetCounts;
  onChange(query: Query): void;
  spaces: readonly SpaceView[];
  views: readonly SavedViewView[];
  tags: readonly TagView[];
  onSaveView(): void;
  onDeleteView(view: SavedViewView): void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const current = formatQuery(query);
  const shared = { query, vocabulary, onChange };
  const idOf = (value: FieldValue) => resolveValue(value, vocabulary);
  const tagColor = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag.color]));
  const spaceByName = new Map(spaces.map((space) => [space.name.toLowerCase(), space]));
  return (
    <>
      {spaces.length ? <FilterPicker {...shared} field="space" label="Space" countOf={(value) => counts.space.get(idOf(value) ?? "") ?? 0} glyph={(value) => {
        const space = spaceByName.get(value.value.toLowerCase());
        return space ? <SpaceGlyph space={space} className="w-3.5 shrink-0 text-center text-xs" /> : null;
      }} /> : null}
      <FilterPicker {...shared} field="kind" label="Kind" countOf={(value) => counts.kind.get(idOf(value) ?? "") ?? 0} />
      <button type="button" aria-haspopup="dialog" className={BUTTON} onClick={() => setMoreOpen(true)}><Icon name="SlidersHorizontal" className="size-3.5" />More filters</button>
      {views.length ? (
        <Popover open={viewsOpen} onOpenChange={setViewsOpen}>
          <PopoverTrigger asChild><button type="button" className={BUTTON}><Icon name="studio/bookmark" className="size-3.5" />Views<Icon name="ChevronDown" className="size-3.5" /></button></PopoverTrigger>
          <PopoverContent aria-label="Saved views" className="w-64">
            {views.map((view) => (
              <div key={view.id} className="flex items-center gap-1">
                <button type="button" aria-pressed={view.query === current} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-2 text-left text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { onChange(parseQuery(view.query)); setViewsOpen(false); }}>
                  <span className="min-w-0 flex-1 truncate">{view.name}</span>{view.query === current ? <Icon name="Check" className="size-3.5" /> : null}
                </button>
                <button type="button" aria-label={`Delete ${view.name}`} className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onDeleteView(view)}><Icon name="Trash2" className="size-3.5" /></button>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      {current ? <button type="button" aria-label="Save view" title="Save this search as a view" className={cn(BUTTON, "px-2")} onClick={onSaveView}><Icon name="BookmarkPlus" className="size-3.5" /><span className="@max-3xl/page:sr-only">Save view</span></button> : null}
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>More filters</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <section aria-label="Project"><h3 className="mb-1 text-xs font-medium text-muted-foreground">Project</h3><FilterChoices {...shared} field="project" label="Projects" countOf={(value) => counts.project.get(idOf(value) ?? "") ?? 0} /></section>
            {tags.length || query.filters.some((filter) => filter.field === "tag") ? <section aria-label="Tags"><h3 className="mb-1 text-xs font-medium text-muted-foreground">Tags</h3><FilterChoices {...shared} field="tag" label="Tags" countOf={(value) => counts.tag.get(idOf(value) ?? UNTAGGED) ?? 0} glyph={(value) => value.value === UNTAGGED ? null : <TagDot color={tagColor.get(value.value.toLowerCase()) ?? "currentColor"} />} /></section> : null}
            <section aria-label="Status"><h3 className="mb-1 text-xs font-medium text-muted-foreground">Status</h3><FilterChoices {...shared} field="is" label="Status" /></section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

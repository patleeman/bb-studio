// Filter choices live above the collection, leaving its full width for items.
import { Icon, TagDot } from "../kit/app/index";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Popover, PopoverContent, PopoverTrigger } from "../kit/ui/index";
import { useState, type ReactNode } from "react";
import { useSearchEscape } from "../kit/ui/search-escape";
import type { TagView } from "../contract";
import { ITEM_TYPES } from "../item-model";
import { fieldValues, resolveValue, toggleFilter, UNTAGGED, type FacetCounts, type FieldValue, type FilterField, type Query, type QueryVocabulary } from "../query";

const BUTTON = "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

interface ChoicesProps {
  field: FilterField;
  label: string;
  values?: readonly FieldValue[];
  query: Query;
  vocabulary: QueryVocabulary;
  onChange(query: Query): void;
  countOf?(value: FieldValue): number;
  glyph?(value: FieldValue): ReactNode;
}

function FilterChoices({ field, label, values: given, query, vocabulary, onChange, countOf, glyph }: ChoicesProps) {
  const [search, setSearch] = useState("");
  // In a popover or dialog: Escape clears the search before it closes them.
  const searchField = useSearchEscape(search, () => setSearch(""));
  const values = given ?? fieldValues(field, vocabulary);
  const visible = values.filter((value) => value.label.toLowerCase().includes(search.toLowerCase()));
  const selected = (value: FieldValue) => query.filters.find((filter) => filter.field === value.field && resolveValue(filter, vocabulary) === resolveValue(value, vocabulary));
  return (
    <div>
      {values.length > 8 ? (
        <input ref={searchField} aria-label={`Find ${label.toLowerCase()}`} placeholder={`Find ${label.toLowerCase()}…`} value={search} onChange={(event) => setSearch(event.target.value)} className="mb-1 h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring" />
      ) : null}
      <div className="max-h-60 overflow-y-auto">
        {visible.map((value) => {
          const filter = selected(value);
          return (
            <button key={`${value.field}:${value.value}`} type="button" aria-pressed={!!filter && !filter.negate} aria-label={value.label} className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-ring" onClick={() => {
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

const APP_KINDS: ReadonlySet<string> = new Set(ITEM_TYPES.filter((type) => type.family === "app").map((type) => type.kind));
const APPS: FieldValue = { field: "family", value: "app", label: "Apps" };
export const APP_TYPES: readonly { type: string; label: string }[] = [{ type: "mini", label: "Interactive" }, { type: "artifact", label: "Saved" }];

export function kindChoices(vocabulary: QueryVocabulary): FieldValue[] {
  const values = fieldValues("kind", vocabulary);
  const first = values.findIndex((value) => APP_KINDS.has(value.value));
  if (first < 0) return values;
  return values.flatMap((value, index) => index === first ? [APPS] : APP_KINDS.has(value.value) ? [] : [value]);
}

const appsChosen = (query: Query, vocabulary: QueryVocabulary) => query.filters.some((filter) => filter.field === "family" && !filter.negate && resolveValue(filter, vocabulary) === "app");

export function withoutStrayAppTypes(previous: Query, query: Query, vocabulary: QueryVocabulary): Query {
  if (!appsChosen(previous, vocabulary) || appsChosen(query, vocabulary)) return query;
  const types = new Set(APP_TYPES.map((each) => each.type));
  return { ...query, filters: query.filters.filter((filter) => !(filter.field === "type" && !filter.negate && types.has(resolveValue(filter, vocabulary) ?? ""))) };
}

export function FilterToolbar({ query, vocabulary, counts, onChange, tags }: {
  query: Query;
  vocabulary: QueryVocabulary;
  counts: FacetCounts;
  onChange(query: Query): void;
  tags: readonly TagView[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const shared = { query, vocabulary, onChange };
  const idOf = (value: FieldValue) => resolveValue(value, vocabulary);
  const tagColor = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag.color]));
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      <FilterPicker {...shared} field="project" label="Project" countOf={(value) => counts.project.get(idOf(value) ?? "") ?? 0} />
      <FilterPicker {...shared} onChange={(next) => onChange(withoutStrayAppTypes(query, next, vocabulary))} field="kind" label="Kind" values={kindChoices(vocabulary)}
        countOf={(value) => value.field === "family" ? [...APP_KINDS].reduce((n, kind) => n + (counts.kind.get(kind) ?? 0), 0) : counts.kind.get(idOf(value) ?? "") ?? 0} />
      {appsChosen(query, vocabulary) ? APP_TYPES.map((each) => {
        const value: FieldValue = { field: "type", value: each.type, label: each.label };
        const on = query.filters.some((filter) => filter.field === "type" && !filter.negate && resolveValue(filter, vocabulary) === each.type);
        return (
          <button key={each.type} type="button" aria-pressed={on} data-testid="library-app-type" className={`${BUTTON} aria-pressed:bg-state-active aria-pressed:text-foreground`}
            onClick={() => onChange(on ? { ...query, filters: query.filters.filter((filter) => !(filter.field === "type" && resolveValue(filter, vocabulary) === each.type)) } : toggleFilter(query, value))}>
            {each.label}
          </button>
        );
      }) : null}
      <button type="button" aria-haspopup="dialog" className={BUTTON} onClick={() => setMoreOpen(true)}><Icon name="SlidersHorizontal" className="size-3.5" />More filters</button>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>More filters</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {tags.length || query.filters.some((filter) => filter.field === "tag") ? <section aria-label="Tags"><h3 className="mb-1 text-xs font-medium text-muted-foreground">Tags</h3><FilterChoices {...shared} field="tag" label="Tags" countOf={(value) => counts.tag.get(idOf(value) ?? UNTAGGED) ?? 0} glyph={(value) => value.value === UNTAGGED ? null : <TagDot color={tagColor.get(value.value.toLowerCase()) ?? "currentColor"} />} /></section> : null}
            <section aria-label="Status"><h3 className="mb-1 text-xs font-medium text-muted-foreground">Status</h3><FilterChoices {...shared} field="is" label="Status" /></section>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

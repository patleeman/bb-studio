// The collection's query language, shared by the filter bar, the agent tool
// and the CLI: `kind:page project:"Q4 launch" -tag:draft is:archived notes`.
// Filters on one field match any of their values, different fields all must
// match, `-` excludes, and the remaining words search titles and content.

export const FILTER_FIELDS = ["kind", "project", "tag", "space", "is"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export interface Filter {
  field: FilterField;
  value: string;
  negate?: boolean;
}

export interface Query {
  filters: Filter[];
  /** The words that aren't filters. */
  text: string;
}

/** What names in a query refer to. */
export interface QueryVocabulary {
  kinds: readonly { id: string; label: string; plural: string; background?: boolean }[];
  projects: readonly { id: string; name: string }[];
  tags: readonly { id: string; name: string }[];
  spaces: readonly { id: string; name: string }[];
}

export interface QueryItem {
  kind: string;
  projectId: string | null;
  archived: boolean;
  template?: boolean;
  tags?: readonly string[];
  spaces?: readonly string[];
}

export const GLOBAL_PROJECT = "global";
export const UNTAGGED = "none";
export const IS_VALUES = ["archived", "template"] as const;

const TOKEN = /(-?)([a-z]+):("[^"]*"?|\S*)|"([^"]*)"?|\S+/gi;

function unquote(value: string): string {
  return value.startsWith('"') ? value.slice(1, value.endsWith('"') && value.length > 1 ? -1 : undefined) : value;
}

function isField(name: string): name is FilterField {
  return (FILTER_FIELDS as readonly string[]).includes(name);
}

export function parseQuery(input: string): Query {
  const filters: Filter[] = [];
  const words: string[] = [];
  for (const match of input.matchAll(TOKEN)) {
    const [whole, negate, field, value, phrase] = match;
    const name = field?.toLowerCase();
    if (name && isField(name)) {
      // A field still waiting for its value is neither a filter nor a word.
      if (unquote(value!).trim()) filters.push({ field: name, value: unquote(value!).trim(), ...(negate ? { negate: true } : {}) });
    } else if (phrase !== undefined) {
      if (phrase.trim()) words.push(phrase.trim());
    } else {
      words.push(whole);
    }
  }
  return { filters, text: words.join(" ") };
}

export function formatValue(value: string): string {
  return /[\s"]/.test(value) || !value ? `"${value.replace(/"/g, "")}"` : value;
}

export function formatFilter(filter: Filter): string {
  return `${filter.negate ? "-" : ""}${filter.field}:${formatValue(filter.value)}`;
}

export function formatQuery(query: Query): string {
  return [...query.filters.map(formatFilter), query.text.trim()].filter(Boolean).join(" ");
}

export function sameFilter(a: Filter, b: Filter): boolean {
  return a.field === b.field && a.value.toLowerCase() === b.value.toLowerCase() && !!a.negate === !!b.negate;
}

/** The query with the filter added, or taken out when it's there; an opposite filter is replaced. */
export function toggleFilter(query: Query, filter: Filter): Query {
  const has = query.filters.some((each) => sameFilter(each, filter));
  const rest = query.filters.filter((each) => !(each.field === filter.field && each.value.toLowerCase() === filter.value.toLowerCase()));
  return { ...query, filters: has ? rest : [...rest, filter] };
}

const lower = (value: string) => value.trim().toLowerCase();

/** The id a filter value names, or undefined when it names nothing. */
export function resolveValue(filter: Filter, vocabulary: QueryVocabulary): string | null | undefined {
  const value = lower(filter.value);
  switch (filter.field) {
    case "kind":
      return vocabulary.kinds.find((kind) => [kind.id, kind.label, kind.plural].some((name) => lower(name) === value))?.id;
    case "project":
      if (value === GLOBAL_PROJECT) return null;
      return vocabulary.projects.find((project) => project.id === filter.value || lower(project.name) === value)?.id;
    case "tag":
      if (value === UNTAGGED) return UNTAGGED;
      return vocabulary.tags.find((tag) => tag.id === filter.value || lower(tag.name) === value.replace(/^#/, ""))?.id;
    case "space":
      return vocabulary.spaces.find((space) => space.id === filter.value || lower(space.name) === value)?.id;
    case "is":
      return (IS_VALUES as readonly string[]).includes(value) ? value : undefined;
  }
}

function hasValue(field: FilterField, id: string | null, item: QueryItem): boolean {
  switch (field) {
    case "kind":
      return item.kind === id;
    case "project":
      return item.projectId === id;
    case "tag":
      return id === UNTAGGED ? !item.tags?.length : !!item.tags?.includes(id!);
    case "space":
      return !!item.spaces?.includes(id!);
    case "is":
      return id === "archived" ? item.archived : !!item.template;
  }
}

export interface CompiledQuery {
  text: string;
  /** Filters whose value names nothing, so they match nothing. */
  unknown: Filter[];
  /** Whether the query shows archived items rather than live ones. */
  archived: boolean;
  /**
   * Whether an item passes the filters. `except` leaves out one field's
   * positive filters, for the counts beside that field's values. Text is
   * the caller's to match.
   */
  test(item: QueryItem, except?: FilterField): boolean;
}

/**
 * Compiles a query against what its names refer to. Archived items show only
 * with `is:archived`, and kinds that run in the background only when asked
 * for by kind or searched for.
 */
export function compileQuery(query: Query, vocabulary: QueryVocabulary): CompiledQuery {
  const resolved: { field: FilterField; id: string | null; negate: boolean }[] = [];
  const unknown: Filter[] = [];
  for (const filter of query.filters) {
    const id = resolveValue(filter, vocabulary);
    if (id === undefined) unknown.push(filter);
    else resolved.push({ field: filter.field, id, negate: !!filter.negate });
  }
  const archived = resolved.some((filter) => filter.field === "is" && filter.id === "archived" && !filter.negate);
  const text = query.text.trim();
  const background = new Set(vocabulary.kinds.filter((kind) => kind.background).map((kind) => kind.id));
  const askedForKind = resolved.some((filter) => filter.field === "kind" && !filter.negate);
  const fields = [...new Set(resolved.filter((filter) => !filter.negate).map((filter) => filter.field))];
  // An unknown positive filter matches nothing; an unknown exclusion excludes nothing.
  const impossible = unknown.some((filter) => !filter.negate);
  return {
    text,
    unknown,
    archived,
    test(item, except) {
      if (impossible) return false;
      if (except !== "is" && item.archived !== archived) return false;
      if (except !== "kind" && !askedForKind && !text && background.has(item.kind)) return false;
      if (resolved.some((filter) => filter.negate && hasValue(filter.field, filter.id, item))) return false;
      return fields.every(
        (field) => field === except || resolved.some((filter) => filter.field === field && !filter.negate && hasValue(field, filter.id, item)),
      );
    },
  };
}

/**
 * Kinds that run in the background, as `pluginId:kind`. Lists that show what's
 * recent or what a space holds skip their items, as the All view does.
 */
export function backgroundKinds(providers: readonly { pluginId: string; kinds: readonly { id: string; background?: boolean }[] }[]): Set<string> {
  return new Set(providers.flatMap((provider) => provider.kinds.filter((kind) => kind.background).map((kind) => `${provider.pluginId}:${kind.id}`)));
}

export interface FacetCounts {
  kind: Map<string, number>;
  /** By project id, with "" for global items. */
  project: Map<string, number>;
  /** By tag id, with "none" for untagged items. */
  tag: Map<string, number>;
  space: Map<string, number>;
  archived: number;
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** How many items each value would show, given the rest of the query. */
export function facetCounts(items: readonly QueryItem[], compiled: CompiledQuery, matchesText: (item: QueryItem) => boolean = () => true): FacetCounts {
  const counts: FacetCounts = { kind: new Map(), project: new Map(), tag: new Map(), space: new Map(), archived: 0 };
  for (const item of items) {
    if (!matchesText(item)) continue;
    if (compiled.test(item, "kind")) bump(counts.kind, item.kind);
    if (compiled.test(item, "project")) bump(counts.project, item.projectId ?? "");
    if (compiled.test(item, "tag")) {
      if (!item.tags?.length) bump(counts.tag, UNTAGGED);
      for (const tag of item.tags ?? []) bump(counts.tag, tag);
    }
    if (compiled.test(item, "space")) for (const space of item.spaces ?? []) bump(counts.space, space);
    if (item.archived && compiled.test(item, "is")) counts.archived += 1;
  }
  return counts;
}

export interface FieldValue {
  field: FilterField;
  /** What the query says. */
  value: string;
  /** What the user sees. */
  label: string;
}

/** Every value a field can take, as the query writes it. */
export function fieldValues(field: FilterField, vocabulary: QueryVocabulary): FieldValue[] {
  switch (field) {
    case "kind":
      return vocabulary.kinds.map((kind) => ({ field, value: kind.id, label: kind.plural }));
    case "project":
      return [{ field, value: GLOBAL_PROJECT, label: "Global" }, ...vocabulary.projects.map((project) => ({ field, value: project.name, label: project.name }))];
    case "tag":
      return [{ field, value: UNTAGGED, label: "Untagged" }, ...vocabulary.tags.map((tag) => ({ field, value: tag.name, label: tag.name }))];
    case "space":
      return vocabulary.spaces.map((space) => ({ field, value: space.name, label: space.name }));
    case "is":
      return IS_VALUES.map((value) => ({ field, value, label: value === "archived" ? "Archived" : "Templates" }));
  }
}

/** A filter as the user reads it, e.g. "Kind: Pages". */
export function describeFilter(filter: Filter, vocabulary: QueryVocabulary): { field: string; value: string } {
  const field = filter.field === "is" ? "Is" : filter.field[0]!.toUpperCase() + filter.field.slice(1);
  const id = resolveValue(filter, vocabulary);
  const known = id === undefined ? undefined : fieldValues(filter.field, vocabulary).find((each) => resolveValue(each, vocabulary) === id);
  return { field, value: known?.label ?? filter.value };
}

export type Suggestion = { type: "field"; field: FilterField; negate: boolean } | ({ type: "value"; negate: boolean } & FieldValue);

/** What the word being typed could become: a field, or a value of one. */
export function suggest(word: string, vocabulary: QueryVocabulary, limit = 8): Suggestion[] {
  const negate = word.startsWith("-");
  const bare = negate ? word.slice(1) : word;
  const colon = bare.indexOf(":");
  const field = colon > 0 ? bare.slice(0, colon).toLowerCase() : null;
  if (field !== null) {
    if (!isField(field)) return [];
    const partial = lower(unquote(bare.slice(colon + 1)));
    return fieldValues(field, vocabulary)
      .filter((each) => !partial || lower(each.label).includes(partial) || lower(each.value).includes(partial))
      .slice(0, limit)
      .map((each) => ({ type: "value", negate, ...each }));
  }
  const partial = lower(bare);
  const fields: Suggestion[] = FILTER_FIELDS.filter((each) => each.startsWith(partial)).map((each) => ({ type: "field", field: each, negate }));
  if (!partial) return fields;
  const values: Suggestion[] = FILTER_FIELDS.filter((each) => each !== "is")
    .flatMap((each) => fieldValues(each, vocabulary))
    .filter((each) => lower(each.label).includes(partial))
    .map((each) => ({ type: "value", negate, ...each }));
  return [...fields, ...values].slice(0, limit);
}

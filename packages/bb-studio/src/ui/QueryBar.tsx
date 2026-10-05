// Search with optional query completion and a separate row of active filters.
import { cn, Icon, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@bb-studio/kit/app";
import { useId, useMemo, useRef, useState } from "react";
import {
  describeFilter,
  parseQuery,
  resolveValue,
  sameFilter,
  suggest,
  type Filter,
  type FilterField,
  type Query,
  type QueryVocabulary,
  type Suggestion,
} from "../query";

const FIELD_HINTS: Record<FilterField, string> = {
  kind: "Pages, recordings, drawings…",
  project: "A project, or global",
  tag: "A tag, or none",
  space: "A space's items",
  is: "Archived or templates",
};

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
  loading = false,
}: {
  query: Query;
  vocabulary: QueryVocabulary;
  onChange(query: Query): void;
  /** While the vocabulary loads, no value is flagged as unknown. */
  loading?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState(-1);
  const word = pendingWord(query.text);
  const suggestions = useMemo(
    () => suggest(word, vocabulary).filter((each) => each.type === "field" || !query.filters.some((filter) => sameFilter(filter, { field: each.field, value: each.value, negate: each.negate }))),
    [word, vocabulary, query.filters],
  );
  const open = focused && word.includes(":") && suggestions.length > 0;
  // Tab completes what's being typed, so it takes the first suggestion when none is picked.
  const active = picked < suggestions.length ? picked : -1;
  const tabTarget = !open ? -1 : active >= 0 ? active : word ? 0 : -1;

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
    <div className="min-w-0">
      <div className="relative flex min-w-0 items-center gap-2">
        <div
          className="flex min-h-9 min-w-0 flex-1 cursor-text flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-sm focus-within:border-foreground/30"
          onClick={() => input.current?.focus()}
        >
          <Icon name="Search" className="ml-1 size-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            aria-label="Search and filter studio"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
            placeholder="Search Studio"
            className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
            value={query.text}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
            }}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && open) {
                event.preventDefault();
                setPicked((picked + 1) % suggestions.length);
              } else if (event.key === "ArrowUp" && open) {
                event.preventDefault();
                setPicked(picked <= 0 ? suggestions.length - 1 : picked - 1);
              } else if (event.key === "Enter" && open && active >= 0) {
                event.preventDefault();
                apply(suggestions[active]!);
              } else if (event.key === "Tab" && !event.shiftKey && tabTarget >= 0) {
                event.preventDefault();
                apply(suggestions[tabTarget]!);
              } else if (event.key === "Enter") {
                setText(`${query.text} `);
              } else if (event.key === "Escape") {
                if (open) setFocused(false);
                else if (query.text) onChange({ ...query, text: "" });
                else return;
                event.preventDefault();
              }
            }}
          />
          {query.text ? (
            <button
              type="button"
              aria-label="Clear search"
              className="mr-1 text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onChange({ ...query, text: "" });
              }}
            >
              <Icon name="X" className="size-3.5" />
            </button>
          ) : null}
        </div>
        {open ? (
          <div id={listId} role="listbox" aria-label="Search suggestions" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md">
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion.type === "field" ? `field:${suggestion.field}` : `${suggestion.field}:${suggestion.value}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
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
      {query.filters.length ? (
        <div aria-label="Active filters" className="mt-2 flex flex-wrap items-center gap-1.5">
          {query.filters.map((filter, index) => {
            const { field, value } = describeFilter(filter, vocabulary);
            const unknown = !loading && resolveValue(filter, vocabulary) === undefined;
            return (
              <span
                key={`${index}:${filter.field}:${filter.value}`}
                className={cn(
                  "flex h-6 max-w-64 items-center gap-1 rounded border border-border bg-foreground/[0.04] pr-0.5 pl-1.5 text-xs",
                  unknown && "border-destructive/50 text-destructive",
                )}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`Options for ${field} ${value}`} className="flex min-w-0 items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="text-muted-foreground">{filter.negate ? `Not ${field.toLowerCase()}` : field}:</span>
                      <span className={cn("truncate", filter.negate && "line-through decoration-foreground/40")}>{value}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => flipFilter(filter)}>{filter.negate ? "Include" : "Exclude"} {value}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => removeFilter(filter)}>Remove filter</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  aria-label={`Remove ${field} ${value}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
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
          <button type="button" className="h-7 rounded px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onChange({ ...query, filters: [] })}>Clear filters</button>
        </div>
      ) : null}
    </div>
  );
}

// The toolbar every Bot page has, under its header: a search field, the
// page's filter pills (bb's segmented ToggleGroup), its menus (a sort, a
// grouping) and "New" on the right. Pills show when there is more than one.
import { forwardRef, type ReactNode, type Ref } from "react";
import { Button, type ButtonProps } from "../../kit/ui/button";
import { Icon } from "../../kit/ui/icon";
import { Input } from "../../kit/ui/input";
import { handleSearchEscape } from "../../kit/ui/search-escape";
import { ToggleGroup, ToggleGroupItem } from "../../kit/ui/toggle-group";
import { cn } from "../../kit/ui/utils";

export interface BotPageSearch {
  value: string;
  onChange(value: string): void;
  placeholder: string;
  /** The field's accessible name; the placeholder when not given. */
  label?: string;
  inputRef?: Ref<HTMLInputElement>;
}

export interface BotPagePill<T extends string> { id: T; label: string; count?: number }

export interface BotPageFilter<T extends string> {
  /** The pills' accessible name: "Area", "Kind", "Topic". */
  label: string;
  value: T;
  options: readonly BotPagePill<T>[];
  onChange(value: T): void;
}

/** "New", the toolbar's add action; a menu's trigger as well (it forwards its ref). */
export const BotPageNewButton = forwardRef<HTMLButtonElement, ButtonProps>(({ children = "New", className, ...props }, ref) => (
  <Button ref={ref} type="button" variant="outline" size="sm" data-testid="bot-page-new" className={cn("h-8 gap-1.5 px-3 text-sm font-normal", className)} {...props}>
    <Icon name="Plus" />{children}
  </Button>
));
BotPageNewButton.displayName = "BotPageNewButton";

export function BotPageToolbar<T extends string>({ search, filter, menus, onNew, newLabel, newAction }: {
  search?: BotPageSearch;
  filter?: BotPageFilter<T>;
  /** Menus beside the search: a sort, a grouping. */
  menus?: ReactNode;
  /** Shows "New" (or `newLabel`) and runs this. */
  onNew?(): void;
  newLabel?: string;
  /** In place of the plain New button: a New menu, built on BotPageNewButton. */
  newAction?: ReactNode;
}) {
  const pills = filter && filter.options.length > 1 ? filter : null;
  return (
    <div data-testid="bot-page-toolbar" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {search ? (
          <label className="relative min-w-56 flex-1">
            <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={search.inputRef} type="search" data-testid="bot-page-search" aria-label={search.label ?? search.placeholder} placeholder={search.placeholder} value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              onKeyDown={(event) => { handleSearchEscape(event, search.value, () => search.onChange(""), { whenEmpty: "blur" }); }}
              className="h-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden" />
          </label>
        ) : <span className="flex-1" />}
        {menus}
        {newAction ?? (onNew ? <BotPageNewButton onClick={onNew}>{newLabel ?? "New"}</BotPageNewButton> : null)}
      </div>
      {pills ? (
        <ToggleGroup type="single" aria-label={pills.label} data-testid="bot-page-pills" value={pills.value} onValueChange={(value) => { if (value) pills.onChange(value as T); }}
          className="flex-wrap justify-start gap-1">
          {pills.options.map((pill) => (
            <ToggleGroupItem key={pill.id} value={pill.id} data-testid="bot-page-pill" data-studio-pill="" data-value={pill.id}
              className="h-7 min-w-0 gap-1.5 px-2.5 text-sm font-normal text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=on]:bg-state-active data-[state=on]:text-foreground">
              {pill.label}
              {pill.count !== undefined ? <span className="text-xs tabular-nums text-muted-foreground">{pill.count}</span> : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}
    </div>
  );
}

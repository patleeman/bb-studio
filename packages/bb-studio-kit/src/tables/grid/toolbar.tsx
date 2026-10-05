// The bar above a table: its views as tabs, and the current view's
// filters, sorts and visible columns.
import { useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../ui/dropdown-menu";
import { Icon } from "../../ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { cn } from "../../ui/utils";
import { COLUMN_TYPE_INFO, type Cell, type Column, type Filter, type FilterOp, type Table, type View, type ViewType } from "../model";
import { MENU_ITEM, newColumnId, uniqueName } from "./column-menu";
import type { TableMeta } from "./state";

const VIEW_INFO: Record<ViewType, { label: string; icon: string }> = {
  table: { label: "Table", icon: "Rows2" },
  board: { label: "Board", icon: "Columns2" },
  calendar: { label: "Calendar", icon: "Calendar" },
};

const BAR_BUTTON =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:text-primary data-[state=open]:bg-state-active [&_[data-icon-root]]:size-3.5";
const FIELD = "h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";

const OP_LABELS: Record<FilterOp, string> = {
  contains: "contains",
  eq: "is",
  neq: "is not",
  gt: "is above",
  lt: "is below",
  empty: "is empty",
  "not-empty": "is not empty",
};

function opsFor(column: Column | undefined): FilterOp[] {
  switch (column?.type) {
    case "number":
    case "date":
      return ["eq", "neq", "gt", "lt", "empty", "not-empty"];
    case "checkbox":
      return ["eq"];
    case "select":
    case "multi-select":
    case "person":
    case "bot":
      return ["eq", "neq", "empty", "not-empty"];
    default:
      return ["contains", "eq", "neq", "empty", "not-empty"];
  }
}

export function newViewId(): string {
  return `view_${crypto.randomUUID().slice(0, 8)}`;
}

/** A new view of `type`, adding the select or date column it needs when the table has none. */
function addView(table: Table, type: ViewType, name: string): TableMeta & { view: View } {
  let columns = table.columns;
  let groupBy: string | null = null;
  let dateBy: string | null = null;
  if (type === "board") {
    let select = columns.find((column) => column.type === "select");
    if (!select) {
      select = { id: newColumnId(), name: uniqueName(columns, "Status"), type: "select", options: ["Not started", "In progress", "Done"] };
      columns = [...columns, select];
    }
    groupBy = select.id;
  }
  if (type === "calendar") {
    let date = columns.find((column) => column.type === "date");
    if (!date) {
      date = { id: newColumnId(), name: uniqueName(columns, "Date"), type: "date", options: [] };
      columns = [...columns, date];
    }
    dateBy = date.id;
  }
  const view: View = { id: newViewId(), name, type, groupBy, dateBy, filters: [], sorts: [], hidden: [] };
  return { view, views: [...table.views, view], ...(columns === table.columns ? {} : { columns }) };
}

function FilterValue({ column, filter, onChange }: { column: Column | undefined; filter: Filter; onChange(value: Cell): void }) {
  const [draft, setDraft] = useState(filter.value == null ? "" : String(filter.value));
  if (filter.op === "empty" || filter.op === "not-empty") return null;
  if (column?.type === "checkbox")
    return (
      <select aria-label="Value" className={FIELD} value={filter.value === true ? "yes" : "no"} onChange={(event) => onChange(event.target.value === "yes")}>
        <option value="yes">Checked</option>
        <option value="no">Unchecked</option>
      </select>
    );
  if (column?.type === "select" || column?.type === "multi-select")
    return (
      <select aria-label="Value" className={cn(FIELD, "flex-1")} value={typeof filter.value === "string" ? filter.value : ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Any option</option>
        {column.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  const save = () => onChange(column?.type === "number" ? (draft.trim() && Number.isFinite(Number(draft)) ? Number(draft) : null) : draft || null);
  return (
    <input
      aria-label="Value"
      type={column?.type === "date" ? "date" : column?.type === "number" ? "number" : "text"}
      className={cn(FIELD, "flex-1")}
      value={draft}
      placeholder="Value"
      onChange={(event) => {
        setDraft(event.target.value);
        if (column?.type === "date") onChange(event.target.value || null);
      }}
      onKeyDown={(event) => event.key === "Enter" && save()}
      onBlur={save}
    />
  );
}

function FilterMenu({ table, view, onView }: { table: Table; view: View; onView(view: View): void }) {
  const set = (filters: Filter[]) => onView({ ...view, filters });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={BAR_BUTTON} aria-pressed={view.filters.length > 0}>
          <Icon name="FilterHorizontal" /> Filter{view.filters.length ? ` · ${view.filters.length}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[26rem] max-w-[calc(100vw-1rem)] p-2" align="end" onKeyDown={(event) => event.stopPropagation()}>
        {view.filters.length ? null : <p className="px-1 pb-2 text-sm text-muted-foreground">No filters in this view.</p>}
        <div className="space-y-1.5">
          {view.filters.map((filter, index) => {
            const column = table.columns.find((each) => each.id === filter.columnId);
            const replace = (next: Filter) => set(view.filters.map((each, at) => (at === index ? next : each)));
            return (
              <div key={`${index}-${filter.columnId}`} className="flex items-center gap-1.5">
                <select
                  aria-label="Column"
                  className={cn(FIELD, "w-28")}
                  value={filter.columnId}
                  onChange={(event) => {
                    const next = table.columns.find((each) => each.id === event.target.value);
                    replace({ columnId: event.target.value, op: opsFor(next)[0]!, value: next?.type === "checkbox" ? true : null });
                  }}
                >
                  {table.columns.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </select>
                <select aria-label="Condition" className={cn(FIELD, "w-28")} value={filter.op} onChange={(event) => replace({ ...filter, op: event.target.value as FilterOp })}>
                  {opsFor(column).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                <FilterValue key={`${filter.columnId}-${filter.op}`} column={column} filter={filter} onChange={(value) => replace({ ...filter, value })} />
                <button type="button" aria-label="Remove filter" className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => set(view.filters.filter((_, at) => at !== index))}>
                  <Icon name="X" className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={cn(MENU_ITEM, "mt-1 text-muted-foreground")}
          disabled={view.filters.length >= 20}
          onClick={() => {
            const column = table.columns[0]!;
            set([...view.filters, { columnId: column.id, op: opsFor(column)[0]!, value: column.type === "checkbox" ? true : null }]);
          }}
        >
          <Icon name="Plus" /> Add filter
        </button>
      </PopoverContent>
    </Popover>
  );
}

function SortMenu({ table, view, onView }: { table: Table; view: View; onView(view: View): void }) {
  const set = (sorts: View["sorts"]) => onView({ ...view, sorts });
  const unused = table.columns.find((column) => !view.sorts.some((sort) => sort.columnId === column.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={BAR_BUTTON} aria-pressed={view.sorts.length > 0}>
          <Icon name="ArrowUpDown" /> Sort{view.sorts.length ? ` · ${view.sorts.length}` : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        {view.sorts.length ? null : <p className="px-1 pb-2 text-sm text-muted-foreground">Rows keep the table's order.</p>}
        <div className="space-y-1.5">
          {view.sorts.map((sort, index) => (
            <div key={sort.columnId} className="flex items-center gap-1.5">
              <select
                aria-label="Sort column"
                className={cn(FIELD, "flex-1")}
                value={sort.columnId}
                onChange={(event) => set(view.sorts.map((each, at) => (at === index ? { ...each, columnId: event.target.value } : each)))}
              >
                {table.columns
                  .filter((column) => column.id === sort.columnId || !view.sorts.some((each) => each.columnId === column.id))
                  .map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Direction"
                className={cn(FIELD, "w-32")}
                value={sort.direction}
                onChange={(event) => set(view.sorts.map((each, at) => (at === index ? { ...each, direction: event.target.value as "asc" | "desc" } : each)))}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button type="button" aria-label="Remove sort" className="rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => set(view.sorts.filter((_, at) => at !== index))}>
                <Icon name="X" className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={cn(MENU_ITEM, "mt-1 text-muted-foreground")} disabled={!unused} onClick={() => unused && set([...view.sorts, { columnId: unused.id, direction: "asc" }])}>
          <Icon name="Plus" /> Add sort
        </button>
      </PopoverContent>
    </Popover>
  );
}

function ColumnsMenu({ table, view, onView }: { table: Table; view: View; onView(view: View): void }) {
  const hidden = new Set(view.hidden);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={BAR_BUTTON} aria-pressed={hidden.size > 0}>
          <Icon name="EyeOff" /> {hidden.size ? `${hidden.size} hidden` : "Columns"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60" align="end">
        {table.columns.map((column) => {
          const shown = !hidden.has(column.id);
          return (
            <button
              key={column.id}
              type="button"
              className={MENU_ITEM}
              aria-pressed={shown}
              onClick={() => onView({ ...view, hidden: shown ? [...view.hidden, column.id] : view.hidden.filter((id) => id !== column.id) })}
            >
              <Icon name={COLUMN_TYPE_INFO[column.type].icon} />
              <span className={cn("flex-1 truncate", !shown && "text-muted-foreground")}>{column.name}</span>
              <Icon name={shown ? "Eye" : "EyeOff"} />
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function AddViewMenu({ table, onAdd }: { table: Table; onAdd(meta: TableMeta & { view: View }): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Add view" className={BAR_BUTTON}>
          <Icon name="Plus" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <p className="px-2 py-1 text-xs text-muted-foreground">New view</p>
        {(Object.keys(VIEW_INFO) as ViewType[]).map((type) => (
          <button
            key={type}
            type="button"
            className={MENU_ITEM}
            onClick={() => {
              const count = table.views.filter((view) => view.type === type).length;
              onAdd(addView(table, type, count ? `${VIEW_INFO[type].label} ${count + 1}` : VIEW_INFO[type].label));
              setOpen(false);
            }}
          >
            <Icon name={VIEW_INFO[type].icon} />
            <span className="flex-1">{VIEW_INFO[type].label}</span>
            {type === "board" && !table.columns.some((column) => column.type === "select") ? <span className="text-xs text-muted-foreground">adds Status</span> : null}
            {type === "calendar" && !table.columns.some((column) => column.type === "date") ? <span className="text-xs text-muted-foreground">adds Date</span> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ViewTab({
  table,
  view,
  selected,
  onSelect,
  onMeta,
  onCopyLink,
}: {
  table: Table;
  view: View;
  selected: boolean;
  onSelect(): void;
  onMeta(meta: TableMeta): void;
  onCopyLink?(): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const replace = (next: View) => onMeta({ views: table.views.map((each) => (each.id === view.id ? next : each)) });
  const groupColumns = table.columns.filter((column) => column.type === (view.type === "board" ? "select" : "date"));
  if (renaming)
    return (
      <input
        aria-label="View name"
        autoFocus
        defaultValue={view.name}
        maxLength={100}
        className="h-7 w-32 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setRenaming(false);
        }}
        onBlur={(event) => {
          const name = event.currentTarget.value.trim();
          if (name && name !== view.name) replace({ ...view, name });
          setRenaming(false);
        }}
      />
    );
  const tab = (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(BAR_BUTTON, "aria-selected:bg-state-active aria-selected:text-foreground")}
      onClick={selected ? undefined : onSelect}
      onDoubleClick={() => setRenaming(true)}
    >
      <Icon name={VIEW_INFO[view.type].icon} /> <span className="max-w-40 truncate">{view.name}</span>
      {selected ? <Icon name="ChevronDown" className="opacity-60" /> : null}
    </button>
  );
  if (!selected) return tab;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{tab}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => setRenaming(true)}>
          <Icon name="Edit" /> Rename
        </DropdownMenuItem>
        {view.type !== "table" && groupColumns.length > 1
          ? groupColumns.map((column) => (
              <DropdownMenuItem key={column.id} onSelect={() => replace(view.type === "board" ? { ...view, groupBy: column.id } : { ...view, dateBy: column.id })}>
                <Icon name={view.type === "board" ? "Columns2" : "Calendar"} /> {view.type === "board" ? "Group by" : "Dates from"} {column.name}
                {(view.type === "board" ? view.groupBy : view.dateBy) === column.id ? <Icon name="Check" className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))
          : null}
        <DropdownMenuItem onSelect={() => onMeta({ views: [...table.views, { ...view, id: newViewId(), name: `${view.name} copy` }] })}>
          <Icon name="Copy" /> Duplicate
        </DropdownMenuItem>
        {onCopyLink ? (
          <DropdownMenuItem onSelect={onCopyLink}>
            <Icon name="studio/link" fallback="Copy" /> Copy link to view
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={table.views.length <= 1} onSelect={() => onMeta({ views: table.views.filter((each) => each.id !== view.id) })}>
          <Icon name="Trash2" /> Delete view
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Toolbar({
  table,
  view,
  shown,
  onSelectView,
  onMeta,
  onCopyLink,
  leading,
  trailing,
}: {
  table: Table;
  view: View | undefined;
  /** Rows the view shows. */
  shown: number;
  onSelectView(id: string): void;
  onMeta(meta: TableMeta, undoable?: boolean): void;
  onCopyLink?(viewId: string): void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const onView = (next: View) => onMeta({ views: table.views.map((each) => (each.id === next.id ? next : each)) }, false);
  return (
    <div className="flex min-w-0 items-center gap-1 border-b border-border px-2 py-1">
      {leading}
      <div role="tablist" aria-label="Views" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {table.views.map((each) => (
          <ViewTab
            key={each.id}
            table={table}
            view={each}
            selected={each.id === view?.id}
            onSelect={() => onSelectView(each.id)}
            onMeta={(meta) => onMeta(meta, false)}
            onCopyLink={onCopyLink ? () => onCopyLink(each.id) : undefined}
          />
        ))}
        <AddViewMenu
          table={table}
          onAdd={({ view: added, ...meta }) => {
            onMeta(meta, !!meta.columns);
            onSelectView(added.id);
          }}
        />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <span className="px-2 text-xs text-muted-foreground tabular-nums max-sm:hidden">
          {shown === table.rows.length ? `${shown} ${shown === 1 ? "row" : "rows"}` : `${shown} of ${table.rows.length}`}
        </span>
        {view ? (
          <>
            <FilterMenu table={table} view={view} onView={onView} />
            <SortMenu table={table} view={view} onView={onView} />
            {view.type === "table" ? <ColumnsMenu table={table} view={view} onView={onView} /> : null}
          </>
        ) : null}
        {trailing}
      </div>
    </div>
  );
}

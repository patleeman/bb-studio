// A column's settings, opened from its header: name, type, options, and
// where it sits; plus the current view's sort and visibility for it.
import { useState, type ReactNode } from "react";
import { Icon } from "../../ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { cn } from "../../ui/utils";
import { COLUMN_TYPE_INFO, COLUMN_TYPES, type Column, type ColumnType, type Table, type View } from "../model";
import { optionTone } from "./cells";

export function newColumnId(): string {
  return `col_${crypto.randomUUID().slice(0, 8)}`;
}

/** `base`, or `base 2`, `base 3`… whichever no column uses yet. */
export function uniqueName(columns: readonly Column[], base: string, except?: string): string {
  const taken = new Set(columns.filter((column) => column.id !== except).map((column) => column.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

export function newColumn(columns: readonly Column[], type: ColumnType = "text"): Column {
  return { id: newColumnId(), name: uniqueName(columns, COLUMN_TYPE_INFO[type].label), type, options: [] };
}

export const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-state-hover focus-visible:bg-state-hover disabled:pointer-events-none disabled:opacity-40 [&_[data-icon-root]]:size-4 [&_[data-icon-root]]:shrink-0 [&_[data-icon-root]]:text-muted-foreground";
export const MENU_SEPARATOR = "-mx-1 my-1 h-px bg-border";

function OptionsEditor({ column, onChange }: { column: Column; onChange(options: string[]): void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const option = draft.trim();
    if (option && !column.options.includes(option)) onChange([...column.options, option]);
    setDraft("");
  };
  return (
    <div className="space-y-0.5 px-1 pb-1">
      {column.options.map((option, index) => (
        <div key={option} className="group/option flex items-center gap-1">
          <span className={cn("size-2.5 shrink-0 rounded-full", optionTone(column, option))} />
          <input
            aria-label={`Option ${option}`}
            defaultValue={option}
            className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1.5 text-sm outline-none hover:bg-state-hover focus:bg-state-hover"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (!next || next === option || column.options.includes(next)) event.currentTarget.value = option;
              else onChange(column.options.map((each, at) => (at === index ? next : each)));
            }}
          />
          <button
            type="button"
            aria-label={`Move ${option} up`}
            disabled={!index}
            className="rounded-sm p-1 text-muted-foreground opacity-0 group-hover/option:opacity-100 hover:text-foreground disabled:invisible"
            onClick={() => {
              const options = [...column.options];
              [options[index - 1], options[index]] = [options[index]!, options[index - 1]!];
              onChange(options);
            }}
          >
            <Icon name="ArrowUp" className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${option}`}
            className="rounded-sm p-1 text-muted-foreground opacity-0 group-hover/option:opacity-100 hover:text-destructive"
            onClick={() => onChange(column.options.filter((each) => each !== option))}
          >
            <Icon name="X" className="size-3.5" />
          </button>
        </div>
      ))}
      <input
        aria-label="New option"
        value={draft}
        placeholder="Add an option…"
        className="h-7 w-full rounded-sm bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground hover:bg-state-hover focus:bg-state-hover"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") add();
        }}
        onBlur={add}
      />
    </div>
  );
}

export function TypeList({ value, onPick }: { value?: ColumnType; onPick(type: ColumnType): void }) {
  return (
    <div role="listbox" aria-label="Column type">
      {COLUMN_TYPES.map((type) => (
        <button key={type} type="button" role="option" aria-selected={type === value} className={MENU_ITEM} onClick={() => onPick(type)}>
          <Icon name={COLUMN_TYPE_INFO[type].icon} />
          <span className="flex-1">{COLUMN_TYPE_INFO[type].label}</span>
          {type === value ? <Icon name="Check" /> : null}
        </button>
      ))}
    </div>
  );
}

export function ColumnMenu({
  table,
  view,
  column,
  children,
  onColumns,
  onView,
}: {
  table: Table;
  view: View | undefined;
  column: Column;
  children: ReactNode;
  onColumns(columns: Column[]): void;
  onView(view: View): void;
}) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const index = table.columns.findIndex((each) => each.id === column.id);
  const save = (next: Column) => onColumns(table.columns.map((each) => (each.id === column.id ? next : each)));
  const insert = (at: number) => {
    const columns = [...table.columns];
    columns.splice(at, 0, newColumn(table.columns));
    onColumns(columns);
    setOpen(false);
  };
  const move = (by: number) => {
    const columns = [...table.columns];
    const [moved] = columns.splice(index, 1);
    columns.splice(index + by, 0, moved!);
    onColumns(columns);
  };
  const sort = (direction: "asc" | "desc") => {
    if (view) onView({ ...view, sorts: [{ columnId: column.id, direction }, ...view.sorts.filter((each) => each.columnId !== column.id)] });
    setOpen(false);
  };
  const sorted = view?.sorts.find((each) => each.columnId === column.id)?.direction;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setTyping(false);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64" onKeyDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-1 p-1">
          <Icon name={COLUMN_TYPE_INFO[column.type].icon} className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="Column name"
            defaultValue={column.name}
            maxLength={100}
            autoFocus
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (!name || name === column.name) event.currentTarget.value = column.name;
              else save({ ...column, name: uniqueName(table.columns, name, column.id) });
            }}
          />
        </div>
        <div className={MENU_SEPARATOR} />
        {typing ? (
          <TypeList
            value={column.type}
            onPick={(type) => {
              setTyping(false);
              if (type !== column.type) save({ ...column, type, options: type === "select" || type === "multi-select" ? column.options : [] });
            }}
          />
        ) : (
          <>
            <button type="button" className={MENU_ITEM} onClick={() => setTyping(true)}>
              <Icon name="SlidersHorizontal" />
              <span className="flex-1">Type</span>
              <span className="text-xs text-muted-foreground">{COLUMN_TYPE_INFO[column.type].label}</span>
              <Icon name="ChevronRight" />
            </button>
            {column.type === "select" || column.type === "multi-select" ? (
              <>
                <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">Options</p>
                <OptionsEditor column={column} onChange={(options) => save({ ...column, options })} />
              </>
            ) : null}
            <div className={MENU_SEPARATOR} />
            {view ? (
              <>
                <button type="button" className={MENU_ITEM} aria-pressed={sorted === "asc"} onClick={() => sort("asc")}>
                  <Icon name="ArrowUp" /> Sort ascending
                </button>
                <button type="button" className={MENU_ITEM} aria-pressed={sorted === "desc"} onClick={() => sort("desc")}>
                  <Icon name="ArrowDown" /> Sort descending
                </button>
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    onView({ ...view, hidden: [...view.hidden, column.id] });
                    setOpen(false);
                  }}
                >
                  <Icon name="EyeOff" /> Hide in view
                </button>
                <div className={MENU_SEPARATOR} />
              </>
            ) : null}
            <button type="button" className={MENU_ITEM} onClick={() => insert(index)}>
              <Icon name="ArrowLeft" /> Insert left
            </button>
            <button type="button" className={MENU_ITEM} onClick={() => insert(index + 1)}>
              <Icon name="ArrowRight" /> Insert right
            </button>
            <button type="button" className={MENU_ITEM} disabled={index <= 0} onClick={() => move(-1)}>
              <Icon name="ArrowLeft" /> Move left
            </button>
            <button type="button" className={MENU_ITEM} disabled={index >= table.columns.length - 1} onClick={() => move(1)}>
              <Icon name="ArrowRight" /> Move right
            </button>
            <div className={MENU_SEPARATOR} />
            <button
              type="button"
              className={cn(MENU_ITEM, "text-destructive [&_[data-icon-root]]:text-destructive")}
              disabled={table.columns.length <= 1}
              onClick={() => {
                onColumns(table.columns.filter((each) => each.id !== column.id));
                setOpen(false);
              }}
            >
              <Icon name="Trash2" /> Delete column
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

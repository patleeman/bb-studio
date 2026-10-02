// Editing a value: a text field over the cell for typed values, where @ links
// a Studio item in text, and a searchable picker for options, people and
// Studio items.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ItemLinkTextarea } from "../../app/item-links";
import { Icon } from "../../ui/icon";
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover";
import { cn } from "../../ui/utils";
import { cellText, convertCell, isRelation, type Cell, type Column } from "../model";
import { Chip, OptionChip } from "./cells";
import { itemKey, type TableHost } from "./host";

/** Where the active cell goes after an edit is saved. */
export type Exit = "down" | "up" | "right" | "left" | "stay";

export interface EditorProps {
  column: Column;
  cell: Cell | undefined;
  host: TableHost;
  /** The key typed to start editing, which replaces the value. */
  initial?: string;
  /** A cell editor sits over the grid; a field editor fills a form row. */
  mode?: "cell" | "field";
  /** The table being edited, left out of a text cell's @ list. */
  selfHref?: string;
  onCommit(cell: Cell, exit?: Exit): void;
  onCancel(): void;
}

export const PICKED_TYPES = new Set<Column["type"]>(["select", "multi-select", "relation"]);

export function CellEditor(props: EditorProps) {
  if (PICKED_TYPES.has(props.column.type)) return <PickerEditor {...props} />;
  if (props.column.type === "checkbox") return null;
  return <TextEditor {...props} />;
}

function editText(column: Column, cell: Cell | undefined): string {
  return column.type === "date" || column.type === "number" ? (cell == null ? "" : String(cell)) : cellText(cell);
}

function TextEditor({ column, cell, host, initial, mode = "cell", selfHref, onCommit, onCancel }: EditorProps) {
  const [draft, setDraft] = useState(initial ?? editText(column, cell));
  const ref = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const suggestions = column.type === "person" ? host.people : column.type === "bot" ? host.bots : undefined;
  const listId = suggestions?.length ? `table-${column.id}-names` : undefined;
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }, []);
  const commit = (exit: Exit, text = draft) => {
    if (done.current) return;
    done.current = true;
    if (text === editText(column, cell)) onCancel();
    else onCommit(convertCell(text, column), exit);
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      done.current = true;
      onCancel();
    } else if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commit("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      commit(event.shiftKey ? "left" : "right");
    }
  };
  // Single-line types use an input so the browser offers names and dates.
  const field =
    column.type === "text" ? (
      <ItemLinkTextarea
        ref={ref}
        aria-label={column.name}
        value={draft}
        rows={1}
        selfHref={selfHref}
        wrapperClassName={mode === "cell" ? "self-stretch" : undefined}
        className={cn(
          "block w-full resize-none bg-background px-2 py-1.5 text-sm outline-none [field-sizing:content]",
          mode === "cell" ? "max-h-64 min-h-full" : "min-h-8 rounded-md hover:bg-state-hover focus:bg-state-hover",
        )}
        onValueChange={setDraft}
        onKeyDown={keyDown}
        onBlur={() => commit("stay")}
      />
    ) : (
      <input
        ref={ref as never}
        aria-label={column.name}
        value={draft}
        list={listId}
        inputMode={column.type === "number" ? "decimal" : column.type === "url" ? "url" : undefined}
        placeholder={column.type === "date" ? "YYYY-MM-DD" : column.type === "url" ? "https://" : undefined}
        className={cn(
          "block h-full w-full bg-background px-2 text-sm outline-none",
          column.type === "number" && "text-right tabular-nums",
          mode === "cell" ? "min-h-full" : "h-8 rounded-md hover:bg-state-hover focus:bg-state-hover",
        )}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={keyDown}
        onBlur={(event) => {
          // Picking a date from the native picker blurs the field first.
          if (event.relatedTarget !== dateRef.current) commit("stay");
        }}
      />
    );
  return (
    <div
      className={cn(
        "flex items-start",
        mode === "cell" ? "absolute top-0 left-0 z-20 min-h-full min-w-full rounded-[2px] bg-background shadow-lg ring-2 ring-primary" : "relative w-full",
      )}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {field}
      {listId ? (
        <datalist id={listId}>
          {suggestions!.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
      {column.type === "date" ? (
        <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground">
          <Icon name="Calendar" className="size-4" />
          <input
            ref={dateRef}
            type="date"
            aria-label={`Pick ${column.name}`}
            tabIndex={-1}
            className="absolute inset-0 cursor-pointer opacity-0"
            value={/^\d{4}-\d{2}-\d{2}$/.test(draft) ? draft : ""}
            onClick={(event) => event.currentTarget.showPicker?.()}
            onChange={(event) => commit("stay", event.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}

interface Choice {
  key: string;
  label: string;
  value: Cell;
  render: ReactNode;
}

function choicesFor(column: Column, host: TableHost): Choice[] {
  if (column.type === "relation")
    return (host.items ?? []).map((item) => ({
      key: itemKey(item),
      label: `${item.title} ${item.kindLabel ?? ""}`,
      value: { pluginId: item.pluginId, itemId: item.itemId },
      render: (
        <span className="flex min-w-0 items-center gap-2">
          {item.icon ? <span className="w-4 shrink-0 text-center">{item.icon}</span> : <Icon name={item.kindIcon ?? "GridView"} className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{item.title}</span>
          {item.kindLabel ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.kindLabel}</span> : null}
        </span>
      ),
    }));
  return column.options.map((option) => ({ key: option, label: option, value: option, render: <OptionChip column={column} option={option} /> }));
}

function selectedKeys(column: Column, cell: Cell | undefined): string[] {
  if (column.type === "relation") return isRelation(cell) ? [itemKey(cell)] : [];
  if (Array.isArray(cell)) return cell;
  return typeof cell === "string" ? [cell] : [];
}

/** The searchable list of a select's options or the Studio's items. */
export function Picker({
  column,
  cell,
  host,
  initial = "",
  onPick,
  onDone,
  onCancel,
}: {
  column: Column;
  cell: Cell | undefined;
  host: TableHost;
  initial?: string;
  /** A single value picks and closes; a multi-select stays open. */
  onPick(cell: Cell): void;
  onDone(): void;
  onCancel(): void;
}) {
  const multiple = column.type === "multi-select";
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => choicesFor(column, host), [column, host]);
  const selected = selectedKeys(column, cell);
  const needle = query.trim().toLowerCase();
  const matches = all.filter((choice) => choice.label.toLowerCase().includes(needle)).slice(0, 100);
  const canCreate = column.type !== "relation" && !!needle && !all.some((choice) => choice.key.toLowerCase() === needle);
  const count = matches.length + (canCreate ? 1 : 0);
  useEffect(() => setActive(0), [needle]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const toggle = (key: string, value: Cell) => {
    if (!multiple) return onPick(selected.includes(key) ? null : value);
    const next = selected.includes(key) ? selected.filter((each) => each !== key) : [...selected, key];
    onPick(next.length ? next : null);
    setQuery("");
  };
  const choose = (index: number) => {
    const choice = matches[index];
    if (choice) toggle(choice.key, choice.value);
    else if (canCreate) toggle(query.trim(), query.trim());
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (count) setActive((active + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (count) choose(active);
      else onDone();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (multiple) onDone();
      else onCancel();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onDone();
    } else if (event.key === "Backspace" && !query && selected.length) {
      event.preventDefault();
      onPick(multiple ? selected.slice(0, -1) : null);
    }
  };
  const chip = (key: string) =>
    column.type === "relation" ? (
      <Chip className="bg-muted">{all.find((choice) => choice.key === key)?.label.trim() ?? key}</Chip>
    ) : (
      <OptionChip column={column} option={key} />
    );
  return (
    <div className="flex w-72 flex-col" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border p-1.5">
        {selected.map((key) => (
          <span key={key} className="inline-flex max-w-full items-center">
            {chip(key)}
            <button
              type="button"
              aria-label={`Remove ${key}`}
              className="ml-0.5 rounded text-muted-foreground hover:text-foreground"
              onClick={() => {
                onPick(multiple ? selected.filter((each) => each !== key) : null);
              }}
            >
              <Icon name="X" className="size-3" />
            </button>
          </span>
        ))}
        <input
          autoFocus
          aria-label={`Search ${column.name}`}
          value={query}
          placeholder={column.type === "relation" ? "Search Studio items…" : selected.length ? "" : "Search or create an option…"}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={keyDown}
        />
      </div>
      <div ref={listRef} role="listbox" aria-label={column.name} className="max-h-64 overflow-y-auto p-1">
        {matches.map((choice, index) => (
          <button
            key={choice.key}
            type="button"
            role="option"
            data-index={index}
            aria-selected={selected.includes(choice.key)}
            className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm", index === active && "bg-state-hover")}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <span className="min-w-0 flex-1">{choice.render}</span>
            {selected.includes(choice.key) ? <Icon name="Check" className="size-4 shrink-0" /> : null}
          </button>
        ))}
        {canCreate ? (
          <button
            type="button"
            role="option"
            data-index={matches.length}
            aria-selected={false}
            className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm", active === matches.length && "bg-state-hover")}
            onMouseEnter={() => setActive(matches.length)}
            onClick={() => choose(matches.length)}
          >
            <span className="text-muted-foreground">Create</span> <OptionChip column={column} option={query.trim()} />
          </button>
        ) : null}
        {!count ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {column.type === "relation" ? (host.items ? "No matching items." : "Loading items…") : "Type to add an option."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PickerEditor({ column, cell, host, initial, mode = "cell", onCommit, onCancel }: EditorProps) {
  const [draft, setDraft] = useState(cell ?? null);
  const multiple = column.type === "multi-select";
  const finish = (value: Cell) => {
    if (JSON.stringify(value) === JSON.stringify(cell ?? null)) onCancel();
    else onCommit(value, "stay");
  };
  return (
    <Popover open onOpenChange={(open) => !open && (multiple ? finish(draft) : onCancel())}>
      <PopoverAnchor asChild>
        <span className={cn("pointer-events-none", mode === "cell" ? "absolute inset-0 rounded-[2px] ring-2 ring-primary" : "absolute inset-0")} />
      </PopoverAnchor>
      <PopoverContent className="p-0" onCloseAutoFocus={(event) => event.preventDefault()}>
        <Picker
          column={column}
          cell={draft}
          host={host}
          initial={initial}
          onPick={(value) => {
            setDraft(value);
            if (!multiple) finish(value);
          }}
          onDone={() => finish(draft)}
          onCancel={onCancel}
        />
      </PopoverContent>
    </Popover>
  );
}

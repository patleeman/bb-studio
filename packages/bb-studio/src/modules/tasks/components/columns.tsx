// Editing a board's columns in place: rename a column by double-clicking
// its title, reorder or delete it from its menu, and add one at the end.
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  cn,
} from "@bb-studio/kit/app";
import { columnId } from "../src/shared";

export interface BoardColumn {
  id: string;
  label: string;
}

export const MAX_COLUMNS = 12;
export { columnId };

/** New columns go before Done, which stays last. */
export function withColumn(columns: readonly BoardColumn[], column: BoardColumn): BoardColumn[] {
  const done = columns.findIndex((each) => each.id === "done");
  const at = done < 0 || done !== columns.length - 1 ? columns.length : done;
  return [...columns.slice(0, at), column, ...columns.slice(at)];
}

function NameInput({ initial, label, onDone }: { initial: string; label: string; onDone(name: string | null): void }) {
  const [settled, setSettled] = useState(false);
  const finish = (name: string | null) => {
    if (settled) return;
    setSettled(true);
    onDone(name?.trim() || null);
  };
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={initial}
      maxLength={60}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
      className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm font-medium outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

/** The column's name, renamed in place on double-click (or from its menu). */
export function ColumnTitle({ label, renaming, onRename, onStartRename }: { label: string; renaming: boolean; onRename(name: string | null): void; onStartRename(): void }) {
  if (renaming) return <NameInput initial={label} label="Column name" onDone={onRename} />;
  return (
    <h2 className="min-w-0 truncate text-sm font-medium" title="Double-click to rename" onDoubleClick={onStartRename}>
      {label}
    </h2>
  );
}

export function ColumnMenu({
  column,
  index,
  total,
  onRename,
  onMove,
  onDelete,
}: {
  column: BoardColumn;
  index: number;
  total: number;
  onRename(): void;
  onMove(offset: -1 | 1): void;
  onDelete(): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${column.label} column actions`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/column:opacity-100 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Board columns</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onRename}>
          <Icon name="Edit" className="size-4" /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
          <Icon name="ArrowLeft" className="size-4" /> Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === total - 1} onSelect={() => onMove(1)}>
          <Icon name="ArrowRight" className="size-4" /> Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={column.id === "done" || total <= 2} onSelect={onDelete}>
          <Icon name="Trash2" className="size-4" /> Delete column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The slot after the last column: a button, then a name field. */
export function AddColumn({ disabled, onAdd }: { disabled: boolean; onAdd(name: string): void }) {
  const [naming, setNaming] = useState(false);
  return (
    <div className="flex w-72 min-w-64 shrink-0 items-start max-md:w-64">
      {naming ? (
        <div className="flex w-full items-center rounded-lg bg-muted/40 px-3 py-2.5">
          <NameInput
            initial=""
            label="New column name"
            onDone={(name) => {
              setNaming(false);
              if (name) onAdd(name);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          title={disabled ? `Boards have at most ${MAX_COLUMNS} columns` : undefined}
          onClick={() => setNaming(true)}
          className={cn(
            "flex h-11 w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <Icon name="Plus" className="size-4" /> Add column
        </button>
      )}
    </div>
  );
}

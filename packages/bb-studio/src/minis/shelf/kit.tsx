// `@studio/kit` for mini apps (shelf/kit-1.js): Studio's own components,
// the app-shaped pieces Studio doesn't need itself, and hooks over
// `window.playground`. Styles come from Tailwind in the frame, with BB's
// colors as theme tokens, so these look like Studio in light and dark.
import * as React from "react";
import { cn } from "../../kit/ui/utils";

export { cn };
export { Button, buttonVariants } from "../../kit/ui/button";
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "../../kit/ui/card";
export { Checkbox } from "../../kit/ui/checkbox";
export { Input } from "../../kit/ui/input";
export { Textarea } from "../../kit/ui/textarea";
export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "../../kit/ui/select";
export { Dialog, DialogOverlay, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "../../kit/ui/dialog";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../../kit/ui/dropdown-menu";
export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent } from "../../kit/ui/popover";
export { Tooltip } from "../../kit/ui/tooltip";

// ---- window.playground ---------------------------------------------------------

type Record_ = { id: string; rev: number; createdAt: number; updatedAt: number; createdBy: "user" | "agent"; data: Record<string, unknown> };
type Query = { where?: Record<string, unknown>; order?: string; limit?: number; offset?: number };
interface Collection {
  find(query?: Query): Promise<Record_[]>;
  get(id: string): Promise<Record_ | null>;
  insert(data: Record<string, unknown>, options?: { id?: string }): Promise<Record_>;
  update(id: string, data: Record<string, unknown>, options?: { rev?: number }): Promise<Record_>;
  patch(id: string, fields: Record<string, unknown>): Promise<Record_>;
  remove(id: string): Promise<{ removed: boolean }>;
  count(query?: Pick<Query, "where">): Promise<number>;
  subscribe(query: Query, listener: (records: Record_[]) => void): () => void;
}
interface Playground {
  state: unknown;
  theme: "light" | "dark";
  save(state: unknown): void;
  onState(listener: (state: unknown) => void): () => void;
  onTheme(listener: (theme: "light" | "dark") => void): () => void;
  expose(actions: Record<string, (...args: never[]) => unknown>): void;
  emit(name: string, data?: unknown): void;
  send(label: string, data?: unknown): boolean;
  db: { collection(name: string): Collection };
}

function playground(): Playground {
  const api = (window as unknown as { playground?: Playground }).playground;
  if (!api) throw new Error("window.playground is missing: this only runs inside a mini app.");
  return api;
}

/**
 * The mini app's shared state, like useState but saved and shared with every
 * open copy and the agent. Keep it small (UI state); use records for data.
 */
export function usePlaygroundState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = React.useState<T>(() => (playground().state ?? initial) as T);
  React.useEffect(() => playground().onState((next) => setValue((next ?? initial) as T)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const set = React.useCallback((next: T | ((previous: T) => T)) => {
    setValue((previous) => {
      const resolved = typeof next === "function" ? (next as (previous: T) => T)(previous) : next;
      playground().save(resolved);
      return resolved;
    });
  }, []);
  return [value, set];
}

/** The collection's API: insert, update, patch, remove, find. */
export function useCollection(name: string): Collection {
  return React.useMemo(() => playground().db.collection(name), [name]);
}

/**
 * Records matching `query`, kept current as anyone (another copy, another
 * view, the agent) changes them. `loading` is true until the first answer.
 */
export function useRecords(name: string, query: Query = {}): { records: Record_[]; loading: boolean; collection: Collection } {
  const collection = useCollection(name);
  const key = JSON.stringify(query);
  const [state, setState] = React.useState<{ records: Record_[]; loading: boolean }>({ records: [], loading: true });
  React.useEffect(() => collection.subscribe(JSON.parse(key) as Query, (records) => setState({ records, loading: false })), [collection, key]);
  return { ...state, collection };
}

/** Exposes actions the agent can run (`minis_live` op `do`). */
export function useActions(actions: Record<string, (...args: never[]) => unknown>, deps: React.DependencyList = []) {
  React.useEffect(() => playground().expose(actions), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** "light" or "dark", following BB. */
export function useTheme(): "light" | "dark" {
  const [theme, setTheme] = React.useState(() => playground().theme);
  React.useEffect(() => playground().onTheme(setTheme), []);
  return theme;
}

// ---- Components Studio itself doesn't need ------------------------------------

/** Wraps a mounted mini app: page padding and type that match BB. */
export function MiniRoot({ children }: { children?: React.ReactNode }) {
  return <div className="min-h-full bg-transparent p-3 text-sm text-foreground antialiased">{children}</div>;
}

const BADGE_TONES = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  outline: "border-border text-foreground",
  muted: "border-transparent bg-muted text-muted-foreground",
  success: "border-transparent bg-success/15 text-success",
  warning: "border-transparent bg-warning/20 text-warning-text",
  destructive: "border-transparent bg-destructive/15 text-destructive-text",
} as const;

export function Badge({ tone = "secondary", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof BADGE_TONES }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", BADGE_TONES[tone], className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent text-muted-foreground", className)} />;
}

export function EmptyState({ title, children, action, className }: { title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center", className)}>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {children ? <div className="max-w-sm text-xs text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="toolbar" className={cn("flex flex-wrap items-center gap-2", className)} {...props} />;
}

/** A label, the control, and a hint or error under it. */
export function Field({ label, hint, error, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  const child = React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id: (children.props as { id?: string }).id ?? id }) : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-foreground">{label}</label>
      {child}
      {error ? <p className="text-xs text-destructive-text">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// Tabs: a row of buttons and the panel for the selected one.
const TabsContext = React.createContext<{ value: string; setValue(value: string): void; id: string } | null>(null);

export function Tabs({ value, defaultValue, onValueChange, className, children }: { value?: string; defaultValue?: string; onValueChange?(value: string): void; className?: string; children: React.ReactNode }) {
  const [own, setOwn] = React.useState(defaultValue ?? "");
  const id = React.useId();
  const current = value ?? own;
  const setValue = (next: string) => {
    if (value === undefined) setOwn(next);
    onValueChange?.(next);
  };
  return <TabsContext.Provider value={{ value: current, setValue, id }}><div className={cn("flex flex-col gap-3", className)}>{children}</div></TabsContext.Provider>;
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="tablist" className={cn("inline-flex w-fit items-center gap-0.5 rounded-lg bg-muted/60 p-0.5", className)} {...props} />;
}

export function TabsTrigger({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const tabs = React.useContext(TabsContext);
  const selected = tabs?.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${tabs?.id}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${tabs?.id}-panel-${value}`}
      onClick={() => tabs?.setValue(value)}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const tabs = React.useContext(TabsContext);
  if (tabs?.value !== value) return null;
  return <div role="tabpanel" id={`${tabs.id}-panel-${value}`} aria-labelledby={`${tabs.id}-tab-${value}`} className={className}>{children}</div>;
}

// Table: plain parts, and DataTable for rows with sortable columns.
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <div className="w-full overflow-auto rounded-lg border border-border"><table className={cn("w-full caption-bottom border-collapse text-sm", className)} {...props} /></div>;
}
export const TableHeader = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn("bg-muted/40", className)} {...props} />;
export const TableBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
export const TableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("border-b border-border transition-colors hover:bg-state-hover/50", className)} {...props} />;
export const TableHead = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("h-8 px-3 text-left align-middle text-xs font-medium text-muted-foreground", className)} {...props} />;
export const TableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-3 py-2 align-middle", className)} {...props} />;

export interface DataTableColumn<Row> {
  key: string;
  header: React.ReactNode;
  /** Defaults to row[key]. */
  cell?: (row: Row) => React.ReactNode;
  /** Value to sort by; defaults to row[key]. False turns sorting off. */
  sort?: ((row: Row) => string | number | null) | false;
  className?: string;
}

/** Rows with sortable columns, an empty state and an optional row click. */
export function DataTable<Row extends Record<string, unknown>>({
  rows,
  columns,
  rowKey = (row) => String(row.id ?? JSON.stringify(row)),
  onRowClick,
  empty = "Nothing here yet.",
  className,
}: {
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey?: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  empty?: React.ReactNode;
  className?: string;
}) {
  const [sort, setSort] = React.useState<{ key: string; desc: boolean } | null>(null);
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((each) => each.key === sort.key);
    if (!column || column.sort === false) return rows;
    const value = column.sort ?? ((row: Row) => row[column.key] as string | number | null);
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const order = x === y ? 0 : x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : x < y ? -1 : 1;
      return sort.desc ? -order : order;
    });
  }, [rows, columns, sort]);
  return (
    <Table className={className}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className} aria-sort={sort?.key === column.key ? (sort.desc ? "descending" : "ascending") : undefined}>
              {column.sort === false ? column.header : (
                <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((now) => (now?.key === column.key ? (now.desc ? null : { key: column.key, desc: true }) : { key: column.key, desc: false }))}>
                  {column.header}
                  <span aria-hidden className="text-[10px]">{sort?.key === column.key ? (sort.desc ? "▼" : "▲") : ""}</span>
                </button>
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow className="hover:bg-transparent"><TableCell colSpan={columns.length} className="py-8 text-center text-muted-foreground">{empty}</TableCell></TableRow>
        ) : sorted.map((row) => (
          <TableRow key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? "cursor-pointer" : undefined}>
            {columns.map((column) => <TableCell key={column.key} className={column.className}>{column.cell ? column.cell(row) : String(row[column.key] ?? "")}</TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// The Studio collection: one searchable, filterable list of items of any
// kind, sorted and optionally grouped. Studio renders it for every installed add-on; an add-on renders
// it alone for its own kind when Studio isn't installed.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import type { StudioAction } from "../contract";
import { errorMessage, plural, relativeTime, untitled } from "../format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import {
  Badge,
  Checkbox,
  DANGER_BUTTON,
  BAR_BUTTON,
  EmptyState,
  GHOST_BUTTON,
  ICON_BUTTON,
  Highlight,
  ItemTile,
  OUTLINE_BUTTON,
  PageColumn,
  PILL,
  PRIMARY_BUTTON,
  projectName,
  THUMBNAIL,
  type Project,
} from "./pieces";
import { BarCrumb, StudioBar } from "./item-header";
import {
  DEFAULT_SORT,
  formatSort,
  GROUP_BYS,
  groupItems,
  itemKey,
  nextSort,
  parseSort,
  sortItems,
  toggleSelection,
  type ActionResults,
  type CollectionItem,
  type CollectionKind,
  type Group,
  type GroupBy,
  type Sort,
  type SortKey,
} from "./selection";
import { TagChips, TagDot, TagMenuItems, TagNameInput, type CollectionTag } from "./tags";
import { openFloat, useFloatAvailable } from "./float";
import { CopyReferenceMenuItem } from "./item-menu";
import { floatPanelFor } from "./float-registry";
import { useOpenTarget } from "./move";
import { STUDIO_ITEM_CLICKS_OFF, studioItemProps } from "./studio-item";
import { SpaceMenuItems } from "./space-picker";
import { spaceMembership } from "./space-state";

export type { CollectionTag } from "./tags";
export { groupItems, itemKey, sortItems, toggleSelection, type ActionResults, type CollectionItem, type CollectionKind, type GroupBy, type Sort } from "./selection";

export interface CollectionHandlers {
  onOpen(item: CollectionItem): void;
  onCreate(kind: CollectionKind, projectId: string | null): Promise<void> | void;
  onNewThread(items: CollectionItem[]): void;
  onMove(items: CollectionItem[], projectId: string | null): Promise<ActionResults>;
  onArchive(items: CollectionItem[], archived: boolean): Promise<ActionResults>;
  onDelete(items: CollectionItem[]): Promise<ActionResults>;
  onAction(kind: CollectionKind, action: StudioAction, items: CollectionItem[]): Promise<{ message: string | null; text: string | null }>;
  /** Item keys whose content matches, beyond title matches, each with the text that matched if known. */
  onSearch?(query: string): Promise<ReadonlyMap<string, string | null>>;
  /** Tagging, when the collection has `tags`. */
  onTag?(items: CollectionItem[], add: string[], remove: string[]): Promise<void>;
  /** Makes a tag, or returns the one with this name. */
  onCreateTag?(name: string): Promise<CollectionTag>;
  onRenameTag?(tag: CollectionTag, name: string): Promise<void>;
  onDeleteTag?(tag: CollectionTag): Promise<void>;
  /** Adds items to a space or takes them out, when the collection has `spaces`. */
  onSpace?(items: CollectionItem[], spaceId: string, add: boolean): Promise<void>;
  onDuplicate?(item: CollectionItem): Promise<void>;
  onSetTemplate?(item: CollectionItem, template: boolean): Promise<void>;
  exportFormats?(item: CollectionItem): readonly { format: string; label: string }[];
  onExport?(item: CollectionItem, format: string): Promise<void>;
  onExportBulk?(items: CollectionItem[]): Promise<void>;
}

/**
 * A host that filters for itself, like Studio's query bar: `items` arrive
 * filtered, `bar` takes the search box's place and `rail` sits beside the list.
 */
export interface CollectionFilter {
  bar: ReactNode;
  /** null while it loads, which keeps its room so the list doesn't jump. */
  rail?: ReactNode;
  /** Shown at the start of the toolbar, e.g. a link to the filtered space. */
  toolbar?: ReactNode;
  /** The words searched for, to highlight. */
  text: string;
  /** Item keys whose content matched, with the text that matched if known. */
  snippets: ReadonlyMap<string, string | null>;
  /** Whether the items are archived ones, so bulk actions restore. */
  archived: boolean;
  /** Shown when no item matches. */
  empty: string;
}

/** A space items can belong to, for grouping and the Spaces column. */
export interface CollectionSpace {
  id: string;
  name: string;
  glyph?: ReactNode;
  /** Projects whose items are all in the space, so they can't leave it one by one. */
  projectIds?: readonly string[];
}

const GROUP_LABELS: Record<GroupBy, string> = { none: "None", kind: "Kind", project: "Project", space: "Space", tag: "Tag" };
const ALL = "all";
const GLOBAL = "global";
const UNTAGGED = "untagged";

function useStoredState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key) as T | null;
      return stored !== null && (!allowed || allowed.includes(stored)) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Private windows can refuse storage; the choice lasts this session.
      }
    },
    [key],
  );
  return [value, set];
}

/**
 * Copies text that is still being fetched. Handing the clipboard a promise
 * keeps the click's permission in Safari, which drops it after an await.
 */
function copyLater(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem === "undefined") return text.then((value) => navigator.clipboard.writeText(value));
  return navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) })]);
}

function reportResults(results: ActionResults, verb: string, noun = "item") {
  if (results.done.length) toast.success(`${verb} ${plural(results.done.length, noun)}`);
  if (results.failed.length) toast.error(`Couldn't ${verb.toLowerCase()} ${plural(results.failed.length, noun)}: ${results.failed[0]!.error}`);
}

export function CollectionPage({
  title,
  kinds,
  items,
  error,
  projects,
  defaultProjectId,
  storageKey,
  tags,
  spaces,
  kind: kindFilter,
  onKindChange,
  isSelectable,
  notice,
  headerActions,
  extraCreateItems,
  handlers,
  filter,
}: {
  title: string;
  kinds: readonly CollectionKind[];
  /** null while loading. */
  items: readonly CollectionItem[] | null;
  error?: string | null;
  projects: readonly Project[];
  /** Where new items go when the filter doesn't pick a project. */
  defaultProjectId: string | null;
  /** Prefix for remembered view and filter choices. */
  storageKey: string;
  /** Every tag, or undefined when the collection has no tags. */
  tags?: readonly CollectionTag[];
  /** Every space, when items carry `spaces`. */
  spaces?: readonly CollectionSpace[];
  /** The kind filter; "all" or a kind id. */
  kind: string;
  onKindChange(kind: string): void;
  /** Items that can't be picked, with the reason shown on hover. */
  isSelectable?(item: CollectionItem): true | string;
  /** Shown under the header, e.g. a one-time tip. */
  notice?: ReactNode;
  /** Extra buttons beside New, e.g. a settings menu. */
  headerActions?: ReactNode;
  extraCreateItems?: readonly { id: string; label: string; icon: string; onSelect(projectId: string | null): void }[];
  handlers: CollectionHandlers;
  filter?: CollectionFilter;
}) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useStoredState<string>(`${storageKey}:project`, ALL);
  const [groupChoice, setGroupBy] = useStoredState<GroupBy>(`${storageKey}:group`, "none", GROUP_BYS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [tagFilter, setTagFilter] = useStoredState<string>(`${storageKey}:tag`, ALL);
  const [renaming, setRenaming] = useState(false);
  const [archivedFilter, setArchived] = useState(false);
  const archived = filter ? filter.archived : archivedFilter;
  const [sortText, setSortText] = useStoredState<string>(`${storageKey}:sort`, formatSort(DEFAULT_SORT));
  const sort = useMemo(() => parseSort(sortText), [sortText]);
  const setSort = useCallback((next: Sort) => setSortText(formatSort(next)), [setSortText]);
  const [ownMatches, setContentMatches] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const contentMatches = filter ? filter.snippets : ownMatches;
  const searched = filter ? filter.text : query;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const anchor = useRef<string | null>(null);
  // A right-clicked row's menu, at the pointer.
  const [rowContext, setRowContext] = useState<{ item: CollectionItem; x: number; y: number } | null>(null);
  const floatAvailable = useFloatAvailable();
  const { open: openTarget, anchor: splitAnchor } = useOpenTarget();

  const kindById = useMemo(() => new Map(kinds.map((kind) => [`${kind.pluginId}:${kind.id}`, kind])), [kinds]);
  const kindOf = useCallback((item: CollectionItem) => kindById.get(`${item.pluginId}:${item.kind}`), [kindById]);
  const activeKind = kindFilter === ALL ? null : (kinds.find((kind) => kind.id === kindFilter) ?? null);
  const single = kinds.length === 1 ? kinds[0]! : activeKind;
  const canArchive = kinds.some((kind) => kind.capabilities?.archive ?? kind.canArchive);
  const projectLabel = useCallback((item: CollectionItem) => projectName(projects, item.projectId), [projects]);
  const kindLabel = useCallback((item: CollectionItem) => kindOf(item)?.label ?? item.kind, [kindOf]);

  // A project that no longer exists falls back to every project.
  useEffect(() => {
    if (project !== ALL && project !== GLOBAL && projects.length && !projects.some((candidate) => candidate.id === project)) setProject(ALL);
  }, [project, projects, setProject]);
  const tagging = tags !== undefined && handlers.onTag !== undefined;
  const tagById = useMemo(() => new Map((tags ?? []).map((tag) => [tag.id, tag])), [tags]);
  const activeTag = tagById.get(tagFilter) ?? null;
  // A deleted tag falls back to every item.
  useEffect(() => {
    if (tags && tagFilter !== ALL && tagFilter !== UNTAGGED && !tagById.has(tagFilter)) setTagFilter(ALL);
  }, [tags, tagById, tagFilter, setTagFilter]);
  // Sorting by a column the new filter doesn't show would be invisible.
  useEffect(() => {
    if (sort.key.startsWith("fact:") && !single?.columns.some((column) => `fact:${column.id}` === sort.key)) setSort(DEFAULT_SORT);
    if (sort.key === "kind" && single) setSort(DEFAULT_SORT);
  }, [single, sort.key, setSort]);

  const { onSearch } = handlers;
  useEffect(() => {
    const text = query.trim();
    if (!text || !onSearch) {
      setContentMatches(new Map());
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      onSearch(text).then(
        (keys) => live && setContentMatches(keys),
        () => {},
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [onSearch, query]);

  const byKey = useMemo(() => new Map((items ?? []).map((item) => [itemKey(item), item])), [items]);
  const shown = useMemo(() => {
    if (filter) return sortItems(items ?? [], sort, { kindLabel, projectLabel });
    const text = query.trim().toLowerCase();
    const filtered = (items ?? []).filter(
      (item) =>
        item.archived === archived &&
        // All skips background kinds unless the user is searching.
        (kindFilter === ALL ? !!text || !kindOf(item)?.background : item.kind === kindFilter) &&
        (project === ALL ? true : project === GLOBAL ? !item.projectId : item.projectId === project) &&
        (!tagging || tagFilter === ALL || (tagFilter === UNTAGGED ? !item.tags?.length : !!item.tags?.includes(tagFilter))) &&
        (!text || untitled(item.title).toLowerCase().includes(text) || contentMatches.has(itemKey(item))),
    );
    return sortItems(filtered, sort, { kindLabel, projectLabel });
  }, [filter, items, archived, kindFilter, kindOf, project, tagging, tagFilter, query, contentMatches, sort, kindLabel, projectLabel]);

  // Grouping by something with one value, or that this collection lacks, is no grouping.
  const tagged = tagging && !!items?.some((item) => item.tags?.length);
  const groupable = (by: GroupBy) =>
    by === "none" || by === "project" || (by === "kind" && !single) || (by === "space" && !!spaces?.length) || (by === "tag" && tagged);
  const grouping = groupable(groupChoice) ? groupChoice : "none";
  const spaceById = useMemo(() => new Map((spaces ?? []).map((space) => [space.id, space])), [spaces]);
  const groups = useMemo<Group[] | null>(() => {
    if (grouping === "none") return null;
    const label = (id: string) =>
      grouping === "kind"
        ? (kinds.find((kind) => kind.id === id)?.plural ?? id)
        : grouping === "project"
          ? projectName(projects, id || null)
          : grouping === "space"
            ? (spaceById.get(id)?.name ?? "No space")
            : (tagById.get(id)?.name ?? "Untagged");
    const order = grouping === "kind" ? kinds.map((kind) => kind.id) : grouping === "space" ? spaces?.map((space) => space.id) : grouping === "tag" ? tags?.map((tag) => tag.id) : undefined;
    return groupItems(shown, grouping, { label, order });
  }, [grouping, shown, kinds, projects, spaceById, spaces, tagById, tags]);
  // Rows in the order they show, for shift-click ranges.
  const ordered = useMemo(
    () => (groups ? [...new Map(groups.flatMap((group) => group.items).map((item) => [itemKey(item), item])).values()] : shown),
    [groups, shown],
  );

  const selectable = useCallback((item: CollectionItem) => (isSelectable ? isSelectable(item) : true), [isSelectable]);
  const selectableKeys = useMemo(() => ordered.filter((item) => selectable(item) === true).map(itemKey), [ordered, selectable]);
  const chosen = useMemo(() => shown.filter((item) => selected.has(itemKey(item)) && selectable(item) === true), [shown, selected, selectable]);
  // Forget picks that were deleted, filtered out, or became unpickable.
  useEffect(() => {
    setSelected((previous) => {
      const visible = new Set(selectableKeys);
      const next = new Set([...previous].filter((key) => visible.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [selectableKeys]);
  useEffect(() => setConfirmDelete(false), [selected]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (item: CollectionItem, range: boolean) => {
    const key = itemKey(item);
    setSelected((previous) => toggleSelection(previous, selectableKeys, key, { range, anchor: anchor.current }));
    anchor.current = key;
  };
  const allChecked = chosen.length > 0 && chosen.length === selectableKeys.length;
  const clear = () => setSelected(new Set());

  const run = (work: () => Promise<unknown>) => {
    setWorking(true);
    void work()
      .catch((cause: unknown) => toast.error(errorMessage(cause)))
      .finally(() => setWorking(false));
  };
  const move = (targets: CollectionItem[], projectId: string | null) =>
    run(async () => reportResults(await handlers.onMove(targets, projectId), "Moved"));
  const archive = (targets: CollectionItem[], value: boolean) =>
    run(async () => reportResults(await handlers.onArchive(targets, value), value ? "Archived" : "Restored"));
  const remove = (targets: CollectionItem[]) =>
    run(async () => {
      reportResults(await handlers.onDelete(targets), "Deleted");
      clear();
    });
  const act = (kind: CollectionKind, action: StudioAction, targets: CollectionItem[]) => {
    if (action.result === "copy") {
      // The clipboard write must start inside the click.
      const result = handlers.onAction(kind, action, targets);
      setWorking(true);
      copyLater(result.then((value) => value.text ?? ""))
        .then(
          () =>
            result.then((value) =>
              value.text ? toast.success(value.message ?? "Copied") : toast.info(value.message ?? "Nothing to copy"),
            ),
          (cause: unknown) => toast.error(errorMessage(cause)),
        )
        .finally(() => setWorking(false));
      return;
    }
    run(async () => {
      const result = await handlers.onAction(kind, action, targets);
      if (result.message) toast.success(result.message);
    });
  };

  const tag = (targets: CollectionItem[], add: string[], remove: string[]) =>
    run(async () => {
      await handlers.onTag?.(targets, add, remove);
    });
  const createTag = (targets: CollectionItem[], name: string) =>
    run(async () => {
      if (!handlers.onCreateTag) return;
      const created = await handlers.onCreateTag(name);
      if (targets.length) await handlers.onTag?.(targets, [created.id], []);
    });
  const tagState = (targets: readonly CollectionItem[]) => (candidate: CollectionTag) => {
    const count = targets.filter((item) => item.tags?.includes(candidate.id)).length;
    return count === 0 ? false : count === targets.length ? true : ("mixed" as const);
  };
  const tagMenu = (targets: CollectionItem[]) => (
    <TagMenuItems
      tags={tags ?? []}
      state={tagState(targets)}
      onToggle={(candidate, add) => tag(targets, add ? [candidate.id] : [], add ? [] : [candidate.id])}
      onCreate={(name) => createTag(targets, name)}
    />
  );
  const spacing = !!spaces && handlers.onSpace !== undefined;
  const spaceMenu = (targets: CollectionItem[]) => (
    <SpaceMenuItems
      spaces={spaces ?? []}
      projects={projects}
      state={(candidate) => spaceMembership(candidate, targets)}
      onToggle={(candidate, add) => run(async () => {
        await handlers.onSpace?.(targets, candidate.id, add);
      })}
    />
  );
  const pickTag = useCallback((candidate: CollectionTag) => setTagFilter(candidate.id), [setTagFilter]);

  // New items land in the filtered project, else the one BB has open.
  const newProject = filter || project === ALL ? defaultProjectId : project === GLOBAL ? null : project;
  // Kind filters narrow the list, while New always offers every available kind.
  const createTargets = kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true));
  const newButton = (className = PRIMARY_BUTTON) =>
    createTargets.length === 0 && !extraCreateItems?.length ? null : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={className}>
            <Icon name="Plus" /> New <Icon name="ChevronDown" className="-mr-1 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {createTargets.map((kind) => (
            <DropdownMenuItem key={`${kind.pluginId}:${kind.id}`} onSelect={() => void handlers.onCreate(kind, newProject)}>
              <Icon name={kind.icon} className="size-4" /> {kind.label}
            </DropdownMenuItem>
          ))}
          {extraCreateItems?.length && createTargets.length ? <DropdownMenuSeparator /> : null}
          {extraCreateItems?.map((item) => <DropdownMenuItem key={item.id} onSelect={() => item.onSelect(newProject)}>
            <Icon name={item.icon} className="size-4" /> {item.label}
          </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  const projectItems = (current: string | null | undefined, onPick: (projectId: string | null) => void) => (
    <>
      <DropdownMenuItem onSelect={() => onPick(null)}>
        Global
        {current === null ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
      </DropdownMenuItem>
      {projects.length ? <DropdownMenuSeparator /> : null}
      {projects.map((candidate) => (
        <DropdownMenuItem key={candidate.id} onSelect={() => onPick(candidate.id)}>
          <span className="truncate">{candidate.name}</span>
          {candidate.id === current ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
        </DropdownMenuItem>
      ))}
    </>
  );

  const itemTarget = (item: CollectionItem) => ({ kind: "path" as const, path: item.href, title: untitled(item.title), icon: kindOf(item)?.icon });
  const floatable = (item: CollectionItem) => floatAvailable && floatPanelFor(item.href.split(/[?#]/)[0]!) !== null;
  // The row's whole menu, shown from its ⋯ button or a right-click.
  const rowMenuItems = (item: CollectionItem) => {
    const kind = kindOf(item);
    return (
      <>
          <DropdownMenuItem onSelect={() => handlers.onOpen(item)}>
            <Icon name="ArrowUpRight" className="size-4" /> Open
          </DropdownMenuItem>
          {floatable(item) ? (
            <DropdownMenuItem onSelect={() => openFloat(itemTarget(item))}>
              <Icon name="AppWindow" className="size-4" /> Float
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => openTarget(itemTarget(item), "split")}>
            <Icon name="Columns2" className="size-4" /> Open in split
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handlers.onNewThread([item])}>
            <Icon name="MessageSquarePlus" className="size-4" /> New thread with this
          </DropdownMenuItem>
          {item.href ? <CopyReferenceMenuItem item={{ href: item.href, title: untitled(item.title), ...(item.icon ? { icon: item.icon } : {}) }} /> : null}
          {handlers.onDuplicate && kind?.capabilities?.duplicate ? <DropdownMenuItem onSelect={() => void handlers.onDuplicate!(item)}><Icon name="Copy" className="size-4" /> Duplicate</DropdownMenuItem> : null}
          {handlers.onSetTemplate && kind?.capabilities?.templates ? <DropdownMenuItem onSelect={() => void handlers.onSetTemplate!(item, !item.template)}><Icon name="Star" className="size-4" /> {item.template ? "Remove template" : "Save as template"}</DropdownMenuItem> : null}
          {handlers.onExport && kind?.capabilities?.export ? <DropdownMenuSub><DropdownMenuSubTrigger><Icon name="Download" className="size-4" /> Export</DropdownMenuSubTrigger><DropdownMenuSubContent>
            {(handlers.exportFormats?.(item) ?? []).map(({ format, label }) => <DropdownMenuItem key={format} onSelect={() => void handlers.onExport!(item, format)}>{label}</DropdownMenuItem>)}
          </DropdownMenuSubContent></DropdownMenuSub> : null}
          {kind?.actions.map((action) => (
            <DropdownMenuItem key={action.id} onSelect={() => act(kind, action, [item])}>
              <Icon name={action.icon} className="size-4" /> {action.label.replace("{count}", "1")}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {(kind?.capabilities?.move ?? true) ? <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon name="Folder" className="size-4" /> Move to project
              <Icon name="ChevronRight" className="ml-auto size-3.5 text-muted-foreground" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-52 overflow-auto">
              {projectItems(item.projectId, (projectId) => move([item], projectId))}
            </DropdownMenuSubContent>
          </DropdownMenuSub> : null}
          {tagging ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="studio/tag" className="size-4" /> Tags
                <Icon name="ChevronRight" className="ml-auto size-3.5 text-muted-foreground" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-56 overflow-auto">{tagMenu([item])}</DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {spacing ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="Layers" className="size-4" /> Spaces
                <Icon name="ChevronRight" className="ml-auto size-3.5 text-muted-foreground" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-56 overflow-auto">{spaceMenu([item])}</DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {(kind?.capabilities?.archive ?? kind?.canArchive) ? (
            <DropdownMenuItem onSelect={() => archive([item], !item.archived)}>
              <Icon name="Archive" className="size-4" /> {item.archived ? "Restore from archive" : "Archive"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {(kind?.capabilities?.delete ?? true) ? <DropdownMenuItem
            className="text-destructive focus:bg-destructive/15 focus:text-destructive"
            onSelect={() => {
              if (!window.confirm(`Delete "${untitled(item.title)}"? This can't be undone.`)) return;
              remove([item]);
            }}
          >
            <Icon name="Trash2" className="size-4" /> Delete
          </DropdownMenuItem> : null}
      </>
    );
  };
  const rowMenu = (item: CollectionItem, triggerClassName: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Actions" className={triggerClassName} onClick={(event) => event.stopPropagation()}>
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(event) => event.stopPropagation()}>
        {rowMenuItems(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const revealClass =
    "rounded-md p-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100";

  const parentLine = (item: CollectionItem) => {
    const parent = item.parentId ? byKey.get(`${item.pluginId}:${item.parentId}`) : undefined;
    return parent ? `in ${parent.icon ? `${parent.icon} ` : ""}${untitled(parent.title)}` : null;
  };
  const selectionLabel = (item: CollectionItem) => {
    const verdict = selectable(item);
    return verdict === true ? undefined : verdict;
  };

  // Bulk actions: shared ones, then a kind's own when every pick is that kind.
  const chosenKinds = [...new Set(chosen.map((item) => `${item.pluginId}:${item.kind}`))];
  const chosenKind = chosenKinds.length === 1 ? kindById.get(chosenKinds[0]!) : undefined;
  const allArchivable = chosen.length > 0 && chosen.every((item) => (kindOf(item)?.capabilities?.archive ?? kindOf(item)?.canArchive));

  const columns = single?.columns ?? [];
  // A column the rows are grouped by would repeat the group header.
  const showKind = !single && grouping !== "kind";
  const showProject = grouping !== "project";
  const showSpaces = grouping !== "space" && shown.some((item) => item.spaces?.some((id) => spaceById.has(id)));
  // Below 48rem of list width the Kind and Spaces columns go (the tile shows
  // the kind); below 36rem rows stack into a name and a menu.
  const template = (wide: boolean) =>
    `minmax(0,1fr)${wide && showKind ? " 110px" : ""}${showProject ? " minmax(0,160px)" : ""}${wide && showSpaces ? " minmax(0,140px)" : ""}${columns.map(() => " 90px").join("")} 130px`;
  const gridTemplate = { "--cols": template(true), "--cols-narrow": template(false) } as CSSProperties;
  const gridColumns = "[grid-template-columns:var(--cols)] @max-3xl/list:[grid-template-columns:var(--cols-narrow)]";

  const header = (label: string, key: SortKey | null, className?: string) => {
    const active = key !== null && sort.key === key;
    return (
      <span role="columnheader" aria-sort={active ? (sort.descending ? "descending" : "ascending") : undefined} className={className}>
        {key ? (
          <button
            type="button"
            className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
            onClick={() => setSort(nextSort(sort, key))}
          >
            {label}
            {active ? <Icon name={sort.descending ? "ArrowDown" : "ArrowUp"} className="size-3" /> : null}
          </button>
        ) : (
          label
        )}
      </span>
    );
  };

  const emptyKinds = activeKind ? [activeKind] : kinds;
  const noItemsAtAll = items !== null && !(items ?? []).some((item) => !item.archived);
  const subtitle = (item: CollectionItem) =>
    [showKind ? kindLabel(item) : null, showProject ? projectLabel(item) : null, relativeTime(item.updatedAt)].filter(Boolean).join(" · ");
  const spaceNames = (item: CollectionItem) => (item.spaces ?? []).flatMap((id) => spaceById.get(id)?.name ?? []);

  const sortChoices: { key: SortKey; label: string }[] = [
    { key: "title", label: "Name" },
    ...(single ? [] : [{ key: "kind" as const, label: "Kind" }]),
    { key: "project", label: "Project" },
    ...columns.map((column) => ({ key: `fact:${column.id}` as const, label: column.label })),
    { key: "createdAt", label: "Created" },
    { key: "updatedAt", label: "Last activity" },
  ];
  const textSort = sort.key === "title" || sort.key === "kind" || sort.key === "project";
  const displayMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Display"
          title={grouping === "none" ? "Sort and group" : `Grouped by ${GROUP_LABELS[grouping].toLowerCase()}`}
          aria-pressed={grouping !== "none"}
          className={ICON_BUTTON}
        >
          <Icon name="SlidersHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Group by</DropdownMenuLabel>
        {GROUP_BYS.filter(groupable).map((by) => (
          <DropdownMenuItem key={by} onSelect={() => setGroupBy(by)}>
            {GROUP_LABELS[by]}
            {grouping === by ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Sort by</DropdownMenuLabel>
        {sortChoices.map((choice) => (
          <DropdownMenuItem key={choice.key} onSelect={() => sort.key !== choice.key && setSort(nextSort(sort, choice.key))}>
            {choice.label}
            {sort.key === choice.key ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {[false, true].map((descending) => (
          <DropdownMenuItem key={String(descending)} onSelect={() => setSort({ key: sort.key, descending })}>
            <Icon name={descending ? "ArrowDown" : "ArrowUp"} className="size-4" />
            {textSort ? (descending ? "Z to A" : "A to Z") : descending ? (sort.key.startsWith("fact:") ? "Largest first" : "Newest first") : sort.key.startsWith("fact:") ? "Smallest first" : "Oldest first"}
            {sort.descending === descending ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const groupGlyph = (id: string) =>
    grouping === "kind" ? (
      <Icon name={kinds.find((kind) => kind.id === id)?.icon ?? "File"} className="size-3.5" />
    ) : grouping === "tag" ? (
      tagById.get(id) ? <TagDot color={tagById.get(id)!.color} /> : null
    ) : grouping === "space" ? (
      (spaceById.get(id)?.glyph ?? null)
    ) : (
      <Icon name={id ? "Folder" : "Globe"} className="size-3.5" />
    );
  // While searching, an item that matched on content shows the text that matched.
  const preview = (item: CollectionItem, className: string) => {
    const text = searched.trim();
    const snippet = text ? contentMatches.get(itemKey(item)) : null;
    if (!snippet && !item.preview) return null;
    return (
      <div className={cn("text-xs text-muted-foreground", className)} data-snippet={snippet ? "" : undefined}>
        {snippet ? <Highlight text={snippet} query={text} /> : item.preview}
      </div>
    );
  };

  const row = (item: CollectionItem, group: string) => {
    const kind = kindOf(item);
    const key = itemKey(item);
    const checked = selected.has(key);
    const reason = selectionLabel(item);
    const parent = parentLine(item);
    return (
      <div
        key={`${group}:${key}`}
        role="row"
        tabIndex={0}
        aria-label={untitled(item.title)}
        aria-selected={checked}
        data-state={checked ? "selected" : undefined}
        className={cn(
          "group/row grid cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-state-hover data-[state=selected]:bg-state-active @max-xl/list:!grid-cols-[minmax(0,1fr)_auto] @max-xl/list:py-2.5",
          gridColumns,
        )}
        style={gridTemplate}
        {...studioItemProps({ href: item.href, title: untitled(item.title), icon: kind?.icon })}
        {...(chosen.length ? { [STUDIO_ITEM_CLICKS_OFF]: "" } : {})}
        onContextMenu={(event) => {
          if (event.shiftKey) return;
          event.preventDefault();
          setRowContext({ item, x: event.clientX, y: event.clientY });
        }}
        onClick={(event) => (chosen.length && reason === undefined ? toggle(item, event.shiftKey) : handlers.onOpen(item))}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter") handlers.onOpen(item);
          if (event.key === " ") {
            event.preventDefault();
            if (reason === undefined) toggle(item, event.shiftKey);
          }
        }}
      >
        <div role="gridcell" className="flex min-w-0 items-center gap-3">
          {/* The checkbox sits on the avatar: it shows on hover, focus, or while selecting. */}
          <span className="group/pick relative flex size-8 shrink-0 items-center justify-center" {...{ [STUDIO_ITEM_CLICKS_OFF]: "" }}>
            <span className={cn("flex", checked || chosen.length ? "invisible" : "group-hover/row:invisible group-focus-within/pick:invisible")}>
              {item.thumbnailUrl ? (
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
                  <img src={item.thumbnailUrl} alt="" loading="lazy" className={THUMBNAIL} />
                </span>
              ) : (
                <ItemTile icon={item.icon} kindIcon={kind?.icon ?? "File"} />
              )}
            </span>
            <Checkbox
              checked={checked}
              label={`Select ${untitled(item.title)}`}
              disabled={reason !== undefined}
              title={reason}
              onToggle={(event) => toggle(item, event.shiftKey)}
              className={cn("absolute", !checked && !chosen.length && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}
            />
          </span>
          <div className="min-w-0">
            <div className={cn("flex min-w-0 items-center gap-1.5 font-medium", !item.title && "text-muted-foreground")}>
              <span className="truncate">{untitled(item.title)}</span>
              {item.badge ? <Badge label={item.badge.label} tone={item.badge.tone} /> : null}
              {tagging ? <TagChips ids={item.tags} tags={tagById} onPick={pickTag} /> : null}
            </div>
            {parent ? <div className="truncate text-xs text-muted-foreground">{parent}</div> : null}
            {!parent ? preview(item, "truncate") : null}
            <div className="truncate text-xs text-muted-foreground @xl/list:hidden">{subtitle(item)}</div>
          </div>
        </div>
        {showKind ? (
          <div role="gridcell" className="flex min-w-0 items-center gap-1.5 text-muted-foreground @max-3xl/list:hidden">
            <Icon name={kind?.icon ?? "File"} className="size-3.5 shrink-0" />
            <span className="truncate">{kindLabel(item)}</span>
          </div>
        ) : null}
        {showProject ? (
          <div role="gridcell" className="truncate text-muted-foreground @max-xl/list:hidden">
            {projectLabel(item)}
          </div>
        ) : null}
        {showSpaces ? (
          <div role="gridcell" className="truncate text-muted-foreground @max-3xl/list:hidden" title={spaceNames(item).join(", ") || undefined}>
            {spaceNames(item).join(", ") || "—"}
          </div>
        ) : null}
        {columns.map((column) => (
          <div key={column.id} role="gridcell" className="truncate text-right tabular-nums text-muted-foreground @max-xl/list:hidden">
            {item.facts.find((fact) => fact.id === column.id)?.value ?? "—"}
          </div>
        ))}
        <div role="gridcell" className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground @max-xl/list:justify-end">
          <span className="truncate @max-xl/list:hidden" title={new Date(item.updatedAt).toLocaleString()}>
            {relativeTime(item.updatedAt)}
          </span>
          {rowMenu(item, revealClass)}
        </div>
      </div>
    );
  };

  const hasRail = filter !== undefined && filter.rail !== undefined;
  return (
    <PageColumn className={cn("pt-6", filter && "max-w-6xl")}>
      <StudioBar>
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center"><BarCrumb current>{title}</BarCrumb></nav>
        <div className="flex shrink-0 items-center gap-0.5">
          {displayMenu}
          {headerActions}
          {newButton(cn(BAR_BUTTON, "text-foreground"))}
        </div>
      </StudioBar>
      {splitAnchor}
      {rowContext ? (
        <DropdownMenu key={`${rowContext.x},${rowContext.y}`} open modal={false} onOpenChange={(open) => !open && setRowContext(null)}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden className="pointer-events-none fixed size-px" style={{ left: rowContext.x, top: rowContext.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={0} className="w-56" aria-label={`${untitled(rowContext.item.title)} options`}>
            {rowMenuItems(rowContext.item)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <div className="flex items-center gap-2">
        {filter ? (
          <div className="min-w-0 flex-1">{filter.bar}</div>
        ) : (
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm focus-within:border-foreground/30 @3xl/page:max-w-sm">
            <Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label={`Search ${title.toLowerCase()}`}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
            />
            {query ? (
              <button type="button" aria-label="Clear search" className="text-muted-foreground hover:text-foreground" onClick={() => setQuery("")}>
                <Icon name="X" className="size-3.5" />
              </button>
            ) : null}
          </label>
        )}
      </div>

      {notice ? <div className="mt-4">{notice}</div> : null}

      <div className={cn(hasRail && "flex items-start gap-8")}>
        {hasRail ? <aside aria-label="Filters" className="sticky top-0 w-52 shrink-0 pt-4 @max-4xl/page:hidden">{filter.rail}</aside> : null}
        <div className={cn(hasRail && "min-w-0 flex-1")}>
          <div
            role="toolbar"
            aria-label={chosen.length ? "Selected items" : "Filters"}
            className="sticky top-0 z-10 -mx-2 mt-4 flex min-h-11 flex-wrap items-center gap-1.5 bg-background px-2 py-1.5 @max-3xl/page:-mx-4 @max-3xl/page:flex-nowrap @max-3xl/page:overflow-x-auto @max-3xl/page:px-4"
          >
            {chosen.length ? (
              <>
                <span className="mr-1 shrink-0 text-sm font-medium">{chosen.length} selected</span>
                <button type="button" className={OUTLINE_BUTTON} disabled={working} onClick={() => handlers.onNewThread(chosen)}>
                  <Icon name="MessageSquarePlus" /> New thread
                </button>
                {chosen.some(floatable) ? (
                  <button type="button" className={OUTLINE_BUTTON} onClick={() => chosen.filter(floatable).forEach((item) => openFloat(itemTarget(item)))}>
                    <Icon name="AppWindow" /> Float {chosen.filter(floatable).length}
                  </button>
                ) : null}
                {chosenKind?.actions.map((action) => (
                  <button key={action.id} type="button" className={OUTLINE_BUTTON} disabled={working} onClick={() => act(chosenKind, action, chosen)}>
                    <Icon name={action.icon} /> {action.label.replace("{count}", String(chosen.length))}
                  </button>
                ))}
                {handlers.onExportBulk && chosen.length > 1 && chosen.every((item) => kindOf(item)?.capabilities?.export) ? <button type="button" className={OUTLINE_BUTTON} disabled={working} onClick={() => void handlers.onExportBulk!(chosen)}><Icon name="Download" /> Export ZIP</button> : null}
                {chosen.every((item) => kindOf(item)?.capabilities?.move ?? true) ? <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={OUTLINE_BUTTON} disabled={working}>
                      <Icon name="Folder" /> Move <Icon name="ChevronDown" className="-mr-1 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Move {plural(chosen.length, "item")} to</DropdownMenuLabel>
                    {projectItems(undefined, (projectId) => move(chosen, projectId))}
                  </DropdownMenuContent>
                </DropdownMenu> : null}
                {tagging ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={OUTLINE_BUTTON} disabled={working}>
                        <Icon name="studio/tag" className="size-4" /> Tag <Icon name="ChevronDown" className="-mr-1 opacity-70" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
                      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Tag {plural(chosen.length, "item")}</DropdownMenuLabel>
                      {tagMenu(chosen)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {spacing ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={OUTLINE_BUTTON} disabled={working}>
                        <Icon name="Layers" className="size-4" /> Space <Icon name="ChevronDown" className="-mr-1 opacity-70" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
                      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Add {plural(chosen.length, "item")} to</DropdownMenuLabel>
                      {spaceMenu(chosen)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {allArchivable ? (
                  <button type="button" className={OUTLINE_BUTTON} disabled={working} onClick={() => archive(chosen, !archived)}>
                    <Icon name="Archive" /> {archived ? "Restore" : "Archive"}
                  </button>
                ) : null}
                {chosen.every((item) => kindOf(item)?.capabilities?.delete ?? true) ? <button
                  type="button"
                  className={confirmDelete ? DANGER_BUTTON : OUTLINE_BUTTON}
                  disabled={working}
                  onBlur={() => setConfirmDelete(false)}
                  onClick={() => (confirmDelete ? remove(chosen) : setConfirmDelete(true))}
                >
                  <Icon name="Trash2" /> {confirmDelete ? `Delete ${chosen.length} for good` : "Delete"}
                </button> : null}
                <button type="button" className={cn(GHOST_BUTTON, "ml-auto")} onClick={clear}>
                  Clear
                </button>
              </>
            ) : filter ? (
              <>
                {filter.toolbar}
                {items !== null && shown.length ? <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{plural(shown.length, "item")}</span> : null}
              </>
            ) : (
              <>
                {kinds.length > 1 ? (
                  <>
                    <button type="button" aria-pressed={kindFilter === ALL} className={PILL} onClick={() => onKindChange(ALL)}>
                      All
                    </button>
                    {kinds.map((kind) => (
                      <button
                        key={`${kind.pluginId}:${kind.id}`}
                        type="button"
                        aria-pressed={kindFilter === kind.id}
                        className={PILL}
                        onClick={() => onKindChange(kind.id)}
                      >
                        {kind.plural}
                      </button>
                    ))}
                    <span className="mx-1 h-4 w-px shrink-0 bg-border" />
                  </>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Filter by project"
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active"
                    >
                      <Icon name="Folder" className="size-3.5" />
                      <span className="max-w-40 truncate">{project === ALL ? "All projects" : project === GLOBAL ? "Global" : projectName(projects, project)}</span>
                      <Icon name="ChevronDown" className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
                    <DropdownMenuItem onSelect={() => setProject(ALL)}>
                      All projects
                      {project === ALL ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
                    </DropdownMenuItem>
                    {projectItems(project === ALL ? undefined : project === GLOBAL ? null : project, (projectId) => setProject(projectId ?? GLOBAL))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {tagging ? (
                  <DropdownMenu onOpenChange={(open) => !open && setRenaming(false)}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Filter by tag"
                        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active"
                      >
                        {activeTag ? <TagDot color={activeTag.color} /> : <Icon name="studio/tag" className="size-3.5" />}
                        <span className="max-w-40 truncate">{activeTag ? activeTag.name : tagFilter === UNTAGGED ? "Untagged" : "All tags"}</span>
                        <Icon name="ChevronDown" className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-96 w-56 overflow-auto">
                      {renaming && activeTag ? (
                        <TagNameInput
                          placeholder="Tag name"
                          initial={activeTag.name}
                          onSubmit={(name) => {
                            setRenaming(false);
                            run(async () => handlers.onRenameTag?.(activeTag, name));
                          }}
                        />
                      ) : (
                        <>
                          <DropdownMenuItem onSelect={() => setTagFilter(ALL)}>
                            All tags
                            {tagFilter === ALL ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setTagFilter(UNTAGGED)}>
                            Untagged
                            {tagFilter === UNTAGGED ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
                          </DropdownMenuItem>
                          {tags!.length ? <DropdownMenuSeparator /> : null}
                          {tags!.map((candidate) => (
                            <DropdownMenuItem key={candidate.id} onSelect={() => setTagFilter(candidate.id)}>
                              <TagDot color={candidate.color} />
                              <span className="truncate">{candidate.name}</span>
                              {candidate.id === tagFilter ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
                            </DropdownMenuItem>
                          ))}
                          {!tags!.length ? (
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Select items and pick Tag to group them.</DropdownMenuLabel>
                          ) : null}
                          {activeTag ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  setRenaming(true);
                                }}
                              >
                                <Icon name="Edit" className="size-4" /> Rename {activeTag.name}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:bg-destructive/15 focus:text-destructive"
                                onSelect={() => {
                                  if (!window.confirm(`Delete the tag "${activeTag.name}"? Its items stay; they just lose the tag.`)) return;
                                  run(async () => handlers.onDeleteTag?.(activeTag));
                                }}
                              >
                                <Icon name="Trash2" className="size-4" /> Delete {activeTag.name}
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {canArchive ? (
                  <button type="button" aria-pressed={archived} className={cn(PILL, "flex items-center gap-1.5")} onClick={() => setArchived(!archived)}>
                    <Icon name="Archive" className="size-3.5" /> Archived
                  </button>
                ) : null}
                {items !== null && shown.length ? (
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{plural(shown.length, "item")}</span>
                ) : null}
              </>
            )}
          </div>

          <div className="@container/list mt-3">
            {error ? <p className="py-2 text-sm text-destructive">{error}</p> : null}
            {items === null && !error ? <p className="py-2 text-sm text-muted-foreground">Loading…</p> : null}
            {filter && items !== null && !shown.length ? (
              <p className="py-16 text-center text-sm text-muted-foreground">{filter.empty}</p>
            ) : items !== null && noItemsAtAll && !archived ? (
              <EmptyState icon={emptyKinds.length === 1 ? emptyKinds[0]!.icon : "Layers"} title={`No ${(activeKind?.plural ?? (kinds.length === 1 ? kinds[0]!.plural : "items")).toLowerCase()} yet`} actions={newButton()} />
            ) : items !== null && !shown.length ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {archived
                  ? "Nothing archived."
                  : query.trim()
                    ? "Nothing matches."
                    : tagging && activeTag
                      ? `Nothing tagged ${activeTag.name}${activeKind ? ` among ${activeKind.plural.toLowerCase()}` : ""}.`
                      : tagging && tagFilter === UNTAGGED
                        ? "Everything here is tagged."
                        : activeKind
                          ? `No ${activeKind.plural.toLowerCase()} here.`
                          : "Nothing here."}
              </p>
            ) : null}

            {shown.length ? (
              <div role="grid" aria-label={title} aria-multiselectable className="text-sm">
                <div role="row" className={cn("grid gap-3 border-b border-border px-2 pb-2 text-xs text-muted-foreground @max-xl/list:hidden", gridColumns)} style={gridTemplate}>
                  <span className="flex items-center gap-3">
                    <span role="columnheader" className="flex w-8 shrink-0 justify-center">
                      <Checkbox
                        checked={allChecked ? true : chosen.length ? "mixed" : false}
                        label={allChecked ? "Deselect all" : "Select all"}
                        disabled={!selectableKeys.length}
                        onToggle={() => setSelected(allChecked ? new Set() : new Set(selectableKeys))}
                      />
                    </span>
                    {header("Name", "title")}
                  </span>
                  {showKind ? header("Kind", "kind", "@max-3xl/list:hidden") : null}
                  {showProject ? header("Project", "project") : null}
                  {showSpaces ? header("Spaces", null, "@max-3xl/list:hidden") : null}
                  {columns.map((column) => header(column.label, `fact:${column.id}`, "text-right"))}
                  {header("Last activity", "updatedAt")}
                </div>
                {groups
                  ? groups.map((group) => {
                      const open = !collapsed.has(group.id);
                      return (
                        <div key={`group:${group.id}`} role="rowgroup" aria-label={group.label}>
                          <div role="row" className="mt-2 border-b border-border/60">
                            <button
                              type="button"
                              role="gridcell"
                              aria-expanded={open}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-state-hover hover:text-foreground"
                              onClick={() =>
                                setCollapsed((previous) => {
                                  const next = new Set(previous);
                                  if (!next.delete(group.id)) next.add(group.id);
                                  return next;
                                })
                              }
                            >
                              <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5" />
                              <span className="flex w-4 justify-center">{groupGlyph(group.id)}</span>
                              <span className="truncate text-foreground">{group.label}</span>
                              <span className="tabular-nums">{group.items.length}</span>
                            </button>
                          </div>
                          {open ? group.items.map((item) => row(item, group.id)) : null}
                        </div>
                      );
                    })
                  : shown.map((item) => row(item, ""))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </PageColumn>
  );
}

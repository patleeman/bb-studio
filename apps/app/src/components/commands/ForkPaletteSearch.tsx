import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type SetStateAction,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginPaletteSearchSlot } from "@/lib/fork-slots";
import { usePluginSlots } from "@/lib/plugin-slots";
import { resolveRouteHref } from "@/lib/route-paths";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { PALETTE_SECTION_LABEL_CLASS, PaletteShortcut } from "./PaletteShell";

const DEBOUNCE_MS = 150;
const GROUP_LIMIT = 5;

export interface PluginPaletteRow {
  key: string;
  title: string;
  subtitle: string | null;
  path: string;
  icon: string | null;
  onModSelect: (() => void) | null;
  modSelectLabel: string | null;
}

export interface PluginPaletteGroup {
  key: string;
  title: string;
  rows: readonly PluginPaletteRow[];
}

function rowsFromResults(
  provider: PluginPaletteSearchSlot,
  results: unknown,
  origin: string,
): PluginPaletteRow[] {
  if (!Array.isArray(results)) return [];
  const rows: PluginPaletteRow[] = [];
  const seen = new Set<string>();
  for (const result of results as readonly unknown[]) {
    if (rows.length === GROUP_LIMIT) break;
    if (typeof result !== "object" || result === null) continue;
    const {
      id,
      title,
      subtitle,
      path,
      icon,
      experimental_onModSelect,
      experimental_modSelectLabel,
    } = result as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      typeof title !== "string" ||
      typeof path !== "string" ||
      !path.startsWith("/") ||
      seen.has(id)
    ) {
      continue;
    }
    const route = resolveRouteHref({ currentOrigin: origin, href: path });
    if (route === null) continue;
    seen.add(id);
    rows.push({
      key: `${provider.pluginId}/${provider.id}/${id}`,
      title,
      subtitle:
        typeof subtitle === "string" && subtitle !== "" ? subtitle : null,
      path: route.path,
      icon: typeof icon === "string" && icon !== "" ? icon : null,
      modSelectLabel:
        typeof experimental_onModSelect === "function" &&
        typeof experimental_modSelectLabel === "string" &&
        experimental_modSelectLabel !== ""
          ? experimental_modSelectLabel
          : null,
      onModSelect:
        typeof experimental_onModSelect === "function"
          ? () => {
              experimental_onModSelect();
            }
          : null,
    });
  }
  return rows;
}

export function usePluginPaletteSearch(
  query: string,
): readonly PluginPaletteGroup[] {
  const { paletteSearches } = usePluginSlots();
  const trimmedQuery = query.trim();
  const [settled, setSettled] = useState<{
    query: string;
    providers: readonly PluginPaletteSearchSlot[];
    groups: readonly PluginPaletteGroup[];
  } | null>(null);

  useEffect(() => {
    if (paletteSearches.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.all(
        paletteSearches.map(
          async (provider): Promise<PluginPaletteGroup | null> => {
            try {
              const results = await provider.search(trimmedQuery, {
                signal: controller.signal,
              });
              return {
                key: `${provider.pluginId}/${provider.id}`,
                title: provider.title,
                rows: rowsFromResults(
                  provider,
                  results,
                  window.location.origin,
                ),
              };
            } catch (error) {
              if (!controller.signal.aborted) {
                console.warn(
                  `[plugin:${provider.pluginId}] palette search "${provider.id}" failed`,
                  error,
                );
              }
              return null;
            }
          },
        ),
      ).then((groups) => {
        if (controller.signal.aborted) return;
        setSettled({
          query: trimmedQuery,
          providers: paletteSearches,
          groups: groups.filter(
            (group): group is PluginPaletteGroup =>
              group !== null && group.rows.length > 0,
          ),
        });
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [paletteSearches, trimmedQuery]);

  return useMemo(
    () =>
      settled !== null &&
      settled.query === trimmedQuery &&
      settled.providers === paletteSearches
        ? settled.groups
        : [],
    [paletteSearches, settled, trimmedQuery],
  );
}

export function rankPluginPaletteGroups(
  groups: readonly PluginPaletteGroup[],
  query: string,
): {
  leading: readonly PluginPaletteGroup[];
  trailing: readonly PluginPaletteGroup[];
} {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { leading: [], trailing: groups };
  const part = (inTitle: boolean) =>
    groups
      .map((group) => ({
        ...group,
        key: inTitle ? `${group.key}/title` : group.key,
        rows: group.rows.filter(
          (row) => row.title.toLowerCase().includes(needle) === inTitle,
        ),
      }))
      .filter((group) => group.rows.length > 0);
  return { leading: part(true), trailing: part(false) };
}

const ICON_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

function PluginPaletteRowIcon({ icon }: { icon: string }) {
  return ICON_NAME_PATTERN.test(icon) ? (
    <Icon
      name={icon as IconName}
      className="size-4 shrink-0 text-subtle-foreground"
      aria-hidden="true"
    />
  ) : (
    <span aria-hidden="true" className="w-4 shrink-0 text-center leading-none">
      {icon}
    </span>
  );
}

export function PluginPaletteGroups({
  groups,
  indexOfRow,
  activeIndex,
  optionIdPrefix,
  modifierLabel = null,
  onSelect,
  onHighlight,
}: {
  modifierLabel?: string | null;
  groups: readonly PluginPaletteGroup[];
  indexOfRow: (row: PluginPaletteRow) => number;
  activeIndex: number;
  optionIdPrefix: string;
  onSelect: (row: PluginPaletteRow, index: number, mod: boolean) => void;
  onHighlight: (index: number) => void;
}) {
  return groups.map((group) => {
    const labelId = `${optionIdPrefix}-${group.key}-label`;
    return (
      <div
        key={group.key}
        role="group"
        aria-labelledby={labelId}
        className="not-last:mb-2"
        data-palette-plugin-group={group.key}
      >
        <div id={labelId} className={PALETTE_SECTION_LABEL_CLASS}>
          {group.title}
        </div>
        {group.rows.map((row) => {
          const index = indexOfRow(row);
          return (
            <div
              key={row.key}
              id={`${optionIdPrefix}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex min-h-11 min-w-0 cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                index === activeIndex && "bg-state-hover text-foreground",
              )}
              onClick={(event) =>
                onSelect(row, index, event.metaKey || event.ctrlKey)
              }
              onPointerMove={() => onHighlight(index)}
            >
              {row.icon === null ? null : (
                <PluginPaletteRowIcon icon={row.icon} />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-foreground">{row.title}</span>
                {row.subtitle === null ? null : (
                  <span className="truncate text-xs leading-4 text-subtle-foreground">
                    {row.subtitle}
                  </span>
                )}
              </span>
              {row.modSelectLabel !== null &&
              modifierLabel !== null &&
              index === activeIndex ? (
                <span className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs text-subtle-foreground">
                  <span className="mr-1">{row.modSelectLabel}</span>
                  <PaletteShortcut>{`${modifierLabel} ↵`}</PaletteShortcut>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  });
}

export function usePluginPaletteOptions<Option>({
  query,
  threadOptions,
  pluginOption,
}: {
  query: string;
  threadOptions: readonly Option[];
  pluginOption: (row: PluginPaletteRow) => Option;
}): {
  options: Option[];
  leading: readonly PluginPaletteGroup[];
  trailing: readonly PluginPaletteGroup[];
  isEmpty: boolean;
} {
  const groups = usePluginPaletteSearch(query);
  const { leading, trailing } = useMemo(
    () => rankPluginPaletteGroups(groups, query),
    [groups, query],
  );
  const options = useMemo(() => {
    const rows = (list: readonly PluginPaletteGroup[]) =>
      list.flatMap((group) => group.rows.map(pluginOption));
    return [...rows(leading), ...threadOptions, ...rows(trailing)];
  }, [leading, pluginOption, threadOptions, trailing]);
  return { options, leading, trailing, isEmpty: groups.length === 0 };
}

export function PluginPaletteSection<
  Option extends { plugin?: PluginPaletteRow },
>({
  groups,
  options,
  activeIndex,
  optionIdPrefix,
  modifierLabel,
  onSelect,
  onHighlight,
}: {
  groups: readonly PluginPaletteGroup[];
  options: readonly Option[];
  activeIndex: number;
  optionIdPrefix: string;
  modifierLabel: ComponentProps<typeof PluginPaletteGroups>["modifierLabel"];
  onSelect: (option: Option, index: number, mod?: boolean) => void;
  onHighlight: (index: number) => void;
}) {
  return (
    <PluginPaletteGroups
      groups={groups}
      indexOfRow={(row) => options.findIndex((option) => option.plugin === row)}
      activeIndex={activeIndex}
      optionIdPrefix={optionIdPrefix}
      modifierLabel={modifierLabel}
      onSelect={(row, index, mod) => {
        const option = options[index];
        if (option !== undefined && option.plugin === row) {
          onSelect(option, index, mod);
        }
      }}
      onHighlight={onHighlight}
    />
  );
}

export function usePluginPaletteHighlightReset<Option>({
  options,
  leading,
  optionKey,
  setHighlightedKey,
  setHighlightedIndex,
}: {
  options: readonly Option[];
  leading: readonly PluginPaletteGroup[];
  optionKey: (option: Option) => string;
  setHighlightedKey: Dispatch<SetStateAction<string | null>>;
  setHighlightedIndex: Dispatch<SetStateAction<number>>;
}): void {
  const leadingRowCount = leading.reduce(
    (count, group) => count + group.rows.length,
    0,
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const optionKeyRef = useRef(optionKey);
  optionKeyRef.current = optionKey;
  useLayoutEffect(() => {
    if (leadingRowCount === 0) return;
    const displaced = optionsRef.current[leadingRowCount];
    if (displaced === undefined) return;
    const displacedKey = optionKeyRef.current(displaced);
    setHighlightedKey((current) => {
      if (current !== displacedKey) return current;
      setHighlightedIndex(0);
      return null;
    });
  }, [leading, leadingRowCount, setHighlightedIndex, setHighlightedKey]);
}

export function selectPluginPaletteRow(
  plugin: PluginPaletteRow,
  split: boolean,
  runAfterClose: (run: () => void) => void,
  navigate: (path: string) => unknown,
): void {
  const onModSelect = split ? plugin.onModSelect : null;
  runAfterClose(
    onModSelect ??
      (() => {
        navigate(plugin.path);
      }),
  );
}

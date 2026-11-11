import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { ExperimentalSourceSkill } from "@get-bb/plugin-sdk";
import {
  ResourceFilterMenu,
  ResourceListPanel,
  ResourceListState,
  ResourceRow,
  ResourceRowDetailChevron,
} from "@bb/shared-ui/resource-list";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import type { PluginSkillSourceSlot } from "@/lib/fork-slots";
import {
  getPluginSlotSnapshot,
  subscribePluginSlots,
} from "@/lib/plugin-slots";

type FilterGroup = ComponentProps<typeof ResourceFilterMenu>["groups"][number];

export const SKILL_SOURCE_FILTER_GROUP_ID = "fork-skill-source";

export interface ForkSkillSources {
  filterGroups: readonly FilterGroup[];
  body(libraryBody: ReactNode): ReactNode;
}

function sourceKey(source: PluginSkillSourceSlot): string {
  return `${source.pluginId}/${source.id}`;
}

export function matchingSourceSkills(
  skills: unknown,
  label: string,
  query: string,
): readonly ExperimentalSourceSkill[] {
  if (!Array.isArray(skills)) return [];
  const valid = skills.filter(
    (skill): skill is ExperimentalSourceSkill =>
      typeof skill === "object" &&
      skill !== null &&
      typeof skill.id === "string" &&
      typeof skill.name === "string" &&
      skill.name.trim() !== "",
  );
  const sorted = [...valid].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  if (query === "") return sorted;
  return sorted.filter((skill) =>
    [
      skill.name,
      typeof skill.description === "string" ? skill.description : "",
      label,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function openSourceSkill(
  skill: ExperimentalSourceSkill,
  openPath: ((path: string) => void) | null,
): void {
  try {
    if (typeof skill.onOpen === "function") {
      skill.onOpen();
      return;
    }
    if (typeof skill.path === "string" && skill.path !== "" && openPath) {
      openPath(skill.path);
    }
  } catch (error) {
    console.error("Plugin skill failed to open", error);
  }
}

type ReportCount = (key: string, count: number | null) => void;

const SkillSourceSection = memo(function SkillSourceSection({
  source,
  query,
  reportKey,
  report,
}: {
  source: PluginSkillSourceSlot;
  query: string;
  reportKey: string;
  report: ReportCount;
}) {
  const skills = source.useSkills();
  const visible = useMemo(
    () => matchingSourceSkills(skills, source.label, query),
    [skills, source.label, query],
  );
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({
      enabled: visible.some(
        (skill) => skill.onOpen === undefined && skill.path !== undefined,
      ),
    });
  const openPath = useMemo(
    () =>
      canOpenPreferredFileTarget
        ? (path: string) => {
            void openPathInPreferredFileTarget({ path, lineNumber: null });
          }
        : null,
    [canOpenPreferredFileTarget, openPathInPreferredFileTarget],
  );
  useLayoutEffect(() => {
    report(reportKey, visible.length);
  }, [report, reportKey, visible.length]);
  useLayoutEffect(() => () => report(reportKey, null), [report, reportKey]);
  if (visible.length === 0) return null;
  return (
    <section
      data-fork-skill-source={reportKey}
      aria-label={source.label}
      className="mt-4 first:mt-0"
    >
      <h3 className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
        {source.label}
      </h3>
      <ResourceListPanel>
        {visible.map((skill) => (
          <ResourceRow
            key={skill.id}
            leading={
              <PluginIcon
                pluginId={source.pluginId}
                icon={null}
                className="size-6"
              />
            }
            title={skill.name}
            description={
              typeof skill.description === "string" && skill.description !== ""
                ? skill.description
                : undefined
            }
            onOpen={() => openSourceSkill(skill, openPath)}
            trailingVisual={<ResourceRowDetailChevron />}
          />
        ))}
      </ResourceListPanel>
    </section>
  );
});

export function useForkSkillSources(
  query: string,
  builtInFiltered: boolean,
  builtInShown: boolean,
): ForkSkillSources {
  const registered = useSyncExternalStore(
    subscribePluginSlots,
    getPluginSlotSnapshot,
    getPluginSlotSnapshot,
  ).skillSources;
  const sources = useMemo(
    () =>
      [...(registered ?? [])].sort(
        (a, b) =>
          a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
      ),
    [registered],
  );
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const report = useCallback<ReportCount>((key, count) => {
    setCounts((previous) => {
      if (count === null) {
        if (!previous.has(key)) return previous;
        const next = new Map(previous);
        next.delete(key);
        return next;
      }
      if (previous.get(key) === count) return previous;
      return new Map(previous).set(key, count);
    });
  }, []);
  const keys = useMemo(() => new Set(sources.map(sourceKey)), [sources]);
  const activeSelection = useMemo(
    () => selected.filter((key) => keys.has(key)),
    [keys, selected],
  );
  const filterGroups = useMemo<readonly FilterGroup[]>(
    () =>
      sources.length === 0
        ? []
        : [
            {
              id: SKILL_SOURCE_FILTER_GROUP_ID,
              label: "Source",
              options: sources.map((source) => ({
                id: sourceKey(source),
                label: source.label,
                leading: (
                  <PluginIcon
                    pluginId={source.pluginId}
                    icon={null}
                    className="size-4"
                  />
                ),
              })),
              selectedValues: activeSelection,
              onChange: (values) => setSelected(values),
            },
          ],
    [activeSelection, sources],
  );
  const body = useCallback(
    (libraryBody: ReactNode): ReactNode => {
      const choosing = activeSelection.length > 0;
      const shown = choosing
        ? sources.filter((source) =>
            activeSelection.includes(sourceKey(source)),
          )
        : builtInFiltered
          ? []
          : sources;
      const sourceRows = [...counts.entries()].reduce(
        (total, [key, count]) =>
          shown.some((source) => sourceKey(source) === key)
            ? total + count
            : total,
        0,
      );
      const includesBuiltIn = !choosing || builtInFiltered;
      const showsBuiltIn =
        includesBuiltIn && (builtInShown || sourceRows === 0);
      return (
        <div className={TOOLS_PAGE_BAND_CLASSES}>
          {showsBuiltIn ? libraryBody : null}
          {shown.length === 0 ? null : (
            <div className={showsBuiltIn ? "mt-4" : undefined}>
              {shown.map((source) => {
                const key = `${sourceKey(source)}/${source.generation}`;
                return (
                  <PluginSlotMount
                    key={key}
                    pluginId={source.pluginId}
                    slotKind="skillSource"
                    slotId={source.id}
                    crashFallback={null}
                    wrapRoot={false}
                  >
                    <SkillSourceSection
                      source={source}
                      query={query}
                      reportKey={sourceKey(source)}
                      report={report}
                    />
                  </PluginSlotMount>
                );
              })}
            </div>
          )}
          {!includesBuiltIn && sourceRows === 0 ? (
            <ResourceListState
              state="empty"
              message="No skills match these filters."
            />
          ) : null}
        </div>
      );
    },
    [
      activeSelection,
      builtInFiltered,
      builtInShown,
      counts,
      query,
      report,
      sources,
    ],
  );
  return { filterGroups, body };
}

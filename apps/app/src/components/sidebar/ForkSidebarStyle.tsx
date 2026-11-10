import { memo, useLayoutEffect, useMemo, type CSSProperties } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import type { ExperimentalSidebarStyle } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { isBareWindow } from "@/lib/fork-bare-window";
import { usePreferredReplacement } from "@/lib/plugin-replacement-preference";
import { usePluginSlots, type PluginSlotSnapshot } from "@/lib/plugin-slots";
import { threadListProviderAtom } from "./threadListProvider";

export interface ForkSidebarStyleReport {
  key: string;
  background: string | null;
  accent: string | null;
}

export const forkSidebarStyleAtom = atom<ForkSidebarStyleReport | null>(null);

const MAX_CSS_VALUE_LENGTH = 2000;
const NO_THREAD_LISTS: PluginSlotSnapshot["threadLists"] = [];

export function cleanSidebarCssValue(
  property: "background" | "color",
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_CSS_VALUE_LENGTH) return null;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports(property, trimmed) ? trimmed : null;
  }
  return trimmed;
}

export type ForkSidebarProps = {
  style?: CSSProperties;
  "data-fork-sidebar-background"?: "";
  "data-fork-sidebar-accent"?: "";
};

export function forkSidebarProps(
  report: ForkSidebarStyleReport | null,
): ForkSidebarProps {
  if (report === null) return {};
  const { background, accent } = report;
  if (background === null && accent === null) return {};
  return {
    style: {
      ...(background === null
        ? {}
        : { "--fork-sidebar-background": background }),
      ...(accent === null ? {} : { "--fork-sidebar-accent": accent }),
    } as CSSProperties,
    ...(background === null ? {} : { "data-fork-sidebar-background": "" }),
    ...(accent === null ? {} : { "data-fork-sidebar-accent": "" }),
  };
}

export function useForkSidebarStyle(): ForkSidebarProps {
  const report = useAtomValue(forkSidebarStyleAtom);
  return useMemo(() => forkSidebarProps(report), [report]);
}

const SidebarStyleProbe = memo(function SidebarStyleProbe({
  reportKey,
  useSidebarStyle,
}: {
  reportKey: string;
  useSidebarStyle: () => ExperimentalSidebarStyle | null;
}) {
  const style = useSidebarStyle();
  const background = cleanSidebarCssValue("background", style?.background);
  const accent = cleanSidebarCssValue("color", style?.accent);
  const setReport = useSetAtom(forkSidebarStyleAtom);
  useLayoutEffect(() => {
    setReport({ key: reportKey, background, accent });
  }, [setReport, reportKey, background, accent]);
  useLayoutEffect(
    () => () =>
      setReport((current) => (current?.key === reportKey ? null : current)),
    [setReport, reportKey],
  );
  return null;
});

export function ForkSidebarStyleHost() {
  const threadLists = usePluginSlots().threadLists ?? NO_THREAD_LISTS;
  const preference = useAtomValue(threadListProviderAtom);
  const resolved = usePreferredReplacement(threadLists, preference);
  if (resolved.kind !== "plugin" || isBareWindow()) return null;
  const registration = resolved.registration;
  const useSidebarStyle = registration.experimental_useSidebarStyle;
  if (useSidebarStyle === undefined) return null;
  const reportKey = `${registration.pluginId}/${registration.id}/${registration.generation}`;
  return (
    <PluginSlotMount
      key={reportKey}
      pluginId={registration.pluginId}
      slotKind="threadListSidebarStyle"
      slotId={registration.id}
      crashFallback={null}
      wrapRoot={false}
    >
      <SidebarStyleProbe
        reportKey={reportKey}
        useSidebarStyle={useSidebarStyle}
      />
    </PluginSlotMount>
  );
}

import {
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ExperimentalComposerReplace } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  usePluginSlots,
  type PluginComposerCustomizationSlot,
} from "@/lib/plugin-slots";

interface Replacement {
  key: string;
  pluginId: string;
  slotId: string;
  generation: number;
  replace: ExperimentalComposerReplace;
}

type ActiveReport = (key: string, threadId: string, active: boolean) => void;

export function composerReplacements(
  customizations: readonly PluginComposerCustomizationSlot[],
): Replacement[] {
  return customizations
    .filter(
      (customization) =>
        customization.experimental_replace !== undefined &&
        (customization.scopes === undefined ||
          customization.scopes.includes("thread")),
    )
    .map((customization) => ({
      key: `${customization.pluginId}/${customization.id}/${String(customization.generation)}`,
      pluginId: customization.pluginId,
      slotId: customization.id,
      generation: customization.generation,
      replace: customization.experimental_replace!,
    }))
    .sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) ||
        a.slotId.localeCompare(b.slotId),
    );
}

interface ActiveProbeProps {
  entryKey: string;
  threadId: string;
  onReport: ActiveReport;
}

const activeHosts = new WeakMap<
  ExperimentalComposerReplace,
  { Probe: ComponentType<ActiveProbeProps> }
>();

function activeHost(replace: ExperimentalComposerReplace) {
  const existing = activeHosts.get(replace);
  if (existing !== undefined) return existing;
  function ActiveHost(props: ActiveProbeProps) {
    const active = replace.useActive({ threadId: props.threadId });
    if (typeof active !== "boolean") {
      throw new Error("experimental_replace.useActive must return a boolean");
    }
    return <ActiveReporter {...props} active={active} />;
  }
  const host = { Probe: ActiveHost };
  activeHosts.set(replace, host);
  return host;
}

function ActiveProbe({
  entry,
  threadId,
  onReport,
}: {
  entry: Replacement;
  threadId: string;
  onReport: ActiveReport;
}) {
  const host = activeHost(entry.replace);
  return (
    <host.Probe entryKey={entry.key} threadId={threadId} onReport={onReport} />
  );
}

function ActiveReporter({
  entryKey,
  threadId,
  onReport,
  active,
}: ActiveProbeProps & { active: boolean }) {
  useLayoutEffect(() => {
    onReport(entryKey, threadId, active);
  }, [entryKey, threadId, active, onReport]);
  return null;
}

function ForkComposerReplace({
  threadId,
  composer,
}: {
  threadId: string;
  composer: ReactNode;
}) {
  const { composerCustomizations } = usePluginSlots();
  const entries = useMemo(
    () => composerReplacements(composerCustomizations),
    [composerCustomizations],
  );
  const [reports, setReports] = useState<
    ReadonlyMap<string, { threadId: string; active: boolean }>
  >(() => new Map());
  const [onReport] = useState<ActiveReport>(
    () => (key: string, reportThreadId: string, active: boolean) => {
      setReports((current) => {
        const previous = current.get(key);
        if (
          previous?.threadId === reportThreadId &&
          previous.active === active
        ) {
          return current;
        }
        const next = new Map(current);
        next.set(key, { threadId: reportThreadId, active });
        return next;
      });
    },
  );
  const winner = entries.find((entry) => {
    const report = reports.get(entry.key);
    return report?.threadId === threadId && report.active;
  });
  const Replacement = winner?.replace.component;
  return (
    <>
      {entries.map((entry) => (
        <PluginSlotMount
          key={`${entry.key}/${threadId}`}
          pluginId={entry.pluginId}
          slotKind="composerReplace/active"
          slotId={entry.slotId}
          instanceId={threadId}
          crashResetKey={String(entry.generation)}
          crashFallback={null}
          wrapRoot={false}
          onCrash={() => onReport(entry.key, threadId, false)}
        >
          <ActiveProbe entry={entry} threadId={threadId} onReport={onReport} />
        </PluginSlotMount>
      ))}
      {winner !== undefined && Replacement !== undefined ? (
        <div data-fork-composer-replace={`${winner.pluginId}/${winner.slotId}`}>
          <PluginSlotMount
            key={`${winner.key}/${threadId}`}
            pluginId={winner.pluginId}
            slotKind="composerReplace"
            slotId={winner.slotId}
            instanceId={threadId}
            crashResetKey={String(winner.generation)}
            crashFallback={composer}
          >
            <Replacement threadId={threadId} />
          </PluginSlotMount>
        </div>
      ) : (
        composer
      )}
    </>
  );
}

export function forkComposerArea(
  threadId: string,
  composer: ReactNode,
): ReactNode {
  if (composer === null) return null;
  return <ForkComposerReplace threadId={threadId} composer={composer} />;
}

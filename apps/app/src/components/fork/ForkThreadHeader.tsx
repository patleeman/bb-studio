import {
  memo,
  useCallback,
  type ComponentType,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ExperimentalThreadHeaderDecoration } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import type { PluginThreadHeaderSlot } from "@/lib/fork-slots";
import { usePluginSlots } from "@/lib/plugin-slots";
import { MACOS_WINDOW_NO_DRAG_CLASS } from "@/lib/bb-desktop";

interface ReportedDecoration {
  threadId: string;
  decoration: ExperimentalThreadHeaderDecoration;
}

type ReportDecoration = (
  key: string,
  threadId: string,
  decoration: ExperimentalThreadHeaderDecoration | null,
) => void;

function slotKey(slot: PluginThreadHeaderSlot): string {
  return `${slot.pluginId}/${slot.id}/${slot.generation}`;
}

interface DecorationProbeProps {
  threadId: string;
  report: ReportDecoration;
}

const decorationHosts = new WeakMap<
  PluginThreadHeaderSlot,
  { Probe: ComponentType<DecorationProbeProps> }
>();

function decorationHost(slot: PluginThreadHeaderSlot) {
  const existing = decorationHosts.get(slot);
  if (existing !== undefined) return existing;
  function DecorationHost({ threadId, report }: DecorationProbeProps) {
    const decoration = slot.useDecoration({ threadId });
    return (
      <DecorationReport
        slotKey={slotKey(slot)}
        threadId={threadId}
        report={report}
        decoration={decoration ?? null}
      />
    );
  }
  const host = { Probe: DecorationHost };
  decorationHosts.set(slot, host);
  return host;
}

const ForkThreadHeaderProbe = memo(function ForkThreadHeaderProbe({
  slot,
  threadId,
  report,
}: DecorationProbeProps & { slot: PluginThreadHeaderSlot }) {
  const host = decorationHost(slot);
  return <host.Probe threadId={threadId} report={report} />;
});

function DecorationReport({
  slotKey: key,
  threadId,
  report,
  decoration,
}: DecorationProbeProps & {
  slotKey: string;
  decoration: ExperimentalThreadHeaderDecoration | null;
}) {
  useLayoutEffect(() => {
    report(key, threadId, decoration);
  }, [report, key, threadId, decoration]);
  useLayoutEffect(
    () => () => report(key, threadId, null),
    [report, key, threadId],
  );
  return null;
}

export interface ForkThreadHeader {
  title: string;
  after: ReactNode;
  /** The decoration's right-end part, drawn first among the header's actions. */
  end: ReactNode;
}

export function useForkThreadHeader(
  threadId: string,
  title: string,
): ForkThreadHeader {
  const registered = usePluginSlots().threadHeaders;
  const slots = useMemo(
    () =>
      [...(registered ?? [])].sort(
        (a, b) =>
          a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
      ),
    [registered],
  );
  const [reports, setReports] = useState<
    ReadonlyMap<string, ReportedDecoration>
  >(() => new Map());
  const report = useCallback<ReportDecoration>(
    (key, reportedThreadId, decoration) => {
      setReports((previous) => {
        const current = previous.get(key);
        if (decoration === null) {
          if (current?.threadId !== reportedThreadId) return previous;
          const next = new Map(previous);
          next.delete(key);
          return next;
        }
        if (
          current?.threadId === reportedThreadId &&
          current.decoration === decoration
        ) {
          return previous;
        }
        const next = new Map(previous);
        next.set(key, { threadId: reportedThreadId, decoration });
        return next;
      });
    },
    [],
  );
  if (slots.length === 0) return { title, after: null, end: null };
  let winner: PluginThreadHeaderSlot | undefined;
  let decoration: ExperimentalThreadHeaderDecoration | null = null;
  for (const slot of slots) {
    const entry = reports.get(slotKey(slot));
    if (entry?.threadId === threadId) {
      winner = slot;
      decoration = entry.decoration;
      break;
    }
  }
  const decoratedTitle =
    typeof decoration?.title === "string" && decoration.title.trim() !== ""
      ? decoration.title
      : title;
  const afterNode = decoration?.after;
  const endNode = decoration?.end;
  return {
    title: decoratedTitle,
    // The header is the desktop window's drag strip: the plugin's parts carve themselves out, as bb's own buttons do.
    end:
      winner !== undefined && endNode != null && endNode !== false ? (
        <PluginSlotMount
          key={`${slotKey(winner)}/end`}
          pluginId={winner.pluginId}
          slotKind="threadHeaderEnd"
          slotId={winner.id}
          instanceId={threadId}
          crashFallback={null}
        >
          <span
            data-fork-thread-header-end={`${winner.pluginId}/${winner.id}`}
            className={`flex min-w-0 shrink-0 items-center gap-1 ${MACOS_WINDOW_NO_DRAG_CLASS}`}
          >
            {endNode}
          </span>
        </PluginSlotMount>
      ) : null,
    after: (
      <>
        {slots.map((slot) => (
          <PluginSlotMount
            key={slotKey(slot)}
            pluginId={slot.pluginId}
            slotKind="threadHeader"
            slotId={slot.id}
            instanceId={threadId}
            crashFallback={null}
            wrapRoot={false}
          >
            <ForkThreadHeaderProbe
              slot={slot}
              threadId={threadId}
              report={report}
            />
          </PluginSlotMount>
        ))}
        {winner !== undefined && afterNode != null && afterNode !== false ? (
          <PluginSlotMount
            key={`${slotKey(winner)}/after`}
            pluginId={winner.pluginId}
            slotKind="threadHeaderAfter"
            slotId={winner.id}
            instanceId={threadId}
            crashFallback={null}
          >
            <span
              data-fork-thread-header-after={`${winner.pluginId}/${winner.id}`}
              className={`flex min-w-0 shrink-0 items-center gap-1.5 ${MACOS_WINDOW_NO_DRAG_CLASS}`}
            >
              {afterNode}
            </span>
          </PluginSlotMount>
        ) : null}
      </>
    ),
  };
}

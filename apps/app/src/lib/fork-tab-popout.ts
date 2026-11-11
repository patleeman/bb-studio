import type {
  ExperimentalFileLocation,
  ExperimentalWorkbenchOpenSpec,
  JsonValue,
} from "@get-bb/plugin-sdk";
import {
  getEnvironmentFilePreviewSourceRef,
  type FilePreviewLineRange,
} from "@bb/client-core";
import { environmentQueryOptions } from "@/hooks/queries/environment-queries";
import { workbenchSplitsFor } from "@/components/secondary-panel/workbenchSplits.fork";
import { appQueryClient } from "./app-query-client";
import type { FixedPanelTab } from "./fixed-panel-tabs-state";
import { forkFixedPanelTabs } from "./fixed-panel-tabs";
import { openPopOutWindow, popOutKey } from "./fork-bare-window";
import type { WorkbenchSurface } from "./fork-workbench";
import { FORK_WINDOW_PATH_PREFIX } from "./fork-windows";
import { normalizeExperimentalFileOpenOptions } from "./live-file-navigation";
import { parsePersistedPluginPanelParams } from "./plugin-json-value";

export const TAB_WINDOW_OWNER = "_bb";
export const TAB_WINDOW_ID = "tab";

export const WINDOW_INSTANCE_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `w-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

export type TabWindowPane = 1 | 2;

export interface TabWindowRequest {
  threadId: string;
  spec: ExperimentalWorkbenchOpenSpec;
  pane: TabWindowPane;
  from: string;
  title: string;
}

function locationOf(
  lineRange: FilePreviewLineRange | null,
): ExperimentalFileLocation | null {
  return lineRange === null
    ? null
    : {
        kind: "range",
        startLine: lineRange.startLineNumber,
        endLine: lineRange.endLineNumber,
      };
}

export function canPopOutTab(tab: FixedPanelTab): boolean {
  switch (tab.kind) {
    case "plugin-panel":
      return tab.fileOpenerOwner === undefined;
    case "workspace-file-preview":
      return tab.environmentId !== null;
    case "host-file-preview":
      return tab.hostId !== null || tab.environmentId !== null;
    case "thread-storage-file-preview":
      return true;
    default:
      return false;
  }
}

function fileSpec(
  target: Extract<ExperimentalWorkbenchOpenSpec, { kind: "file" }>["target"],
  lineRange: FilePreviewLineRange | null,
): ExperimentalWorkbenchOpenSpec | null {
  const normalized = normalizeExperimentalFileOpenOptions({
    target,
    location: locationOf(lineRange),
  });
  return normalized === null
    ? null
    : {
        kind: "file",
        target: normalized.target,
        location: normalized.location,
      };
}

async function environmentHostId(
  environmentId: string,
): Promise<string | null> {
  try {
    const environment = await appQueryClient.fetchQuery(
      environmentQueryOptions(environmentId),
    );
    return environment.hostId ?? null;
  } catch {
    return null;
  }
}

export async function tabOpenSpec(
  tab: FixedPanelTab,
  threadId: string,
): Promise<ExperimentalWorkbenchOpenSpec | null> {
  if (!canPopOutTab(tab)) return null;
  switch (tab.kind) {
    case "plugin-panel": {
      const params = parsePersistedPluginPanelParams(tab.paramsJson);
      return {
        kind: "tab",
        tab: { id: tab.actionId, pluginId: tab.pluginId },
        ...(params === null ? {} : { params }),
        title: tab.title,
      };
    }
    case "workspace-file-preview": {
      if (tab.environmentId === null) return null;
      const ref = getEnvironmentFilePreviewSourceRef(tab.source);
      return fileSpec(
        {
          kind: "workspace",
          environmentId: tab.environmentId,
          path: tab.path,
          ...(ref === null ? {} : { experimental_ref: ref }),
        },
        tab.lineRange,
      );
    }
    case "host-file-preview": {
      const hostId =
        tab.hostId ??
        (tab.environmentId === null
          ? null
          : await environmentHostId(tab.environmentId));
      return hostId === null
        ? null
        : fileSpec({ kind: "host", hostId, path: tab.path }, tab.lineRange);
    }
    case "thread-storage-file-preview":
      return fileSpec(
        {
          kind: "thread-storage",
          threadId: tab.threadId ?? threadId,
          path: tab.path,
        },
        tab.lineRange,
      );
    default:
      return null;
  }
}

export function tabWindowPath(request: TabWindowRequest): string {
  const query = new URLSearchParams({
    thread: request.threadId,
    spec: JSON.stringify(request.spec),
    pane: String(request.pane),
    from: request.from,
    title: request.title,
  });
  return `${FORK_WINDOW_PATH_PREFIX}${TAB_WINDOW_OWNER}/${TAB_WINDOW_ID}?${query.toString()}`;
}

function isJsonValue(value: unknown): value is JsonValue {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

export function parseTabSpec(
  raw: unknown,
): ExperimentalWorkbenchOpenSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const spec = raw as Record<string, unknown>;
  if (spec.kind === "tab") {
    const tab = spec.tab as Record<string, unknown> | null | undefined;
    if (
      typeof tab !== "object" ||
      tab === null ||
      typeof tab.id !== "string" ||
      tab.id === "" ||
      typeof tab.pluginId !== "string" ||
      tab.pluginId === "" ||
      (spec.title !== undefined && typeof spec.title !== "string") ||
      (spec.params !== undefined && !isJsonValue(spec.params))
    ) {
      return null;
    }
    return {
      kind: "tab",
      tab: { id: tab.id, pluginId: tab.pluginId },
      ...(spec.params === undefined ? {} : { params: spec.params }),
      ...(spec.title === undefined ? {} : { title: spec.title }),
    };
  }
  if (spec.kind === "file") {
    const normalized = normalizeExperimentalFileOpenOptions({
      target: spec.target as never,
      location: (spec.location ?? null) as never,
    });
    return normalized === null
      ? null
      : {
          kind: "file",
          target: normalized.target,
          location: normalized.location,
        };
  }
  return null;
}

export function parseTabWindowSearch(
  search: URLSearchParams,
): TabWindowRequest | null {
  const threadId = search.get("thread");
  const pane = search.get("pane");
  const from = search.get("from");
  const rawSpec = search.get("spec");
  if (!threadId || !from || rawSpec === null) return null;
  if (pane !== "1" && pane !== "2") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSpec);
  } catch {
    return null;
  }
  const spec = parseTabSpec(parsed);
  if (spec === null) return null;
  return {
    threadId,
    spec,
    pane: pane === "2" ? 2 : 1,
    from,
    title: search.get("title") ?? "",
  };
}

function paneOf(threadId: string, key: string): TabWindowPane {
  const panes = workbenchSplitsFor(threadId)?.panes() ?? [];
  return panes.findIndex((pane) => pane.tabIds.includes(key)) === 1 ? 2 : 1;
}

function ownTab(
  surface: WorkbenchSurface,
  key: string,
): FixedPanelTab | undefined {
  const atom = forkFixedPanelTabs.owned(surface.threadId);
  return surface.store.get(atom).secondary.tabs.find((tab) => tab.id === key);
}

export async function popOutWorkbenchTab(
  surface: WorkbenchSurface,
  key: string,
): Promise<boolean> {
  const listed = surface.panel.getTabs().tabs.find((tab) => tab.key === key);
  const tab = ownTab(surface, key);
  if (listed === undefined || !listed.closable || tab === undefined) {
    return false;
  }
  const spec = await tabOpenSpec(tab, surface.threadId);
  if (spec === null) return false;
  const request: TabWindowRequest = {
    threadId: surface.threadId,
    spec,
    pane: paneOf(surface.threadId, key),
    from: WINDOW_INSTANCE_ID,
    title: listed.title,
  };
  const opened = await openPopOutWindow(
    tabWindowPath(request),
    { title: listed.title },
    popOutKey(`${surface.threadId}:${JSON.stringify(spec)}`),
  );
  if (!opened) return false;
  surface.panel.closeTab(key);
  return true;
}

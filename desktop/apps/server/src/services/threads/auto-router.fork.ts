import {
  permissionModeRank,
  type AvailableModel,
  type PermissionMode,
  type PromptInput,
  type ProviderInfo,
  type Thread,
} from "@bb/domain";
import { getProjectExecutionDefaults, type DbConnection } from "@bb/db";
import type {
  SystemExecutionOptionsQuery,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import {
  EXPERIMENTAL_AUTO_PROVIDER_ID,
  type ExperimentalAutoRouteTarget,
  type ExperimentalAutoRouter,
} from "@get-bb/plugin-sdk";
import type { ThreadCreateServiceRequestInput } from "./thread-create-request.js";

/**
 * Auto: a picker entry that a plugin's router resolves to a real provider and
 * model when a thread is created. A thread never runs as Auto; its provider is
 * the real one from creation on, like any other thread's.
 */

export const AUTO_PROVIDER_ID = EXPERIMENTAL_AUTO_PROVIDER_ID;
export const AUTO_MODEL_ID = "auto";
export const AUTO_ROUTE_TIMEOUT_MS = 8_000;

interface RegisteredRouter {
  pluginId: string;
  router: ExperimentalAutoRouter;
}

let registered: RegisteredRouter | null = null;

export function registerAutoRouter(
  pluginId: string,
  router: ExperimentalAutoRouter,
): () => void {
  const entry = { pluginId, router };
  registered = entry;
  return () => {
    if (registered === entry) registered = null;
  };
}

function safely<T>(read: (() => T) | undefined, fallback: T): T {
  if (read === undefined) return fallback;
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** The router while Auto is offered, else null. */
export function activeAutoRouter(): RegisteredRouter | null {
  if (registered === null) return null;
  return safely(registered.router.enabled, true) ? registered : null;
}

function autoLabel(router: ExperimentalAutoRouter): string {
  const label = typeof router.label === "string" ? router.label.trim() : "";
  return label === "" ? "Auto" : label.slice(0, 40);
}

export function autoProviderInfo(
  entry: RegisteredRouter,
  base: ProviderInfo,
): ProviderInfo {
  return {
    id: AUTO_PROVIDER_ID,
    pluginId: entry.pluginId,
    displayName: autoLabel(entry.router),
    logoUrl: null,
    maintenance: { health: false, usage: false, installation: false },
    capabilities: { ...base.capabilities, supportsServiceTier: false },
    composerActions: [],
    completedTurnDisplay: base.completedTurnDisplay,
    available: true,
    reasoningLevels: [],
  };
}

export function autoModel(entry: RegisteredRouter): AvailableModel {
  return {
    id: AUTO_MODEL_ID,
    model: AUTO_MODEL_ID,
    displayName: autoLabel(entry.router),
    description: "Picks a model for each new conversation",
    reasoningDiscovery: "known",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: true,
  };
}

/**
 * The picker's execution options with Auto among the providers, and Auto's
 * one model when Auto is the provider asked about. Without an active router
 * the options are bb's own, unchanged.
 */
export async function withAutoExecutionOptions(
  query: SystemExecutionOptionsQuery,
  resolve: (
    query: SystemExecutionOptionsQuery,
  ) => Promise<SystemExecutionOptionsResponse>,
): Promise<SystemExecutionOptionsResponse> {
  const entry = activeAutoRouter();
  if (entry === null) return resolve(query);
  if (query.providerId !== AUTO_PROVIDER_ID) {
    const options = await resolve(query);
    return {
      ...options,
      providers: withAutoProvider(entry, options.providers),
    };
  }
  const { providerId: _auto, selectedModel: _model, ...rest } = query;
  const options = await resolve(rest);
  return {
    ...options,
    providers: withAutoProvider(entry, options.providers),
    models: [autoModel(entry)],
    selectedOnlyModels: [],
    modelLoadError: null,
  };
}

function withAutoProvider(
  entry: RegisteredRouter,
  providers: readonly ProviderInfo[],
): ProviderInfo[] {
  const real = providers.filter((each) => each.id !== AUTO_PROVIDER_ID);
  const base = real.find((each) => each.available) ?? real[0];
  if (base === undefined) return real;
  const auto = autoProviderInfo(entry, base);
  return safely(entry.router.isDefault, false)
    ? [auto, ...real]
    : [...real, auto];
}

function promptText(input: readonly PromptInput[]): string {
  return input
    .flatMap((block) =>
      block.type === "text" && block.visibility !== "agent-only"
        ? [block.text]
        : [],
    )
    .join("\n")
    .trim();
}

type AutoFields = Pick<
  ThreadCreateServiceRequestInput,
  | "executionInputSources"
  | "model"
  | "permissionMode"
  | "providerId"
  | "reasoningLevel"
  | "serviceTier"
  | "sessionOptions"
>;

/**
 * Whether a create goes through Auto: it asks for Auto; or it names no
 * provider and no model and either the router makes Auto the default for
 * such threads (workers included) or, for a thread with no parent, Auto is
 * the project's saved default. A fork keeps its source's provider.
 */
function wantsAuto(
  request: ThreadCreateServiceRequestInput,
  parentThread: Pick<Thread, "id"> | null,
  deps: AutoCreateDeps | null,
): boolean {
  if (request.providerId === AUTO_PROVIDER_ID) return true;
  if (request.providerId !== undefined || request.model !== undefined) {
    return false;
  }
  if (request.originKind) return false;
  const entry = activeAutoRouter();
  if (entry === null) return false;
  if (safely(entry.router.isDefault, false)) return true;
  if (parentThread !== null || deps === null) return false;
  return (
    getProjectExecutionDefaults(deps.db, { projectId: request.projectId })
      ?.providerId === AUTO_PROVIDER_ID
  );
}

function validTarget(value: unknown): ExperimentalAutoRouteTarget | null {
  if (value === null || typeof value !== "object") return null;
  const target = value as Partial<ExperimentalAutoRouteTarget>;
  if (
    typeof target.providerId !== "string" ||
    target.providerId === "" ||
    target.providerId === AUTO_PROVIDER_ID ||
    typeof target.model !== "string" ||
    target.model === "" ||
    target.model === AUTO_MODEL_ID
  ) {
    return null;
  }
  return target as ExperimentalAutoRouteTarget;
}

async function askRouter(
  entry: RegisteredRouter,
  request: ThreadCreateServiceRequestInput,
  parentThread: Pick<Thread, "id"> | null,
  timeoutMs: number,
): Promise<ExperimentalAutoRouteTarget | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const answer = Promise.resolve()
      .then(() =>
        entry.router.resolve({
          projectId: request.projectId,
          text: promptText(request.input),
          parentThreadId: parentThread?.id ?? null,
          originPluginId: request.originPluginId ?? null,
          permissionMode: request.permissionMode ?? null,
          signal: controller.signal,
        }),
      )
      .catch(() => null);
    return validTarget(await Promise.race([answer, late]));
  } finally {
    clearTimeout(timer);
  }
}

function withoutAutoSources(
  sources: ThreadCreateServiceRequestInput["executionInputSources"],
): ThreadCreateServiceRequestInput["executionInputSources"] {
  if (sources === undefined) return undefined;
  const {
    providerId: _provider,
    model: _model,
    reasoningLevel: _reasoning,
    serviceTier: _tier,
    ...rest
  } = sources;
  return rest;
}

/** What Auto needs to know about the provider it lands on. */
export interface AutoProviderCapabilities {
  getSupportedPermissionModes(
    providerId: string,
  ): readonly PermissionMode[] | null | undefined;
}

export interface AutoCreateDeps {
  db: DbConnection;
  providerRegistry: AutoProviderCapabilities;
}

/**
 * Marks a create that went through Auto. A symbol: it travels with the
 * request objects (spread and rest keep it) but never into JSON or the
 * database.
 */
export const AUTO_ROUTED = Symbol("bb.autoRouted");

/**
 * What the create remembers as the project's default: Auto itself for a
 * create that went through Auto, so the next new thread starts on Auto again
 * rather than on the model Auto picked this time.
 */
export function autoRememberArgs<
  T extends {
    execution: { model: string };
    request: { providerId: string };
  },
>(args: T): T {
  if (!(args.request as { [AUTO_ROUTED]?: true })[AUTO_ROUTED]) return args;
  return {
    ...args,
    execution: { ...args.execution, model: AUTO_MODEL_ID },
    request: { ...args.request, providerId: AUTO_PROVIDER_ID },
  };
}

/**
 * The permission mode the routed provider runs with: the one asked for when
 * it supports it, else the most permissive mode it supports that is not above
 * it (Auto never widens access). Undefined leaves the request as it was.
 */
export function autoPermissionMode(
  requested: PermissionMode | undefined,
  supported: readonly PermissionMode[] | null | undefined,
): PermissionMode | undefined {
  if (requested === undefined || !supported || supported.length === 0) {
    return undefined;
  }
  if (supported.includes(requested)) return undefined;
  const below = supported
    .filter((mode) => permissionModeRank(mode) <= permissionModeRank(requested))
    .sort((a, b) => permissionModeRank(b) - permissionModeRank(a));
  return below[0];
}

/**
 * The execution fields a create with Auto runs with: the router's target, or
 * bb's usual defaults (no provider, no model) when there is no router or it
 * gives no usable answer in time. Null leaves a create that is not Auto as it
 * is.
 */
export async function resolveAutoForCreate(
  request: ThreadCreateServiceRequestInput,
  parentThread: Pick<Thread, "id"> | null,
  deps: AutoCreateDeps | null = null,
  timeoutMs = AUTO_ROUTE_TIMEOUT_MS,
): Promise<(Partial<AutoFields> & { [AUTO_ROUTED]: true }) | null> {
  if (!wantsAuto(request, parentThread, deps)) return null;
  const entry = activeAutoRouter();
  const target =
    entry === null
      ? null
      : await askRouter(entry, request, parentThread, timeoutMs);
  const sources = withoutAutoSources(request.executionInputSources);
  if (target === null) {
    return {
      [AUTO_ROUTED]: true,
      providerId: undefined,
      model: undefined,
      reasoningLevel: undefined,
      serviceTier: undefined,
      sessionOptions: undefined,
      executionInputSources: sources,
    };
  }
  const reasoning = target.reasoningLevel ?? undefined;
  const tier = target.serviceTier ?? undefined;
  const permission = autoPermissionMode(
    request.permissionMode,
    deps?.providerRegistry.getSupportedPermissionModes(target.providerId),
  );
  return {
    [AUTO_ROUTED]: true,
    providerId: target.providerId,
    model: target.model,
    reasoningLevel: reasoning,
    serviceTier: tier,
    sessionOptions: undefined,
    ...(permission === undefined ? {} : { permissionMode: permission }),
    executionInputSources:
      sources === undefined
        ? undefined
        : {
            ...sources,
            providerId: "explicit",
            model: "explicit",
            ...(reasoning === undefined ? {} : { reasoningLevel: "explicit" }),
            ...(tier === undefined ? {} : { serviceTier: "explicit" }),
          },
  };
}

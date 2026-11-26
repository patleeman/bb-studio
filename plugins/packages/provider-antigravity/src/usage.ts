import {
  type ProviderUsage,
  type ProviderUsageResult,
  type ProviderUsageWindow,
  experimental_clampPercent as clampPercent,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { readAntigravityCredentials } from "./auth.js";

const DEFAULT_CLOUD_CODE_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const USAGE_FETCH_TIMEOUT_MS = 15_000;

const tierSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .passthrough();

const loadCodeAssistSchema = z
  .object({
    currentTier: tierSchema.nullish(),
    paidTier: tierSchema.nullish(),
    cloudaicompanionProject: z.string().min(1).nullish(),
  })
  .passthrough();

const quotaBucketSchema = z
  .object({
    bucketId: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    window: z.string().min(1).optional(),
    remainingFraction: z.number().min(0).max(1).optional(),
    resetTime: z.string().min(1).nullish(),
  })
  .passthrough();

const quotaGroupSchema = z
  .object({
    displayName: z.string().min(1).optional(),
    description: z.string().optional(),
    buckets: z.array(quotaBucketSchema).default([]),
  })
  .passthrough();

const quotaSummarySchema = z
  .object({
    groups: z.array(quotaGroupSchema).default([]),
  })
  .passthrough();

const availableModelSchema = z
  .object({
    displayName: z.string().optional(),
    quotaInfo: z
      .object({
        remainingFraction: z.number().min(0).max(1).optional(),
        resetTime: z.string().min(1).nullish(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const fetchAvailableModelsSchema = z
  .object({
    models: z.record(z.string(), availableModelSchema).default({}),
  })
  .passthrough();

function endpointBase(): string {
  const configured = process.env.CLOUD_CODE_ENDPOINT?.trim();
  return configured && configured.length > 0
    ? configured.replace(/\/+$/u, "")
    : DEFAULT_CLOUD_CODE_ENDPOINT;
}

function windowKindForBucket(
  windowName: string | undefined,
  bucketId: string | undefined,
): "five-hour" | "daily" | "weekly" | "custom" {
  const raw = `${windowName ?? ""} ${bucketId ?? ""}`.toLowerCase();
  if (raw.includes("5h") || raw.includes("five")) return "five-hour";
  if (raw.includes("week")) return "weekly";
  if (raw.includes("day") || raw.includes("daily")) return "daily";
  return "custom";
}

function windowSuffix(kind: "five-hour" | "daily" | "weekly" | "custom"): string {
  switch (kind) {
    case "five-hour":
      return "5-hour";
    case "weekly":
      return "Weekly";
    case "daily":
      return "Daily";
    case "custom":
      return "Quota";
  }
}

function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeAntigravityUsage(args: {
  loadCodeAssist: unknown;
  quotaSummary: unknown;
  availableModels: unknown;
  accountEmail: string | null;
}): ProviderUsage {
  const lca = loadCodeAssistSchema.safeParse(args.loadCodeAssist);
  const tier = lca.success
    ? (lca.data.paidTier ?? lca.data.currentTier ?? null)
    : null;
  const planLabel = tier?.name ?? null;

  const summary = quotaSummarySchema.safeParse(args.quotaSummary);
  const modelsParsed = fetchAvailableModelsSchema.safeParse(
    args.availableModels,
  );
  const models = modelsParsed.success ? modelsParsed.data.models : {};

  // Build reset-time hints per model family from fetchAvailableModels.
  let thirdPartyResetTime: string | null = null;
  const geminiBuckets = new Map<
    string,
    { remainingFraction: number; resetTime: string | null; hasPro: boolean; hasFlash: boolean }
  >();

  for (const [modelId, model] of Object.entries(models)) {
    const quota = model.quotaInfo;
    if (quota?.remainingFraction === undefined) continue;
    const lowerId = modelId.toLowerCase();
    const resetTime = normalizeIsoTimestamp(quota.resetTime);

    if (
      lowerId.startsWith("claude-") ||
      lowerId.startsWith("gpt-")
    ) {
      if (thirdPartyResetTime === null && resetTime !== null) {
        thirdPartyResetTime = resetTime;
      }
      continue;
    }

    if (lowerId.startsWith("gemini-")) {
      const key = `${quota.remainingFraction.toFixed(4)}|${resetTime ?? ""}`;
      const existing = geminiBuckets.get(key) ?? {
        remainingFraction: quota.remainingFraction,
        resetTime,
        hasPro: false,
        hasFlash: false,
      };
      if (lowerId.includes("flash")) {
        existing.hasFlash = true;
      } else {
        existing.hasPro = true;
      }
      geminiBuckets.set(key, existing);
    }
  }

  const windows: ProviderUsageWindow[] = [];
  let hasGeminiSummaryWindow = false;

  if (summary.success) {
    for (const group of summary.data.groups) {
      const groupName = group.displayName ?? "Antigravity";
      if (groupName.toLowerCase().includes("gemini")) {
        hasGeminiSummaryWindow = true;
      }
      for (const bucket of group.buckets) {
        if (bucket.remainingFraction === undefined) continue;
        if (bucket.bucketId?.toLowerCase().includes("gemini")) {
          hasGeminiSummaryWindow = true;
        }
        const kind = windowKindForBucket(bucket.window, bucket.bucketId);
        const isThirdParty =
          bucket.bucketId?.toLowerCase().startsWith("3p") ||
          groupName.toLowerCase().includes("claude");
        const resetsAt =
          normalizeIsoTimestamp(bucket.resetTime) ??
          (isThirdParty && kind === "five-hour" ? thirdPartyResetTime : null);
        windows.push({
          kind,
          label: `${groupName} (${windowSuffix(kind)})`,
          usedPercent: clampPercent((1 - bucket.remainingFraction) * 100),
          resetsAt,
        });
      }
    }
  }

  // Include Gemini quota windows from fetchAvailableModels if not in summary.
  if (!hasGeminiSummaryWindow && geminiBuckets.size > 0) {
    const entries = [...geminiBuckets.values()];
    for (const entry of entries) {
      const label =
        entries.length === 1
          ? "Gemini models"
          : entry.hasFlash && !entry.hasPro
            ? "Gemini Flash"
            : entry.hasPro && !entry.hasFlash
              ? "Gemini Pro"
              : "Gemini models";
      windows.push({
        kind: "custom",
        label,
        usedPercent: clampPercent((1 - entry.remainingFraction) * 100),
        resetsAt: entry.resetTime,
      });
    }
  }

  return {
    status: "ok",
    accountEmail: args.accountEmail,
    planLabel,
    ...(tier?.id ? { plan: { id: tier.id, multiplier: null } } : {}),
    windows,
  };
}

async function postCloudCode(
  endpoint: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${endpointBase()}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "antigravity-bb-plugin/0.1.0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS),
  });
}

export async function readAntigravityUsage(): Promise<ProviderUsageResult> {
  const credentials = await readAntigravityCredentials();
  if (credentials === null) {
    return { supported: true, usage: { status: "unauthenticated" } };
  }

  try {
    const lcaResponse = await postCloudCode(
      "v1internal:loadCodeAssist",
      credentials.accessToken,
      {
        metadata: {
          ideType: "ANTIGRAVITY",
          platform: "PLATFORM_UNSPECIFIED",
          pluginType: "GEMINI",
        },
      },
    );

    if (lcaResponse.status === 401) {
      return {
        supported: true,
        usage: {
          status: "expired",
          accountEmail: credentials.email,
          planLabel: null,
        },
      };
    }

    const lcaBody = lcaResponse.ok
      ? await lcaResponse.json().catch(() => ({}))
      : {};
    const parsedLca = loadCodeAssistSchema.safeParse(lcaBody);
    const project = parsedLca.success
      ? (parsedLca.data.cloudaicompanionProject ?? undefined)
      : undefined;
    const projectBody = project ? { project } : {};

    const [summaryResponse, modelsResponse] = await Promise.all([
      postCloudCode(
        "v1internal:retrieveUserQuotaSummary",
        credentials.accessToken,
        projectBody,
      ),
      postCloudCode(
        "v1internal:fetchAvailableModels",
        credentials.accessToken,
        projectBody,
      ),
    ]);

    if (summaryResponse.status === 401 || modelsResponse.status === 401) {
      return {
        supported: true,
        usage: {
          status: "expired",
          accountEmail: credentials.email,
          planLabel: null,
        },
      };
    }

    if (!summaryResponse.ok && !modelsResponse.ok) {
      return {
        supported: true,
        usage: {
          status: "error",
          accountEmail: credentials.email,
          planLabel: null,
          message: `Antigravity quota request failed (HTTP ${summaryResponse.status}).`,
        },
      };
    }

    const [summaryBody, modelsBody] = await Promise.all([
      summaryResponse.ok ? summaryResponse.json().catch(() => ({})) : {},
      modelsResponse.ok ? modelsResponse.json().catch(() => ({})) : {},
    ]);

    return {
      supported: true,
      usage: normalizeAntigravityUsage({
        loadCodeAssist: lcaBody,
        quotaSummary: summaryBody,
        availableModels: modelsBody,
        accountEmail: credentials.email,
      }),
    };
  } catch (error) {
    return {
      supported: true,
      usage: {
        status: "error",
        accountEmail: credentials.email,
        planLabel: null,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

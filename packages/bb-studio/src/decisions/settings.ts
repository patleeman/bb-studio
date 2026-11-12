// Studio Decisions' settings. Its API keys are BB secret fields (keys stay in
// BB's 0600 secret files); every other Decisions setting is a Studio setting
// (src/settings/schema.ts, keys `decisions_*`). The TypeSafe model, the Jev
// timeout and the steer threshold are constants, which a BB host can still
// override with an environment variable.
import type { PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { STUDIO_SETTINGS } from "../settings/schema";

export const DECISIONS_KEY_SETTINGS = {
  decisions_typesafeApiKey: {
    type: "string",
    label: "TypeSafe API key",
    secret: true,
    description: "Tried first. Create a key at https://console.typesafe.ai/keys. Falls back to TYPESAFE_API_KEY on the BB host.",
  },
  decisions_vercelApiKey: {
    type: "string",
    label: "Vercel AI Gateway API key",
    secret: true,
    description: "Jev through Vercel AI Gateway. Falls back to AI_GATEWAY_API_KEY.",
  },
  decisions_openRouterApiKey: {
    type: "string",
    label: "OpenRouter API key",
    secret: true,
    description: "Jev through OpenRouter. Falls back to OPENROUTER_API_KEY.",
  },
  decisions_zenApiKey: {
    type: "string",
    label: "OpenCode Zen API key",
    secret: true,
    description: "Jev through OpenCode Zen, the last fallback. Falls back to OPENCODE_API_KEY.",
  },
  decisions_customJevApiKey: {
    type: "string",
    label: "Your own Jev endpoint: key",
    secret: true,
    description: "Sent as a bearer token to the endpoint set in Jev ▸ Your own Jev endpoint. Leave empty if it needs none.",
  },
} as const satisfies Record<string, PluginSettingDescriptor>;

const number = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const value = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

/** The settings that became constants, with the host's overrides. */
export function decisionsConstants(env: NodeJS.ProcessEnv = process.env) {
  return {
    typesafeModel: env.STUDIO_TYPESAFE_MODEL?.trim() || "jev-latest",
    jevTimeoutMs: Math.round(number(env.STUDIO_JEV_TIMEOUT_MS, 5000, 250, 15_000)),
    steerConfidence: number(env.STUDIO_JEV_STEER_CONFIDENCE, 0.5, 0, 1),
  };
}

/** Decisions' settings without the `decisions_` prefix: the constants, then the Studio settings' defaults. */
export const decisionsDefaults: Record<string, unknown> = {
  ...decisionsConstants(),
  ...Object.fromEntries(Object.entries(STUDIO_SETTINGS).filter(([key]) => key.startsWith("decisions_")).map(([key, setting]) => [key.slice("decisions_".length), setting.default])),
};

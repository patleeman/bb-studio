import type { PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { z } from "zod";
const jevProviderChoices = ["auto", "typesafe", "vercel", "openrouter", "opencode-zen", "custom"];
export const typesafeModels = ["jev-latest", "jev-preview", "jev-1.13.0"];
export const LEGACY_SETTINGS = {
    enabled: {
      type: "boolean",
      label: "Smart Queue",
      default: true,
      description:
        "Hold a message you send while a thread is working, then steer the current turn or queue it as a follow-up. Pauses while the standalone Smart Queue plugin is on.",
    },
    jevProvider: {
      type: "select",
      label: "Jev provider",
      options: [...jevProviderChoices],
      default: "auto",
      description:
        "Where Studio Decisions calls Jev, for Smart Queue and for other plugins. Auto tries TypeSafe, Vercel AI Gateway, OpenRouter, OpenCode Zen, then Custom, using each one that has a key, and moves on when one fails.",
    },
    typesafeApiKey: {
      type: "string",
      label: "TypeSafe API key",
      secret: true,
      description:
        "TypeSafe serves Jev directly. Create a key at https://console.typesafe.ai/keys. Falls back to the server's TYPESAFE_API_KEY environment variable.",
    },
    typesafeModel: {
      type: "select",
      label: "TypeSafe model",
      options: typesafeModels,
      default: "jev-latest",
      description: "jev-latest follows each stable release, jev-preview tries previews, and jev-1.13.0 pins that version.",
    },
    vercelApiKey: {
      type: "string",
      label: "Vercel AI Gateway API key",
      secret: true,
      description: "Calls Jev through Vercel AI Gateway. Falls back to AI_GATEWAY_API_KEY.",
    },
    openRouterApiKey: {
      type: "string",
      label: "OpenRouter API key",
      secret: true,
      description: "Calls Jev through OpenRouter. Falls back to OPENROUTER_API_KEY.",
    },
    zenApiKey: {
      type: "string",
      label: "OpenCode Zen API key",
      secret: true,
      description: "Calls Jev through OpenCode Zen. Falls back to OPENCODE_API_KEY.",
    },
    customJevEndpoint: {
      type: "string",
      label: "Custom Jev endpoint",
      description:
        "Bring your own provider: the full URL of any endpoint that speaks TypeSafe's System One API, such as https://gateway.example.com/v1/systemone. HTTPS is required except on localhost.",
    },
    customJevApiKey: {
      type: "string",
      label: "Custom Jev API key",
      secret: true,
      description: "Sent as a bearer token to the custom endpoint. Leave empty if it needs none.",
    },
    customJevApiKeyCommand: {
      type: "string",
      label: "Custom Jev key command",
      description:
        "For short-lived tokens: a shell command, run on the BB server, that prints the bearer token. The token is reused until its JWT expiry, or for five minutes. Use this instead of the API key.",
    },
    customJevHeaders: {
      type: "string",
      label: "Custom Jev headers",
      description: "Extra request headers as `name: value` pairs separated by semicolons, such as `source: bb; org-id: 2`.",
    },
    customJevModel: {
      type: "string",
      label: "Custom Jev model",
      description: "The model name the custom endpoint expects, such as jev-latest.",
    },
    jevTimeoutMs: {
      type: "number",
      label: "Jev timeout (milliseconds)",
      default: 5000,
      experimental_schema: z.number().int().min(250).max(15000),
      description: "Direct request deadline, from 250 to 15000 milliseconds.",
    },
    steerConfidence: {
      type: "number",
      label: "Smart Queue: minimum confidence to steer",
      default: 0.5,
      experimental_schema: z.number().min(0).max(1),
      description: "A value from 0 to 1. An uncertain steer becomes a follow-up. Other plugins apply their own thresholds.",
    },
    batchConfidence: {
      type: "number",
      label: "Smart Queue: minimum confidence to batch",
      default: 0.5,
      experimental_schema: z.number().min(0).max(1),
      description:
        "A value from 0 to 1. When a thread frees up, queued follow-ups Jev is this sure belong with the next one are sent with it as one turn. Set to 1 to send each on its own.",
    },
} satisfies Record<string, PluginSettingDescriptor>;

export const SECRET_KEYS = ["typesafeApiKey", "vercelApiKey", "openRouterApiKey", "zenApiKey", "customJevApiKey"] as const;

// Speech's part of Studio's settings. The OpenRouter key is named for Studio,
// not for speech, so other Studio features can share it later.
import type { SpeechConfig, SpeechEngineId } from "./engines";

export const SPEECH_ENGINES: readonly { id: SpeechEngineId; label: string }[] = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "custom", label: "Custom endpoint" },
];

export const DEFAULT_SPEECH_MODEL = "fish-audio/drama-3";

export const SPEECH_SETTINGS = {
  speechEngine: {
    type: "select" as const,
    label: "Speech: engine",
    description: "Where Studio turns text into speech: OpenRouter's hosted voices, or your own server with OpenAI's speech API.",
    options: SPEECH_ENGINES.map((engine) => engine.id as string),
    default: "openrouter",
  },
  speechModel: {
    type: "string" as const,
    label: "Speech: model",
    description: "The speech model, such as fish-audio/drama-3 or elevenlabs/eleven-v4 on OpenRouter. Pick one by ear in Studio → Setup → Speech.",
    default: DEFAULT_SPEECH_MODEL,
  },
  speechVoice: {
    type: "string" as const,
    label: "Speech: voice",
    description: "The model's voice. Leave empty for its default.",
    default: "",
  },
  speechInstructions: {
    type: "string" as const,
    label: "Speech: delivery",
    description: "How to speak, such as \"Warm and calm, a little brisk.\" Models that can't take directions ignore it.",
    default: "",
  },
  openRouterApiKey: {
    type: "string" as const,
    label: "OpenRouter API key",
    description: "Studio's OpenRouter key, used for speech. Falls back to OPENROUTER_API_KEY on the BB host.",
    secret: true as const,
    default: "",
  },
  speechEndpoint: {
    type: "string" as const,
    label: "Speech: custom endpoint",
    description: "For the custom engine: the base URL of a server with OpenAI's speech API, such as http://127.0.0.1:8000/v1 for a local mlx-audio server.",
    default: "",
  },
  speechEndpointApiKey: {
    type: "string" as const,
    label: "Speech: custom endpoint key",
    description: "Sent as a bearer token to the custom endpoint. Leave empty if it needs none.",
    secret: true as const,
    default: "",
  },
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Studio's setting values as a speech config, with the host's OPENROUTER_API_KEY as the key's fallback. */
export function speechConfig(values: Record<string, unknown>, env: Record<string, string | undefined> = process.env): SpeechConfig {
  return {
    engine: values.speechEngine === "custom" ? "custom" : "openrouter",
    model: text(values.speechModel).trim() || DEFAULT_SPEECH_MODEL,
    voice: text(values.speechVoice).trim(),
    instructions: text(values.speechInstructions).trim(),
    openRouterApiKey: text(values.openRouterApiKey).trim() || env.OPENROUTER_API_KEY?.trim() || "",
    endpoint: text(values.speechEndpoint).trim(),
    endpointApiKey: text(values.speechEndpointApiKey).trim(),
  };
}

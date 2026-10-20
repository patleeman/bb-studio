// A Bot's image avatar: one it generated (bot_avatar_generate) or the user
// uploaded (Edit profile). The drawn avatar (shape, color, emoji) stays the
// fallback: no image, or a client that can't load it, shows it.
//
// Images live in bot_avatar_images and are served at AVATAR_ROUTE, which the
// desktop and the iOS app load as they load drawing thumbnails and artifact
// images. A Bot keeps its last AVATAR_HISTORY images; the shown one and the
// one Revert goes back to are never pruned.
//
// Generation goes through a small provider interface. Keys come from Studio's
// secret settings (OpenAI's is the shared "OpenAI API key", src/openai-key.ts)
// or the BB server's environment (XAI_API_KEY, OPENAI_API_KEY); without one
// the tool says image generation isn't set up.
// Never log a key.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { OPENAI_KEY_SETTINGS, openaiKey } from "./openai-key";

/** How many images a Bot keeps. */
export const AVATAR_HISTORY = 5;
/** The largest image a Bot keeps (an upload or a provider's answer). */
export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
/** The HTTP route (under /api/v1/plugins/studio/http) that serves an avatar image. */
export const AVATAR_ROUTE = "/bots/avatar";

/** An avatar image's URL; the id changes with the image, so it caches forever. */
export function avatarImageUrl(botId: string, imageId: string): string {
  return `/api/v1/plugins/studio/http${AVATAR_ROUTE}?bot=${encodeURIComponent(botId)}&image=${encodeURIComponent(imageId)}`;
}

/** The image type from its first bytes; null for anything that isn't PNG, JPEG, WebP or GIF. */
export function imageMime(data: Uint8Array): string | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length > 12 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
  if (data.length > 6 && String.fromCharCode(...data.subarray(0, 4)) === "GIF8") return "image/gif";
  return null;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export type GeneratedImage = { data: Buffer; mime: string; model: string };

/** One image-generation service. */
export interface ImageProvider {
  id: string;
  label: string;
  generate(prompt: string, signal?: AbortSignal): Promise<GeneratedImage>;
}

/** No provider has a key: the tool's error says how to set one up. */
export class ImageNotSetUpError extends Error {
  constructor(detail: string) {
    super(`Image generation isn't set up: ${detail}`);
    this.name = "ImageNotSetUpError";
  }
}

type Fetch = typeof fetch;

/** An OpenAI-compatible /images/generations call that returns base64 (xAI and OpenAI both speak it). */
async function imagesGeneration(fetchImpl: Fetch, label: string, url: string, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text.slice(0, 300);
    try {
      const error = (JSON.parse(text) as { error?: { message?: string } | string }).error;
      message = (typeof error === "string" ? error : error?.message) ?? message;
    } catch { /* Plain text. */ }
    throw new Error(`${label} couldn't make the image (${response.status}): ${message}`);
  }
  const b64 = (JSON.parse(text) as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
  if (!b64) throw new Error(`${label} answered without an image.`);
  return Buffer.from(b64, "base64");
}

/** xAI (Grok) image generation. */
export function xaiImageProvider(key: string, options: { baseUrl?: string; model?: string; fetch?: Fetch } = {}): ImageProvider {
  const model = options.model ?? "grok-2-image";
  return {
    id: "xai", label: "xAI",
    async generate(prompt, signal) {
      const data = await imagesGeneration(options.fetch ?? fetch, "xAI", `${(options.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, "")}/images/generations`, key, { model, prompt, n: 1, response_format: "b64_json" }, signal);
      return { data, mime: imageMime(data) ?? "image/jpeg", model };
    },
  };
}

/** OpenAI gpt-image, at low quality: an avatar is small. */
export function openaiImageProvider(key: string, options: { baseUrl?: string; model?: string; fetch?: Fetch } = {}): ImageProvider {
  const model = options.model ?? "gpt-image-1";
  return {
    id: "openai", label: "OpenAI",
    async generate(prompt, signal) {
      const data = await imagesGeneration(options.fetch ?? fetch, "OpenAI", `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/images/generations`, key, { model, prompt, n: 1, size: "1024x1024", quality: "low" }, signal);
      return { data, mime: imageMime(data) ?? "image/png", model };
    },
  };
}

/** Where keys come from: Studio's secret settings first, then the BB server's environment. */
export type ImageKeys = { settings?: Record<string, unknown>; env?: NodeJS.ProcessEnv; fetch?: Fetch };
export const IMAGE_KEY_SETTINGS = { xai: "botAvatarXaiApiKey" } as const;

/** Studio's settings for the keys: secret, so they stay on the server. OpenAI's is Studio's shared key (src/openai-key.ts). */
export const BOT_AVATAR_SETTINGS = {
  ...OPENAI_KEY_SETTINGS,
  [IMAGE_KEY_SETTINGS.xai]: { type: "string", label: "Bot avatars: xAI API key", description: "Lets a Bot draw its own avatar with Grok's image model (about 7¢ an image). Falls back to XAI_API_KEY on the BB host.", secret: true, default: "" },
} as const;

/** The first provider with a key, OpenAI before xAI (cheaper per avatar); throws ImageNotSetUpError when none has one. */
export function pickImageProvider({ settings = {}, env = process.env, fetch: fetchImpl }: ImageKeys = {}): ImageProvider {
  const key = (setting: string, variable: string) => {
    const value = settings[setting];
    return (typeof value === "string" && value.trim()) || env[variable]?.trim() || "";
  };
  const openai = openaiKey(settings, env);
  if (openai) return openaiImageProvider(openai, { fetch: fetchImpl });
  const xai = key(IMAGE_KEY_SETTINGS.xai, "XAI_API_KEY");
  if (xai) return xaiImageProvider(xai, { fetch: fetchImpl });
  throw new ImageNotSetUpError("add an OpenAI API key or an xAI key (Bot avatars) in Studio's settings, or set OPENAI_API_KEY or XAI_API_KEY on the BB host. Until then, the user can upload an image or pick a drawn avatar in Edit profile.");
}

/** The prompt a provider gets: the Bot's idea, framed as a square avatar. */
export function avatarPrompt(name: string, prompt: string): string {
  return `A square profile avatar for an AI assistant named ${JSON.stringify(name)}. ${prompt.trim()} One centered subject, bold simple shapes that read at small sizes, a plain background, no text or letters.`;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type AvatarImageRow = { id: string; bot_id: string; mime: string; data: Buffer; source: "generated" | "upload"; prompt: string | null; provider: string | null; created_at: number };
export type AvatarImageMeta = Omit<AvatarImageRow, "data">;

export class AvatarImages {
  constructor(private readonly db: Database.Database) {}

  add(input: { botId: string; data: Buffer; mime: string; source: "generated" | "upload"; prompt?: string | null; provider?: string | null }): AvatarImageMeta {
    if (input.data.length > AVATAR_MAX_BYTES) throw new Error(`That image is ${Math.ceil(input.data.length / 1024)} KB; the most is ${AVATAR_MAX_BYTES / 1024 / 1024} MB.`);
    const id = `bai_${randomBytes(8).toString("hex")}`;
    // Strictly newer than the last, so history order holds within a millisecond.
    const last = (this.db.prepare("SELECT MAX(created_at) AS at FROM bot_avatar_images WHERE bot_id = ?").get(input.botId) as { at: number | null }).at ?? 0;
    const at = Math.max(Date.now(), last + 1);
    this.db.prepare("INSERT INTO bot_avatar_images (id, bot_id, mime, data, source, prompt, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.botId, input.mime, input.data, input.source, input.prompt ?? null, input.provider ?? null, at);
    return { id, bot_id: input.botId, mime: input.mime, source: input.source, prompt: input.prompt ?? null, provider: input.provider ?? null, created_at: at };
  }

  get(botId: string, id: string): AvatarImageRow | undefined {
    return this.db.prepare("SELECT * FROM bot_avatar_images WHERE bot_id = ? AND id = ?").get(botId, id) as AvatarImageRow | undefined;
  }

  /** Newest first, without the bytes. */
  list(botId: string): AvatarImageMeta[] {
    return this.db.prepare("SELECT id, bot_id, mime, source, prompt, provider, created_at FROM bot_avatar_images WHERE bot_id = ? ORDER BY created_at DESC").all(botId) as AvatarImageMeta[];
  }

  /** Keeps the newest AVATAR_HISTORY images and any in `keep` (the shown one and Revert's). */
  prune(botId: string, keep: readonly (string | null | undefined)[]): void {
    const kept = new Set(keep.filter((id): id is string => !!id));
    const drop = this.list(botId).slice(AVATAR_HISTORY).filter((image) => !kept.has(image.id));
    const remove = this.db.prepare("DELETE FROM bot_avatar_images WHERE id = ?");
    for (const image of drop) remove.run(image.id);
  }
}

// Studio's speech service. A client asks `prepare` for a piece of text and
// gets an audio URL back; fetching it makes the audio, streaming it to the
// client as it arrives and saving it to a cache, so the same text in the same
// voice is never paid for twice. The URL's key is a hash of everything that
// shapes the audio, so it can't be guessed into a request nobody prepared.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { defaultVoice, engineFor, type SpeechConfig, type SpeechEngine, type SpeechRequest } from "./engines";

/** Characters in one request. Clients cut longer text with speechChunks. */
export const MAX_SPEECH_CHARS = 4000;
const PREPARED_TTL_MS = 60 * 60_000;
const MAX_PREPARED = 2000;
const CACHE_BYTES = 200 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/opus": "opus", "audio/aac": "aac", "audio/flac": "flac" };
const MIME_TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac" };

export interface SpeechOverrides {
  model?: string;
  voice?: string;
  instructions?: string;
}

interface Prepared { engineIdentity: string; request: SpeechRequest; at: number }

export class SpeechService {
  private readonly prepared = new Map<string, Prepared>();
  private readonly making = new Map<string, Promise<void>>();

  constructor(
    private readonly options: {
      config(): SpeechConfig;
      cacheDir: string;
      engineFor?(config: SpeechConfig): SpeechEngine;
      warn(message: string): void;
    },
  ) {}

  private engine(config = this.options.config()): SpeechEngine {
    return (this.options.engineFor ?? engineFor)(config);
  }

  private engineIdentity(config: SpeechConfig): string {
    return JSON.stringify([config.engine, config.engine === "custom" ? config.endpoint.trim() : ""]);
  }

  /** Why speech can't run with the current settings, or null when it can. */
  problem(): string | null {
    try {
      this.engine();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** The configured engine's models; throws SpeechNotSetUpError when it isn't set up. */
  models(signal?: AbortSignal) {
    return this.engine().models(signal);
  }

  private request(text: string, overrides: SpeechOverrides, config: SpeechConfig): SpeechRequest {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Nothing to speak.");
    if (trimmed.length > MAX_SPEECH_CHARS) throw new Error(`Speak at most ${MAX_SPEECH_CHARS} characters at a time; cut longer text into pieces.`);
    const instructions = overrides.instructions ?? config.instructions;
    const model = overrides.model?.trim() || config.model;
    return {
      text: trimmed,
      model,
      // A model that would pick a voice per request gets a fixed one, so a reply keeps one voice.
      voice: (overrides.voice ?? config.voice) || defaultVoice(model),
      ...(instructions ? { instructions } : {}),
    };
  }

  /** Check the engine is set up and remember the request; returns the key its audio is fetched by. */
  prepare(text: string, overrides: SpeechOverrides = {}): string {
    const config = this.options.config();
    this.engine(config);
    const request = this.request(text, overrides, config);
    const key = createHash("sha256").update(JSON.stringify([config.engine, config.engine === "custom" ? config.endpoint : "", request.model, request.voice, request.instructions ?? "", request.text])).digest("hex").slice(0, 40);
    this.prepared.delete(key);
    this.prepared.set(key, { engineIdentity: this.engineIdentity(config), request, at: Date.now() });
    this.forgetOld();
    return key;
  }

  private forgetOld(): void {
    const cutoff = Date.now() - PREPARED_TTL_MS;
    for (const [key, entry] of this.prepared) {
      if (entry.at >= cutoff && this.prepared.size <= MAX_PREPARED) break;
      this.prepared.delete(key);
    }
  }

  private async cached(key: string): Promise<{ path: string; mimeType: string; size: number } | null> {
    const files = await readdir(this.options.cacheDir).catch(() => [] as string[]);
    const name = files.find((file) => file.startsWith(`${key}.`) && !file.endsWith(".part"));
    if (!name) return null;
    const path = join(this.options.cacheDir, name);
    const info = await stat(path).catch(() => null);
    if (!info) return null;
    const now = new Date();
    await utimes(path, now, now).catch(() => {});
    return { path, mimeType: MIME_TYPES[name.split(".").pop()!] ?? "audio/mpeg", size: info.size };
  }

  /** The audio for a prepared key: from the cache, or made now and streamed while it's saved. Null for an unknown key. */
  async audio(key: string): Promise<{ mimeType: string; body: ReadableStream<Uint8Array>; size?: number } | null> {
    const hit = await this.cached(key);
    if (hit) return { mimeType: hit.mimeType, size: hit.size, body: Readable.toWeb(createReadStream(hit.path)) as ReadableStream<Uint8Array> };
    const pending = this.making.get(key);
    if (pending) {
      await pending.catch(() => {});
      const made = await this.cached(key);
      if (made) return { mimeType: made.mimeType, size: made.size, body: Readable.toWeb(createReadStream(made.path)) as ReadableStream<Uint8Array> };
    }
    const entry = this.prepared.get(key);
    if (!entry) return null;
    const config = this.options.config();
    if (this.engineIdentity(config) !== entry.engineIdentity) throw new Error("The speech engine settings changed since this audio was asked for; ask again.");
    // The client's request can end early; the engine's audio is still saved for next time.
    const audio = await this.engine(config).synthesize(entry.request);
    const [toClient, toCache] = audio.body.tee();
    const saving = this.save(key, audio.mimeType, toCache);
    this.making.set(key, saving);
    void saving.catch((error) => this.options.warn(`Studio couldn't cache speech ${key}: ${String(error)}`)).finally(() => this.making.delete(key));
    return { mimeType: audio.mimeType, body: toClient };
  }

  /** Start making the audio for text now, into the cache, so a player that asks for it soon gets it sooner. Returns the key. */
  warm(text: string, overrides: SpeechOverrides = {}): string {
    const key = this.prepare(text, overrides);
    if (this.making.has(key)) return key;
    const entry = this.prepared.get(key)!;
    const making = (async () => {
      if (await this.cached(key)) return;
      const config = this.options.config();
      if (this.engineIdentity(config) !== entry.engineIdentity) throw new Error("The speech engine settings changed since this audio was asked for; ask again.");
      const audio = await this.engine(config).synthesize(entry.request);
      await this.save(key, audio.mimeType, audio.body);
    })();
    this.making.set(key, making);
    void making.catch((error) => this.options.warn(`Studio couldn't make speech ${key}: ${String(error)}`)).finally(() => this.making.delete(key));
    return key;
  }

  /** The whole audio for text, for the CLI and agent tools. */
  async speak(text: string, overrides: SpeechOverrides = {}): Promise<{ mimeType: string; bytes: Uint8Array }> {
    const key = this.prepare(text, overrides);
    const audio = await this.audio(key);
    if (!audio) throw new Error("Speech couldn't be prepared.");
    const bytes = new Uint8Array(await new Response(audio.body).arrayBuffer());
    // Let the cache finish writing before the caller reads it back.
    await this.making.get(key)?.catch(() => {});
    return { mimeType: audio.mimeType, bytes };
  }

  private async save(key: string, mimeType: string, body: ReadableStream<Uint8Array>): Promise<void> {
    await mkdir(this.options.cacheDir, { recursive: true });
    const path = join(this.options.cacheDir, `${key}.${EXTENSIONS[mimeType] ?? "mp3"}`);
    const part = `${path}.part`;
    try {
      await pipeline(Readable.fromWeb(body as NodeReadableStream<Uint8Array>), createWriteStream(part));
      if (path.endsWith(".wav")) await fixWavLength(part);
      await rename(part, path);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    await this.trim();
  }

  /** Keep the cache under its size by removing the least recently played audio. */
  private async trim(): Promise<void> {
    const names = await readdir(this.options.cacheDir).catch(() => [] as string[]);
    const files = (await Promise.all(names.filter((name) => !name.endsWith(".part")).map(async (name) => {
      const path = join(this.options.cacheDir, name);
      const info = await stat(path).catch(() => null);
      return info ? { path, size: info.size, used: info.mtimeMs } : null;
    }))).filter((file): file is { path: string; size: number; used: number } => file !== null).sort((a, b) => b.used - a.used);
    let total = 0;
    for (const file of files) {
      total += file.size;
      if (total > CACHE_BYTES) await rm(file.path, { force: true });
    }
  }
}

/** A streamed WAV's header says "open-ended"; once it's whole, write the real lengths so every player can seek it. */
async function fixWavLength(path: string): Promise<void> {
  const file = await open(path, "r+");
  try {
    const { size } = await file.stat();
    const head = Buffer.alloc(44);
    await file.read(head, 0, 44, 0);
    if (size < 44 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 36, 40) !== "data") return;
    const lengths = Buffer.alloc(4);
    lengths.writeUInt32LE(size - 8);
    await file.write(lengths, 0, 4, 4);
    lengths.writeUInt32LE(size - 44);
    await file.write(lengths, 0, 4, 40);
  } finally {
    await file.close();
  }
}

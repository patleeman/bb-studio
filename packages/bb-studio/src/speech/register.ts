// Speech, built into Studio: its RPCs, the audio route and `bb studio speech`.
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { pluginDataDirectory } from "../talk/server/audio-files";
import { parseCliArgs } from "../cli-args";
import { SpeechNotSetUpError, type SpeechModel } from "./engines";
import { SPEECH_ENGINES, speechConfig } from "./settings";
import { SpeechService } from "./service";
import { SPEECH_HTTP_PATH, SPEECH_HTTP_ROOT, speechContract, type SpeechState } from "./contract";
import type Database from "better-sqlite3";

export const SPEECH_USAGE = [
  "Usage:",
  "  bb studio speech status [--json]",
  "  bb studio speech models [--json]",
  "  bb studio speech say <text…> --out <file.mp3> [--model <id>] [--voice <name>] [--instructions <text>]",
].join("\n");

type CliResult = { exitCode: number; stdout?: string; stderr?: string };

export interface BuiltinSpeech {
  service: SpeechService;
  cli(argv: string[], ctx: { cwd?: string }): Promise<CliResult>;
}

interface SettingsAccess {
  values(): Record<string, unknown>;
  set(values: Record<string, unknown>): Promise<void>;
}

export function registerSpeech(bb: BbPluginApi, db: Database.Database, settings: SettingsAccess): BuiltinSpeech {
  const config = () => speechConfig(settings.values());
  const service = new SpeechService({
    config,
    cacheDir: join(pluginDataDirectory(db), "speech-cache"),
    warn: (message) => bb.log.warn(message),
  });

  function state(): SpeechState {
    const current = config();
    const problem = service.problem();
    return {
      engine: current.engine,
      engines: [...SPEECH_ENGINES],
      model: current.model,
      voice: current.voice,
      instructions: current.instructions,
      endpoint: current.endpoint,
      openRouterKey: Boolean(current.openRouterApiKey),
      problem,
    };
  }

  // A minute is enough to pick a model; the list changes rarely.
  let modelCache: { key: string; at: number; models: SpeechModel[] } | null = null;
  async function models(): Promise<SpeechModel[]> {
    const current = config();
    const key = `${current.engine}|${current.endpoint}`;
    if (modelCache?.key === key && Date.now() - modelCache.at < 60_000) return modelCache.models;
    const list = await service.models(AbortSignal.timeout(15_000));
    modelCache = { key, at: Date.now(), models: list };
    return list;
  }

  bb.rpc.register(speechContract, {
    "speech.state": () => state(),
    "speech.update": async (input) => {
      const values: Record<string, unknown> = {};
      if (input.engine !== undefined) values.speechEngine = input.engine;
      if (input.model !== undefined) values.speechModel = input.model;
      if (input.voice !== undefined) values.speechVoice = input.voice;
      if (input.instructions !== undefined) values.speechInstructions = input.instructions;
      if (input.endpoint !== undefined) values.speechEndpoint = input.endpoint;
      await settings.set(values);
      return state();
    },
    "speech.models": async () => ({ models: await models() }),
    "speech.prepare": ({ text, ...overrides }) => ({ url: `${SPEECH_HTTP_ROOT}?key=${service.prepare(text, overrides)}` }),
  });

  bb.http.route("GET", `/${SPEECH_HTTP_PATH}`, async (context) => {
    const key = context.req.query("key") ?? "";
    if (!/^[a-f0-9]{40}$/.test(key)) return context.text("Not found", 404);
    try {
      const audio = await service.audio(key);
      if (!audio) return context.text("This audio expired; ask for it again.", 404);
      return new Response(audio.body, {
        headers: {
          "content-type": audio.mimeType,
          ...(audio.size !== undefined ? { "content-length": String(audio.size) } : {}),
          "cache-control": "private, max-age=86400",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      bb.log.warn(`Studio couldn't speak ${key}: ${String(error)}`);
      return context.text(error instanceof Error ? error.message : String(error), error instanceof SpeechNotSetUpError ? 503 : 502);
    }
  });

  async function cli(argv: string[], ctx: { cwd?: string }): Promise<CliResult> {
    const [command, ...rest] = argv;
    const args = parseCliArgs(rest, { flags: ["--json"], options: ["--out", "--model", "--voice", "--instructions"] });
    if (!args.ok) return { exitCode: 2, stderr: `${args.error}\n${SPEECH_USAGE}` };
    const json = args.flags.has("--json");
    try {
      if (command === "status") {
        const current = state();
        if (json) return { exitCode: 0, stdout: JSON.stringify(current, null, 2) };
        const engine = SPEECH_ENGINES.find((each) => each.id === current.engine)!.label;
        return { exitCode: 0, stdout: [
          `Engine: ${engine}${current.engine === "custom" ? ` (${current.endpoint || "no endpoint"})` : ""}`,
          `Model: ${current.model}`,
          `Voice: ${current.voice || "(model default)"}`,
          ...(current.instructions ? [`Delivery: ${current.instructions}`] : []),
          current.problem ? `Not ready: ${current.problem}` : "Ready.",
        ].join("\n") };
      }
      if (command === "models") {
        const list = await models();
        if (json) return { exitCode: 0, stdout: JSON.stringify(list, null, 2) };
        if (!list.length) return { exitCode: 0, stdout: "The engine lists no models; set one by name in Studio's settings." };
        return { exitCode: 0, stdout: list.map((model) => {
          const price = model.pricePerMillionChars !== undefined ? `  $${model.pricePerMillionChars}/M chars` : "";
          const voices = model.voices?.length ? `  voices: ${model.voices.slice(0, 8).join(", ")}${model.voices.length > 8 ? ` +${model.voices.length - 8}` : ""}` : "";
          return `${model.id}${price}${voices}`;
        }).join("\n") };
      }
      if (command === "say") {
        const text = args.positional.join(" ").trim();
        const out = args.options.get("--out");
        if (!text || !out) return { exitCode: 2, stderr: SPEECH_USAGE };
        const started = Date.now();
        const audio = await service.speak(text, {
          model: args.options.get("--model"),
          voice: args.options.get("--voice"),
          instructions: args.options.get("--instructions"),
        });
        const path = isAbsolute(out) ? out : resolve(ctx.cwd ?? homedir(), out);
        await writeFile(path, audio.bytes);
        return { exitCode: 0, stdout: `Wrote ${path} (${audio.mimeType}, ${Math.round(audio.bytes.length / 1024)} KB) in ${((Date.now() - started) / 1000).toFixed(1)}s.` };
      }
      return { exitCode: 2, stderr: SPEECH_USAGE };
    } catch (error) {
      return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
    }
  }

  return { service, cli };
}

import { cliCommand, defineCli, defineRpcContract, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_PREFERENCES,
  isPreferenceKey,
  ORGANIZATION_MODE,
  parsePreference,
  PREFERENCE_DESCRIPTIONS,
  PREFERENCE_KEYS,
  PREFERENCES_CHANGED_CHANNEL,
  type PreferenceKey,
  type Preferences,
} from "./preferences.js";

const keySchema = z.enum(PREFERENCE_KEYS as [PreferenceKey, ...PreferenceKey[]]);

export const sidebarRpcContract = defineRpcContract({
  listPreferences: {
    input: z.null(),
    output: z.object({ preferences: z.record(z.string(), z.unknown()) }),
  },
  setPreference: {
    input: z.object({ key: keySchema, value: z.unknown() }).strict(),
    output: z.object({ key: keySchema, value: z.unknown() }).strict(),
  },
  resetPreference: {
    input: z.object({ key: keySchema }).strict(),
    output: z.object({ key: keySchema, value: z.unknown() }).strict(),
  },
});

export class PreferenceValidationError extends Error {}

export function createPreferenceStore(bb: Pick<BbPluginApi, "storage" | "realtime" | "log">) {
  const kvKey = (key: PreferenceKey) => `preference:${key}`;
  async function read<Key extends PreferenceKey>(key: Key): Promise<Preferences[Key]> {
    const stored = await bb.storage.kv.get<unknown>(kvKey(key));
    if (stored === undefined) return DEFAULT_PREFERENCES[key];
    const parsed = parsePreference(key, stored);
    if (parsed.success) return parsed.value;
    bb.log.warn(`stored preference ${key} is invalid (${parsed.message}); using the default`);
    return DEFAULT_PREFERENCES[key];
  }
  async function readAll(): Promise<Preferences & { organizationMode: string }> {
    const entries = await Promise.all(PREFERENCE_KEYS.map(async (key) => [key, await read(key)] as const));
    return { ...(Object.fromEntries(entries) as Preferences), organizationMode: ORGANIZATION_MODE };
  }
  async function write<Key extends PreferenceKey>(key: Key, value: unknown): Promise<Preferences[Key]> {
    const parsed = parsePreference(key, value);
    if (!parsed.success) throw new PreferenceValidationError(`Invalid value for ${key}: ${parsed.message}`);
    await bb.storage.kv.set(kvKey(key), parsed.value);
    bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, { key, value: parsed.value });
    return parsed.value;
  }
  async function reset<Key extends PreferenceKey>(key: Key): Promise<Preferences[Key]> {
    await bb.storage.kv.delete(kvKey(key));
    bb.realtime.publish(PREFERENCES_CHANGED_CHANNEL, { key, value: DEFAULT_PREFERENCES[key] });
    return DEFAULT_PREFERENCES[key];
  }
  return { read, readAll, write, reset };
}

function cliKey(raw: string): PreferenceKey {
  if (isPreferenceKey(raw)) return raw;
  throw new PluginCliError(`Unknown preference: ${raw}`, {
    code: "unknown_preference",
    hint: `Known preferences: ${PREFERENCE_KEYS.join(", ")}.`,
  });
}

const json = { type: "boolean", description: "Emit machine-readable JSON" } as const;
const keyArg = { name: "key", description: "Preference name", required: true } as const;

export default async function sidebarPlugin(bb: BbPluginApi) {
  const store = createPreferenceStore(bb);
  bb.rpc.register(sidebarRpcContract, {
    async listPreferences() {
      return { preferences: await store.readAll() };
    },
    async setPreference({ key, value }) {
      return { key, value: await store.write(key, value) };
    },
    async resetPreference({ key }) {
      return { key, value: await store.reset(key) };
    },
  });

  const show = (key: string, value: unknown, asJson: boolean | undefined) => ({
    exitCode: 0,
    stdout: asJson ? JSON.stringify({ key, value }) : `${key} = ${JSON.stringify(value)}`,
  });
  bb.cli.register(defineCli({
    name: bb.pluginId,
    summary: "Inspect and change the Spaces sidebar's preferences",
    description: "The Space shown, hidden threads, and collapsed threads and Spaces. Values are JSON; a bare word is read as a string.",
    commands: {
      "prefs list": cliCommand({
        summary: "List every preference and its current value",
        options: { json },
        async run(input) {
          const values = await store.readAll();
          if (input.options.json) return { exitCode: 0, stdout: JSON.stringify(values) };
          return {
            exitCode: 0,
            stdout: PREFERENCE_KEYS.map((key) => `${key}\t${JSON.stringify(values[key])}\t${PREFERENCE_DESCRIPTIONS[key]}`).join("\n"),
          };
        },
      }),
      "prefs get": cliCommand({
        summary: "Print one preference",
        positionals: [keyArg],
        options: { json },
        async run(input) {
          const key = cliKey(input.positionals.key);
          const value = await store.read(key);
          return input.options.json ? show(key, value, true) : { exitCode: 0, stdout: JSON.stringify(value) };
        },
      }),
      "prefs set": cliCommand({
        summary: "Set one preference",
        positionals: [keyArg, { name: "value", description: "JSON value, e.g. '\"all\"' or '[\"thr_1\"]'", required: true }],
        options: { json },
        async run(input) {
          const key = cliKey(input.positionals.key);
          let raw: unknown = input.positionals.value;
          try { raw = JSON.parse(input.positionals.value); } catch { /* a bare word is a string */ }
          try {
            return show(key, await store.write(key, raw), input.options.json);
          } catch (error) {
            if (error instanceof PreferenceValidationError) {
              throw new PluginCliError(error.message, { code: "invalid_preference_value", hint: PREFERENCE_DESCRIPTIONS[key] });
            }
            throw error;
          }
        },
      }),
      "prefs reset": cliCommand({
        summary: "Restore one preference to its default",
        positionals: [keyArg],
        options: { json },
        async run(input) {
          const key = cliKey(input.positionals.key);
          return show(key, await store.reset(key), input.options.json);
        },
      }),
    },
  }));
}

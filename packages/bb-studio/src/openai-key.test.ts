import { describe, expect, it } from "vitest";
import { pickImageProvider } from "./bot-avatar";
import { LEGACY_OPENAI_KEY_SETTING, migrateOpenaiKey, OPENAI_KEY_SETTING, OPENAI_KEY_SETTINGS, openaiKey } from "./openai-key";

/** A settings handle over a plain object, as BB's experimental_set behaves: null unsets. */
function store(values: Record<string, unknown>) {
  return {
    values,
    get: async () => ({ ...values }),
    set: async (patch: Record<string, string | null>) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete values[key];
        else values[key] = value;
      }
    },
  };
}

describe("Studio's OpenAI key", () => {
  it("is one secret setting, with the old avatar one kept readable", () => {
    expect(OPENAI_KEY_SETTINGS[OPENAI_KEY_SETTING]).toMatchObject({ label: "OpenAI API key", secret: true });
    expect(OPENAI_KEY_SETTINGS[LEGACY_OPENAI_KEY_SETTING]).toMatchObject({ secret: true });
  });

  it("reads the new key, then the old avatar key, then OPENAI_API_KEY", () => {
    expect(openaiKey({ openaiApiKey: " new ", botAvatarOpenaiApiKey: "old" }, { OPENAI_API_KEY: "env" })).toBe("new");
    expect(openaiKey({ openaiApiKey: "", botAvatarOpenaiApiKey: "old" }, { OPENAI_API_KEY: "env" })).toBe("old");
    expect(openaiKey({ openaiApiKey: "  " }, { OPENAI_API_KEY: "env" })).toBe("env");
    expect(openaiKey({}, {})).toBe("");
  });

  it("moves the old avatar key into the shared setting once", async () => {
    const settings = store({ botAvatarOpenaiApiKey: "sk-old" });
    expect(await migrateOpenaiKey(settings)).toBe(true);
    expect(settings.values).toEqual({ openaiApiKey: "sk-old" });
    expect(await migrateOpenaiKey(settings)).toBe(false);
    expect(settings.values).toEqual({ openaiApiKey: "sk-old" });
  });

  it("leaves both alone when the new key is already set", async () => {
    const settings = store({ openaiApiKey: "sk-new", botAvatarOpenaiApiKey: "sk-old" });
    expect(await migrateOpenaiKey(settings)).toBe(false);
    expect(settings.values).toEqual({ openaiApiKey: "sk-new", botAvatarOpenaiApiKey: "sk-old" });
    expect(await migrateOpenaiKey(store({}))).toBe(false);
  });

  it("is the key Bot avatars use", () => {
    expect(pickImageProvider({ settings: { openaiApiKey: "o" }, env: {} }).id).toBe("openai");
    expect(pickImageProvider({ settings: { botAvatarOpenaiApiKey: "o" }, env: {} }).id).toBe("openai");
  });
});

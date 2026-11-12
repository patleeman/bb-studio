import { describe, expect, it } from "vitest";
import { OPENAI_KEY_SETTING, OPENAI_KEY_SETTINGS, openaiKey, openaiKeyMigration } from "./openai-key";

describe("Studio's OpenAI key", () => {
  it("is one secret setting; the old avatar key is no longer declared", () => {
    expect(OPENAI_KEY_SETTINGS[OPENAI_KEY_SETTING]).toMatchObject({ label: "OpenAI API key", secret: true });
    expect(Object.keys(OPENAI_KEY_SETTINGS)).toEqual(["openaiApiKey"]);
  });

  it("reads the key, then OPENAI_API_KEY, and never the old avatar key", () => {
    expect(openaiKey({ openaiApiKey: " new " }, { OPENAI_API_KEY: "env" })).toBe("new");
    expect(openaiKey({ openaiApiKey: "", botAvatarOpenaiApiKey: "old" }, { OPENAI_API_KEY: "env" })).toBe("env");
    expect(openaiKey({ botAvatarOpenaiApiKey: "old" }, {})).toBe("");
    expect(openaiKey({}, {})).toBe("");
  });

  it("migration: clears the old avatar key when the shared key is set, without copying it", () => {
    expect(openaiKeyMigration({ openaiApiKey: "sk-new", botAvatarOpenaiApiKey: "sk-old" })).toEqual({ patch: { botAvatarOpenaiApiKey: null }, outcome: "cleared" });
  });

  it("migration: moves the old key into an empty shared key, and clears it", () => {
    expect(openaiKeyMigration({ openaiApiKey: "", botAvatarOpenaiApiKey: "sk-old" })).toEqual({ patch: { openaiApiKey: "sk-old", botAvatarOpenaiApiKey: null }, outcome: "copied" });
    expect(openaiKeyMigration({ openaiApiKey: "sk-new" })).toEqual({ patch: {}, outcome: "none" });
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_SPEECH_MODEL, speechConfig } from "./settings";

describe("speechConfig", () => {
  it("defaults to OpenRouter and its default model, with the host's key as a fallback", () => {
    expect(speechConfig({}, { OPENROUTER_API_KEY: " env-key " })).toMatchObject({ engine: "openrouter", model: DEFAULT_SPEECH_MODEL, voice: "", openRouterApiKey: "env-key" });
  });

  it("prefers the key in settings and trims every value", () => {
    expect(speechConfig({ speechEngine: "custom", speechModel: " kokoro ", speechVoice: " af_heart ", openRouterApiKey: "set", speechEndpoint: " http://x/v1 " }, { OPENROUTER_API_KEY: "env" }))
      .toMatchObject({ engine: "custom", model: "kokoro", voice: "af_heart", openRouterApiKey: "set", endpoint: "http://x/v1" });
  });
});

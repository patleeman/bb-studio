import { describe, expect, it } from "vitest";
import { addRealtimeUsage, addTranscriptionUsage, EMPTY_TALLY, realtimeCost, realtimePriceFor, REALTIME_PRICES } from "../../bot-prices";

describe("voice call cost", () => {
  it("prices the current Realtime models, and dated snapshots of them", () => {
    expect(REALTIME_PRICES["gpt-realtime-2.1"]).toEqual({ textInput: 4, cachedTextInput: 0.4, textOutput: 24, audioInput: 32, cachedAudioInput: 0.4, audioOutput: 64 });
    expect(realtimePriceFor("gpt-realtime-2.1-2026-09-30")).toBe(REALTIME_PRICES["gpt-realtime-2.1"]);
    expect(realtimePriceFor("gpt-realtime-9")).toBeNull();
  });

  it("splits cached tokens out of the input counts", () => {
    const tally = addRealtimeUsage(EMPTY_TALLY, {
      input_token_details: { text_tokens: 1000, audio_tokens: 2000, cached_tokens: 1500, cached_tokens_details: { text_tokens: 800, audio_tokens: 700 } },
      output_token_details: { text_tokens: 100, audio_tokens: 500 },
    });
    expect(tally).toMatchObject({ textIn: 200, cachedTextIn: 800, audioIn: 1300, cachedAudioIn: 700, textOut: 100, audioOut: 500 });
  });

  it("adds up audio and text in and out against the table", () => {
    let tally = addRealtimeUsage(EMPTY_TALLY, { input_token_details: { text_tokens: 1_000_000 }, output_token_details: { audio_tokens: 1_000_000 } });
    tally = addRealtimeUsage(tally, { input_token_details: { audio_tokens: 500_000 }, output_token_details: { text_tokens: 250_000 } });
    // 1M text in ($4) + 1M audio out ($64) + 0.5M audio in ($16) + 0.25M text out ($6).
    expect(realtimeCost("gpt-realtime-2.1", tally)).toBeCloseTo(90, 6);
    expect(realtimeCost("gpt-realtime-2.1-mini", tally)).toBeCloseTo(0.6 + 20 + 5 + 0.6, 6);
    expect(realtimeCost("unknown-model", tally)).toBeNull();
  });

  it("adds transcription, by token or by minute", () => {
    const tokens = addTranscriptionUsage(EMPTY_TALLY, { type: "tokens", input_tokens: 1_000_000, output_tokens: 100_000 });
    expect(realtimeCost("gpt-realtime-2.1", tokens, "gpt-4o-mini-transcribe")).toBeCloseTo(1.25 + 0.5, 6);
    const minutes = addTranscriptionUsage(EMPTY_TALLY, { type: "duration", seconds: 120 });
    expect(realtimeCost("gpt-realtime-2.1", minutes, "gpt-realtime-whisper")).toBeCloseTo(0.034, 6);
    expect(addTranscriptionUsage(EMPTY_TALLY, null)).toBe(EMPTY_TALLY);
  });

  it("ignores junk counts", () => {
    expect(addRealtimeUsage(EMPTY_TALLY, { input_token_details: { text_tokens: -5, audio_tokens: Number.NaN } })).toEqual(EMPTY_TALLY);
  });
});

import { readFileSync } from "node:fs";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { resetPluginSlotStoreForTest, setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { buildThreadHandoffCreateRequest, emptyPromptDraftState } from "@bb/client-core";
import {
  signInRecovery,
  signInRecoveryExitDraft,
  signInRecoveryHandoffDraft,
  signInRecoveryTitle,
} from "./signInRecovery.fork";

const sdkCalls = vi.hoisted(() => ({ archive: vi.fn(), archiveAll: vi.fn(), delete: vi.fn() }));

vi.mock("@/lib/sdk", () => ({ sdk: { threads: sdkCalls } }));

const signInError = {
  id: "row_error",
  turnId: "turn_fail",
  kind: "system",
  systemKind: "error",
  title: "Codex isn't signed in",
  detail: "Sign in to Codex, or pick another model.",
  status: "error",
} as unknown as TimelineRow;

const otherError = {
  ...signInError,
  id: "row_other_error",
  title: "Codex stopped",
} as unknown as TimelineRow;

function userRow(
  text: string,
  initiator: "user" | "agent" = "user",
  mentions: unknown[] = [],
  turnId = "turn_fail",
): TimelineRow {
  return {
    id: `row_${text}`,
    turnId,
    kind: "conversation",
    role: "user",
    initiator,
    text,
    mentions,
    attachments: null,
  } as unknown as TimelineRow;
}

const reply = {
  id: "row_reply",
  turnId: "turn_earlier",
  kind: "conversation",
  role: "assistant",
  text: "Hello!",
  attachments: null,
} as unknown as TimelineRow;

const poem =
  "Write a six-line poem about the sea.\nKeep each line short.\nNo rhyme.";

const seed = {
  environmentId: null,
  projectId: "proj_personal",
  sourceThreadId: "thr_source",
  sourceThreadTitle: "Sea poem",
};

const execution = {
  providerId: "claude-code",
  model: "claude-haiku",
  reasoningLevel: "medium" as const,
  serviceTier: undefined,
  supportsServiceTier: false,
  permissionMode: "full" as const,
};

describe("sign-in recovery", () => {
  it("finds the message that failed when it is the conversation's only message", () => {
    expect(signInRecovery([userRow(poem), signInError], false)).toEqual({
      input: [{ type: "text", text: poem, mentions: [] }],
      onlyMessage: true,
    });
  });

  it("finds the latest failed message after earlier replies, as a continuation", () => {
    const recovery = signInRecovery(
      [userRow("Hi"), reply, userRow("Now a poem"), signInError],
      false,
    );
    expect(recovery?.input).toEqual([
      { type: "text", text: "Now a poem", mentions: [] },
    ]);
    expect(recovery?.onlyMessage).toBe(false);
  });

  it("does not treat a conversation with older unloaded rows or a Bot-sent message as empty", () => {
    expect(signInRecovery([userRow(poem), signInError], true)?.onlyMessage).toBe(false);
    expect(
      signInRecovery([userRow("Set up", "agent"), userRow(poem), signInError], false)
        ?.onlyMessage,
    ).toBe(false);
  });

  it("is off unless the last reply failed on sign-in", () => {
    expect(signInRecovery([userRow(poem), otherError], false)).toBeNull();
    expect(signInRecovery([userRow(poem), reply], false)).toBeNull();
    expect(signInRecovery([signInError], false)).toBeNull();
    expect(signInRecovery(null, false)).toBeNull();
  });

  it("returns the same answer for the same rows", () => {
    const rows = [userRow(poem), signInError];
    expect(signInRecovery(rows, false)).toBe(signInRecovery(rows, false));
  });

  it("carries the full message into the new conversation, not a Continue from mention", () => {
    const recovery = signInRecovery([userRow(poem), signInError], false);
    const draft = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), recovery);
    expect(draft.text).toBe(poem);
    expect(draft.text).not.toContain("Continue from");
    const request = buildThreadHandoffCreateRequest({ draft, execution, seed });
    expect(request?.input).toEqual([{ type: "text", text: poem, mentions: [] }]);
    expect(request?.providerId).toBe("claude-code");
  });

  it("keeps a mention in the carried message", () => {
    const mention = {
      start: 6,
      end: 15,
      resource: { kind: "file", path: "/notes.md", label: "notes.md" },
    };
    const recovery = signInRecovery(
      [userRow("Check @notes.md please", "user", [mention]), signInError],
      false,
    );
    const draft = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), recovery);
    expect(draft.mentions).toEqual([mention]);
  });

  it("puts the failed message after the Continue from line when the conversation had replies", () => {
    const recovery = signInRecovery(
      [userRow("Hi"), reply, userRow("Now a poem"), signInError],
      false,
    );
    const draft = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), recovery);
    expect(draft.text).toBe("Continue from @thread:thr_source\n\nNow a poem");
  });

  it("keeps what the user already typed and stays stable on a second provider switch", () => {
    const recovery = signInRecovery([userRow(poem), signInError], false);
    const typed = { text: "Something else", mentions: [], attachments: [] };
    expect(signInRecoveryHandoffDraft(seed, typed, recovery)).toBe(typed);
    const seeded = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), recovery);
    expect(signInRecoveryHandoffDraft(seed, seeded, recovery)).toBe(seeded);
  });

  it("leaves bb's handoff unchanged without a sign-in failure", () => {
    const draft = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), null);
    expect(draft.text).toBe("Continue from @thread:thr_source\n\n");
  });

  it("names the new conversation after the failed one, never after the mention", () => {
    const only = signInRecovery([userRow(poem), signInError], false);
    expect(signInRecoveryTitle({ title: "Sea poem", titleFallback: poem }, only)).toEqual({
      title: "Sea poem",
    });
    expect(signInRecoveryTitle({ title: null, titleFallback: poem }, only)).toBeNull();
    const later = signInRecovery([userRow("Hi"), reply, userRow("Now a poem"), signInError], false);
    expect(signInRecoveryTitle({ title: null, titleFallback: "Hi" }, later)).toEqual({
      title: "Hi",
    });
    expect(signInRecoveryTitle({ title: "Sea poem", titleFallback: null }, null)).toBeNull();
  });


  it("never archives a Bot's Main whose only message failed: the failed conversation stays", () => {
    const mainRows = [userRow("Hi, I'm Sam."), signInError];
    const main = { title: "Assistant", titleFallback: null };
    const recovery = signInRecovery(mainRows, false);
    expect(recovery?.onlyMessage).toBe(true);
    signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), recovery);
    signInRecoveryTitle(main, recovery);
    expect(sdkCalls.archive).not.toHaveBeenCalled();
    expect(sdkCalls.archiveAll).not.toHaveBeenCalled();
    expect(sdkCalls.delete).not.toHaveBeenCalled();
  });

  it("keeps archiving out of the recovery and out of the prompt area's handoff path", () => {
    const seam = readFileSync(new URL("./signInRecovery.fork.ts", import.meta.url), "utf8");
    expect(seam).not.toMatch(/archive(?!dAt)/iu);
    const area = readFileSync(new URL("./ThreadDetailPromptArea.tsx", import.meta.url), "utf8");
    const start = area.indexOf("const createHandoffThread = useCallback(");
    const end = area.indexOf("const submitFollowUpDraft", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(area.slice(start, end)).not.toMatch(/archive|retire/iu);
  });

  it("never re-posts an old, answered message when a later Bot-started turn fails in Main", () => {
    const rows = [
      userRow("hi", "user", [], "turn_1"),
      { ...(reply as object), turnId: "turn_1" } as TimelineRow,
      userRow("[bb message from thread:thr_worker]\n\nHeartbeat", "agent", [], "turn_fail"),
      signInError,
    ];
    expect(signInRecovery(rows, false)).toBeNull();
    const draft = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), signInRecovery(rows, false));
    expect(draft.text).toBe("Continue from @thread:thr_source\n\n");
  });

  it("takes the user's message only from the turn that failed", () => {
    const answered = [
      userRow("hi", "user", [], "turn_1"),
      { ...(reply as object), turnId: "turn_1" } as TimelineRow,
    ];
    expect(signInRecovery([...answered, { ...(signInError as object), turnId: "turn_other" } as TimelineRow], false)).toBeNull();
    expect(signInRecovery([...answered, { ...(signInError as object), turnId: null } as TimelineRow], false)).toBeNull();
    expect(signInRecovery([...answered, userRow("Now a poem"), signInError], false)?.input).toEqual([
      { type: "text", text: "Now a poem", mentions: [] },
    ]);
  });

  it("never re-posts a Studio line or an automation as if the user typed it", () => {
    resetPluginSlotStoreForTest();
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        replyClassifiers: [
          {
            id: "relay",
            classify: () => null,
            classifyMessage: (text) => (text.startsWith("Watcher ") ? { sender: "watcher Morning card" } : null),
          },
        ],
      }),
    );
    expect(signInRecovery([userRow("Watcher Morning card: write today's card."), signInError], false)).toBeNull();
    expect(signInRecovery([userRow("[bb automation due:aut_1] Check the inbox"), signInError], false)).toBeNull();
    resetPluginSlotStoreForTest();
  });

  it("clears the recovered message when the user backs out, so it can't be sent twice in the failed conversation", () => {
    const only = signInRecovery([userRow(poem), signInError], false);
    const seeded = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), only);
    expect(signInRecoveryExitDraft(seed, seeded, only)).toEqual(emptyPromptDraftState());
    const later = signInRecovery([userRow("Hi"), reply, userRow("Now a poem"), signInError], false);
    const continued = signInRecoveryHandoffDraft(seed, emptyPromptDraftState(), later);
    expect(signInRecoveryExitDraft(seed, continued, later)).toEqual(emptyPromptDraftState());
    const edited = { text: "Now a poem about rain", mentions: [], attachments: [] };
    expect(signInRecoveryExitDraft(seed, edited, only)).toBeNull();
    const typed = signInRecoveryHandoffDraft(seed, { text: "Mine", mentions: [], attachments: [] }, null);
    expect(signInRecoveryExitDraft(seed, typed, null)?.text).toBe("Mine");
  });

  it("recovers a thread's first message, which bb records before its turn starts", () => {
    const seedMessage = { ...(userRow("Say hello.") as object), turnId: null } as TimelineRow;
    const provisioned = { id: "op", kind: "system", systemKind: "operation", turnId: null, title: "Provisioned thread" } as unknown as TimelineRow;
    expect(signInRecovery([seedMessage, provisioned, signInError], false)?.input).toEqual([
      { type: "text", text: "Say hello.", mentions: [] },
    ]);
  });

  it("recovers nothing when another turn's rows sit between the message and the error", () => {
    const seedMessage = { ...(userRow("hi") as object), turnId: null } as TimelineRow;
    const otherTurnWork = { id: "work", kind: "command", turnId: "turn_1", status: "completed" } as unknown as TimelineRow;
    expect(signInRecovery([seedMessage, otherTurnWork, signInError], false)).toBeNull();
  });
});


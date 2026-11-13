import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { getFollowUpPromptPlaceholder } from "./follow-up-placeholder";
import {
  COMPACT_SIGNED_OUT_PLACEHOLDER,
  FIRST_MESSAGE_PLACEHOLDER,
  SIGNED_OUT_PLACEHOLDER,
  forkPlaceholder,
  forkPlaceholderState,
  threadHasNoUserMessage,
} from "./follow-up-placeholder.fork";

function placeholder(
  status: "idle" | "error" | "active",
  rows: readonly TimelineRow[],
): string {
  return (
    forkPlaceholder(status, forkPlaceholderState(rows, false), false) ??
    getFollowUpPromptPlaceholder(status)
  );
}

function errorRow(title: string): TimelineRow {
  return {
    id: `row_${title}`,
    kind: "system",
    systemKind: "error",
    title,
    detail: "Sign in to Codex, or pick another model.",
    status: "error",
  } as unknown as TimelineRow;
}

function userRow(initiator: "user" | "agent" | "system"): TimelineRow {
  return {
    id: `row_${initiator}`,
    kind: "conversation",
    role: "user",
    initiator,
    text: "hello",
  } as unknown as TimelineRow;
}

const assistantRow = {
  id: "row_assistant",
  kind: "conversation",
  role: "assistant",
  text: "Hi, I'm your assistant.",
} as unknown as TimelineRow;

describe("the first-message placeholder", () => {
  it("says Ask anything on an idle thread whose only message is the assistant's welcome", () => {
    expect(threadHasNoUserMessage([assistantRow], false)).toBe(true);
    expect(placeholder("idle", [assistantRow])).toBe(FIRST_MESSAGE_PLACEHOLDER);
  });

  it("does not count a message the system or an agent sent as the user's", () => {
    expect(
      threadHasNoUserMessage([userRow("system"), userRow("agent"), assistantRow], false),
    ).toBe(true);
  });

  it("asks for a follow-up once the user has written", () => {
    expect(threadHasNoUserMessage([userRow("user"), assistantRow], false)).toBe(false);
    expect(placeholder("idle", [userRow("user"), assistantRow])).toMatch(
      /^Ask for a follow-up/u,
    );
  });

  it("finds the user's message inside a grouped turn", () => {
    const turn = {
      id: "turn_1",
      kind: "turn",
      children: [userRow("user")],
    } as unknown as TimelineRow;
    expect(threadHasNoUserMessage([turn], false)).toBe(false);
  });

  it("assumes a message exists when older rows are not loaded", () => {
    expect(threadHasNoUserMessage([assistantRow], true)).toBe(false);
    expect(threadHasNoUserMessage(undefined, false)).toBe(false);
  });

  it("keeps the error and running placeholders", () => {
    expect(placeholder("error", [assistantRow])).toBe(
      "Retry by sending a follow-up message",
    );
    expect(placeholder("active", [assistantRow])).not.toBe(FIRST_MESSAGE_PLACEHOLDER);
  });
});

describe("the placeholder after a provider that isn't signed in", () => {
  it("asks to sign in or pick another model instead of Retry", () => {
    const rows = [userRow("user"), errorRow("Codex isn't signed in")];
    expect(forkPlaceholderState(rows, true)).toBe("signed-out");
    expect(placeholder("error", rows)).toBe(SIGNED_OUT_PLACEHOLDER);
    expect(
      forkPlaceholder("error", forkPlaceholderState(rows, false), true),
    ).toBe(COMPACT_SIGNED_OUT_PLACEHOLDER);
  });

  it("goes back to Retry for any other failure", () => {
    const rows = [userRow("user"), errorRow("Provider error")];
    expect(placeholder("error", rows)).toBe("Retry by sending a follow-up message");
  });

  it("stops once a later reply lands", () => {
    const rows = [
      userRow("user"),
      errorRow("Codex isn't signed in"),
      userRow("user"),
      assistantRow,
    ];
    expect(forkPlaceholderState(rows, false)).toBeNull();
  });
});

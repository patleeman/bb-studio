import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldsWithReply, markStudioLine, parseRelayedMessage, relayedLine, type RelayedInitiator } from "./relayed";
import { tellLine, TRIAGE_NOTE } from "../runners";
import { watcherMessage } from "../automations";
import { dueMessage } from "../triggers/scheduler";
import { RESUME_MARKER, exhaustedLine as threadExhaustedLine } from "../thread-resume";
import { exhaustedLine as automationExhaustedLine } from "../auto-resume";

interface RelayedCase {
  name: string;
  initiator: RelayedInitiator;
  text: string;
  senderTitle?: string;
  reply: string;
  expect: { kind: string; sender: string | null; senderThreadId: string | null; urgent: boolean; summary: string; line: string; folds: boolean } | null;
}

const fixture = JSON.parse(readFileSync(new URL("./relayed-messages.json", import.meta.url), "utf8")) as { cases: RelayedCase[] };

describe("relayed messages: the shared cases", () => {
  for (const each of fixture.cases) {
    it(each.name, () => {
      const parsed = parseRelayedMessage(each.text, each.initiator);
      if (each.expect === null) {
        expect(parsed).toBeNull();
        expect(foldsWithReply(parsed, each.reply)).toBe(false);
        return;
      }
      expect(parsed).not.toBeNull();
      expect({ kind: parsed!.kind, sender: parsed!.sender, senderThreadId: parsed!.senderThreadId, urgent: parsed!.urgent, summary: parsed!.summary }).toEqual({
        kind: each.expect.kind, sender: each.expect.sender, senderThreadId: each.expect.senderThreadId, urgent: each.expect.urgent, summary: each.expect.summary,
      });
      expect(relayedLine(parsed!, each.senderTitle)).toBe(each.expect.line);
      expect(foldsWithReply(parsed, each.reply)).toBe(each.expect.folds);
    });
  }
});

describe("relayed messages: Studio's own senders", () => {
  it("reads a runner report as Studio writes it", () => {
    const parsed = parseRelayedMessage(`[bb message from thread:thr_runr0001]\n\n${tellLine("House", "urgent", "The  door\nis open.")}`, "agent");
    expect(parsed).toMatchObject({ kind: "runner", sender: "runner House", urgent: true, summary: "The door is open." });
    expect(TRIAGE_NOTE).toContain("[PASS]");
  });

  it("reads a watcher line as Studio writes it", () => {
    expect(parseRelayedMessage(watcherMessage("Inbox", "3 new", "", false).text, "user")).toMatchObject({ kind: "studio", sender: "watcher Inbox", summary: "3 new" });
  });

  it("reads an automation trigger as the scheduler writes it", () => {
    expect(parseRelayedMessage(dueMessage("sch_1", 'Check-in "Morning": Plan the day.'), "user")).toMatchObject({ kind: "automation", sender: "Morning", summary: "Plan the day." });
  });

  it("reads the restart and turned-off alerts as Studio writes them", () => {
    expect(parseRelayedMessage(markStudioLine(RESUME_MARKER), "user")).toMatchObject({ kind: "studio", sender: "BB Studio" });
    expect(parseRelayedMessage(markStudioLine(`⚠️ ${threadExhaustedLine("Sync", "host restarted")}`), "user")).toMatchObject({ kind: "studio", urgent: true });
    expect(parseRelayedMessage(markStudioLine(`⚠️ ${automationExhaustedLine("Sweep", "error")}`), "user")).toMatchObject({ kind: "studio", urgent: true });
  });

  it("puts the summary start after the header and a dropped tag", () => {
    const text = "[bb message from thread:thr_lead0001]\n\nLEAD bb-studio: shipped.";
    const parsed = parseRelayedMessage(text, "agent")!;
    expect(text.slice(parsed.bodyStart)).toBe("LEAD bb-studio: shipped.");
    expect(text.slice(parsed.summaryStart)).toBe("shipped.");
  });

  it("never reads a typed line as Studio's, however it starts; only Studio's header marks one", () => {
    for (const typed of ["Watcher A: hi", "From runner B: x", "⚠️ From runner B: x", "📥 Handed to you: this", "Maintenance: 2 threads need your call soon"]) expect(parseRelayedMessage(typed, "user"), typed).toBeNull();
    expect(parseRelayedMessage(markStudioLine("Watcher A: hi"), "user")).toMatchObject({ kind: "studio", sender: "watcher A", summary: "hi" });
    expect(parseRelayedMessage(`[bb message from thread:thr_runr0001]\n\n${markStudioLine("From runner B: x")}`, "agent")).toMatchObject({ kind: "runner", sender: "runner B", summary: "x" });
  });

  it("never reads an assistant-looking or empty text", () => {
    expect(parseRelayedMessage("", "agent")).toBeNull();
    expect(parseRelayedMessage("[PASS]", "user")).toBeNull();
    expect(parseRelayedMessage("[bb system]\n\nhello", "user")).toBeNull();
  });
});

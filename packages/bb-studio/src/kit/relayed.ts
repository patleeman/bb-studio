import { isPassOutput } from "./silent";

export type RelayedKind = "agent" | "runner" | "automation" | "system" | "studio";
export type RelayedInitiator = "user" | "agent" | "system";

export interface RelayedMessage {
  kind: RelayedKind;
  sender: string | null;
  senderThreadId: string | null;
  urgent: boolean;
  bodyStart: number;
  summaryStart: number;
  summary: string;
}

export const RELAYED_FALLBACK_SENDER = "another conversation";
export const RELAYED_STUDIO_SENDER = "BB Studio";
export const RELAYED_SUMMARY_LIMIT = 100;

const AGENT_HEADER = /^\[bb message from thread:([^;\]\s]+)(?:;[^\]]*)?\]\s*/u;
const SYSTEM_HEADER = /^\[bb system\]\s*/u;
const AUTOMATION_HEADER = /^\[bb automation due:([^\]\s]+)\]\s*/u;
const RUNNER_LINE = /^(⚠️ )?From runner ([^:\n]+): /u;
const NAMED_AUTOMATION = /^(?:Check-in|Reminder) "([^"\n]+)"(?: \([^)\n]*\))?: /u;
const LEAD_TAG = /^[A-Z]{2,}(?:[ \t]+[a-z0-9][\w.-]*)?:[ \t]+/u;

interface StudioLine {
  pattern: RegExp;
  sender: (match: RegExpExecArray) => string;
  urgent?: boolean;
  keepPrefix?: boolean;
}

const STUDIO_LINES: StudioLine[] = [
  { pattern: /^Watcher ([^:\n]+): /u, sender: (match) => `watcher ${match[1]}` },
  { pattern: /^🗓 [a-z][a-z ]* from \[([^\]\n]+)\]\(\/threads\/[^)\s]+\): /u, sender: (match) => match[1]! },
  { pattern: /^📥 Handed to you: /u, sender: () => RELAYED_STUDIO_SENDER, keepPrefix: true },
  { pattern: /^↻ Resumed after a restart$/u, sender: () => RELAYED_STUDIO_SENDER, keepPrefix: true },
  { pattern: /^⚠️ "[^"\n]+" stopped again \(/u, sender: () => RELAYED_STUDIO_SENDER, urgent: true, keepPrefix: true },
  { pattern: /^⚠️ [^\n]+ is off: BB turned it off again \(/u, sender: () => RELAYED_STUDIO_SENDER, urgent: true, keepPrefix: true },
  { pattern: /^Maintenance: \d+ threads? needs? your call /u, sender: () => RELAYED_STUDIO_SENDER, keepPrefix: true },
  { pattern: /^The reviewer checked (?:round \d+|the screens) of "[^"\n]+" and found problems:/u, sender: () => "design review", keepPrefix: true },
];

function skipSpace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/u.test(text[index]!)) index += 1;
  return index;
}

export function relayedSummary(text: string, start = 0): string {
  const line = text.slice(start).split(/\r?\n/u).find((each) => each.trim().length > 0) ?? "";
  const plain = line
    .replace(/^\s*(?:>\s*|#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)+/u, "")
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/gu, "$1")
    .replace(/(\*\*|__|`)/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const sentenceEnd = /[.!?](?=\s)/u.exec(plain);
  const sentence = sentenceEnd ? plain.slice(0, sentenceEnd.index + 1) : plain;
  if (sentence.length <= RELAYED_SUMMARY_LIMIT) return sentence;
  const cut = sentence.slice(0, RELAYED_SUMMARY_LIMIT - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > RELAYED_SUMMARY_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/u, "")}…`;
}

function result(kind: RelayedKind, text: string, fields: { sender: string | null; senderThreadId?: string | null; urgent?: boolean; bodyStart: number; summaryStart: number }): RelayedMessage {
  const summaryStart = skipSpace(text, fields.summaryStart);
  return {
    kind,
    sender: fields.sender,
    senderThreadId: fields.senderThreadId ?? null,
    urgent: fields.urgent ?? false,
    bodyStart: fields.bodyStart,
    summaryStart,
    summary: relayedSummary(text, summaryStart),
  };
}

function studioLine(text: string, start: number): RelayedMessage | null {
  const runner = RUNNER_LINE.exec(text.slice(start));
  if (runner) return result("runner", text, { sender: `runner ${runner[2]!.trim()}`, urgent: !!runner[1], bodyStart: start, summaryStart: start + runner[0].length });
  for (const line of STUDIO_LINES) {
    const match = line.pattern.exec(text.slice(start));
    if (!match) continue;
    return result("studio", text, { sender: line.sender(match), urgent: line.urgent, bodyStart: start, summaryStart: line.keepPrefix ? start : start + match[0].length });
  }
  return null;
}

export function parseRelayedBody(body: string): RelayedMessage {
  const line = studioLine(body, 0);
  if (line) return line;
  const tag = LEAD_TAG.exec(body);
  return result("agent", body, { sender: null, bodyStart: 0, summaryStart: tag ? tag[0].length : 0 });
}

export function parseRelayedMessage(text: string, initiator: RelayedInitiator | null): RelayedMessage | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const automation = AUTOMATION_HEADER.exec(text);
  if (automation) {
    const bodyStart = automation[0].length;
    const named = NAMED_AUTOMATION.exec(text.slice(bodyStart));
    return result("automation", text, { sender: named ? named[1]! : "Automation", bodyStart, summaryStart: bodyStart + (named ? named[0].length : 0) });
  }
  if (initiator !== "user") {
    const agent = AGENT_HEADER.exec(text);
    if (agent) {
      const bodyStart = agent[0].length;
      const body = parseRelayedBody(text.slice(bodyStart));
      return {
        ...body,
        senderThreadId: agent[1]!,
        bodyStart,
        summaryStart: bodyStart + body.summaryStart,
      };
    }
    const system = SYSTEM_HEADER.exec(text);
    if (system) return result("system", text, { sender: RELAYED_STUDIO_SENDER, bodyStart: system[0].length, summaryStart: system[0].length });
  }
  if (initiator === "agent" || initiator === "system") return null;
  return studioLine(text, 0);
}

export function relayedSender(message: RelayedMessage, senderTitle?: string | null): string {
  return message.sender ?? (senderTitle?.trim() || RELAYED_FALLBACK_SENDER);
}

export function relayedLine(message: RelayedMessage, senderTitle?: string | null): string {
  const sender = relayedSender(message, senderTitle);
  return message.summary ? `From ${sender} · ${message.summary}` : `From ${sender}`;
}

export function foldsWithReply(message: RelayedMessage | null, reply: string | null | undefined): boolean {
  return message !== null && isPassOutput(reply);
}

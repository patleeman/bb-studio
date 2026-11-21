// Secrets out of everything strands send to Jev or the small model, and out
// of the lines they keep: known secret values (Studio's API keys, Tool
// Gateway's server secrets and tokens) by exact match, then anything shaped
// like a token (Studio's redact(): bearer tokens, sk- keys, JWTs, GitHub and
// Slack tokens, key=value secrets, long token-like strings), plus private key
// blocks and AWS and Google API keys.
import { redact } from "../auth/scrub";

export const REDACTED = "[redacted]";

const MORE: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\bAIza[0-9A-Za-z_-]{35}\b/gu,
];

/** Known values shorter than this aren't matched (too likely to be ordinary words). */
const MIN_KNOWN = 8;

export type Scrub = (text: string) => string;

/** A scrubber for these known secret values (and token-shaped text). */
export function scrubber(known: readonly string[] = []): Scrub {
  const values = [...new Set(known.filter((value) => typeof value === "string" && value.length >= MIN_KNOWN))].sort((a, b) => b.length - a.length);
  return (text: string) => {
    if (!text) return text;
    let out = text;
    for (const value of values) if (out.includes(value)) out = out.split(value).join(REDACTED);
    for (const pattern of MORE) out = out.replace(pattern, REDACTED);
    return redact(out);
  };
}

// Secrets out of everything strands send to Jev or the small model, and out
// of the lines they keep: known secret values (Studio's API keys, Tool
// Gateway's server secrets and tokens) by exact match, then anything shaped
// like a token (Studio's redact(): bearer tokens, sk- keys, JWTs, GitHub and
// Slack tokens, key=value secrets, long token-like strings), plus private key
// blocks, AWS and Google API keys, passwords in URLs, and the value of any
// pair named like a secret ("token: …", "password=…", "api_key: …",
// "AWS_SECRET_ACCESS_KEY=…"), Authorization headers of any scheme and cookies.
import { redact } from "../auth/scrub";

export const REDACTED = "[redacted]";

const MORE: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\bAIza[0-9A-Za-z_-]{35}\b/gu,
];

/** A password in a URL (scheme://user:password@host): the password goes, the user and host stay. */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s@/]+)@/giu;
/**
 * A secret named in a pair: the value goes, the name stays. The name is any
 * identifier (env-style, dotted, camelCase, quoted JSON key) that contains a
 * secret word anywhere: token, secret, password/passwd/pwd, passphrase,
 * credential, cookie, session; or KEY / AUTH as one of its parts
 * (AWS_SECRET_ACCESS_KEY=, SLACK_BOT_TOKEN=, api_key:, "authToken":), so
 * "keyboard" and "author" stay.
 */
const PAIR = /(?<![A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]*)(["']?[ \t]*[:=][ \t]*["']?)(?!\[redacted\])([^\s"',;]+)/gu;
const SECRET_WORD = /token|secret|passw(?:or)?d|pwd|passphrase|credential|cookie|session/iu;
const SECRET_PARTS = new Set(["key", "keys", "auth", "apikey", "privatekey", "accesskey"]);
/** The name's parts: split at _ . - and camelCase, lower case ("awsAccessKey" → aws, access, key). */
const parts = (name: string) => name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase().split(/[_.-]+/u);
const secretName = (name: string) => SECRET_WORD.test(name) || parts(name).some((part) => SECRET_PARTS.has(part));
/** Authorization and Proxy-Authorization headers, any scheme (Bearer, Basic, …): everything after the name. */
const AUTH_HEADER = /\b((?:proxy-)?authorization)([ \t]*[:=][ \t]*)(?!\[redacted\])[^\r\n]+/giu;
/** Cookie and Set-Cookie lines: every cookie on them. */
const COOKIE_HEADER = /\b((?:set-)?cookie)([ \t]*:[ \t]*)(?!\[redacted\])[^\r\n]+/giu;

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
    out = out.replace(URL_PASSWORD, `$1:${REDACTED}@`)
      .replace(AUTH_HEADER, `$1$2${REDACTED}`)
      .replace(COOKIE_HEADER, `$1$2${REDACTED}`)
      .replace(PAIR, (match, name: string, sep: string) => (secretName(name) ? `${name}${sep}${REDACTED}` : match));
    return redact(out);
  };
}

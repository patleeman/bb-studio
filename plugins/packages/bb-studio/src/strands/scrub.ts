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
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]*):([^\s@/]+)@/giu;
/**
 * A secret named in a pair ("password=…", "AWS_SECRET_ACCESS_KEY=…",
 * "api_key: …", "--token=…"): the value goes, the name stays. Names are
 * judged by whole parts (split at _ . - and camelCase), so "tokens",
 * "tokenizer", "secretary" and "passwordless" are ordinary words.
 * - Strong names lose any value: a part that is secret, password, passwd,
 *   pwd, passphrase or credential(s); token with another part
 *   (SLACK_BOT_TOKEN, authToken, --with-token); key after api, private,
 *   access, secret, signing, encryption or master; session with id, token,
 *   key or secret.
 * - Weak names (key, auth, authorization, session, token or pass, alone or
 *   with other parts) lose only a value that looks like a secret: 8+
 *   characters, not a number, not code ({…}, (…), <…>, […]), not a type
 *   name and not a snake_case word.
 * - A name with a part about size or rules (count, budget, limit, max, min,
 *   length, reset…) isn't a secret name: token_count: 512 stays.
 * - Any name keeps a code expression (thread.id, z.string(), /re/).
 * - A kept value is judged again inside, so a secret after an ordinary pair
 *   in the same word goes ("https://x/v1?api_key=…", "user=a:password=…").
 * Type words (string, number, boolean, true, false, null…) always stay, so
 * TypeScript ("token: string") reads as it was.
 */
const PAIR = /(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_.-]*)(["']?[ \t]*[:=][ \t]*["']?)(?!\[redacted\])([^\s"',;>)}]+)/gu;
const STRONG_PARTS = new Set(["secret", "secrets", "password", "passwords", "passwd", "pwd", "passphrase", "credential", "credentials", "apikey", "privatekey", "accesskey", "clientsecret"]);
/** A part that makes the name about a secret's size or rules, not the secret ("token_count", "password_min_length"). */
const ABOUT_PARTS = new Set(["count", "counts", "budget", "limit", "limits", "usage", "max", "min", "length", "size", "reset", "word", "field", "label", "hint", "policy"]);
const KEY_QUALIFIERS = new Set(["api", "private", "access", "secret", "signing", "encryption", "master"]);
const SESSION_SECRET = new Set(["id", "token", "key", "secret"]);
const WEAK_PARTS = new Set(["key", "keys", "auth", "authorization", "session", "token", "pass"]);
const TYPE_WORDS = new Set(["string", "number", "boolean", "bigint", "true", "false", "null", "undefined", "any", "unknown", "object", "void", "never"]);
/** The name's parts: split at _ . - and camelCase, lower case ("awsAccessKey" → aws, access, key). */
const parts = (name: string) => name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase().split(/[_.-]+/u).filter(Boolean);
type Strength = "strong" | "weak" | null;
function strength(name: string): Strength {
  const each = parts(name);
  if (each.some((part) => ABOUT_PARTS.has(part))) return null;
  if (each.some((part) => STRONG_PARTS.has(part))) return "strong";
  if ((each.includes("token") || each.includes("pass")) && each.length > 1) return "strong";
  for (let i = 1; i < each.length; i++) if ((each[i] === "key" || each[i] === "keys") && KEY_QUALIFIERS.has(each[i - 1]!)) return "strong";
  if (each.includes("session") && each.some((part) => SESSION_SECRET.has(part))) return "strong";
  return each.some((part) => WEAK_PARTS.has(part)) ? "weak" : null;
}
/** A value a weak name keeps: short, a number, code, a type name ("AuthConfig") or a snake_case word (created_at). */
const ordinaryValue = (value: string) => value.length < 8 || /^[\d.,:_-]+$/u.test(value) || /^[{(<[]/u.test(value) || /^[A-Z][A-Za-z]*$/u.test(value) || /^[a-z]+(?:_[a-z]+)+$/u.test(value);
/** A code expression any name keeps: a lowercase dotted path (thread.id), a call (z.string(), makeKey(thread)) or a regex literal. */
const codeValue = (value: string) => /^[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)+$/u.test(value) || value.includes("(") || /^\/.+\/[a-z]*$/u.test(value);
/** A flag and its value after a space: --token plainvalue, --password hunter2, --api-key abc. */
const FLAG_VALUE = /(?<![\w-])(--(?:token|password|passwd|pass|secret|api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret))([ \t]+)(?!-)(?!\[redacted\])[^\s"']+/giu;
/** curl-style -u user:password: the password goes. */
const USER_PASSWORD_FLAG = /(?<![\w-])(-u[ \t]+["']?[^\s:"']+):(?!\[redacted\])[^\s"']+/gu;
/** A Slack incoming webhook: the path is the secret. */
const SLACK_WEBHOOK = /(https:\/\/hooks\.slack\.com\/services\/)[A-Za-z0-9/_-]+/gu;
/** Authorization and Proxy-Authorization headers: a scheme and its credential, or one long credential. */
const AUTH_HEADER = /(?<=^|["'\s])((?:proxy-)?authorization)([ \t]*[:=][ \t]*)(?!\[redacted\])(?:[A-Za-z][A-Za-z0-9-]*[ \t]+[^\s"']{6,}|[^\s"']{16,})/gimu;
/** Cookie and Set-Cookie headers (with a name=value after them): every cookie on them. */
const COOKIE_HEADER = /(?<=^|["'\s])((?:set-)?cookie)([ \t]*:[ \t]*)(?=[^\r\n"']*=)(?!\[redacted\])[^\r\n"']+/gimu;

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
      .replace(SLACK_WEBHOOK, `$1${REDACTED}`)
      .replace(AUTH_HEADER, `$1$2${REDACTED}`)
      .replace(COOKIE_HEADER, `$1$2${REDACTED}`)
      .replace(FLAG_VALUE, `$1$2${REDACTED}`)
      .replace(USER_PASSWORD_FLAG, `$1:${REDACTED}`)
      // A kept pair's value is judged again inside: "https://x/v1?api_key=…", "user=admin:password=…".
      .replace(PAIR, function judge(match: string, name: string, sep: string, value: string): string {
        const kind = strength(name);
        if (!kind || TYPE_WORDS.has(value.toLowerCase()) || codeValue(value) || (kind === "weak" && ordinaryValue(value))) {
          const inner = value.replace(PAIR, judge as never);
          return inner === value ? match : `${name}${sep}${inner}`;
        }
        return `${name}${sep}${REDACTED}`;
      });
    // Named pairs are judged above (strong and weak names); redact() adds the token shapes.
    return redact(out, { pairs: false });
  };
}

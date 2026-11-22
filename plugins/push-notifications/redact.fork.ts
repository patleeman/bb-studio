export const REDACTED_LABEL = "[redacted";

const SHOWN = "[A-Za-z0-9._~+/=-]{4}";
const LABEL = new RegExp(`^\\[redacted(?: …${SHOWN})?\\]$`, "u");
const LABEL_SOURCE = String.raw`\[redacted(?: …${SHOWN})?\]`;
const value = (chars: string) => `(${LABEL_SOURCE}|${chars}+)`;

const SECRET_KEYS =
  "token|access_token|refresh_token|id_token|auth|auth_token|key|api_key|apikey|secret|client_secret|password|passwd|pwd|sig|signature|code";
const SECRET_PARAM = new RegExp(
  `([?&#;](?:${SECRET_KEYS})=)${value(`[^&#;\\s"'<>]`)}`,
  "giu",
);
const URL_USER_INFO = new RegExp(
  `(\\b[a-z][a-z0-9+.-]*:\\/\\/)${value(`[^/?#@\\s"'<>]`)}@`,
  "giu",
);
const SECRET_HEADER = new RegExp(
  `(\\b(?:authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-access-token)\\s*:\\s*)([^;\\r\\n"']+)`,
  "giu",
);
const BEARER = new RegExp(
  `(\\b(?:Bearer|Basic)\\s+)${value(`[A-Za-z0-9._~+/=-]`)}`,
  "gu",
);
const WEBHOOK_PATH = new RegExp(
  `(\\bhooks\\.slack\\.com\\/(?:services|workflows|triggers)\\/|\\bdiscord(?:app)?\\.com\\/api\\/webhooks\\/\\d+\\/)${value(`[^?#\\s"'<>]`)}`,
  "giu",
);
const EXPO_TOKEN = new RegExp(
  `(\\bExpo(?:nent)?PushToken\\[)${value(`[^\\]\\s"']`)}(\\])`,
  "gu",
);
const APNS_TOKEN = /\b(apns:)([0-9a-f]{16,})\b/giu;
const LONG_HEX = /\b[0-9a-f]{64,}\b/giu;

const SHOWN_CHARS = new RegExp(`^${SHOWN}$`, "u");

export function redactedLabel(secret: string): string {
  const last = secret.slice(-4);
  return secret.length >= 16 && SHOWN_CHARS.test(last)
    ? `[redacted …${last}]`
    : "[redacted]";
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const isLabel = (text: string) => LABEL.test(decoded(text).trim());
const redactValue = (text: string) =>
  isLabel(text) ? text : redactedLabel(decoded(text).trim());

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET_HEADER, (_match, prefix: string, secret: string) => {
      const trimmed = secret.trimEnd();
      return `${prefix}${redactValue(trimmed)}${secret.slice(trimmed.length)}`;
    })
    .replace(BEARER, (match, prefix: string, secret: string) =>
      secret.length < 8 || !(/\d/u.test(secret) || secret.length >= 20)
        ? match
        : `${prefix}${redactValue(secret)}`,
    )
    .replace(
      SECRET_PARAM,
      (_match, prefix: string, secret: string) =>
        `${prefix}${redactValue(secret)}`,
    )
    .replace(
      URL_USER_INFO,
      (_match, scheme: string, userInfo: string) =>
        `${scheme}${isLabel(userInfo) ? userInfo : "[redacted]"}@`,
    )
    .replace(
      WEBHOOK_PATH,
      (_match, prefix: string, secret: string) =>
        `${prefix}${redactValue(secret)}`,
    )
    .replace(
      EXPO_TOKEN,
      (_match, prefix: string, secret: string, suffix: string) =>
        `${prefix}${redactValue(secret)}${suffix}`,
    )
    .replace(
      APNS_TOKEN,
      (_match, prefix: string, secret: string) =>
        `${prefix}${redactedLabel(secret)}`,
    )
    .replace(LONG_HEX, (secret) => redactedLabel(secret));
}

export function holdsRedactedSecret(text: unknown): boolean {
  return typeof text === "string" && text.includes(REDACTED_LABEL);
}

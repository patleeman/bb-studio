const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;
const CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;
const HYPERLINK = /\u001b\]8;[^;\u0007\u001b]*;(https:\/\/[^\u0007\u001b]+)(?:\u0007|\u001b\\)/u;
const URL_PATTERN = /https:\/\/[^\s\u0007\u001b"'<>]+/u;
const URL_ALL = /https?:\/\/[^\s\u0007\u001b"'<>]+/gu;
const USER_CODE = /(?<![A-Za-z0-9-])[A-Z0-9]{4,5}-[A-Z0-9]{4,5}(?![A-Za-z0-9-])/u;
const PASTE_PROMPT = /paste (?:the |your )?(?:authorization )?code/iu;
const SECRET_PARAM = /^(?:access_token|refresh_token|id_token|token|api_key|apikey|key|secret|client_secret|password|code_verifier)$/iu;

const SECRETS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu,
  /\bsk-[A-Za-z0-9_-]{8,}/gu,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]*)?/gu,
  /\b(?:gh[pousr]|xox[abprs])[-_][A-Za-z0-9_-]{8,}/gu,
  /\b((?:access|refresh|id)[_-]?token|api[_-]?key|secret|password|authorization)\b(["']?\s*[:=]\s*["']?)[^\s"',;]+/giu,
  /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/gu,
];

export interface SignInGuide {
  url: string | null;
  code: string | null;
  acceptsCode: boolean;
}

export function stripTerminal(output: string): string {
  return output.replace(OSC, "").replace(CSI, "").replace(/\r/gu, "");
}

export function safeSignInUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate.replace(/[).,;]+$/u, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  for (const name of url.searchParams.keys()) if (SECRET_PARAM.test(name)) return null;
  if (/(?:access_token|refresh_token|id_token)=/iu.test(url.hash)) return null;
  return url.toString();
}

export function safeUserCode(candidate: string | null | undefined): string | null {
  const text = candidate?.trim() ?? "";
  return /^[A-Z0-9]{3,8}(?:-[A-Z0-9]{3,8})?$/u.test(text) ? text : null;
}

export function signInGuide(output: string): SignInGuide {
  const text = stripTerminal(output);
  const url = safeSignInUrl(HYPERLINK.exec(output)?.[1]) ?? safeSignInUrl(URL_PATTERN.exec(text)?.[0]);
  const rest = text.replace(URL_ALL, " ");
  return { url, code: USER_CODE.exec(rest)?.[0] ?? null, acceptsCode: PASTE_PROMPT.test(rest) };
}

export function redact(text: string): string {
  let out = stripTerminal(text);
  for (const pattern of SECRETS) {
    out = out.replace(pattern, (match, name?: unknown, separator?: unknown) =>
      typeof name === "string" && typeof separator === "string" && match.startsWith(name) ? `${name}${separator}[redacted]` : "[redacted]");
  }
  return out;
}

export function safeMessage(text: string | null | undefined, fallback: string): string {
  const line = redact(text ?? "").split("\n").map((each) => each.trim()).find(Boolean) ?? "";
  if (!line) return fallback;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

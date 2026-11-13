import type { EventProjectionErrorMessage } from "./event-projection-types.js";

const SIGN_IN_TEXT =
  /\b401\b[^\n]*unauthori[sz]ed|\bunauthori[sz]ed\b[^\n]*\b401\b|not logged in|please run \/login|codex login|not signed in|invalid api key/iu;

export function isSignInError(message: EventProjectionErrorMessage): boolean {
  const info = message.providerErrorInfo;
  if (info?.category === "unauthorized" || info?.httpStatusCode === 401) {
    return true;
  }
  return SIGN_IN_TEXT.test(`${message.message}\n${message.detail ?? ""}`);
}

export function signInErrorDisplay(
  message: EventProjectionErrorMessage,
  providerDisplayName: string | undefined,
): { title: string; detail: string } | null {
  if (message.willRetry === true || !isSignInError(message)) return null;
  const name = providerDisplayName?.trim() || "This provider";
  const target = providerDisplayName?.trim() || "it";
  return {
    title: `${name} isn't signed in`,
    detail: `Sign in to ${target}, or pick another model.`,
  };
}

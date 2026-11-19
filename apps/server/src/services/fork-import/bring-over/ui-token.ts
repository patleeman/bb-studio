import { timingSafeEqual } from "node:crypto";

export const UI_TOKEN_HEADER = "x-bb-studio-ui-token";

let token: string | null = null;

export function registerUiToken(candidate: unknown): boolean {
  if (token !== null) return false;
  if (
    typeof candidate !== "string" ||
    candidate.length < 32 ||
    candidate.length > 200
  ) {
    return false;
  }
  token = candidate;
  return true;
}

export function uiTokenMatches(presented: string | undefined | null): boolean {
  if (token === null || typeof presented !== "string") return false;
  const expected = Buffer.from(token);
  const given = Buffer.from(presented);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function resetUiTokenForTests(): void {
  token = null;
}

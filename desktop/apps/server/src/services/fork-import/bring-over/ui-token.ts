import { createHash, timingSafeEqual } from "node:crypto";

export const UI_TOKEN_HEADER = "x-bb-studio-ui-token";
export const UI_TOKEN_HASH_ENV = "BB_STUDIO_UI_TOKEN_SHA256";

let expected: Buffer | null = null;

export function adoptUiTokenHash(
  env: Record<string, string | undefined>,
): void {
  const hash = env[UI_TOKEN_HASH_ENV]?.trim().toLowerCase();
  delete env[UI_TOKEN_HASH_ENV];
  expected =
    hash !== undefined && /^[0-9a-f]{64}$/u.test(hash)
      ? Buffer.from(hash, "hex")
      : null;
}

export function uiTokenConfigured(): boolean {
  return expected !== null;
}

export function uiTokenMatches(presented: string | undefined | null): boolean {
  if (
    expected === null ||
    typeof presented !== "string" ||
    presented.length === 0
  ) {
    return false;
  }
  const given = createHash("sha256").update(presented).digest();
  return timingSafeEqual(expected, given);
}

export function resetUiTokenForTests(): void {
  expected = null;
}

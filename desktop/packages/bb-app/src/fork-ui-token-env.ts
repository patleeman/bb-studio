export const FORK_UI_TOKEN_HASH_ENV = "BB_STUDIO_UI_TOKEN_SHA256";

export function withoutForkUiTokenHash(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const rest = { ...env };
  delete rest[FORK_UI_TOKEN_HASH_ENV];
  return rest;
}

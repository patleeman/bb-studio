export const LEGACY_THEME_ID = "plugin:studio:bb-studio";
export const DEFAULT_THEME_ID = "default";
export const LEGACY_THEME_KV_KEY = "theme.legacy-bb-theme.v1";

export interface LegacyThemeDeps {
  kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  get(): Promise<{ themeId: string }>;
  set(themeId: string): Promise<unknown>;
}

export async function retireLegacyThemeOnce(deps: LegacyThemeDeps): Promise<boolean> {
  if (await deps.kv.get(LEGACY_THEME_KV_KEY)) return false;
  const { themeId } = await deps.get();
  const moved = themeId === LEGACY_THEME_ID;
  if (moved) await deps.set(DEFAULT_THEME_ID);
  await deps.kv.set(LEGACY_THEME_KV_KEY, true);
  return moved;
}

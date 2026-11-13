export const DESKTOP_HUD_ENV = "BB_STUDIO_DESKTOP_HUD";

export function desktopHudEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[DESKTOP_HUD_ENV]?.trim() === "1";
}

export function desktopHudOn(values: { desktopControl?: unknown } | null | undefined): boolean {
  return values?.desktopControl === true;
}

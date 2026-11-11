export type ForkThemeMode = "light" | "dark";

let override: ForkThemeMode | null = null;
const listeners = new Set<() => void>();

export function forkThemeModeOverride(): ForkThemeMode | null {
  return override;
}

export function setForkThemeModeOverride(mode: ForkThemeMode | null): void {
  if (mode === override) return;
  override = mode;
  for (const listener of [...listeners]) listener();
}

export function subscribeForkThemeModeOverride(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

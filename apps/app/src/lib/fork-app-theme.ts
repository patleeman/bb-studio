import { useMemo } from "react";
import type { ExperimentalAppTheme } from "@get-bb/plugin-sdk";
import { useAppThemeEpoch } from "@/hooks/useAppTheme";
import { usePreferredTheme } from "@/hooks/useTheme";

export function usePluginAppTheme(): ExperimentalAppTheme {
  const mode = usePreferredTheme();
  const epoch = useAppThemeEpoch();
  return useMemo(() => ({ mode, epoch }), [epoch, mode]);
}

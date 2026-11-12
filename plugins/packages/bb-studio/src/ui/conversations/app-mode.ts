import { useSyncExternalStore } from "react";
import { hostTheme, subscribeHostTheme } from "../../kit/app/host-theme";

function documentMode(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** BB's light or dark mode: the host's report, else the document's class. */
export function useAppMode(): "light" | "dark" {
  return useSyncExternalStore(subscribeHostTheme, () => hostTheme()?.mode ?? documentMode(), () => "light");
}

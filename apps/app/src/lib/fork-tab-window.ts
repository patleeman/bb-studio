import { createContext, useContext } from "react";
import type { ExperimentalTabWindow } from "@get-bb/plugin-sdk";

export const TabWindowContext = createContext<ExperimentalTabWindow | null>(
  null,
);

export function usePluginTabWindow(): ExperimentalTabWindow | null {
  return useContext(TabWindowContext);
}

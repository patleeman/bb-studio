import { z } from "zod";

export const FORK_UI_PREFERENCE_KEYS = ["workbench.globalTabs"] as const;

export const forkUiPreferenceDefinitions = {
  "workbench.globalTabs": {
    schema: z.array(z.string().min(1).max(1_024)).max(10_000),
    defaultValue: [] as string[],
    description:
      "Tabs in the side panel's Global section, one JSON object per tab.",
  },
} as const;

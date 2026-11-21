import { promptStackSource } from "../../strands/ui/prompt-stack";
import { member } from "../../kit/app/host-sdk";

export const HIDDEN_BB_CHROME = {
  id: "bb-chrome",
  settingsSections: ["mobile"],
  footer: ["builtin:mobile", "builtin:report-bug", "plugin:bb--provider-usage/usage"],
  // Thread by thread (desktop 1.0.12; older BBs ignore it): BB's running children where the strands box shows, and
  // BB's thread context row in a strands conversation, which Studio draws in its Info tab (src/strands/ui/prompt-stack.ts).
  promptStackFor: promptStackSource,
} as const;

export function hideBbChrome(slots: object): boolean {
  const slot = member(slots, "experimental_hideHostEntries");
  if (typeof slot !== "function") return false;
  (slot as (registration: unknown) => void).call(slots, HIDDEN_BB_CHROME);
  return true;
}

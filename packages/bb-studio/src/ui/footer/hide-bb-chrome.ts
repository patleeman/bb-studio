import { member } from "../../kit/app/host-sdk";

export const HIDDEN_BB_CHROME = {
  id: "bb-chrome",
  settingsSections: ["mobile"],
  footer: ["builtin:mobile", "builtin:report-bug", "plugin:bb--provider-usage/usage"],
  // BB's Active child threads list above the composer: the strands box shows a conversation's workers.
  // A child waiting on the user stays in BB's card with its question (desktop 1.0.12's promptStack; older BBs ignore it).
  promptStack: ["active-child-threads"],
} as const;

export function hideBbChrome(slots: object): boolean {
  const slot = member(slots, "experimental_hideHostEntries");
  if (typeof slot !== "function") return false;
  (slot as (registration: unknown) => void).call(slots, HIDDEN_BB_CHROME);
  return true;
}

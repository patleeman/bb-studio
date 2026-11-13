import { member } from "../../kit/app/host-sdk";

export const HIDDEN_BB_CHROME = {
  id: "bb-chrome",
  settingsSections: ["mobile"],
  footer: ["builtin:mobile", "builtin:report-bug", "plugin:bb--provider-usage/usage"],
} as const;

export function hideBbChrome(slots: object): boolean {
  const slot = member(slots, "experimental_hideHostEntries");
  if (typeof slot !== "function") return false;
  (slot as (registration: unknown) => void).call(slots, HIDDEN_BB_CHROME);
  return true;
}

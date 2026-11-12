import { member } from "../../kit/app/host-sdk";

export const HIDDEN_BB_SKILLS = {
  id: "bb-skills",
  navigation: ["__bb__/skills"],
  pages: ["skills"],
  settings: ["cli-skills"],
} as const;

export function hideBbSkills(slots: object): boolean {
  const slot = member(slots, "experimental_hideHostEntries");
  if (typeof slot !== "function") return false;
  (slot as (registration: unknown) => void).call(slots, HIDDEN_BB_SKILLS);
  return true;
}

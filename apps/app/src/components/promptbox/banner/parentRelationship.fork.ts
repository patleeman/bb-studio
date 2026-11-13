export type ParentRelationship = "parent" | "fork" | "reply";

export function parentRelationship(
  originKind: string | null,
  originPluginId: string | null | undefined,
): ParentRelationship {
  if (originKind !== "fork") return "parent";
  return originPluginId ? "reply" : "fork";
}

export const REPLY_SECTION_COPY = {
  verb: "Reply to",
  bodyLead: "This thread replies to ",
  ariaPrefix: "Reply to",
};

export const REPLY_SECTION_ICON = "ArrowTurnBackward";

export function parentRowIcon(relationship: ParentRelationship): string {
  if (relationship === "reply") return REPLY_SECTION_ICON;
  return relationship === "fork" ? "Fork" : "UserRound";
}

export function parentRowLabel(relationship: ParentRelationship): string {
  if (relationship === "reply") return "Reply to";
  return relationship === "fork" ? "Forked from" : "Parent";
}

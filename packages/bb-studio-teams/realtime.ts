export type ChangeEvent = {
  revision: string;
  scope: "all" | "bots";
  id?: string;
};

export function affects(event: unknown, scope: "bots", id?: string): boolean {
  if (!event || typeof event !== "object") return true;
  const change = event as Partial<ChangeEvent>;
  return change.scope === "all" || change.scope === scope && (!id || !change.id || change.id === id);
}

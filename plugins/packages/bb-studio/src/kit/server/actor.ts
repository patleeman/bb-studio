/** A common in-memory identity. Store adapters keep each plugin's existing values. */
export interface Actor {
  kind: "user" | "agent" | "bot" | "cli" | "app" | "editor";
  id?: string;
  name?: string;
}

export function actorName(actor: Actor): string {
  return actor.name?.trim() || actor.id || {
    user: "User",
    agent: "Agent",
    bot: "Bot",
    cli: "CLI",
    app: "App",
    editor: "Editor",
  }[actor.kind];
}

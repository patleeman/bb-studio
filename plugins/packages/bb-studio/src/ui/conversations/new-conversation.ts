// The address of a Bot's + New page (NewConversation.tsx), under the Studio
// panel: `new-conversation/<botId>[/<projectId>]`, the project being the
// Bot's Main's (the composer's starting project).
export const NEW_CONVERSATION_SUBPATH = "new-conversation";

export const newConversationPath = (botId: string, projectId: string | null): string =>
  `${NEW_CONVERSATION_SUBPATH}/${encodeURIComponent(botId)}${projectId ? `/${encodeURIComponent(projectId)}` : ""}`;

/** The Bot and project a `new-conversation/…` path names, or null for any other path. */
export function newConversationRoute(path: string): { botId: string; projectId: string | null } | null {
  const match = new RegExp(`^${NEW_CONVERSATION_SUBPATH}/([^/?#]+)(?:/([^/?#]+))?/?$`).exec(path.replace(/^\/+/, ""));
  if (!match) return null;
  try {
    return { botId: decodeURIComponent(match[1]!), projectId: match[2] ? decodeURIComponent(match[2]) : null };
  } catch {
    return null;
  }
}

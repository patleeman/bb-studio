import type { Attachment } from "./contract";

export const attachmentUrl = (a: Attachment, inline = false) =>
  `/api/v1/plugins/bot-teams/http/attachment?id=${encodeURIComponent(a.id)}${inline ? "&inline=1" : ""}`;

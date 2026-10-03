import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";

export const conversationRecordSchema = z.object({
  id: z.string(), name: z.string(), projectId: z.string(),
  members: z.array(z.object({ kind: z.enum(["bot", "thread"]), id: z.string() })),
  archived: z.boolean().default(false), createdAt: z.number(), updatedAt: z.number(),
});
export type ConversationRecord = z.infer<typeof conversationRecordSchema>;

/** Operates on the migrated Teams database. The module remains the owner of
 * conversation execution and transcript delivery. */
export class OfficeConversations {
  constructor(private readonly db: Database.Database) {}
  list(): ConversationRecord[] {
    return (this.db.prepare("SELECT json FROM conversations ORDER BY rowid").all() as { json: string }[])
      .map(r => conversationRecordSchema.parse(JSON.parse(r.json)));
  }
  get(id: string): ConversationRecord {
    const row = this.db.prepare("SELECT json FROM conversations WHERE id=?").get(id) as { json: string } | undefined;
    if (!row) throw new Error("Conversation no longer exists.");
    return conversationRecordSchema.parse(JSON.parse(row.json));
  }
  /** Exactly one bot defines a DM; explicit thread members do not change it. */
  dm(botId: string, projectId: string, botName: string): ConversationRecord {
    return this.db.transaction(() => {
      const existing = this.list().filter(c => !c.archived && c.projectId === projectId && c.members.filter(m => m.kind === "bot").length === 1 && c.members.some(m => m.kind === "bot" && m.id === botId))
        .sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
      if (existing) return existing;
      const now = Date.now();
      const conversation: ConversationRecord = { id: randomUUID(), name: `Conversation with ${botName}`.slice(0,80), projectId, members:[{kind:"bot",id:botId}], archived:false,createdAt:now,updatedAt:now };
      this.db.prepare("INSERT INTO conversations(id,json,project_id) VALUES (?,?,?)").run(conversation.id,JSON.stringify(conversation),projectId);
      return conversation;
    })();
  }
  attachThread(conversationId: string, threadId: string, botId: string): void {
    const conversation=this.get(conversationId);
    if (!conversation.members.some(m=>m.kind==="bot" && m.id===botId)) throw new Error("Bot is not a member of this conversation.");
    this.db.prepare("INSERT OR IGNORE INTO conversation_threads(conversation_id,thread_id,bot_id) VALUES (?,?,?)").run(conversationId,threadId,botId);
  }
  history(conversationId: string): { source: string; id: string; record: unknown }[] {
    this.get(conversationId);
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='conversation_legacy_records'").get()) return [];
    return (this.db.prepare("SELECT source_table,row_key,payload FROM conversation_legacy_records WHERE conversation_id=? ORDER BY source_table,row_key").all(conversationId) as {source_table:string;row_key:string;payload:string}[])
      .map(r=>({source:r.source_table,id:r.row_key,record:JSON.parse(r.payload)}));
  }
}

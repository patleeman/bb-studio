import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { APNS_MAX_PAYLOAD_BYTES, DEVICE_TTL_MS } from "./apns.js";

type Database = ReturnType<BbPluginApi["storage"]["database"]>;

export const MOBILE_MIGRATIONS: string[] = [
  `CREATE TABLE live_activity_tokens (
    device_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('push-to-start', 'update')),
    token TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, bot_id, kind)
  )`,
];

export const MAX_TOKENS_PER_DEVICE = 64;
export const MAX_TOKENS = 512;

export const LIVE_ACTIVITY_TOKEN_KINDS = ["push-to-start", "update"] as const;
export type LiveActivityTokenKind = (typeof LIVE_ACTIVITY_TOKEN_KINDS)[number];

export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "A device id is 8 to 64 letters, digits and dashes.");
export const botIdSchema = z.string().min(1).max(100);
export const tokenKindSchema = z.enum(LIVE_ACTIVITY_TOKEN_KINDS);
export const activityTokenSchema = z.string().trim().toLowerCase().regex(/^[0-9a-f]{64,200}$/, "A Live Activity token is 64 to 200 hex characters.");

const contentState = z.record(z.string(), z.json());
const alert = z.object({ title: z.string().min(1).max(200), body: z.string().max(1000) });
const epochSeconds = z.number().int().positive();

export const liveActivityPushSchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("start"),
    botId: botIdSchema,
    attributesType: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
    attributes: z.record(z.string(), z.json()),
    contentState,
    alert: alert.optional(),
    staleDate: epochSeconds.optional(),
  }),
  z.strictObject({ event: z.literal("update"), botId: botIdSchema, contentState, alert: alert.optional(), staleDate: epochSeconds.optional() }),
  z.strictObject({ event: z.literal("end"), botId: botIdSchema, contentState, dismissalDate: epochSeconds.optional() }),
]);
export type LiveActivityPush = z.infer<typeof liveActivityPushSchema>;

export interface ActivityToken {
  deviceId: string;
  botId: string;
  kind: LiveActivityTokenKind;
  token: string;
  updatedAt: number;
}

interface Row { device_id: string; bot_id: string; kind: LiveActivityTokenKind; token: string; updated_at: number }

const toToken = (row: Row): ActivityToken => ({ deviceId: row.device_id, botId: row.bot_id, kind: row.kind, token: row.token, updatedAt: row.updated_at });

export class LiveActivityTokens {
  constructor(private readonly db: Database, private readonly now: () => number = Date.now) {}

  register(input: { deviceId: string; botId: string; kind: LiveActivityTokenKind; token: string }): void {
    const now = this.now();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO live_activity_tokens (device_id, bot_id, kind, token, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (device_id, bot_id, kind) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at`)
        .run(input.deviceId, input.botId, input.kind, input.token, now);
      this.prune();
    })();
  }

  unregister(input: { deviceId: string; botId?: string; kind?: LiveActivityTokenKind }): number {
    return this.db.prepare("DELETE FROM live_activity_tokens WHERE device_id = ? AND (? IS NULL OR bot_id = ?) AND (? IS NULL OR kind = ?)")
      .run(input.deviceId, input.botId ?? null, input.botId ?? null, input.kind ?? null, input.kind ?? null).changes;
  }

  forBot(botId: string, kind: LiveActivityTokenKind): ActivityToken[] {
    this.prune();
    return (this.db.prepare("SELECT * FROM live_activity_tokens WHERE bot_id = ? AND kind = ? ORDER BY updated_at DESC").all(botId, kind) as Row[]).map(toToken);
  }

  all(): ActivityToken[] {
    return (this.db.prepare("SELECT * FROM live_activity_tokens ORDER BY device_id, bot_id, kind").all() as Row[]).map(toToken);
  }

  forget(token: ActivityToken): void {
    this.db.prepare("DELETE FROM live_activity_tokens WHERE device_id = ? AND bot_id = ? AND kind = ? AND token = ?").run(token.deviceId, token.botId, token.kind, token.token);
  }

  private prune(): void {
    this.db.prepare("DELETE FROM live_activity_tokens WHERE updated_at < ?").run(this.now() - DEVICE_TTL_MS);
    this.db.prepare(`DELETE FROM live_activity_tokens WHERE rowid IN (
      SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY updated_at DESC, rowid DESC) AS n FROM live_activity_tokens) WHERE n > ?)`).run(MAX_TOKENS_PER_DEVICE);
    this.db.prepare(`DELETE FROM live_activity_tokens WHERE rowid IN (
      SELECT rowid FROM live_activity_tokens ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?)`).run(MAX_TOKENS);
  }
}

export function liveActivityPayload(push: LiveActivityPush, nowMs: number): string {
  const aps: Record<string, unknown> = { timestamp: Math.floor(nowMs / 1000), event: push.event, "content-state": push.contentState };
  if (push.event === "start") { aps["attributes-type"] = push.attributesType; aps.attributes = push.attributes; }
  if (push.event !== "end" && push.alert) aps.alert = push.alert;
  if (push.event !== "end" && push.staleDate !== undefined) aps["stale-date"] = push.staleDate;
  if (push.event === "end" && push.dismissalDate !== undefined) aps["dismissal-date"] = push.dismissalDate;
  const payload = JSON.stringify({ aps });
  if (Buffer.byteLength(payload) > APNS_MAX_PAYLOAD_BYTES) throw new Error(`The Live Activity payload is ${Buffer.byteLength(payload)} bytes; APNs takes at most ${APNS_MAX_PAYLOAD_BYTES}.`);
  return payload;
}

export function liveActivityPriority(push: LiveActivityPush): 5 | 10 {
  return push.event === "update" && !push.alert ? 5 : 10;
}

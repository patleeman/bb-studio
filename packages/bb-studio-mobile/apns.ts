// APNs delivery for BB Studio. BB's push-notifications plugin posts Expo-format
// batches to its relay URL; this module sends `apns:` tokens to Apple and
// answers with Expo-format tickets so the sender's bookkeeping keeps working.
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

export const APNS_TOKEN_PREFIX = "apns:";

export type ExpoMessage = {
  to: string;
  title?: string;
  body?: string;
  sound?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ExpoTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

export type ApnsEnvironment = "production" | "development";

export type ApnsConfig = {
  keyPem: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  /** `auto` tries production first and falls back to development for sandbox tokens. */
  environment: ApnsEnvironment | "auto";
};

export type ApnsResult = { status: number; reason?: string; id?: string };

export type ApnsSend = (
  environment: ApnsEnvironment,
  deviceToken: string,
  payload: string,
  headers: Record<string, string>,
) => Promise<ApnsResult>;

const HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  development: "https://api.sandbox.push.apple.com",
};

/** Accepts a full PEM or just its base64 body, with or without line breaks. */
export function normalizePem(value: string): string {
  const body = value
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** Apple accepts a provider token for up to an hour; refresh well before that. */
export class ProviderToken {
  private key: KeyObject;
  private cached: { token: string; issuedAt: number } | null = null;

  constructor(
    private config: Pick<ApnsConfig, "keyPem" | "keyId" | "teamId">,
    private now: () => number = Date.now,
  ) {
    this.key = createPrivateKey(normalizePem(config.keyPem));
  }

  get(): string {
    const nowSeconds = Math.floor(this.now() / 1000);
    if (this.cached && nowSeconds - this.cached.issuedAt < 45 * 60) {
      return this.cached.token;
    }
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "ES256", kid: this.config.keyId })}.${encode({ iss: this.config.teamId, iat: nowSeconds })}`;
    const signature = sign("sha256", Buffer.from(unsigned), {
      key: this.key,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    this.cached = { token: `${unsigned}.${signature}`, issuedAt: nowSeconds };
    return this.cached.token;
  }
}

/**
 * The app's notification category, which decides the lock-screen actions:
 * Approve/Deny for approvals, Approve plan/Keep planning for plans, and an
 * answer box for questions. Finished turns and errors are plain alerts.
 * `BB_CHOICE` questions also get `mutable-content`, so the app's notification
 * extension can add a button per option. Interaction details come from
 * `enrichInteraction` in server.ts.
 */
export function notificationCategory(data: Record<string, unknown>): string | undefined {
  switch (data.kind) {
    case "pending-interaction": {
      if (typeof data.interactionId !== "string") return undefined;
      if (data.interactionKind === "user_question") {
        return Array.isArray(data.choices) && data.choices.length > 0 ? "BB_CHOICE" : "BB_QUESTION";
      }
      if (data.interactionKind !== "approval") return undefined;
      const decisions = Array.isArray(data.decisions) ? data.decisions : [];
      if (!decisions.includes("allow_once") || !decisions.includes("deny")) return undefined;
      return data.subjectKind === "plan" ? "BB_PLAN" : "BB_APPROVAL";
    }
    default:
      return undefined;
  }
}

/** APNs rejects alert payloads larger than this many bytes (PayloadTooLarge). */
export const APNS_MAX_PAYLOAD_BYTES = 4096;

/** Maps a BB push message onto an APNs payload. The app reads `threadId` on tap. */
export function apnsPayload(message: ExpoMessage): string {
  const body = message.body ?? "";
  const full = renderPayload(message, body);
  if (Buffer.byteLength(full) <= APNS_MAX_PAYLOAD_BYTES) return full;
  // Shorten the body by whole code points so multi-byte text is never split.
  const chars = Array.from(body);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(renderPayload(message, `${chars.slice(0, mid).join("")}…`)) <= APNS_MAX_PAYLOAD_BYTES) low = mid;
    else high = mid - 1;
  }
  return renderPayload(message, `${chars.slice(0, low).join("")}…`);
}

function renderPayload(message: ExpoMessage, body: string): string {
  const data = message.data ?? {};
  const threadId = typeof data.threadId === "string" ? data.threadId : undefined;
  const category = notificationCategory(data);
  return JSON.stringify({
    aps: {
      alert: { title: message.title ?? "BB", body },
      sound: message.sound ?? "default",
      ...(threadId ? { "thread-id": threadId } : {}),
      ...(category ? { category } : {}),
      ...(category === "BB_CHOICE" ? { "mutable-content": 1 } : {}),
    },
    ...data,
  });
}

/** Tokens Apple will never accept again; the sender deletes their subscription rows. */
const GONE_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/** Apple will never accept this token again. */
export function isGoneResult(result: ApnsResult): boolean {
  return result.status === 410 || (result.reason !== undefined && GONE_REASONS.has(result.reason));
}

export type ApnsPush = {
  deviceToken: string;
  payload: string;
  /** `alert` and `background` pushes use the bundle ID; Live Activity pushes use `<bundle>.push-type.liveactivity`. */
  pushType: "alert" | "background" | "liveactivity";
  priority: 5 | 10;
};

/** Sends one push, retrying in the sandbox when `auto` meets a development-build token. */
export async function sendApns(
  push: ApnsPush,
  config: ApnsConfig,
  token: ProviderToken,
  send: ApnsSend,
): Promise<ApnsResult> {
  const headers = {
    authorization: `bearer ${token.get()}`,
    "apns-topic": push.pushType === "liveactivity" ? `${config.bundleId}.push-type.liveactivity` : config.bundleId,
    "apns-push-type": push.pushType,
    "apns-priority": String(push.priority),
  };
  const environments: ApnsEnvironment[] =
    config.environment === "auto" ? ["production", "development"] : [config.environment];
  let result: ApnsResult = { status: 0, reason: "NotSent" };
  for (const environment of environments) {
    result = await send(environment, push.deviceToken, push.payload, headers);
    if (!(result.status === 400 && result.reason === "BadDeviceToken")) break;
  }
  return result;
}

export function isHexToken(value: string): boolean {
  return /^[0-9a-f]{64,200}$/.test(value);
}

export async function deliverApns(
  message: ExpoMessage,
  config: ApnsConfig,
  token: ProviderToken,
  send: ApnsSend,
): Promise<ExpoTicket> {
  const deviceToken = message.to.slice(APNS_TOKEN_PREFIX.length).toLowerCase();
  if (!isHexToken(deviceToken)) {
    return { status: "error", message: "Malformed APNs token", details: { error: "DeviceNotRegistered" } };
  }
  const result = await sendApns(
    { deviceToken, payload: apnsPayload(message), pushType: "alert", priority: 10 },
    config,
    token,
    send,
  );
  if (result.status === 200) return { status: "ok", ...(result.id ? { id: result.id } : {}) };
  const reason = result.reason ?? `HTTP ${result.status}`;
  return {
    status: "error",
    message: `APNs rejected the notification: ${reason}`,
    details: { error: isGoneResult(result) ? "DeviceNotRegistered" : reason },
  };
}

/** One HTTP/2 connection per APNs host, reopened after errors or GOAWAY. */
export class Http2ApnsSender {
  private sessions = new Map<ApnsEnvironment, ClientHttp2Session>();

  send: ApnsSend = (environment, deviceToken, payload, headers) =>
    new Promise((resolve) => {
      let session: ClientHttp2Session;
      try {
        session = this.session(environment);
      } catch (error) {
        resolve({ status: 0, reason: error instanceof Error ? error.message : "ConnectFailed" });
        return;
      }
      const request = session.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        "content-type": "application/json",
        ...headers,
      });
      request.setTimeout(15_000, () => request.close());
      let status = 0;
      let id: string | undefined;
      let body = "";
      request.on("response", (responseHeaders) => {
        status = Number(responseHeaders[":status"] ?? 0);
        const apnsId = responseHeaders["apns-id"];
        id = typeof apnsId === "string" ? apnsId : undefined;
      });
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("error", (error) => resolve({ status: 0, reason: error.message }));
      request.on("close", () => {
        let reason: string | undefined;
        try {
          reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
        } catch {
          reason = undefined;
        }
        resolve({ status, reason: status === 0 ? (reason ?? "Timeout") : reason, id });
      });
      request.end(payload);
    });

  private session(environment: ApnsEnvironment): ClientHttp2Session {
    const existing = this.sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = connect(HOSTS[environment]);
    const forget = () => {
      if (this.sessions.get(environment) === session) this.sessions.delete(environment);
    };
    session.on("error", forget);
    session.on("goaway", forget);
    session.on("close", forget);
    this.sessions.set(environment, session);
    return session;
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }
}

/** Recipients forgotten after this long without a successful push. */
export const DEVICE_TTL_MS = 30 * 86_400_000;

/**
 * The relay's APNs recipients after a delivery: delivered tokens are refreshed,
 * tokens Apple rejects for good are dropped, and stale ones expire.
 */
export function rememberedDevices(
  devices: Record<string, number>,
  messages: ExpoMessage[],
  tickets: ExpoTicket[],
  now: number,
): Record<string, number> {
  const next = { ...devices };
  messages.forEach((message, index) => {
    if (!message.to.startsWith(APNS_TOKEN_PREFIX)) return;
    const ticket = tickets[index];
    if (ticket?.status === "ok") next[message.to] = now;
    else if (ticket?.details?.error === "DeviceNotRegistered") delete next[message.to];
  });
  for (const [to, seen] of Object.entries(next)) if (now - seen > DEVICE_TTL_MS) delete next[to];
  return next;
}

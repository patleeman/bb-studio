import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type {
  ExperimentalApprovalDecision,
  ExperimentalApprovalRequest,
} from "@get-bb/plugin-sdk";
import { ApiError } from "../../errors.js";
import {
  APPROVAL_PUBLIC_KEY_ENV,
  APPROVAL_SESSION_COOKIE,
  ApprovalRefusedError,
  ApprovalRegistry,
} from "./registry.js";

const COOKIE_PATH = "/api/v1/fork/approvals";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TEXT_MAX = 400;
const DETAIL_MAX = 1200;
const ITEMS_MAX = 20;

function publicKeyPemFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const encoded = env[APPROVAL_PUBLIC_KEY_ENV]?.trim();
  if (encoded === undefined || encoded.length === 0) return null;
  try {
    const der = Buffer.from(encoded, "base64url").toString("base64");
    return `-----BEGIN PUBLIC KEY-----\n${der}\n-----END PUBLIC KEY-----\n`;
  } catch {
    return null;
  }
}

let registry: ApprovalRegistry | null = null;

export function forkApprovalRegistry(): ApprovalRegistry {
  registry ??= new ApprovalRegistry({
    publicKeyPem: publicKeyPemFromEnv(process.env),
  });
  return registry;
}

export function setForkApprovalRegistryForTest(
  next: ApprovalRegistry | null,
): void {
  registry = next;
}

function clip(value: unknown, fallback: string, max = TEXT_MAX): string {
  const text = typeof value === "string" ? value.trim() : "";
  return (text.length > 0 ? text : fallback).slice(0, max);
}

export function requestPluginApproval(
  pluginId: string,
  request: ExperimentalApprovalRequest,
): Promise<ExperimentalApprovalDecision> {
  const items = (Array.isArray(request?.items) ? request.items : [])
    .filter(
      (item) => typeof item?.id === "string" && typeof item?.label === "string",
    )
    .slice(0, ITEMS_MAX)
    .map((item) => ({ id: item.id, label: clip(item.label, item.id) }));
  return forkApprovalRegistry().request({
    pluginId,
    title: clip(request?.title, "Approve this?"),
    message: clip(request?.message, ""),
    detail:
      typeof request?.detail === "string"
        ? clip(request.detail, "", DETAIL_MAX)
        : null,
    items,
    confirmLabel: clip(request?.confirmLabel, "Approve").slice(0, 40),
  }).decision;
}

function refuse(error: unknown): never {
  if (error instanceof ApprovalRefusedError) {
    throw new ApiError(
      error.reason === "unknown" || error.reason === "expired" ? 404 : 403,
      error.reason === "unknown" ? "not_found" : "invalid_request",
      error.message,
      { details: { reason: error.reason } },
    );
  }
  throw error;
}

export function registerForkApprovalRoutes(app: Hono): void {
  app.get("/fork/approvals/pending", (context) =>
    context.json({ approvals: forkApprovalRegistry().pending() }),
  );

  app.get("/fork/approvals/session", (context) =>
    context.json({
      approver: forkApprovalRegistry().isApprover(
        getCookie(context, APPROVAL_SESSION_COOKIE) ?? null,
      ),
      desktopChannel: forkApprovalRegistry().hasDesktopChannel(),
    }),
  );

  app.get("/fork/approvals/:id", (context) => {
    const approval = forkApprovalRegistry().get(context.req.param("id"));
    if (approval === null) {
      throw new ApiError(404, "not_found", "This approval is gone.");
    }
    return context.json(approval);
  });

  app.post("/fork/approvals/:id/resolve", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      approved?: unknown;
      picked?: unknown;
      signature?: unknown;
    };
    const decision = {
      approved: body.approved === true,
      picked: Array.isArray(body.picked)
        ? body.picked.filter((item): item is string => typeof item === "string")
        : [],
    };
    try {
      forkApprovalRegistry().resolve(
        context.req.param("id"),
        decision,
        typeof body.signature === "string"
          ? { channel: "desktop", signature: body.signature }
          : {
              channel: "session",
              token: getCookie(context, APPROVAL_SESSION_COOKIE) ?? null,
            },
      );
    } catch (error) {
      refuse(error);
    }
    return context.json({ ok: true });
  });

  app.post("/fork/approvals/pairings", (context) => {
    const agent = clip(context.req.header("user-agent"), "an unknown browser");
    const from = clip(
      context.req.header("x-forwarded-for")?.split(",")[0],
      "this machine",
    );
    try {
      return context.json(
        forkApprovalRegistry().startPairing(`${agent}, from ${from}`),
      );
    } catch (error) {
      throw new ApiError(
        429,
        "invalid_request",
        error instanceof Error ? error.message : "Too many approvals",
      );
    }
  });

  app.post("/fork/approvals/pairings/:id/claim", async (context) => {
    const body = (await context.req.json().catch(() => ({}))) as {
      secret?: unknown;
    };
    const token =
      typeof body.secret === "string"
        ? forkApprovalRegistry().claimPairing(
            context.req.param("id"),
            body.secret,
          )
        : null;
    if (token === null) return context.json({ paired: false });
    setCookie(context, APPROVAL_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(context.req.url).protocol === "https:",
      path: COOKIE_PATH,
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return context.json({ paired: true });
  });
}

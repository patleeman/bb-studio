import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";

type ProviderErrorDelta = Extract<ThreadDelta, { kind: "provider.error" }>;

const AUTH_TEXT = /\b401\b|\bunauthori[sz]ed\b|\bnot logged in\b|\bcodex login\b/iu;
const SIGN_IN_MESSAGE = "Not signed in";

const failedTurnsBySession = new WeakMap<object, Set<string>>();

function isAuthError(delta: ProviderErrorDelta): boolean {
  const info = delta.errorInfo;
  if (info?.category === "unauthorized" || info?.httpStatusCode === 401) {
    return true;
  }
  return AUTH_TEXT.test(`${delta.message}\n${delta.detail ?? ""}`);
}

export interface AuthFailFast {
  deltas: ThreadDelta[];
  interruptTurnId: string | null;
}

export function failFastOnAuthError(
  session: object,
  deltas: readonly ThreadDelta[],
): AuthFailFast {
  let failed = failedTurnsBySession.get(session);
  let interruptTurnId: string | null = null;
  const out: ThreadDelta[] = [];
  for (const delta of deltas) {
    if (delta.kind === "provider.error" && delta.providerTurnId !== undefined) {
      const turnId = delta.providerTurnId;
      if (failed?.has(turnId)) continue;
      if (delta.willRetry === true && isAuthError(delta)) {
        if (failed === undefined) {
          failed = new Set();
          failedTurnsBySession.set(session, failed);
        }
        failed.add(turnId);
        interruptTurnId = turnId;
        out.push({
          ...delta,
          willRetry: false,
          errorInfo: {
            category: "unauthorized",
            providerCode: delta.errorInfo?.providerCode ?? null,
            httpStatusCode: delta.errorInfo?.httpStatusCode ?? 401,
          },
        });
        continue;
      }
    }
    if (
      delta.kind === "turn.boundary" &&
      delta.providerTurnId !== undefined &&
      failed?.delete(delta.providerTurnId) === true
    ) {
      out.push({
        ...delta,
        status: "failed",
        error: delta.error ?? { message: SIGN_IN_MESSAGE },
      });
      continue;
    }
    out.push(delta);
  }
  return { deltas: out, interruptTurnId };
}

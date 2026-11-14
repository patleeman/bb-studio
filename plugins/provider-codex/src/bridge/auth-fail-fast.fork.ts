import type { ThreadDelta } from "@get-bb/plugin-sdk/provider-bridge";

type ProviderErrorDelta = Extract<ThreadDelta, { kind: "provider.error" }>;

const MISSING_CREDENTIALS =
  /\bmissing bearer\b|\bnot logged in\b|\bnot signed in\b|\bplease run `?codex login\b/iu;
const UNAUTHORIZED_TEXT = /\bstatus 401\b|\b401 unauthori[sz]ed\b/iu;
const SIGN_IN_MESSAGE = "Not signed in";

interface SessionAuthState {
  failed: Set<string>;
  unauthorizedStreak: Map<string, number>;
}

const stateBySession = new WeakMap<object, SessionAuthState>();

function stateFor(session: object): SessionAuthState {
  let state = stateBySession.get(session);
  if (state === undefined) {
    state = { failed: new Set(), unauthorizedStreak: new Map() };
    stateBySession.set(session, state);
  }
  return state;
}

function errorText(delta: ProviderErrorDelta): string {
  return `${delta.message}\n${delta.detail ?? ""}`;
}

export function isMissingCredentials(delta: ProviderErrorDelta): boolean {
  return MISSING_CREDENTIALS.test(errorText(delta));
}

export function isUnauthorized(delta: ProviderErrorDelta): boolean {
  const info = delta.errorInfo;
  if (info?.category === "unauthorized" || info?.httpStatusCode === 401) {
    return true;
  }
  return UNAUTHORIZED_TEXT.test(errorText(delta)) || isMissingCredentials(delta);
}

export interface AuthFailFast {
  deltas: ThreadDelta[];
  interruptTurnId: string | null;
}

export function failFastOnAuthError(
  session: object,
  deltas: readonly ThreadDelta[],
): AuthFailFast {
  const state = stateFor(session);
  let interruptTurnId: string | null = null;
  const out: ThreadDelta[] = [];
  for (const delta of deltas) {
    if (delta.kind === "provider.error" && delta.providerTurnId !== undefined) {
      const turnId = delta.providerTurnId;
      if (state.failed.has(turnId)) continue;
      if (delta.willRetry === true) {
        if (!isUnauthorized(delta)) {
          state.unauthorizedStreak.delete(turnId);
          out.push(delta);
          continue;
        }
        const streak = (state.unauthorizedStreak.get(turnId) ?? 0) + 1;
        state.unauthorizedStreak.set(turnId, streak);
        if (isMissingCredentials(delta) || streak >= 2) {
          state.failed.add(turnId);
          state.unauthorizedStreak.delete(turnId);
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
    }
    if (delta.kind === "turn.boundary" && delta.providerTurnId !== undefined) {
      state.unauthorizedStreak.delete(delta.providerTurnId);
      if (state.failed.delete(delta.providerTurnId)) {
        out.push({
          ...delta,
          status: "failed",
          error: delta.error ?? { message: SIGN_IN_MESSAGE },
        });
        continue;
      }
    }
    out.push(delta);
  }
  return { deltas: out, interruptTurnId };
}

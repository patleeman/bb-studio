import type { BbDesktopApi } from "@bb/desktop-contract";

let closeGuard: (() => boolean) | null = null;
const guarded = new WeakMap<BbDesktopApi, BbDesktopApi>();

export function setForkCloseGuard(guard: (() => boolean) | null): void {
  closeGuard = guard;
}

export function withForkCloseGuard(
  info: BbDesktopApi | null,
): BbDesktopApi | null {
  const register = info?.onCloseWindowRequest;
  if (info === null || register === undefined) return info;
  const cached = guarded.get(info);
  if (cached !== undefined) return cached;
  const wrapped: BbDesktopApi = Object.create(info, {
    onCloseWindowRequest: {
      value: (listener: () => boolean) =>
        register.call(info, () => closeGuard?.() === true || listener()),
    },
  });
  guarded.set(info, wrapped);
  return wrapped;
}

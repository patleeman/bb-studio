import { afterEach, describe, expect, it } from "vitest";
import type { BbDesktopApi } from "@bb/desktop-contract";
import { setForkCloseGuard, withForkCloseGuard } from "./bb-desktop.fork";

afterEach(() => {
  setForkCloseGuard(null);
});

function desktop() {
  const listeners = new Set<() => boolean>();
  let version = "1.0.0";
  const info = {
    get latestVersion() {
      return version;
    },
    onCloseWindowRequest(listener: () => boolean) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as BbDesktopApi;
  const request = () => [...listeners].map((listener) => listener());
  return {
    info,
    listeners,
    request,
    bump: () => {
      version = "2.0.0";
    },
  };
}

describe("withForkCloseGuard", () => {
  it("lets the close fallback answer a close request before every view's own handler", () => {
    const { info, request } = desktop();
    const calls: string[] = [];
    const wrapped = withForkCloseGuard(info);
    wrapped?.onCloseWindowRequest?.(() => {
      calls.push("view");
      return true;
    });
    let handled = false;
    setForkCloseGuard(() => handled);
    expect(request()).toEqual([true]);
    expect(calls).toEqual(["view"]);
    handled = true;
    expect(request()).toEqual([true]);
    expect(calls).toEqual(["view"]);
  });

  it("keeps the desktop API's other members live, returns one wrapper per API, and unsubscribes", () => {
    const { info, listeners, bump } = desktop();
    const wrapped = withForkCloseGuard(info);
    expect(withForkCloseGuard(info)).toBe(wrapped);
    expect(wrapped?.latestVersion).toBe("1.0.0");
    bump();
    expect(wrapped?.latestVersion).toBe("2.0.0");
    const off = wrapped?.onCloseWindowRequest?.(() => false);
    expect(listeners.size).toBe(1);
    off?.();
    expect(listeners.size).toBe(0);
    expect(withForkCloseGuard(null)).toBeNull();
  });
});

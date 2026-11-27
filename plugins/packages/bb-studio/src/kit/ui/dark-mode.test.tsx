// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useDarkMode } from "./dark-mode";

function Probe({ id }: { id: string }) {
  const dark = useDarkMode();
  return <span data-testid={id}>{dark ? "dark" : "light"}</span>;
}

describe("useDarkMode", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark");
  });

  it("tracks dark class changes on documentElement and body across multiple subscribers", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<><Probe id="a" /><Probe id="b" /></>);
    });
    const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent;
    expect(text("a")).toBe("light");
    expect(text("b")).toBe("light");

    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });
    expect(text("a")).toBe("dark");
    expect(text("b")).toBe("dark");

    await act(async () => {
      document.documentElement.classList.remove("dark");
      document.body.classList.add("dark");
      await Promise.resolve();
    });
    expect(text("a")).toBe("dark");

    await act(async () => {
      document.body.classList.remove("dark");
      await Promise.resolve();
    });
    expect(text("a")).toBe("light");

    await act(async () => { root.unmount(); });
    host.remove();
  });
});

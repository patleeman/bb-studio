import { describe, expect, it } from "vitest";
import { checkScript, parseVerdict, reviewTargets, reviewerPrompt } from "./review";

describe("the reviewer", () => {
  const screens = [
    { id: "1a", viewport: "desktop" as const, steps: [], url: "/s?screen=1a" },
    { id: "1b", viewport: "mobile" as const, steps: [{ id: "welcome", label: "Welcome" }, { id: "done", label: "All set" }], url: "/s?screen=1b" },
  ];

  it("checks desktop screens at a phone's width too, and every step", () => {
    expect(reviewTargets("http://127.0.0.1:1", screens).map((target) => [target.label, target.url, target.width])).toEqual([
      ["1a at desktop", "http://127.0.0.1:1/s?screen=1a", 1280],
      ["1a at mobile", "http://127.0.0.1:1/s?screen=1a", 390],
      ["1b · Welcome at mobile", "http://127.0.0.1:1/s?screen=1b#welcome", 390],
      ["1b · All set at mobile", "http://127.0.0.1:1/s?screen=1b#done", 390],
    ]);
  });

  it("gives the reviewer a check script that parses", () => {
    const script = checkScript(reviewTargets("http://x", screens).slice(0, 2));
    // DevBrowser runs scripts as an async body.
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    expect(() => new AsyncFunction("browser", script)).not.toThrow();
  });

  it("batches the targets two to a run", () => {
    const prompt = reviewerPrompt({ designName: "Onboarding", designId: "dsn_1", round: 1, screens: screens.map((screen) => ({ ...screen, caption: "" })), targets: reviewTargets("http://x", screens), hostId: "host_1", rules: "rules" });
    expect(prompt.match(/^Batch \d+/gm)).toEqual(["Batch 1", "Batch 2"]);
    expect(prompt).toContain("--machine host_1");
    expect(prompt.trim().endsWith("how you know.")).toBe(true);
  });

  it("reads the verdict from the last line that names one", () => {
    expect(parseVerdict("Looks fine.\nVERDICT: done")).toEqual({ verdict: "done", findings: "Looks fine." });
    expect(parseVerdict("- 1b · Welcome: button is 30px tall\n\n`VERDICT: needs_work`\n")).toEqual({ verdict: "needs_work", findings: "- 1b · Welcome: button is 30px tall" });
    expect(parseVerdict("I ran out of time.").verdict).toBeNull();
  });
});

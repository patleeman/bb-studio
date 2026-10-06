// The design reviewer: a separate agent, in a hidden thread, that checks a
// round of screens with fresh eyes before the user relies on it. It loads
// each frame headlessly at its size (desktop screens at a phone's width too),
// measures what a person shouldn't have to (overflow, small targets, console
// errors, steps that don't open), looks at the screenshots against the design
// rules, and ends with a verdict. Only "needs work" reaches the design's
// thread; "done" stays quiet.
import { VIEWPORTS, type ScreenStep, type Viewport } from "../shared";

export type ReviewState = {
  state: "reviewing" | "done" | "needs_work" | "failed";
  round: number | null;
  screens: string[];
  at: number;
  /** The findings for "needs_work", or why a review failed. */
  summary: string | null;
};

/** One thing the reviewer loads: a screen, or one step of it, at one size. */
export type ReviewTarget = { label: string; url: string; width: number; height: number };

export function reviewTargets(baseUrl: string, screens: { id: string; viewport: Viewport; steps: ScreenStep[]; url: string }[]): ReviewTarget[] {
  const targets: ReviewTarget[] = [];
  for (const screen of screens) {
    const frames = screen.steps.length ? screen.steps.map((step) => ({ label: `${screen.id} · ${step.label}`, url: `${screen.url}#${encodeURIComponent(step.id)}` })) : [{ label: screen.id, url: screen.url }];
    const sizes = screen.viewport === "desktop" ? (["desktop", "mobile"] as const) : [screen.viewport];
    for (const frame of frames)
      for (const size of sizes) targets.push({ label: `${frame.label} at ${size}`, url: baseUrl + frame.url, ...VIEWPORTS[size] });
  }
  return targets;
}

/**
 * The check the reviewer runs with `bb browser-automation run`. TARGETS is
 * filled in per run (at most two, since a run returns at most four
 * screenshots and each target takes one).
 */
export function checkScript(targets: ReviewTarget[], batch = 1): string {
  return `const TARGETS = ${JSON.stringify(targets)};
const BATCH = ${batch};
const page = await browser.getPage("review");
const results = [];
for (const target of TARGETS) {
  const errors = [];
  const onConsole = (m) => { if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text()); };
  const onError = (e) => errors.push(String(e.message || e));
  page.on("console", onConsole);
  page.on("pageerror", onError);
  await page.setViewport({ width: target.width, height: target.height });
  await page.goto("about:blank");
  await page.goto(target.url, { waitUntil: "networkidle2", timeout: 20000 }).catch((e) => errors.push("load: " + e.message));
  await new Promise((r) => setTimeout(r, 600));
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + ((el.textContent || "").trim() ? " \\"" + el.textContent.trim().slice(0, 30) + "\\"" : "");
    const all = [...document.querySelectorAll("body *")].filter(visible);
    return {
      blank: !(document.body && document.body.innerText.trim()) && !document.querySelector("img, svg, canvas, video"),
      horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
      overflowing: all.filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1).slice(0, 6).map(name),
      smallTargets: [...document.querySelectorAll("button, a[href], input, select, textarea, [role=button]")].filter(visible)
        .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).slice(0, 8)
        .map((el) => name(el) + " " + Math.round(el.getBoundingClientRect().width) + "x" + Math.round(el.getBoundingClientRect().height)),
      clippedText: all.filter((el) => el.children.length === 0 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && getComputedStyle(el).overflow !== "visible").slice(0, 6).map(name),
    };
  });
  // Unique per batch: runs share a folder, and a reused name overwrites an earlier screenshot.
  const shot = await page.shot({ name: "review-" + BATCH + "-" + results.length + ".jpg" });
  page.off("console", onConsole);
  page.off("pageerror", onError);
  results.push({ target: target.label, ...layout, consoleErrors: [...new Set(errors)].slice(0, 6), screenshot: shot.path });
}
console.log(JSON.stringify(results, null, 2));`;
}

export const VERDICT_DONE = "VERDICT: done";
export const VERDICT_NEEDS_WORK = "VERDICT: needs_work";

export function reviewerPrompt(input: {
  designName: string;
  designId: string;
  round: number | null;
  screens: { id: string; caption: string; viewport: Viewport; steps: ScreenStep[] }[];
  targets: ReviewTarget[];
  hostId: string;
  rules: string;
}): string {
  const batches: ReviewTarget[][] = [];
  for (let index = 0; index < input.targets.length; index += 2) batches.push(input.targets.slice(index, index + 2));
  return [
    `You are the reviewer for the design "${input.designName}" (id ${input.designId})${input.round ? `, round ${input.round}` : ""}. Another agent made these screens; check them with fresh eyes before the user relies on them. Don't change anything: report.`,
    "",
    "Screens:",
    ...input.screens.map((screen) => `- ${screen.id} (${screen.viewport})${screen.caption ? `: ${screen.caption}` : ""}${screen.steps.length ? ` · steps: ${screen.steps.map((step) => step.label).join(", ")}` : ""}`),
    "",
    "How to check:",
    `1. Open a headless browser: \`bb browser-automation open --backend local --machine ${input.hostId} --headless --json\`. Note the session id.`,
    `2. For each batch below, save the script to a file in your workspace and run it: \`bb browser-automation run <session> --script-file <path> --script-host ${input.hostId} --timeout 90s --json\`. Each run returns its measurements and the screenshots; look at every screenshot.`,
    "3. Close the session with `bb browser-automation close <session>` when you're done, even if something failed.",
    "",
    ...batches.flatMap((batch, index) => [`Batch ${index + 1} (${batch.map((target) => target.label).join("; ")}):`, "```js", checkScript(batch, index + 1), "```", ""]),
    "What counts as a real problem:",
    "- A screen or step that doesn't load, is blank, throws console errors, or doesn't open at its step.",
    "- Content that runs off the screen or scrolls sideways at its size; text cut off; touch targets under 44px on a phone.",
    "- Clear breaks of the design rules below, visible in the screenshots.",
    "- Something that obviously doesn't work as the caption says.",
    "Ignore nitpicks and matters of taste. Measurements are hints: confirm them in the screenshot before reporting.",
    "",
    "Design rules the screens should follow:",
    input.rules,
    "",
    "End your reply with exactly one of these as the last line:",
    `- \`${VERDICT_DONE}\` when nothing real needs fixing.`,
    `- \`${VERDICT_NEEDS_WORK}\` when something does. Put the findings just above it: one short bullet each, naming the screen (and step), what's wrong, and how you know.`,
  ].join("\n");
}

/** The reviewer's verdict from its last reply; the findings are what came before the verdict line. */
export function parseVerdict(output: string): { verdict: "done" | "needs_work" | null; findings: string } {
  const lines = output.trim().split("\n");
  let index = -1;
  for (let at = lines.length - 1; at >= 0 && index === -1; at--) if (/VERDICT:\s*(done|needs_work)/i.test(lines[at]!)) index = at;
  if (index === -1) return { verdict: null, findings: output.trim() };
  const verdict = /needs_work/i.test(lines[index]!) ? "needs_work" : "done";
  return { verdict, findings: lines.slice(0, index).join("\n").trim() };
}

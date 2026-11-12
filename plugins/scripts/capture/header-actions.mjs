// Clicking a plugin's header action in a thread's header. Since SDK 0.6.104
// these are BB's labelled outline buttons: the first as a button, the rest
// in the split button's "More actions" menu (or the thread menu when narrow).
import { sleep } from "./bb.mjs";

export const HEADER = '[data-testid="app-page-header-content-row"]';

/** Waits up to `timeoutMs` for a header action whose label matches `pattern` (a RegExp source), and clicks it. */
export async function clickHeaderAction(client, pattern, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await client.evaluate(`(() => {
      const label = new RegExp(${JSON.stringify(pattern)});
      const header = document.querySelector(${JSON.stringify(HEADER)});
      if (!header) return "none";
      const buttons = [...header.querySelectorAll("button")].filter((each) => each.offsetParent);
      const direct = buttons.find((each) => label.test(each.textContent.trim()));
      if (direct) { direct.click(); return "clicked"; }
      const more = buttons.find((each) => each.getAttribute("aria-label") === "More actions");
      if (!more) return "none";
      more.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
      more.click();
      return "menu";
    })()`);
    if (found === "clicked") return;
    if (found === "menu") {
      await sleep(400);
      const picked = await client.evaluate(`(() => {
        const label = new RegExp(${JSON.stringify(pattern)});
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((each) => label.test(each.textContent.trim()));
        if (!item) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return false; }
        item.click();
        return true;
      })()`);
      if (picked) return;
    }
    await sleep(300);
  }
  throw new Error(`No header action matching /${pattern}/ in the thread header`);
}

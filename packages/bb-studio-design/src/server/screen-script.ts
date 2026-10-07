// The script the screen route adds to every screen. Screens run sandboxed
// with an opaque origin, so the canvas can't look inside them; this script
// answers it over postMessage instead. In comment mode it outlines the
// element under the pointer and reports the one clicked; on request it
// reports where pinned elements are, so the canvas can place their pins.
// Messages carry `bbDesign` so the screen's own messages pass untouched.
// Bump SCREEN_SCRIPT_VERSION (src/shared.ts) whenever this script changes.

/**
 * Runs inside the screen. Plain JavaScript in a string, not a compiled
 * function, so bundler helpers never leak into the page.
 */
const SCREEN_AGENT = String.raw`(() => {
  const MARK = "data-bb-design-ui";
  let commenting = false;
  /** Edit mode: click an element's text to type over it. */
  let editing = false;
  let outline = null;
  const post = (message) => window.parent.postMessage(Object.assign({ bbDesign: true }, message), "*");

  // Its id when unique, else a tag path from the nearest unique id or the body.
  function selectorFor(element) {
    const parts = [];
    let node = element;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.id && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
        parts.unshift("#" + CSS.escape(node.id));
        return parts.join(" > ");
      }
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === node.tagName) : [];
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")" : tag);
      node = parent;
    }
    return parts.length ? "body > " + parts.join(" > ") : "body";
  }

  function rectOf(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height };
  }

  function target(event) {
    const element = event.target instanceof Element ? event.target : null;
    return element && !element.closest("[" + MARK + "]") && element !== document.documentElement ? element : null;
  }

  function showOutline(element) {
    if (!outline) {
      outline = document.createElement("div");
      outline.setAttribute(MARK, "");
      outline.style.cssText = "position:absolute;pointer-events:none;z-index:2147483647;border:2px solid #4f7cff;border-radius:3px;background:rgba(79,124,255,.08);transition:all .06s";
      document.body.appendChild(outline);
    }
    if (!element) { outline.style.display = "none"; return; }
    const rect = rectOf(element);
    Object.assign(outline.style, { display: "block", left: (rect.x - 2) + "px", top: (rect.y - 2) + "px", width: (rect.width + 4) + "px", height: (rect.height + 4) + "px" });
  }

  // Only elements that hold text alone can be edited in place; others take a comment.
  function editable(element) {
    if (!element || element.children.length || element.closest("script, style, textarea, select, [" + MARK + "]")) return null;
    return (element.textContent || "").trim() ? element : null;
  }

  function startEdit(element) {
    const before = element.innerHTML;
    const original = element.innerText;
    showOutline(null);
    element.setAttribute("contenteditable", "plaintext-only");
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      element.removeAttribute("contenteditable");
      element.removeEventListener("keydown", onKey, true);
      const text = element.innerText;
      if (!save) element.innerHTML = before;
      else if (text.trim() !== original.trim()) post({ type: "text", before: before, text: text });
    };
    const onKey = (event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); finish(false); element.blur(); }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); element.blur(); }
    };
    element.addEventListener("keydown", onKey, true);
    element.addEventListener("blur", () => finish(true), { once: true });
  }

  document.addEventListener("mouseover", (event) => {
    if (commenting) showOutline(target(event));
    else if (editing && !document.activeElement?.isContentEditable) showOutline(editable(target(event)));
  }, true);
  document.addEventListener("click", (event) => {
    if (editing) {
      const element = editable(target(event));
      if (element?.isContentEditable) return;
      event.preventDefault();
      event.stopPropagation();
      if (element) startEdit(element);
      else post({ type: "not-editable" });
      return;
    }
    if (!commenting) return;
    const element = target(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const html = element.outerHTML;
    post({
      type: "pick",
      selector: selectorFor(element),
      html: html.length > 4000 ? html.slice(0, 4000) + "…" : html,
      text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300),
      rect: rectOf(element),
    });
  }, true);

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || !data.bbDesign) return;
    if (data.type === "mode") {
      commenting = Boolean(data.on);
      editing = !commenting && Boolean(data.edit);
      document.documentElement.style.cursor = commenting ? "crosshair" : editing ? "text" : "";
      if (!commenting && !editing) showOutline(null);
    }
    if (data.type === "locate") {
      const rects = {};
      for (const selector of data.selectors || []) {
        let found = null;
        try { found = document.querySelector(selector); } catch (error) { /* A stale selector finds nothing. */ }
        rects[selector] = found ? rectOf(found) : null;
      }
      post({ type: "rects", rects });
    }
  });

  // Live screens sit on a pan-and-zoom canvas. Gestures the screen can't use
  // itself (pinch, ⌘/Ctrl-scroll, scrolling past an edge) go to the canvas.
  function canScroll(node, dx, dy) {
    for (let element = node instanceof Element ? node : null; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      const scrollable = (overflow) => /(auto|scroll|overlay)/.test(overflow) || element === document.scrollingElement;
      if (dy && scrollable(style.overflowY) && element.scrollHeight > element.clientHeight + 1 &&
        ((dy < 0 && element.scrollTop > 0) || (dy > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1))) return true;
      if (dx && scrollable(style.overflowX) && element.scrollWidth > element.clientWidth + 1 &&
        ((dx < 0 && element.scrollLeft > 0) || (dx > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1))) return true;
    }
    return false;
  }
  window.addEventListener("wheel", (event) => {
    const zoom = event.ctrlKey || event.metaKey;
    if (!zoom && canScroll(event.target, event.deltaX, event.deltaY)) return;
    event.preventDefault();
    post({ type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY, zoom: zoom, x: event.clientX, y: event.clientY });
  }, { passive: false });

  // Space held outside a text field lets the canvas pan by dragging.
  const typing = (target) => target instanceof Element && Boolean((target.closest("input, textarea, select") || (target instanceof HTMLElement && target.isContentEditable)));
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !event.repeat && !typing(event.target)) { event.preventDefault(); post({ type: "space", down: true }); }
  });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") post({ type: "space", down: false }); });

  post({ type: "ready" });
})();`;

const SCRIPT = `<script data-bb-design-ui>${SCREEN_AGENT}</script>`;

/** The screen's HTML with the canvas script added before `</body>`, or at the end. */
export function withScreenScript(html: string): string {
  const close = html.toLowerCase().lastIndexOf("</body>");
  return close === -1 ? `${html}\n${SCRIPT}` : `${html.slice(0, close)}${SCRIPT}${html.slice(close)}`;
}

import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Check local Markdown links and images; external URLs and anchors are out of scope. */
export async function localLinkErrors(file, text) {
  const errors = [];
  for (const [, target] of text.matchAll(/\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const link = target.replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(link)) continue;
    let path;
    try { path = decodeURIComponent(link.split(/[?#]/)[0]); }
    catch { errors.push(`${file}: invalid link ${link}`); continue; }
    if (path && !(await stat(resolve(dirname(file), path)).then(() => true, () => false))) errors.push(`${file}: links to missing ${link}`);
  }
  return errors;
}

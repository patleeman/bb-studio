export * from "./studio-cli-env.fork.js";
import { STUDIO_CLI_NAME } from "./studio-cli-env.fork.js";

const CODE_FENCE = /^\s*(```|~~~)/u;
const BB_COMMAND = /(^|[\s(|&;`$"'])bb(?= +[a-z][\w-]*)/gu;

function renameInCode(code: string): string {
  return code.replace(BB_COMMAND, `$1${STUDIO_CLI_NAME}`);
}

/**
 * Rewrites `bb <command>` invocations in Markdown code (fenced blocks and
 * inline code spans, which may wrap across lines) as `bbs <command>`, for text
 * Studio's CLI prints, such as `bbs guide`. Prose that names bb is left as it
 * is.
 */
export function toStudioCommandText(text: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let inFence = false;
  const flushProse = (): void => {
    if (prose.length === 0) return;
    out.push(
      prose
        .join("\n")
        .replace(/`([^`]+)`/gu, (_span, code: string) => `\`${renameInCode(code)}\``),
    );
    prose = [];
  };
  for (const line of text.split("\n")) {
    if (CODE_FENCE.test(line)) {
      flushProse();
      inFence = !inFence;
      out.push(line);
    } else if (inFence) {
      out.push(renameInCode(line));
    } else {
      prose.push(line);
    }
  }
  flushProse();
  return out.join("\n");
}

/** A rendered guide chapter with its commands named `bbs`. */
export function toStudioGuide<T extends { content: string }>(rendered: T): T {
  return { ...rendered, content: toStudioCommandText(rendered.content) };
}

// Text made ready to speak: hands-free voice reads thread replies out
// (live.ts). It came from the old voice mode, removed on Nov 1.

/** Text as it should be heard: markdown marks, code and links reduced to words. */
export function speakable(text: string): string {
  return text
    // BB draws directives (::next{…}, ::page{…}) as cards and buttons; they aren't words.
    .replace(/^[ \t]*::[\w-]+\{[^\n]*\}[ \t]*$/gm, "")
    .replace(/::[\w-]+\{[^}\n]*\}/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, " (code left out) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, "$2")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

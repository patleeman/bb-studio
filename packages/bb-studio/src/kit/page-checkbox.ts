/** A page checkbox with its stable BlockNote id. */
export interface PageCheckbox {
  blockId: string;
  checked: boolean;
  title: string;
  line: string;
}

export function pageCheckboxes(markdown: string): PageCheckbox[] {
  const found: PageCheckbox[] = [];
  const pattern = /<!-- \^([a-zA-Z0-9]{8}) -->\n([ \t]*- \[([ xX])\] ([^\n]*))/g;
  for (const match of markdown.matchAll(pattern)) {
    found.push({ blockId: match[1]!, checked: match[3]!.toLowerCase() === "x", title: match[4]!.trim(), line: match[2]! });
  }
  return found;
}

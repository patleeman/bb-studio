/** A page checkbox with its stable BlockNote id and optional linked task. */
export interface PageCheckbox {
  blockId: string;
  checked: boolean;
  title: string;
  taskId: string | null;
  line: string;
}

export function pageCheckboxes(markdown: string): PageCheckbox[] {
  const found: PageCheckbox[] = [];
  const pattern = /<!-- \^([a-zA-Z0-9]{8}) -->\n([ \t]*- \[([ xX])\] ([^\n]*))/g;
  for (const match of markdown.matchAll(pattern)) {
    const line = match[2]!;
    const taskId = /\]\(item:studio-tasks:(tsk_[a-z0-9]+)\)/.exec(line)?.[1] ?? null;
    found.push({ blockId: match[1]!, checked: match[3]!.toLowerCase() === "x",
      title: match[4]!.replace(/\s*\[[^\]]+\]\(item:studio-tasks:tsk_[a-z0-9]+\)/, "").trim(), taskId, line });
  }
  return found;
}

export function setPageCheckbox(line: string, checked: boolean): string {
  return line.replace(/(- \[)[ xX](\])/, `$1${checked ? "x" : " "}$2`);
}

import { readFileSync, writeFileSync } from "node:fs";

const IMPORT_LINE =
  /^\s*(?:$|import\b|export\s+(?:\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\b|\}\s*from\s|["'][^"']+["'];?$|(?:type\s+)?[\w$]+(?:\s+as\s+[\w$]+)?,?$|[\w$\s,{}*]+,$)/;

const isImportBlock = (lines) => lines.every((line) => IMPORT_LINE.test(line));

export function resolveImportConflicts(text) {
  const lines = text.split("\n");
  const out = [];
  let resolved = 0;
  let unresolved = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.startsWith("<<<<<<< ")) {
      out.push(line);
      continue;
    }
    const ours = [];
    const base = [];
    const theirs = [];
    let section = ours;
    let end = index + 1;
    let sawBase = false;
    for (; end < lines.length; end++) {
      const current = lines[end];
      if (current.startsWith("||||||| ")) {
        section = base;
        sawBase = true;
      } else if (current === "=======") section = theirs;
      else if (current.startsWith(">>>>>>> ")) break;
      else section.push(current);
    }
    const block = lines.slice(index, end + 1);
    if (
      !sawBase ||
      end >= lines.length ||
      !isImportBlock(ours) ||
      !isImportBlock(base) ||
      !isImportBlock(theirs)
    ) {
      out.push(...block);
      unresolved++;
      index = end;
      continue;
    }
    const baseSet = new Set(base.map((each) => each.trim()));
    const oursSet = new Set(ours.map((each) => each.trim()));
    const added = theirs.filter(
      (each) =>
        each.trim() !== "" &&
        !baseSet.has(each.trim()) &&
        !oursSet.has(each.trim()),
    );
    out.push(...added, ...ours);
    resolved++;
    index = end;
  }
  return { text: out.join("\n"), resolved, unresolved };
}

export function resolveImportConflictsInFile(path) {
  const before = readFileSync(path, "utf8");
  const result = resolveImportConflicts(before);
  if (result.resolved > 0) writeFileSync(path, result.text);
  return result;
}

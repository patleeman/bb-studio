import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, readlink, symlink, writeFile, link, rm, chmod } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Rebuild paths embedded in JSON, URI strings, backup headers and SQLite values. */
export function rebuildPaths(text: string, source: string, target: string): string {
  const pairs = [
    [source, target],
    [pathToFileURL(source).href, pathToFileURL(target).href],
    [encodeURIComponent(source), encodeURIComponent(target)],
    [JSON.stringify(source).slice(1, -1), JSON.stringify(target).slice(1, -1)],
  ].sort((a, b) => b[0]!.length - a[0]!.length);
  // Replace only path prefixes, never similarly named sibling directories.
  for (const [from, to] of pairs) {
    const escaped = from!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`${escaped}(?=/|%2[fF]|["'\\s?#]|$)`, "g"), () => to!);
  }
  return text;
}
const absent = async (path: string) => !(await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; }));

/**
 * Publish a file only after transformation. A crash leaves no partial destination;
 * a retry skips acknowledged files and keeps every existing destination file.
 */
export async function copyCodeFiles(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const identities = new Map<string, string>();
  const remember = (uri: string) => {
    const next = rebuildPaths(uri, source, target);
    if (next === uri) return;
    const pairs = [[uri, next]];
    // https://github.com/microsoft/vscode/blob/main/src/vs/platform/workspaces/node/workspaces.ts
    // VS Code's node identifier hashes native file paths (lowercase on macOS),
    // while remote URIs hash their serialized URI. Recognize both existing forms.
    if (uri.startsWith("file:")) {
      const from = fileURLToPath(uri), to = fileURLToPath(next);
      pairs.push([from, to], [from.toLowerCase(), to.toLowerCase()]);
    }
    for (const [from, to] of pairs) identities.set(createHash("md5").update(from!).digest("hex"), createHash("md5").update(to!).digest("hex"));
  };
  async function inventory(dir: string): Promise<void> {
    if (await absent(dir)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await inventory(file);
      else if (entry.isFile() && entry.name.endsWith(".code-workspace")) remember(pathToFileURL(file).href);
      else if (entry.isFile() && entry.name === "workspace.json" && basename(dirname(dir)) === "workspaceStorage") {
        const doc = JSON.parse(await readFile(file, "utf8")) as { workspace?: string };
        if (doc.workspace) remember(doc.workspace);
      }
    }
  }
  await inventory(join(source, "workspaces"));
  const rebuild = (text: string) => {
    text = rebuildPaths(text, source, target);
    for (const [from, to] of identities) text = text.replace(new RegExp(`(?<![a-f0-9])${from}(?![a-f0-9])`, "g"), to);
    return text;
  };
  async function copy(from: string, to: string): Promise<void> {
    const info = await lstat(from);
    if (info.isDirectory()) {
      if (!(await absent(to)) && !(await lstat(to)).isDirectory()) throw new Error(`Migration destination is not a directory: ${to}`);
      await mkdir(to, { recursive: true });
      for (const name of await readdir(from)) {
        // Sockets and launch credentials are recreated; recovery and WAL files stay.
        if (/\.vscdb(?:\.backup)?-(?:wal|shm)$/.test(name) || name === "code-server.yaml" || name === "bridge-token" || name.endsWith(".sock")) continue;
        // Storage and Backup directory names use the workspace's derived id.
        const destinationName = identities.get(name) ?? name;
        await copy(join(from, name), join(to, destinationName));
      }
      return;
    }
    if (!(await absent(to))) return;
    if (info.isSymbolicLink()) {
      const value = await readlink(from);
      const referenced = resolve(dirname(from), value);
      const rebuilt = rebuild(referenced);
      const mapped = isAbsolute(value) ? rebuilt : relative(dirname(to), rebuilt) || ".";
      // Preserve external extension links as references, without reading their targets.
      await symlink(mapped, to).catch((error) => { if (error.code !== "EEXIST") throw error; });
      return;
    }
    if (!info.isFile()) return;
    const temporary = join(dirname(to), `.studio-copy-${randomUUID()}`);
    try {
      if (/\.vscdb(?:\.backup)?$/.test(from)) {
        // A SQLite backup includes committed WAL state; never edit the source.
        const db = new Database(from, { readonly: true, fileMustExist: true });
        try { await db.backup(temporary); } finally { db.close(); }
        const copied = new Database(temporary);
        try {
          if (copied.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ItemTable'").get()) {
            const rows = copied.prepare("SELECT key, value FROM ItemTable").all() as { key: string; value: string | Buffer }[];
            const update = copied.prepare("UPDATE ItemTable SET key = ?, value = ? WHERE key = ?");
            copied.transaction(() => {
              for (const row of rows) {
                const value = Buffer.isBuffer(row.value) ? row.value.toString("utf8") : row.value;
                const next = Buffer.isBuffer(row.value)
                  ? Buffer.from(value).equals(row.value) ? Buffer.from(rebuild(value)) : row.value
                  : rebuild(value);
                update.run(rebuild(row.key), next, row.key);
              }
            })();
          }
        } finally { copied.close(); }
      } else {
        const bytes = await readFile(from);
        // Only losslessly decoded text is rewritten. Executables and other binaries stay exact.
        const text = bytes.toString("utf8");
        const rebuilt = !text.includes("\0") && Buffer.from(text).equals(bytes) ? Buffer.from(rebuild(text)) : bytes;
        await writeFile(temporary, rebuilt, { flag: "wx", mode: info.mode & 0o777 });
      }
      await chmod(temporary, info.mode & 0o777);
      await link(temporary, to).catch((error) => { if (error.code !== "EEXIST") throw error; });
    } finally { await rm(temporary, { force: true }); }
  }
  // Never copy the plugin's database or migration markers, only editor-owned files.
  for (const name of ["workspaces", "extensions", "code-server", "watchdog.cjs"]) {
    const from = join(source, name);
    if (!(await absent(from))) await copy(from, join(target, name));
  }
}

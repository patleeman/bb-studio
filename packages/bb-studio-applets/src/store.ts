// Applets on disk. Each applet is a folder `<root>/<id>/` with a
// manifest.json and its files; the shell loads the same folders. Approved
// capabilities live in `<root>/grants.json`, and the shell writes each
// applet's console and API errors to `<root>/.logs/<id>.log`.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APPLET_ID, newCapabilities, parseManifest, type AppletManifest } from "./manifest";

export const MAX_FILES = 64;
export const MAX_FILE_BYTES = 512 * 1024;
const LOG_TAIL_BYTES = 64 * 1024;

export function defaultRoot(): string {
  return join(homedir(), ".bb-studio", "applets");
}

export type AppletFile = { path: string; content: string };

export type AppletInfo = {
  id: string;
  dir: string;
  manifest: AppletManifest | null;
  errors: string[];
  granted: string[];
  /** Capabilities the manifest asks for that the user hasn't approved yet. */
  pending: string[];
};

type Grants = Record<string, string[]>;

/** A relative path that stays inside the applet folder, or null. */
export function safeRelative(path: string): string | null {
  const parts = path.replace(/\\/g, "/").replace(/^(\.\/)+/, "").split("/");
  if (parts.some((part) => part === "" || part.startsWith("."))) return null;
  return parts.join("/");
}

export class AppletStore {
  constructor(readonly root: string) {}

  dir(id: string): string {
    if (!APPLET_ID.test(id)) throw new Error(`Invalid applet id "${id}"`);
    return join(this.root, id);
  }

  async list(): Promise<AppletInfo[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const grants = await this.grants();
    const ids = entries.filter((entry) => entry.isDirectory() && APPLET_ID.test(entry.name)).map((entry) => entry.name).sort();
    return Promise.all(ids.map((id) => this.info(id, grants)));
  }

  async get(id: string): Promise<AppletInfo | null> {
    const exists = await stat(join(this.dir(id), "manifest.json")).then(() => true, () => false);
    return exists ? this.info(id, await this.grants()) : null;
  }

  private async info(id: string, grants: Grants): Promise<AppletInfo> {
    const dir = this.dir(id);
    const granted = grants[id] ?? [];
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    } catch (error) {
      return { id, dir, manifest: null, errors: [`manifest.json: ${error instanceof Error ? error.message : String(error)}`], granted, pending: [] };
    }
    const parsed = parseManifest(raw);
    if (!parsed.ok) return { id, dir, manifest: null, errors: parsed.errors, granted, pending: [] };
    const errors = parsed.manifest.id === id ? [] : [`id: "${parsed.manifest.id}" doesn't match the folder name "${id}"`];
    return { id, dir, manifest: parsed.manifest, errors, granted, pending: newCapabilities(parsed.manifest.capabilities, granted) };
  }

  /**
   * Write files into an applet folder. A manifest, if given, is validated
   * first, and nothing is written when it or any path is invalid.
   */
  async write(id: string, files: readonly AppletFile[], manifest?: unknown): Promise<AppletInfo> {
    const dir = this.dir(id);
    if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files per call`);
    const writes: AppletFile[] = [];
    for (const file of files) {
      const path = safeRelative(file.path);
      if (!path) throw new Error(`Invalid file path "${file.path}": use a relative path inside the applet`);
      if (path === "manifest.json") throw new Error("Pass the manifest as `manifest`, not as a file");
      if (Buffer.byteLength(file.content) > MAX_FILE_BYTES) throw new Error(`${path} is over ${MAX_FILE_BYTES / 1024} KB`);
      writes.push({ path, content: file.content });
    }
    if (manifest !== undefined) {
      const parsed = parseManifest(manifest);
      if (!parsed.ok) throw new Error(`Invalid manifest:\n${parsed.errors.join("\n")}`);
      if (parsed.manifest.id !== id) throw new Error(`Manifest id "${parsed.manifest.id}" must be "${id}"`);
      writes.push({ path: "manifest.json", content: `${JSON.stringify(parsed.manifest, null, 2)}\n` });
    } else if (!(await this.get(id))) {
      throw new Error(`Applet "${id}" doesn't exist yet; pass a manifest to create it`);
    }
    for (const file of writes) await atomicWrite(join(dir, file.path), file.content);
    const info = await this.get(id);
    if (!info) throw new Error(`Applet "${id}" has no manifest`);
    return info;
  }

  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
    const grants = await this.grants();
    delete grants[id];
    await this.saveGrants(grants);
  }

  async grant(id: string, capabilities: readonly string[]): Promise<AppletInfo> {
    const info = await this.get(id);
    if (!info?.manifest) throw new Error(`Applet "${id}" isn't valid`);
    const allowed = capabilities.filter((capability) => info.manifest!.capabilities.includes(capability));
    const grants = await this.grants();
    grants[id] = [...new Set([...(grants[id] ?? []), ...allowed])].sort();
    await this.saveGrants(grants);
    return (await this.get(id))!;
  }

  async revoke(id: string): Promise<void> {
    const grants = await this.grants();
    delete grants[id];
    await this.saveGrants(grants);
  }

  async logs(id: string): Promise<string> {
    this.dir(id);
    const text = await readFile(join(this.root, ".logs", `${id}.log`), "utf8").catch(() => "");
    return text.length > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text;
  }

  private async grants(): Promise<Grants> {
    try {
      const parsed = JSON.parse(await readFile(join(this.root, "grants.json"), "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((c) => typeof c === "string")),
      );
    } catch {
      return {};
    }
  }

  private async saveGrants(grants: Grants): Promise<void> {
    await atomicWrite(join(this.root, "grants.json"), `${JSON.stringify(grants, null, 2)}\n`);
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
}

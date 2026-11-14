import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { HostSettings } from "./handle";

type Values = Record<string, unknown>;

export function pluginSecretsDir(dataDir: string, pluginId: string): string {
  return join(dataDir, "plugins", pluginId, "secrets");
}

export class StudioKeyStore implements HostSettings {
  private values: Record<string, string> = {};
  private readonly listeners = new Set<(next: Values, prev: Values) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string, private readonly keys: readonly string[]) {}

  private path(key: string): string {
    return join(this.dir, key);
  }

  private async read(): Promise<Record<string, string>> {
    const next: Record<string, string> = {};
    for (const key of this.keys) {
      try {
        next[key] = await readFile(this.path(key), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        next[key] = "";
      }
    }
    return next;
  }

  async get(): Promise<Values> {
    this.values = await this.read();
    return { ...this.values };
  }

  current(): Values {
    return { ...this.values };
  }

  async status(): Promise<Record<string, boolean>> {
    const values = await this.get();
    return Object.fromEntries(this.keys.map((key) => [key, String(values[key] ?? "").trim() !== ""]));
  }

  experimental_set(patch: Values): Promise<Values> {
    const run = this.queue.then(async () => {
      for (const [key, value] of Object.entries(patch)) {
        if (!this.keys.includes(key)) throw new Error(`There's no Studio API key called ${key}.`);
        if (value !== null && typeof value !== "string") throw new Error(`${key} needs text.`);
        if (typeof value === "string" && /[\r\n]/.test(value.trim())) throw new Error(`${key} must be one line.`);
      }
      const prev = { ...this.values };
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      for (const [key, value] of Object.entries(patch)) {
        const text = typeof value === "string" ? value.trim() : "";
        if (!text) {
          await rm(this.path(key), { force: true });
          continue;
        }
        const temp = `${this.path(key)}.${randomBytes(6).toString("hex")}.tmp`;
        try {
          await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
          await rename(temp, this.path(key));
        } catch (error) {
          await rm(temp, { force: true });
          throw error;
        }
      }
      const next = await this.get();
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        for (const listener of this.listeners) {
          try { listener({ ...next }, prev); } catch { continue; }
        }
      }
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  onChange(listener: (next: Values, prev: Values) => void): void {
    this.listeners.add(listener);
  }
}

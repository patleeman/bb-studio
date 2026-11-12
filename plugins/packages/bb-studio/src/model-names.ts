// A model's display name, as BB's composer picker shows it: the provider's
// model catalog's `displayName` ("Opus 5.5"), else BB's own fallback for a
// model the catalog doesn't list (formatModelName, a port of BB's
// formatUnknownModelLabel in apps/app/src/components/pickers/unknownModelLabel.fork.ts).
// The catalog is read once per provider and kept for a while; lookups are
// synchronous, so a list never waits on a model probe.

const DROPPED_LEADING_WORDS: ReadonlySet<string> = new Set(["claude"]);

/** "claude-opus-5-5" → "Opus 5.5", "gpt-5.1-codex" → "gpt 5.1 Codex": BB's label for a model its catalog doesn't name. */
export function formatModelName(model: string): string {
  const parts = model.trim().split(/[-_\s]+/u).filter(Boolean);
  if (parts.length === 0) return model;
  const words: string[] = [];
  for (const part of parts) {
    const previous = words.at(-1);
    if (/^\d+$/u.test(part) && previous !== undefined && /^[\d.]+$/u.test(previous)) words[words.length - 1] = `${previous}.${part}`;
    else words.push(part);
  }
  const shown = words.length > 1 && DROPPED_LEADING_WORDS.has(words[0]!.toLowerCase()) ? words.slice(1) : words;
  return shown.map((word) => (/^[a-z]+$/u.test(word) && word.length > 3 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word)).join(" ");
}

type CatalogModel = { id?: string | null; model?: string | null; displayName?: string | null };

export class ModelNames {
  private readonly catalogs = new Map<string, { names: Map<string, string>; at: number }>();
  private readonly loading = new Set<string>();

  constructor(private readonly load: (providerId: string) => Promise<readonly CatalogModel[]>, private readonly ttlMs = 10 * 60_000, private readonly now = () => Date.now()) {}

  /** The model's display name: its provider's catalog name when known, else BB's fallback. */
  name(providerId: string | null | undefined, model: string): string {
    const named = providerId ? this.catalogs.get(providerId)?.names.get(model) : undefined;
    return named || formatModelName(model);
  }

  /** Reads the provider's catalog in the background, unless a fresh one is kept or a read is under way. */
  warm(providerId: string | null | undefined): Promise<void> {
    if (!providerId || this.loading.has(providerId)) return Promise.resolve();
    const kept = this.catalogs.get(providerId);
    if (kept && this.now() - kept.at < this.ttlMs) return Promise.resolve();
    this.loading.add(providerId);
    let pending: Promise<readonly CatalogModel[]>;
    try { pending = this.load(providerId); } catch (error) { pending = Promise.reject(error); }
    return pending.then((models) => {
      const names = new Map<string, string>();
      for (const each of models) {
        const label = each.displayName?.trim();
        if (!label) continue;
        for (const key of [each.model, each.id]) if (key && !names.has(key)) names.set(key, label);
      }
      this.catalogs.set(providerId, { names, at: this.now() });
    }, () => {
      // No catalog (the provider is offline or unknown): the fallback names it.
    }).finally(() => { this.loading.delete(providerId); });
  }
}

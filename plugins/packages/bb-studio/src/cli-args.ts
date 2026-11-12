// Strict arguments for `bb studio`: every `--flag` must be one the command
// knows, and an option's value can't be another flag. Without this, a typo or
// a flag missing its value fell into the list query or the items to move.

export interface CliSpec {
  /** Flags that stand alone, e.g. `--json`. */
  flags?: readonly string[];
  /** Options that take the next word as their value, e.g. `--space <name>`. */
  options?: readonly string[];
}

export type CliArgs =
  | { ok: true; flags: Set<string>; options: Map<string, string>; positional: string[] }
  | { ok: false; error: string };

export function parseCliArgs(argv: readonly string[], spec: CliSpec): CliArgs {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (spec.flags?.includes(arg)) {
      flags.add(arg);
      continue;
    }
    if (!spec.options?.includes(arg)) return { ok: false, error: `Unknown option ${arg}.` };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${arg} needs a value.` };
    if (options.has(arg)) return { ok: false, error: `${arg} was given twice.` };
    options.set(arg, value);
    index++;
  }
  return { ok: true, flags, options, positional };
}

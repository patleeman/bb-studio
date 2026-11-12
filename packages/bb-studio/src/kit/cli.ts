/** Parse long flags without consuming a positional value after boolean flags. */
export function parseFlags(
  argv: readonly string[],
  booleans: readonly string[] = [],
): { positional: string[]; values: Record<string, string | undefined> } {
  const positional: string[] = [];
  const values: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("--")) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--") && !booleans.includes(arg.slice(2))) {
        values[arg.slice(2)] = next;
        index += 1;
      } else {
        values[arg.slice(2)] = "";
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, values };
}

export function subcommand(argv: readonly string[]): { command: string | undefined; rest: string[] } {
  return { command: argv[0], rest: argv.slice(1) };
}

export function usage(line: string): { exitCode: 1; stderr: string } {
  return { exitCode: 1, stderr: `usage: ${line}\n` };
}

/** Consume one known flag from a mutable argv, as the older CLIs do. */
export function takeFlag(argv: string[], flag: string): boolean {
  const index = argv.indexOf(flag);
  if (index < 0) return false;
  argv.splice(index, 1);
  return true;
}

/** Consume a known option and its following word, retaining CLI behavior. */
export function takeOption(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const [, value] = argv.splice(index, 2);
  return value;
}

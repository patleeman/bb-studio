const DROPPED_LEADING_WORDS: ReadonlySet<string> = new Set(["claude"]);

export function formatUnknownModelLabel(model: string): string {
  const parts = model
    .trim()
    .split(/[-_\s]+/u)
    .filter(Boolean);
  if (parts.length === 0) return model;
  const words: string[] = [];
  for (const part of parts) {
    const previous = words.at(-1);
    if (
      /^\d+$/u.test(part) &&
      previous !== undefined &&
      /^[\d.]+$/u.test(previous)
    ) {
      words[words.length - 1] = `${previous}.${part}`;
    } else {
      words.push(part);
    }
  }
  const shown =
    words.length > 1 && DROPPED_LEADING_WORDS.has(words[0]!.toLowerCase())
      ? words.slice(1)
      : words;
  return shown
    .map((word) =>
      /^[a-z]+$/u.test(word) && word.length > 3
        ? `${word[0]!.toUpperCase()}${word.slice(1)}`
        : word,
    )
    .join(" ");
}

export function triggerReasoningLabel(args: {
  hasSelectedModel: boolean;
  modelKnown: boolean;
  optionLabel: string | undefined;
  storedLabel: string;
}): string | null {
  if (!args.hasSelectedModel) return null;
  if (args.optionLabel !== undefined) return args.optionLabel;
  return args.modelKnown ? null : args.storedLabel;
}

export const FORK_PERMISSION_COMPACT_LABELS = false;

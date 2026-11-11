import type { PromptInput } from "@bb/domain";
import type { ExperimentalTurnContextProvider } from "@get-bb/plugin-sdk";

export const TURN_CONTEXT_TIMEOUT_MS = 500;
export const TURN_CONTEXT_MAX_CHARS = 8000;

const providers = new Map<string, ExperimentalTurnContextProvider>();

export function registerTurnContextProvider(
  pluginId: string,
  provider: ExperimentalTurnContextProvider,
): () => void {
  providers.set(pluginId, provider);
  return () => {
    if (providers.get(pluginId) === provider) providers.delete(pluginId);
  };
}

function bounded(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return trimmed.length > TURN_CONTEXT_MAX_CHARS
    ? `${trimmed.slice(0, TURN_CONTEXT_MAX_CHARS - 1)}…`
    : trimmed;
}

export async function collectTurnContext(
  threadId: string,
): Promise<PromptInput[]> {
  if (providers.size === 0) return [];
  const entries = [...providers.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const answers = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TURN_CONTEXT_TIMEOUT_MS);
  });
  const work = Promise.all(
    entries.map(async ([pluginId, provider]) => {
      try {
        const text = bounded(await provider({ threadId }));
        if (text !== null) answers.set(pluginId, text);
      } catch {
        return;
      }
    }),
  );
  try {
    await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
  const items: PromptInput[] = [];
  for (const [pluginId] of entries) {
    const text = answers.get(pluginId);
    if (text === undefined) continue;
    items.push({
      type: "text",
      text: `Context from the ${pluginId} plugin at the start of this turn:\n\n${text}`,
      mentions: [],
      visibility: "agent-only",
    });
  }
  return items;
}

interface TurnPrompt {
  input: PromptInput[];
  inputGroups?: PromptInput[][];
}

export async function withTurnContext<T extends TurnPrompt>(
  threadId: string,
  prompt: T,
  startsTurn = true,
): Promise<T> {
  if (!startsTurn || prompt.input.length === 0) return prompt;
  const context = await collectTurnContext(threadId);
  if (context.length === 0) return prompt;
  const groups = prompt.inputGroups;
  return {
    ...prompt,
    input: [...prompt.input, ...context],
    ...(groups !== undefined && groups.length > 0
      ? {
          inputGroups: [
            ...groups.slice(0, -1),
            [...groups[groups.length - 1]!, ...context],
          ],
        }
      : {}),
  };
}

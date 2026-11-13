import type { AvailableModel, ReasoningLevel } from "@bb/domain";
import { resolveModelReasoningLevel } from "@/hooks/thread-creation-options/model-catalog-selection";

export interface ProviderModelPick {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
}

export type ProviderModelPickHandler = (pick: ProviderModelPick) => void;

export function previewPick(args: {
  providerId: string;
  model: string;
  reasoningLevel?: ReasoningLevel;
  preferredReasoningLevel: ReasoningLevel;
  catalog:
    | {
        models: readonly AvailableModel[];
        selectedOnlyModels: readonly AvailableModel[];
      }
    | undefined;
}): ProviderModelPick {
  const found = [
    ...(args.catalog?.models ?? []),
    ...(args.catalog?.selectedOnlyModels ?? []),
  ].find((candidate) => candidate.model === args.model);
  return {
    providerId: args.providerId,
    model: args.model,
    reasoningLevel:
      args.reasoningLevel ??
      resolveModelReasoningLevel(found, args.preferredReasoningLevel),
  };
}

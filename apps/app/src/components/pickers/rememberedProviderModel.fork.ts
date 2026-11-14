import { useEffect } from "react";
import { usePromptBoxModelPreference } from "@/hooks/thread-creation-options/persisted-selection-fields";

const lastModelByProvider = new Map<string, string>();

export function noteProviderModel(providerId: string, model: string): void {
  if (providerId.length === 0 || model.length === 0) return;
  lastModelByProvider.set(providerId, model);
}

export function rememberedProviderModel(
  providerId: string | null,
  stored: string,
): string {
  if (providerId === null || providerId.length === 0) return "";
  return lastModelByProvider.get(providerId) ?? stored;
}

export function useRememberedProviderModel(
  previewProviderId: string | null,
  selectedProviderId: string,
  selectedModel: string,
): string {
  useEffect(() => {
    noteProviderModel(selectedProviderId, selectedModel);
  }, [selectedProviderId, selectedModel]);
  const stored = usePromptBoxModelPreference(previewProviderId ?? "").value;
  return rememberedProviderModel(previewProviderId, stored);
}

export function forgetRememberedProviderModels(): void {
  lastModelByProvider.clear();
}

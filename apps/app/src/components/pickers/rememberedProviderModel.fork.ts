import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { SYSTEM_EXECUTION_OPTIONS_QUERY_KEY } from "@/hooks/queries/query-keys";
import { usePromptBoxModelPreference } from "@/hooks/thread-creation-options/persisted-selection-fields";

const lastModelByProvider = new Map<string, string>();

export function modelBelongsToProvider(
  queryClient: QueryClient,
  providerId: string,
  model: string,
): boolean {
  const cached = queryClient.getQueriesData<SystemExecutionOptionsResponse>({
    queryKey: [SYSTEM_EXECUTION_OPTIONS_QUERY_KEY],
  });
  return cached.some(([key, data]) => {
    if (key[3] !== providerId || data === undefined) return false;
    if (data.modelLoadError !== null) return false;
    return [...data.models, ...data.selectedOnlyModels].some(
      (candidate) => candidate.model === model,
    );
  });
}

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
  const queryClient = useQueryClient();
  const shown = useRef({ providerId: "", model: "" });
  useEffect(() => {
    const previous = shown.current;
    shown.current = { providerId: selectedProviderId, model: selectedModel };
    const providerMovedAhead =
      previous.providerId !== "" &&
      previous.providerId !== selectedProviderId &&
      previous.model === selectedModel;
    if (providerMovedAhead) return;
    if (modelBelongsToProvider(queryClient, selectedProviderId, selectedModel)) {
      noteProviderModel(selectedProviderId, selectedModel);
    }
  }, [queryClient, selectedProviderId, selectedModel]);
  const stored = usePromptBoxModelPreference(previewProviderId ?? "").value;
  return rememberedProviderModel(previewProviderId, stored);
}

export function forgetRememberedProviderModels(): void {
  lastModelByProvider.clear();
}

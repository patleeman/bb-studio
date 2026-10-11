import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { modelSelectionSchema, type ModelSelection } from "@bb-studio/kit/decisions-contract";
import type { ModelPreferences, ModelPurpose } from "../shared/contract";

/** Studio's KV key for a purpose's model; the Talk plugin used `model:<purpose>`. */
export const modelKey = (purpose: ModelPurpose) => `talk:model:${purpose}`;

/** Store each purpose independently so editing one never overwrites another. */
export function talkModels(bb: BbPluginApi) {
  async function get(purpose: ModelPurpose): Promise<ModelSelection | null> {
    const saved = await bb.storage.kv.get(modelKey(purpose));
    const parsed = modelSelectionSchema.safeParse(saved);
    return parsed.success ? parsed.data : null;
  }
  async function all(): Promise<ModelPreferences> {
    const [cleanup, title, summary] = await Promise.all([get("cleanup"), get("title"), get("summary")]);
    return { cleanup, title, summary };
  }
  async function set(purpose: ModelPurpose, selection: ModelSelection | null): Promise<void> {
    await bb.storage.kv.set(modelKey(purpose), selection);
  }
  return {
    get,
    set,
    handlers: {
      "recordings.models.get": all,
      "recordings.models.set": async ({ purpose, selection }: { purpose: ModelPurpose; selection: ModelSelection | null }) => {
        await set(purpose, selection);
        return all();
      },
      // Seed once from a real provider default. The native picker owns catalog
      // discovery and reconciliation for all subsequent changes.
      "recordings.models.suggest": async (): Promise<ModelSelection | null> => {
        for (const provider of (await bb.sdk.providers.list()).filter((entry) => entry.available)) {
          const options = await bb.sdk.providers.models({ providerId: provider.id }).catch(() => null);
          const model = options?.models.find((entry) => entry.isDefault) ?? options?.models[0];
          if (!model) continue;
          const efforts = model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
          return {
            providerId: provider.id,
            model: model.model,
            reasoningLevel: efforts.includes("none") ? "none" : efforts.includes("low") ? "low" : model.defaultReasoningEffort,
          };
        }
        return null;
      },
    },
  };
}

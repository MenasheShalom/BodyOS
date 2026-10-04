import { useAiSettings, useSaveAiSettings } from "../../lib/queries";
import type { AiFeature } from "../../lib/types";

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  fake: "a test model",
};

export const providerName = (provider: string | null) =>
  provider ? (PROVIDER_NAMES[provider] ?? provider) : "the AI provider";

/** Whether the one-time notice for `feature` still has to be shown, and a way to accept it. */
export function usePrivacyGate(feature: AiFeature) {
  const settings = useAiSettings();
  const save = useSaveAiSettings();
  const needed = !!settings.data && !settings.data.acknowledged.includes(feature);
  const accept = () =>
    settings.data
      ? save.mutateAsync({
          ...settings.data,
          acknowledged: [...settings.data.acknowledged, feature],
        })
      : Promise.resolve(undefined);
  return { ready: !!settings.data, needed, accept, saving: save.isPending };
}

import { syncPromptInjection } from "./promptInjection";
import type { BetterSimTrackerSettings, STContext, TrackerData } from "./types";

export function createPromptRefreshController(input: {
  getSettings: () => BetterSimTrackerSettings | null;
  getLatestData: () => TrackerData | null;
  getLatestPromptMacroData: () => TrackerData | null;
  pushTrace: (event: string, payload?: Record<string, unknown>) => void;
  refreshFromStoredData: () => void;
  syncPromptInjectionFn?: typeof syncPromptInjection;
}): {
  queuePromptSync: (context: STContext) => void;
  scheduleRefresh: (delay?: number) => void;
} {
  let refreshTimer: number | null = null;
  let lastPromptSyncSignature = "";
  const syncPromptInjectionFn = input.syncPromptInjectionFn ?? syncPromptInjection;

  return {
    queuePromptSync(context: STContext): void {
      const settings = input.getSettings();
      const latestData = input.getLatestData();
      const latestPromptMacroData = input.getLatestPromptMacroData();
      if (!settings) return;
      const customPrivacySignature = (settings.customStats ?? [])
        .slice(0, 12)
        .map(stat => [
          stat.id,
          stat.kind ?? "numeric",
          stat.includeInInjection ? 1 : 0,
          stat.track ? 1 : 0,
          stat.trackCharacters ? 1 : 0,
          stat.trackUser ? 1 : 0,
          stat.privateToOwner ? 1 : 0,
        ].join(":"))
        .join("|");
      const signature = [
        settings.enabled ? "1" : "0",
        settings.injectTrackerIntoPrompt ? "1" : "0",
        settings.enableUserTracking ? "1" : "0",
        settings.includeUserTrackerInInjection ? "1" : "0",
        settings.trackMood ? "1" : "0",
        settings.trackLastThought ? "1" : "0",
        settings.lastThoughtPrivate ? "1" : "0",
        settings.userTrackMood ? "1" : "0",
        settings.userTrackLastThought ? "1" : "0",
        customPrivacySignature,
        latestData?.timestamp ?? 0,
        context.groupId ?? "",
        context.characterId ?? "",
      ].join("|");
      if (signature === lastPromptSyncSignature) {
        input.pushTrace("prompt.sync.skip", { reason: "signature_unchanged" });
        return;
      }
      input.pushTrace("prompt.sync", {
        hasData: Boolean(latestData),
        groupId: context.groupId ?? null,
        characterId: context.characterId ?? null,
      });
      lastPromptSyncSignature = signature;
      void syncPromptInjectionFn({
        context,
        settings,
        data: latestPromptMacroData,
      });
    },

    scheduleRefresh(delay = 80): void {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        input.pushTrace("refresh.run", { delay });
        input.refreshFromStoredData();
      }, delay);
    },
  };
}

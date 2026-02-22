import type { BetterSimTrackerSettings, STContext, StatKey } from "./types";

type SlashRegisterObject = (command: Record<string, unknown>) => void;

type SlashCommandDeps = {
  getContext: () => STContext | null;
  getSettings: () => BetterSimTrackerSettings | null;
  setSettings: (next: BetterSimTrackerSettings) => void;
  getLatestMessageIndex: () => number | null;
  isExtracting: () => boolean;
  runExtraction: (reason: string, messageIndex?: number) => Promise<void>;
  refreshFromStoredData: () => void;
  clearCurrentChat: () => void;
  queuePromptSync: (context: STContext) => void;
  saveSettings: (context: STContext, next: BetterSimTrackerSettings) => void;
  pushTrace?: (event: string, details?: Record<string, unknown>) => void;
};

const COMMAND_PREFIX = "/bst";

function notify(message: string, type: "info" | "success" | "warning" | "error" = "info"): void {
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  const toastr = anyGlobal.toastr as Record<string, unknown> | undefined;
  const handler = toastr?.[type];
  if (typeof handler === "function") {
    handler(message, "BetterSimTracker");
  } else {
    console.log(`[BetterSimTracker] ${message}`);
  }
}

function parseArgs(raw: string): string[] {
  if (!raw) return [];
  return raw.trim().split(/\s+/).filter(Boolean);
}

function formatEnabledStats(settings: BetterSimTrackerSettings): string {
  const enabled: string[] = [];
  if (settings.trackAffection) enabled.push("affection");
  if (settings.trackTrust) enabled.push("trust");
  if (settings.trackDesire) enabled.push("desire");
  if (settings.trackConnection) enabled.push("connection");
  if (settings.trackMood) enabled.push("mood");
  if (settings.trackLastThought) enabled.push("lastThought");
  for (const stat of settings.customStats ?? []) {
    if (!stat.track) continue;
    enabled.push(stat.id);
  }
  return enabled.length ? enabled.join(", ") : "none";
}

function resolveBuiltInToggleKey(raw: string): StatKey | null {
  const key = raw.toLowerCase();
  if (key === "affection") return "affection";
  if (key === "trust") return "trust";
  if (key === "desire") return "desire";
  if (key === "connection") return "connection";
  if (key === "mood") return "mood";
  if (key === "lastthought" || key === "last_thought" || key === "thought") return "lastThought";
  return null;
}

function updateSetting(settings: BetterSimTrackerSettings, key: StatKey, next: boolean): BetterSimTrackerSettings {
  const copy = { ...settings };
  if (key === "affection") copy.trackAffection = next;
  if (key === "trust") copy.trackTrust = next;
  if (key === "desire") copy.trackDesire = next;
  if (key === "connection") copy.trackConnection = next;
  if (key === "mood") copy.trackMood = next;
  if (key === "lastThought") copy.trackLastThought = next;
  return copy;
}

function updateCustomTrackSetting(
  settings: BetterSimTrackerSettings,
  id: string,
  next: boolean,
): BetterSimTrackerSettings {
  const normalized = id.trim().toLowerCase();
  return {
    ...settings,
    customStats: (settings.customStats ?? []).map(stat =>
      stat.id === normalized ? { ...stat, track: next } : stat),
  };
}

function coerceArgs(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(" ");
  if (raw == null) return "";
  return String(raw);
}

function renderHelp(): string {
  return [
    "Commands:",
    `${COMMAND_PREFIX} status`,
    `${COMMAND_PREFIX} extract`,
    `${COMMAND_PREFIX} clear`,
    `${COMMAND_PREFIX} toggle <stat>`,
    `${COMMAND_PREFIX} inject on|off`,
    `${COMMAND_PREFIX} debug on|off`,
  ].join(" ");
}

export function registerSlashCommands(deps: SlashCommandDeps): void {
  const attemptRegister = (): boolean => {
    const context = deps.getContext();
    if (!context) return false;
    const anyContext = context as unknown as Record<string, unknown>;
    const SlashCommandParser = anyContext.SlashCommandParser as { addCommandObject?: SlashRegisterObject } | undefined;
    const SlashCommand = anyContext.SlashCommand as { fromProps?: (props: Record<string, unknown>) => Record<string, unknown> } | undefined;
    const ARGUMENT_TYPE = anyContext.ARGUMENT_TYPE as { STRING?: string } | undefined;
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return false;

  const withContext = (): { context: STContext; settings: BetterSimTrackerSettings } | null => {
    const context = deps.getContext();
    const settings = deps.getSettings();
    if (!context || !settings) return null;
    return { context, settings };
  };

  const handleStatus = (): void => {
    const resolved = withContext();
    if (!resolved) {
      notify("Tracker context not ready.", "warning");
      return;
    }
    const { settings } = resolved;
    const enabled = formatEnabledStats(settings);
    const mode = settings.sequentialExtraction ? "sequential" : "unified";
    const inject = settings.injectTrackerIntoPrompt ? "on" : "off";
    const debug = settings.debug ? "on" : "off";
    const latestIndex = deps.getLatestMessageIndex();
    notify(`Status: stats=${enabled}; mode=${mode}; inject=${inject}; debug=${debug}; last=${latestIndex ?? "none"}`);
  };

  const handleExtract = async (): Promise<void> => {
    if (deps.isExtracting()) {
      notify("Extraction already running.", "warning");
      return;
    }
    await deps.runExtraction("manual_refresh");
  };

  const handleClear = (): void => {
    deps.clearCurrentChat();
    notify("Tracker data cleared for current chat.", "success");
  };

  const handleToggle = (args: string[]): void => {
    const resolved = withContext();
    if (!resolved) {
      notify("Tracker context not ready.", "warning");
      return;
    }
    const rawTarget = String(args[0] ?? "").trim();
    const target = resolveBuiltInToggleKey(rawTarget);
    const customTargetId = rawTarget.toLowerCase();
    const customTarget = (resolved.settings.customStats ?? []).find(stat => stat.id === customTargetId);
    if (!target && !customTarget) {
      notify("Usage: /bst toggle <affection|trust|desire|connection|mood|lastThought|custom_stat_id>", "warning");
      return;
    }
    const { context, settings } = resolved;
    let nextSettings = settings;
    let toggledName = "";
    let current = false;
    if (target) {
      current =
        target === "affection" ? settings.trackAffection :
        target === "trust" ? settings.trackTrust :
        target === "desire" ? settings.trackDesire :
        target === "connection" ? settings.trackConnection :
        target === "mood" ? settings.trackMood :
        settings.trackLastThought;
      nextSettings = updateSetting(settings, target, !current);
      toggledName = target;
    } else if (customTarget) {
      current = Boolean(customTarget.track);
      nextSettings = updateCustomTrackSetting(settings, customTarget.id, !current);
      toggledName = customTarget.id;
    }
    deps.setSettings(nextSettings);
    deps.saveSettings(context, nextSettings);
    deps.refreshFromStoredData();
    deps.queuePromptSync(context);
    notify(`Toggled ${toggledName}: ${current ? "off" : "on"}.`, "success");
  };

  const handleInject = (args: string[]): void => {
    const resolved = withContext();
    if (!resolved) {
      notify("Tracker context not ready.", "warning");
      return;
    }
    const value = (args[0] ?? "").toLowerCase();
    if (value !== "on" && value !== "off") {
      notify("Usage: /bst inject on|off", "warning");
      return;
    }
    const { context, settings } = resolved;
    const nextSettings = { ...settings, injectTrackerIntoPrompt: value === "on" };
    deps.setSettings(nextSettings);
    deps.saveSettings(context, nextSettings);
    deps.queuePromptSync(context);
    notify(`Prompt injection ${value}.`, "success");
  };

  const handleDebug = (args: string[]): void => {
    const resolved = withContext();
    if (!resolved) {
      notify("Tracker context not ready.", "warning");
      return;
    }
    const value = (args[0] ?? "").toLowerCase();
    if (value !== "on" && value !== "off") {
      notify("Usage: /bst debug on|off", "warning");
      return;
    }
    const { context, settings } = resolved;
    const nextSettings = { ...settings, debug: value === "on" };
    deps.setSettings(nextSettings);
    deps.saveSettings(context, nextSettings);
    notify(`Debug ${value}.`, "success");
  };

  const handleBst = async (_args: Record<string, unknown>, rawValue: string): Promise<string> => {
    const args = parseArgs(rawValue);
    const sub = (args.shift() ?? "").toLowerCase();
    deps.pushTrace?.("slash", { command: sub || "help" });
    if (!sub || sub === "help") {
      notify(renderHelp());
      return "";
    }
    if (sub === "status") return String(handleStatus() ?? "");
    if (sub === "extract") return String(await handleExtract() ?? "");
    if (sub === "clear") return String(handleClear() ?? "");
    if (sub === "toggle") return String(handleToggle(args) ?? "");
    if (sub === "inject") return String(handleInject(args) ?? "");
    if (sub === "debug") return String(handleDebug(args) ?? "");
    notify(`Unknown subcommand "${sub}". ${renderHelp()}`, "warning");
    return "";
  };

    const returns = ARGUMENT_TYPE?.STRING ?? "string";
    const addCommandObject = SlashCommandParser.addCommandObject.bind(SlashCommandParser);
    const fromProps = SlashCommand.fromProps.bind(SlashCommand);
    const add = (name: string, callback: (args: Record<string, unknown>, value: string) => Promise<string> | string, help?: string): void => {
      addCommandObject(fromProps({
        name,
        callback,
        helpString: help,
        returns,
      }));
    };

    add("bst", handleBst, "BetterSimTracker commands. Use /bst help.");
    add("bst-status", async () => { handleStatus(); return ""; }, "Show tracker status.");
    add("bst-extract", async () => { await handleExtract(); return ""; }, "Extract stats for latest AI message.");
    add("bst-clear", async () => { handleClear(); return ""; }, "Clear tracker data for current chat.");
    add("bst-toggle", async (_args, raw) => { handleToggle(parseArgs(raw)); return ""; }, "Toggle a tracked stat.");
    add("bst-inject", async (_args, raw) => { handleInject(parseArgs(raw)); return ""; }, "Toggle prompt injection.");
    add("bst-debug", async (_args, raw) => { handleDebug(parseArgs(raw)); return ""; }, "Toggle debug mode.");
    return true;
  };

  let attempts = 0;
  const retry = (): void => {
    attempts += 1;
    if (attemptRegister()) {
      if (deps.getSettings()?.debug) {
        notify("Slash commands registered.", "success");
      }
      return;
    }
    if (attempts >= 60) {
      console.warn("[BetterSimTracker] Slash command API not available.");
      return;
    }
    setTimeout(retry, 500);
  };
  retry();
}

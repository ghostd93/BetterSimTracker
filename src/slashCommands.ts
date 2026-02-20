import type { BetterSimTrackerSettings, STContext, StatKey } from "./types";

type SlashRegister = (name: string, handler: (args: string) => void | Promise<void>, options?: Record<string, unknown>) => void;

type SlashCommandApi = {
  register: SlashRegister;
};

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

function getSlashCommandApi(): SlashCommandApi | null {
  const anyGlobal = globalThis as unknown as Record<string, unknown>;
  const registerSlashCommand = anyGlobal.registerSlashCommand;
  if (typeof registerSlashCommand === "function") {
    return { register: registerSlashCommand as SlashRegister };
  }
  const registerSlashCommandHandler = anyGlobal.registerSlashCommandHandler;
  if (typeof registerSlashCommandHandler === "function") {
    return { register: registerSlashCommandHandler as SlashRegister };
  }
  const parser = (anyGlobal.SlashCommandParser as { addCommand?: SlashRegister } | undefined);
  if (parser?.addCommand) {
    return { register: parser.addCommand.bind(parser) };
  }
  const manager = (anyGlobal.slashCommandManager as { register?: SlashRegister } | undefined);
  if (manager?.register) {
    return { register: manager.register.bind(manager) };
  }
  return null;
}

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
  const enabled: StatKey[] = [];
  if (settings.trackAffection) enabled.push("affection");
  if (settings.trackTrust) enabled.push("trust");
  if (settings.trackDesire) enabled.push("desire");
  if (settings.trackConnection) enabled.push("connection");
  if (settings.trackMood) enabled.push("mood");
  if (settings.trackLastThought) enabled.push("lastThought");
  return enabled.length ? enabled.join(", ") : "none";
}

function resolveToggleKey(raw: string): StatKey | null {
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

function registerCommand(api: SlashCommandApi, name: string, handler: (args: string) => void | Promise<void>, help?: string): void {
  const options = help ? { help } : undefined;
  try {
    api.register(name, handler, options);
    return;
  } catch {
    // ignore
  }
  try {
    api.register(name, handler);
  } catch {
    // ignore
  }
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
  const api = getSlashCommandApi();
  if (!api) {
    console.warn("[BetterSimTracker] Slash command API not available.");
    return;
  }

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
    const target = resolveToggleKey(args[0] ?? "");
    if (!target) {
      notify("Usage: /bst toggle <affection|trust|desire|connection|mood|lastThought>", "warning");
      return;
    }
    const { context, settings } = resolved;
    const current =
      target === "affection" ? settings.trackAffection :
      target === "trust" ? settings.trackTrust :
      target === "desire" ? settings.trackDesire :
      target === "connection" ? settings.trackConnection :
      target === "mood" ? settings.trackMood :
      settings.trackLastThought;
    const nextSettings = updateSetting(settings, target, !current);
    deps.setSettings(nextSettings);
    deps.saveSettings(context, nextSettings);
    deps.refreshFromStoredData();
    deps.queuePromptSync(context);
    notify(`Toggled ${target}: ${current ? "off" : "on"}.`, "success");
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

  const handleBst = async (rawArgs: string): Promise<void> => {
    const args = parseArgs(rawArgs);
    const sub = (args.shift() ?? "").toLowerCase();
    deps.pushTrace?.("slash", { command: sub || "help" });
    if (!sub || sub === "help") {
      notify(renderHelp());
      return;
    }
    if (sub === "status") return handleStatus();
    if (sub === "extract") return handleExtract();
    if (sub === "clear") return handleClear();
    if (sub === "toggle") return handleToggle(args);
    if (sub === "inject") return handleInject(args);
    if (sub === "debug") return handleDebug(args);
    notify(`Unknown subcommand "${sub}". ${renderHelp()}`, "warning");
  };

  registerCommand(api, "bst", handleBst, "BetterSimTracker commands. Use '/bst help' for usage.");
  registerCommand(api, "bst-status", () => handleStatus(), "Show tracker status.");
  registerCommand(api, "bst-extract", () => handleExtract(), "Extract stats for latest AI message.");
  registerCommand(api, "bst-clear", () => handleClear(), "Clear tracker data for current chat.");
  registerCommand(api, "bst-toggle", raw => handleToggle(parseArgs(raw)), "Toggle a tracked stat.");
  registerCommand(api, "bst-inject", raw => handleInject(parseArgs(raw)), "Toggle prompt injection.");
  registerCommand(api, "bst-debug", raw => handleDebug(parseArgs(raw)), "Toggle debug mode.");
}

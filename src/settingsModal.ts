import { CUSTOM_STAT_ID_REGEX, GLOBAL_TRACKER_KEY, MAX_CUSTOM_STATS, RESERVED_CUSTOM_STAT_IDS, STYLE_ID, USER_TRACKER_KEY } from "./constants";
import { generateJson } from "./generator";
import { logDebug } from "./settings";
import type {
  BetterSimTrackerSettings,
  BuiltInNumericStatUiSettings,
  ConnectionProfileOption,
  CustomStatKind,
  CustomStatDefinition,
  DateTimeMode,
  DeltaDebugRecord,
  MoodLabel,
  MoodSource,
  SceneCardStatDisplayOptions,
  StExpressionImageOptions,
} from "./types";
import {
  DEFAULT_INJECTION_PROMPT_TEMPLATE,
  DEFAULT_PROTOCOL_SEQUENTIAL_AFFECTION,
  DEFAULT_PROTOCOL_SEQUENTIAL_CONNECTION,
  DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NON_NUMERIC,
  DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NUMERIC,
  DEFAULT_PROTOCOL_SEQUENTIAL_DESIRE,
  DEFAULT_PROTOCOL_SEQUENTIAL_LAST_THOUGHT,
  DEFAULT_PROTOCOL_SEQUENTIAL_MOOD,
  DEFAULT_PROTOCOL_SEQUENTIAL_TRUST,
  DEFAULT_PROTOCOL_UNIFIED,
  DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION,
  DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
  DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS,
  DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
  buildBuiltInSequentialPromptGenerationPrompt,
  buildCustomStatBehaviorGuidanceGenerationPrompt,
  buildCustomStatDescriptionGenerationPrompt,
  buildSequentialCustomOverrideGenerationPrompt,
  moodOptions,
} from "./prompts";
import {
  closeStExpressionFrameEditor,
  formatStExpressionFrameSummary,
  openStExpressionFrameEditor,
  sanitizeStExpressionFrame,
} from "./stExpressionFrameEditor";
import { fetchFirstExpressionSprite } from "./stExpressionSprites";
import {
  hasScriptLikeContent,
  MAX_CUSTOM_ARRAY_ITEMS,
  MAX_CUSTOM_ENUM_OPTIONS,
  normalizeCustomEnumOptions,
  normalizeCustomStatKind,
  normalizeNonNumericArrayItems,
  normalizeNonNumericTextValue,
  resolveEnumOption,
} from "./customStatRuntime";
import { normalizeDateTimeValue, toDateTimeInputValue } from "./dateTime";
import { normalizeDateTimePartOrder } from "./uiDateTimeDisplay";
import {
  BUILT_IN_NUMERIC_STAT_KEY_LIST,
  BUILT_IN_NUMERIC_STAT_KEYS,
  BUILT_IN_STAT_LABELS,
  BUILT_IN_TRACKABLE_STAT_KEY_LIST,
  CUSTOM_STAT_DESCRIPTION_MAX_LENGTH,
  DEFAULT_MOOD_EXPRESSION_MAP,
  DEFAULT_ST_EXPRESSION_IMAGE_OPTIONS,
  MOOD_LABELS,
  bindTextareaCounters,
  clampNumberInputToBounds,
  cloneBuiltInNumericStatUi,
  cloneCustomStatDefinition,
  ensureStyles,
  escapeHtml,
  getGlobalStExpressionImageOptions,
  getResolvedMoodSource,
  getStableAutoCardColor,
  getNumericStatDefinitions,
  normalizeHexColor,
  normalizeMoodLabel,
  safeSetLocalStorage,
  sanitizeGeneratedSequentialTemplate,
  sanitizeGeneratedBehaviorGuidance,
  sanitizeGeneratedCustomDescription,
  suggestUniqueCustomStatId,
  toCustomStatSlug,
  toMacroCharacterSlug,
} from "./ui";
import { closeGraphModal } from "./graphModal";
export function openSettingsModal(input: {
  settings: BetterSimTrackerSettings;
  profileOptions: ConnectionProfileOption[];
  previewCharacterCandidates?: Array<{ name: string; avatar?: string | null }>;
  debugRecord?: DeltaDebugRecord | null;
  injectedPrompt?: string;
  onSave: (next: BetterSimTrackerSettings) => void;
  onRetrack?: () => void;
  onClearCurrentChat?: () => void;
  onDumpDiagnostics?: () => void;
  onClearDiagnostics?: () => void;
}): void {
  ensureStyles();
  closeSettingsModal();

  const backdrop = document.createElement("div");
  backdrop.className = "bst-settings-backdrop";
  backdrop.addEventListener("click", () => closeSettingsModal());
  document.body.appendChild(backdrop);

  const profileMap = new Map<string, string>();
  for (const option of input.profileOptions) {
    profileMap.set(option.id, option.label);
  }
  if (input.settings.connectionProfile && !profileMap.has(input.settings.connectionProfile)) {
    profileMap.set(input.settings.connectionProfile, `${input.settings.connectionProfile} (current)`);
  }

  const profileOptionsHtml = [
    `<option value="">Use active connection</option>`,
    ...Array.from(profileMap.entries()).map(([id, label]) => `<option value="${id}">${label}</option>`)
  ].join("");
  let customStatsState: CustomStatDefinition[] = Array.isArray(input.settings.customStats)
    ? input.settings.customStats.map(cloneCustomStatDefinition)
    : [];
  let sceneCardStatOrderState: string[] = Array.isArray(input.settings.sceneCardStatOrder)
    ? input.settings.sceneCardStatOrder.map(id => String(id ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  let characterCardStatOrderState: string[] = Array.isArray(input.settings.characterCardStatOrder)
    ? input.settings.characterCardStatOrder.map(id => String(id ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  let sceneCardStatDisplayState: Record<string, SceneCardStatDisplayOptions> = (() => {
    const raw = input.settings.sceneCardStatDisplay ?? {};
    const out: Record<string, SceneCardStatDisplayOptions> = {};
    for (const [id, row] of Object.entries(raw)) {
      const key = String(id ?? "").trim().toLowerCase();
      if (!key || !row) continue;
      const rawOrder = Array.isArray(row.dateTimePartOrder) ? row.dateTimePartOrder : [];
      const dateTimePartOrder: Array<"weekday" | "date" | "time" | "phase"> = [];
      for (const entry of rawOrder) {
        const part = String(entry ?? "").trim().toLowerCase();
        if (part === "weekday" || part === "date" || part === "time" || part === "phase") {
          if (!dateTimePartOrder.includes(part)) dateTimePartOrder.push(part);
        }
      }
      for (const part of ["weekday", "date", "time", "phase"] as const) {
        if (!dateTimePartOrder.includes(part)) dateTimePartOrder.push(part);
      }
      out[key] = {
        visible: Boolean(row.visible ?? true),
        showLabel: Boolean(row.showLabel ?? true),
        hideWhenEmpty: Boolean(row.hideWhenEmpty ?? false),
        labelOverride: String(row.labelOverride ?? "").trim().slice(0, 40),
        colorOverride: normalizeHexColor(row.colorOverride) ?? "",
        layoutOverride: row.layoutOverride === "chips" || row.layoutOverride === "rows" ? row.layoutOverride : "auto",
        valueStyle: row.valueStyle === "chip" || row.valueStyle === "plain" ? row.valueStyle : "auto",
        textMaxLength: typeof row.textMaxLength === "number" && Number.isFinite(row.textMaxLength)
          ? Math.max(10, Math.min(400, Math.round(row.textMaxLength)))
          : null,
        arrayCollapsedLimit: typeof row.arrayCollapsedLimit === "number" && Number.isFinite(row.arrayCollapsedLimit)
          ? Math.max(1, Math.min(MAX_CUSTOM_ARRAY_ITEMS, Math.round(row.arrayCollapsedLimit)))
          : null,
        dateTimeShowWeekday: Boolean(row.dateTimeShowWeekday ?? true),
        dateTimeShowDate: Boolean(row.dateTimeShowDate ?? true),
        dateTimeShowTime: Boolean(row.dateTimeShowTime ?? true),
        dateTimeShowPhase: Boolean(row.dateTimeShowPhase ?? true),
        dateTimeShowPartLabels: Boolean(row.dateTimeShowPartLabels ?? false),
        dateTimeLabelWeekday: String(row.dateTimeLabelWeekday ?? "Day").trim().slice(0, 20) || "Day",
        dateTimeLabelDate: String(row.dateTimeLabelDate ?? "Date").trim().slice(0, 20) || "Date",
        dateTimeLabelTime: String(row.dateTimeLabelTime ?? "Time").trim().slice(0, 20) || "Time",
        dateTimeLabelPhase: String(row.dateTimeLabelPhase ?? "Phase").trim().slice(0, 20) || "Phase",
        dateTimeDateFormat:
          row.dateTimeDateFormat === "dmy" ||
          row.dateTimeDateFormat === "mdy" ||
          row.dateTimeDateFormat === "d_mmm_yyyy" ||
          row.dateTimeDateFormat === "mmmm_d_yyyy" ||
          row.dateTimeDateFormat === "mmmm_do_yyyy"
            ? row.dateTimeDateFormat
            : "iso",
        dateTimePartOrder,
      };
    }
    return out;
  })();
  let builtInNumericStatUiState: BuiltInNumericStatUiSettings = cloneBuiltInNumericStatUi(input.settings.builtInNumericStatUi);

  const modal = document.createElement("div");
  modal.className = "bst-settings";
  modal.innerHTML = `
    <div class="bst-settings-top">
      <div>
        <h3>BetterSimTracker Settings</h3>
        <p class="bst-settings-subtitle">Changes are saved automatically.</p>
      </div>
      <div class="bst-settings-top-actions">
        <button class="bst-btn bst-btn-soft" data-action="toggle-all-sections" title="Expand all sections">Expand all</button>
        <button class="bst-btn bst-close-btn" data-action="close" title="Close settings" aria-label="Close settings">&times;</button>
      </div>
    </div>
    <div class="bst-settings-section bst-quick-help">
      <h4><span class="bst-header-icon fa-solid fa-circle-info"></span>Quick Help</h4>
      <div class="bst-help-line"><strong>Extraction mode:</strong> Unified = faster single request. Sequential = one request per stat (more robust, slower).</div>
      <ul class="bst-help-list">
        <li><strong>Affection:</strong> emotional warmth and care</li>
        <li><strong>Trust:</strong> safety and willingness to be vulnerable</li>
        <li><strong>Desire:</strong> attraction/flirt tension</li>
        <li><strong>Connection:</strong> bond depth and emotional attunement</li>
      </ul>
      <div class="bst-help-line"><strong>Mood</strong> is short-term tone. <strong>Last Thought</strong> is one brief internal line for continuity.</div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-plug"></span>Connection</h4>
      <div class="bst-settings-grid">
        <label>Connection Profile <select data-k="connectionProfile">${profileOptionsHtml}</select></label>
        <label>Max Tokens Override <input data-k="maxTokensOverride" type="number" min="0" max="100000"></label>
        <label>Context Size Override <input data-k="truncationLengthOverride" type="number" min="0" max="200000"></label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-filter"></span>Extraction &amp; Injection</h4>
      <div class="bst-settings-grid">
        <div class="bst-section-divider">Extraction Settings</div>
        <label>Context Messages <input data-k="contextMessages" type="number" min="1" max="40"></label>
        <label data-bst-row="maxConcurrentCalls">Max Concurrent Requests <input data-k="maxConcurrentCalls" type="number" min="1" max="8"></label>
        <label data-bst-row="maxRetriesPerStat">Max Retries Per Stat <input data-k="maxRetriesPerStat" type="number" min="0" max="4"></label>
        <label>Max Delta Per Turn <input data-k="maxDeltaPerTurn" type="number" min="1" max="30"></label>
        <label>Confidence Dampening <input data-k="confidenceDampening" type="number" min="0" max="1" step="0.05"></label>
        <label>Mood Stickiness <input data-k="moodStickiness" type="number" min="0" max="1" step="0.05"></label>
        <label data-bst-row="activityLookback">Activity Lookback <input data-k="activityLookback" type="number" min="1" max="25"></label>
        <div class="bst-section-divider">Extraction Includes</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="includeCharacterCardsInPrompt" type="checkbox">Include Character Cards in Extraction Prompt</label>
          <label class="bst-check"><input data-k="includeLorebookInExtraction" type="checkbox">Include Activated Lorebook in Extraction Prompt</label>
        </div>
        <label data-bst-row="lorebookExtractionMaxChars">Lorebook Extraction Limit <input data-k="lorebookExtractionMaxChars" type="number" min="0" max="12000"></label>
        <div class="bst-help-line bst-toggle-help" data-bst-row="lorebookExtractionHelp">Maximum lorebook characters included in extraction context (0 = no trim).</div>

        <div class="bst-section-divider">Extraction Toggles</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="autoGenerateTracker" type="checkbox">Auto-Generate Tracker</label>
          <label class="bst-check"><input data-k="sequentialExtraction" type="checkbox">Sequential Extraction (per stat)</label>
          <label class="bst-check"><input data-k="enableSequentialStatGroups" type="checkbox">Enable Sequential Stat Groups</label>
          <label class="bst-check"><input data-k="strictJsonRepair" type="checkbox">Strict JSON Repair</label>
          <label class="bst-check"><input data-k="autoDetectActive" type="checkbox">Auto Detect Active</label>
          <label class="bst-check" data-bst-row="regenerateOnMessageEdit"><input data-k="regenerateOnMessageEdit" type="checkbox">Regenerate Tracker After Message Edit</label>
          <label class="bst-check" data-bst-row="generateOnGreetingMessages"><input data-k="generateOnGreetingMessages" type="checkbox">Generate Tracker on Greetings</label>
        </div>

        <div class="bst-section-divider">User Tracking</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="enableUserTracking" type="checkbox">Enable User-Side Extraction</label>
          <label class="bst-check"><input data-k="userTrackMood" type="checkbox">Track User Mood</label>
          <label class="bst-check"><input data-k="userTrackLastThought" type="checkbox">Track User Last Thought</label>
          <label class="bst-check"><input data-k="includeUserTrackerInInjection" type="checkbox">Include User Tracker In Injection</label>
        </div>

        <div class="bst-section-divider">Injection Settings</div>
        <label data-bst-row="injectPromptDepth">Injection Depth <select data-k="injectPromptDepth"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option></select></label>
        <label data-bst-row="injectionPromptMaxChars">Injection Prompt Max Chars <input data-k="injectionPromptMaxChars" type="number" min="500" max="100000"></label>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="injectTrackerIntoPrompt" type="checkbox">Inject Tracker Into Prompt</label>
          <label class="bst-check"><input data-k="summarizationNoteVisibleForAI" type="checkbox">Summarization Note Visible for AI (future notes)</label>
          <label class="bst-check" data-bst-row="injectSummarizationNote"><input data-k="injectSummarizationNote" type="checkbox">Inject Summarization Note</label>
        </div>
        <div class="bst-help-line bst-toggle-help">Global macro: <code>{{bst_injection}}</code></div>
        <div class="bst-help-line bst-toggle-help"><strong>Summarize</strong> creates a prose note of current tracked stats (no numbers), typically 4-6 sentences, grounded in recent messages.</div>
        <div class="bst-help-line bst-toggle-help"><code>Summarization Note Visible for AI</code> affects only newly generated BetterSimTracker summary notes. Existing notes are not modified for safety.</div>
        <div class="bst-help-line bst-toggle-help"><code>Inject Summarization Note</code> only affects hidden tracker prompt injection guidance and does not edit chat messages.</div>
        <div class="bst-section-divider" data-bst-row="injectPromptDivider">Injection Prompt</div>
        <div class="bst-injection-prompt" data-bst-row="injectPromptBlock">
          <div class="bst-help-line">Shown only when Inject Tracker Into Prompt is enabled.</div>
          <div class="bst-help-line">Placeholders you can use:</div>
          <ul class="bst-help-list">
            <li><code>{{header}}</code> — privacy + usage rules header</li>
            <li><code>{{statSemantics}}</code> — enabled stat meanings</li>
            <li><code>{{behaviorBands}}</code> — low/medium/high behavior bands</li>
            <li><code>{{reactRules}}</code> — how-to-react rules</li>
            <li><code>{{priorityRules}}</code> — priority rules block</li>
            <li><code>{{lines}}</code> — per-character state lines</li>
            <li><code>{{summarizationNote}}</code> — optional latest tracker summary note (when enabled)</li>
          </ul>
          <div class="bst-prompt-group bst-prompt-inline">
            <div class="bst-prompt-head">
              <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-wand-magic-sparkles"></span>Injection Prompt</span>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateInjection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
            </div>
            <div class="bst-prompt-body">
              <div class="bst-prompt-caption">Template (editable)</div>
              <textarea data-k="promptTemplateInjection" rows="8"></textarea>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-chart-line"></span>Tracked Stats</h4>
      <div class="bst-custom-stats-top bst-custom-stats-top-centered">
        <button type="button" class="bst-btn bst-btn-soft" data-action="manage-builtins">Manage Built-in Stats</button>
      </div>
      <div data-bst-row="moodAdvancedBlock" class="bst-mood-advanced-settings">
        <div class="bst-section-divider">Mood Advanced Settings</div>
        <div class="bst-settings-grid bst-settings-grid-single">
          <label>Mood Source
            <select data-k="moodSource">
              <option value="bst_images">BST mood images</option>
              <option value="st_expressions">ST expressions</option>
            </select>
          </label>
        </div>
        <div data-bst-row="globalMoodExpressionMap">
          <div class="bst-help-line">Global mood to ST expression map (character overrides still take priority).</div>
          <div class="bst-character-map bst-global-mood-map">
            ${MOOD_LABELS.map(label => {
              const moodLabel = label as MoodLabel;
              const safeLabel = escapeHtml(moodLabel);
              const rawMap = input.settings.moodExpressionMap as Record<string, unknown> | undefined;
              const explicitValue = rawMap && typeof rawMap[moodLabel] === "string" ? String(rawMap[moodLabel]).trim() : "";
              const value = explicitValue || DEFAULT_MOOD_EXPRESSION_MAP[moodLabel];
              const safeValue = escapeHtml(value);
              const safePlaceholder = escapeHtml(DEFAULT_MOOD_EXPRESSION_MAP[moodLabel]);
              return `
                <label class="bst-character-map-row">
                  <span>${safeLabel}</span>
                  <input type="text" data-bst-global-mood-map="${safeLabel}" value="${safeValue}" placeholder="${safePlaceholder}">
                </label>
              `;
            }).join("")}
          </div>
        </div>
        <div data-bst-row="stExpressionImageOptions">
          <div class="bst-help-line">ST expression framing (global): zoom and crop position for expression sprites.</div>
          <div class="bst-st-expression-control">
            <button type="button" class="bst-btn bst-btn-soft" data-action="open-global-st-framing">Adjust ST Expression Framing</button>
            <div class="bst-help-line bst-st-expression-summary" data-bst-row="stExpressionImageSummary"></div>
            <input data-k="stExpressionImageZoom" type="hidden">
            <input data-k="stExpressionImagePositionX" type="hidden">
            <input data-k="stExpressionImagePositionY" type="hidden">
          </div>
        </div>
        <div class="bst-help-line">Emoji is always fallback if the selected source has no image.</div>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-sliders"></span>Custom Stats</h4>
      <div class="bst-custom-stats-top">
        <div class="bst-help-line">Add custom stats (numeric, enum, boolean, short text, array). Maximum ${MAX_CUSTOM_STATS} custom stats.</div>
        <div class="bst-custom-stats-actions">
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-add">Add Custom Stat</button>
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-import-json">Import JSON</button>
        </div>
      </div>
      <div class="bst-help-line bst-custom-stats-status is-info" data-bst-row="customStatsImportStatus" style="display:none;"></div>
      <div class="bst-custom-stats-list" data-bst-row="customStatsList"></div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-eye"></span>Display</h4>
      <div class="bst-settings-grid">
        <label data-bst-row="inactiveLabel">Inactive Label <input data-k="inactiveLabel" type="text"></label>
        <label>Accent Color
          <div class="bst-color-inputs">
            <input data-k-color="accentColor" type="color">
            <input data-k="accentColor" type="text" placeholder="#RRGGBB">
          </div>
        </label>
        <label>User Card Color
          <div class="bst-color-inputs">
            <input data-k-color="userCardColor" type="color">
            <input data-k="userCardColor" type="text" placeholder="Auto">
            <button type="button" class="bst-btn bst-btn-soft" data-action="reset-user-card-color">Auto</button>
          </div>
        </label>
        <label>Card Opacity <input data-k="cardOpacity" type="number" min="0.1" max="1" step="0.01"></label>
        <label>Border Radius <input data-k="borderRadius" type="number" min="0" max="32"></label>
        <label>Font Size <input data-k="fontSize" type="number" min="10" max="22"></label>
        <div class="bst-section-divider">Toggles</div>
        <div class="bst-check-grid">
          <label class="bst-check"><input data-k="collapseCardsByDefault" type="checkbox">Collapse Cards By Default</label>
          <label class="bst-check"><input data-k="showInactive" type="checkbox">Show Inactive</label>
          <label class="bst-check"><input data-k="showLastThought" type="checkbox">Show Last Thought</label>
        </div>
      </div>
      <details class="bst-subdrawer" data-bst-row="sceneCardDrawer">
        <summary><span class="bst-subdrawer-title"><span class="fa-solid fa-layer-group" aria-hidden="true"></span>Scene Card</span></summary>
        <div class="bst-settings-grid bst-settings-grid-single">
          <label class="bst-check" data-bst-row="sceneCardEnabled"><input data-k="sceneCardEnabled" type="checkbox">Enable Scene Card (global stats)</label>
          <label data-bst-row="sceneCardPosition">Position
            <select data-k="sceneCardPosition">
              <option value="above_tracker_cards">Above tracker cards</option>
              <option value="above_message">Above message text</option>
            </select>
          </label>
          <label data-bst-row="sceneCardLayout">Stat Layout
            <select data-k="sceneCardLayout">
              <option value="chips">Chips</option>
              <option value="rows">Rows</option>
            </select>
          </label>
          <div data-bst-row="sceneCardOrderManager">
            <div class="bst-help-line">Scene Stat Studio (order + per-stat style, visibility, and layout).</div>
            <div class="bst-scene-order-list" data-bst-row="sceneCardOrderList"></div>
          </div>
          <label data-bst-row="sceneCardArrayCollapsedLimit">Array chips before collapse
            <input data-k="sceneCardArrayCollapsedLimit" type="number" min="1" max="${MAX_CUSTOM_ARRAY_ITEMS}">
          </label>
          <label data-bst-row="sceneCardTitle">Card Title <input data-k="sceneCardTitle" type="text" maxlength="40"></label>
          <label data-bst-row="sceneCardColor">Card Color
            <div class="bst-color-inputs">
              <input data-k-color="sceneCardColor" type="color">
              <input data-k="sceneCardColor" type="text" placeholder="Auto">
            </div>
          </label>
          <label data-bst-row="sceneCardValueColor">Stat Value Color
            <div class="bst-color-inputs">
              <input data-k-color="sceneCardValueColor" type="color">
              <input data-k="sceneCardValueColor" type="text" placeholder="Per-stat/Accent auto">
            </div>
          </label>
          <label class="bst-check" data-bst-row="sceneCardShowWhenEmpty"><input data-k="sceneCardShowWhenEmpty" type="checkbox">Show Scene card even when empty</label>
          <div class="bst-help-line">When enabled, global custom stats are shown only in Scene Card (hidden on owner cards).</div>
        </div>
      </details>
      <details class="bst-subdrawer" data-bst-row="characterCardOrderDrawer">
        <summary><span class="bst-subdrawer-title"><span class="fa-solid fa-list-ol" aria-hidden="true"></span>Character Card Stat Order</span></summary>
        <div class="bst-settings-grid bst-settings-grid-single">
          <div class="bst-help-line">Order controls for stat rows shown on character cards (built-in + custom, non-global).</div>
          <div class="bst-scene-order-list" data-bst-row="characterCardOrderList"></div>
        </div>
      </details>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-pen-to-square"></span>Prompts</h4>
            <details class="bst-help-details">
        <summary>Prompt help</summary>
        <div class="bst-help-line">Unified prompt is used for one-prompt built-in extraction. Custom stats always use per-stat prompts in all modes.</div>
        <div class="bst-help-line">Instruction is always editable. Protocol can be edited only when advanced unlock is enabled.</div>
        <div class="bst-help-line">Strict/repair prompts are fixed for safety and consistency.</div>
        <div class="bst-help-line">Placeholders you can use:</div>
        <ul class="bst-help-list">
          <li><code>{{envelope}}</code> — prebuilt header with user/characters + recent messages</li>
          <li><code>{{user}}</code> — current user name (<code>{{userName}}</code> alias also works)</li>
          <li><code>{{char}}</code> — tracked message speaker (fallback: first character in scope)</li>
          <li><code>{{characters}}</code> — comma-separated character names</li>
          <li><code>{{contextText}}</code> — raw recent messages text</li>
          <li><code>{{currentLines}}</code> — current tracker state lines</li>
          <li><code>{{historyLines}}</code> — recent tracker snapshot lines</li>
          <li><code>{{numericStats}}</code> — requested numeric stats list</li>
          <li><code>{{textStats}}</code> — requested text stats list</li>
          <li><code>{{maxDelta}}</code> — configured max delta per turn</li>
          <li><code>{{moodOptions}}</code> — allowed mood labels</li>
          <li><code>{{statId}}</code>/<code>{{statLabel}}</code> — custom stat identity (custom per-stat template)</li>
          <li><code>{{statDescription}}</code>/<code>{{statDefault}}</code> — custom stat metadata (custom per-stat template)</li>
          <li><code>{{statKind}}</code>/<code>{{valueSchema}}</code> — non-numeric stat kind + expected value format</li>
          <li><code>{{allowedValues}}</code>/<code>{{textMaxLen}}</code> — enum option list or text-short limit</li>
          <li><code>{{defaultValueLiteral}}</code>/<code>{{booleanTrueLabel}}</code>/<code>{{booleanFalseLabel}}</code> — non-numeric defaults/labels</li>
        </ul>
      </details>
      <div class="bst-check-grid">
        <label class="bst-check"><input data-k="unlockProtocolPrompts" type="checkbox">Unlock Protocol Prompt Editing (Advanced)</label>
      </div>
      <div class="bst-help-line">By default protocol blocks are locked. Enable the toggle above to edit and reset them.</div>
      <div class="bst-settings-grid bst-settings-grid-single bst-prompts-stack">
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-layer-group"></span>Unified Prompt</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateUnified" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateUnified" rows="8"></textarea>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolUnified)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolUnified" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolUnified" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-heart"></span>Seq: Affection</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialAffection" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialAffection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialAffection" rows="6"></textarea>
            <div class="bst-prompt-caption">Behavior Instruction (injection only)</div>
            <textarea data-k="builtInBehaviorAffection" rows="5" placeholder="How affection should change visible behavior in replies. Leave empty to use BST fallback rules."></textarea>
            <div class="bst-prompt-ai-row" style="display:none;">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialAffection"></span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialAffection)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialAffection" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialAffection" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-shield-heart"></span>Seq: Trust</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialTrust" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialTrust" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialTrust" rows="6"></textarea>
            <div class="bst-prompt-caption">Behavior Instruction (injection only)</div>
            <textarea data-k="builtInBehaviorTrust" rows="5" placeholder="How trust should change visible behavior in replies. Leave empty to use BST fallback rules."></textarea>
            <div class="bst-prompt-ai-row" style="display:none;">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialTrust"></span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialTrust)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialTrust" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialTrust" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-fire"></span>Seq: Desire</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialDesire" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialDesire" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialDesire" rows="6"></textarea>
            <div class="bst-prompt-caption">Behavior Instruction (injection only)</div>
            <textarea data-k="builtInBehaviorDesire" rows="5" placeholder="How desire should change visible behavior in replies. Leave empty to use BST fallback rules."></textarea>
            <div class="bst-prompt-ai-row" style="display:none;">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialDesire"></span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialDesire)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialDesire" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialDesire" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-link"></span>Seq: Connection</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialConnection" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialConnection" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialConnection" rows="6"></textarea>
            <div class="bst-prompt-caption">Behavior Instruction (injection only)</div>
            <textarea data-k="builtInBehaviorConnection" rows="5" placeholder="How connection should change visible behavior in replies. Leave empty to use BST fallback rules."></textarea>
            <div class="bst-prompt-ai-row" style="display:none;">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialConnection"></span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialConnection)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialConnection" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialConnection" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-sliders"></span>Custom Numeric Default</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialCustomNumeric" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable default used when a custom stat has no per-stat override, in all modes)</div>
            <textarea data-k="promptTemplateSequentialCustomNumeric" rows="6"></textarea>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialCustomNumeric)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialCustomNumeric" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialCustomNumeric" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-list-check"></span>Custom Non-Numeric Default</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialCustomNonNumeric" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable default used when enum/boolean/text/array custom stats have no per-stat override, in all modes)</div>
            <textarea data-k="promptTemplateSequentialCustomNonNumeric" rows="6"></textarea>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialCustomNonNumeric)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialCustomNonNumeric" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialCustomNonNumeric" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-face-smile"></span>Seq: Mood</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialMood" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialMood" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialMood" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialMood">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialMood)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialMood" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialMood" rows="10"></textarea>
            </div>
          </div>
        </label>
        <label class="bst-prompt-group">
          <div class="bst-prompt-head">
            <span class="bst-prompt-title"><span class="bst-prompt-icon fa-solid fa-brain"></span>Seq: LastThought</span>
            <span class="bst-prompt-toggle fa-solid fa-circle-chevron-down"></span>
            <button class="bst-prompt-generate" data-action="generate-seq-prompt" data-generate-for="promptTemplateSequentialLastThought" title="Generate instruction with AI."><span class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span></button>
            <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptTemplateSequentialLastThought" title="Reset to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
          </div>
          <div class="bst-prompt-body">
            <div class="bst-prompt-caption">Instruction (editable)</div>
            <textarea data-k="promptTemplateSequentialLastThought" rows="6"></textarea>
            <div class="bst-prompt-ai-row">
              <span class="bst-prompt-ai-status" data-bst-seq-ai-status="promptTemplateSequentialLastThought">Uses current connection profile.</span>
            </div>
            <div class="bst-protocol-readonly-wrap">
              <div class="bst-prompt-caption">Protocol (read-only)</div>
              <pre class="bst-prompt-protocol">${escapeHtml(input.settings.promptProtocolSequentialLastThought)}</pre>
            </div>
            <div class="bst-protocol-editable-wrap">
              <div class="bst-prompt-caption">Protocol (advanced editable)</div>
              <button class="bst-prompt-reset" data-action="reset-prompt" data-reset-for="promptProtocolSequentialLastThought" title="Reset protocol to default."><span class="fa-solid fa-rotate-left" aria-hidden="true"></span></button>
              <textarea data-k="promptProtocolSequentialLastThought" rows="10"></textarea>
            </div>
          </div>
        </label>
      </div>
    </div>
    <div class="bst-settings-section">
      <h4><span class="bst-header-icon fa-solid fa-bug"></span>Debug</h4>
      <div class="bst-check-grid">
        <label class="bst-check"><input data-k="debug" type="checkbox">Debug</label>
      </div>
      <div class="bst-check-grid" data-bst-row="debugFlags">
        <label class="bst-check"><input data-k="debugExtraction" type="checkbox">Extraction</label>
        <label class="bst-check"><input data-k="debugPrompts" type="checkbox">Prompts</label>
        <label class="bst-check"><input data-k="debugUi" type="checkbox">UI</label>
        <label class="bst-check"><input data-k="debugMoodImages" type="checkbox">Mood Images</label>
        <label class="bst-check"><input data-k="debugStorage" type="checkbox">Storage</label>
        <label class="bst-check" data-bst-row="includeContextInDiagnostics"><input data-k="includeContextInDiagnostics" type="checkbox">Include Context In Diagnostics</label>
        <label class="bst-check" data-bst-row="includeGraphInDiagnostics"><input data-k="includeGraphInDiagnostics" type="checkbox">Include Graph Data In Diagnostics</label>
      </div>
      <div data-bst-row="debugBody">
        <div class="bst-debug-actions">
          <button class="bst-btn bst-btn-soft bst-btn-icon" data-action="retrack" title="Retrack Last AI Message" aria-label="Retrack Last AI Message">
            <span class="fa-solid fa-rotate-left" aria-hidden="true"></span>
          </button>
          <button class="bst-btn bst-btn-danger" data-action="clear-chat" title="Delete all tracker data for the currently open chat only.">
            <span class="fa-solid fa-trash bst-btn-icon-left" aria-hidden="true"></span>
            Delete Tracker Data (Current Chat)
          </button>
          <button class="bst-btn" data-action="dump-diagnostics" title="Collect and copy current diagnostics report to clipboard.">
            <span class="fa-solid fa-file-export bst-btn-icon-left" aria-hidden="true"></span>
            Dump Diagnostics
          </button>
          <button class="bst-btn bst-btn-danger" data-action="clear-diagnostics" title="Clear stored diagnostics traces and last debug record for this chat scope.">
            <span class="fa-solid fa-broom bst-btn-icon-left" aria-hidden="true"></span>
            Clear Diagnostics
          </button>
        </div>
        <div style="margin-top:8px;font-size:12px;opacity:.9;">Latest Extraction Debug Record</div>
        <div class="bst-debug-box">${input.debugRecord ? JSON.stringify(input.debugRecord, null, 2) : "No debug record yet."}</div>
        <div style="margin-top:8px;font-size:12px;opacity:.9;">Latest Injected Prompt Block</div>
        <div class="bst-debug-box">${input.injectedPrompt?.trim() ? input.injectedPrompt : "No injected prompt currently active."}</div>
      </div>
    </div>
    <div class="bst-settings-footer">
      <button class="bst-btn bst-btn-soft" data-action="retrack" title="Retrack Last AI Message">
        <span class="fa-solid fa-rotate-left bst-btn-icon-left" aria-hidden="true"></span>
        Retrack
      </button>
      <button class="bst-btn" data-action="close" title="Close settings">Done</button>
    </div>
  `;
  document.body.appendChild(modal);

  const mergeConnectionAndGeneration = (): void => {
    const sections = Array.from(modal.querySelectorAll(".bst-settings-section")) as HTMLElement[];
    const connectionSection = sections.find(section => section.querySelector("h4")?.textContent?.trim() === "Connection");
    const generationSection = sections.find(section => section.querySelector("h4")?.textContent?.trim() === "Generation");
    if (!connectionSection || !generationSection) return;
    const generationGrid = generationSection.querySelector(".bst-settings-grid");
    if (!generationGrid) return;
    const divider = document.createElement("div");
    divider.className = "bst-section-divider";
    divider.textContent = "Generation";
    connectionSection.appendChild(divider);
    connectionSection.appendChild(generationGrid);
    generationSection.remove();
  };
  mergeConnectionAndGeneration();

  const addMinMaxHints = (): void => {
    const numberInputs = Array.from(modal.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    numberInputs.forEach(input => {
      const minAttr = input.getAttribute("min");
      const maxAttr = input.getAttribute("max");
      if (minAttr === null && maxAttr === null) return;
      const label = input.closest("label");
      if (!label) return;
      const existing = label.querySelector(".bst-minmax");
      if (existing) return;
      const span = document.createElement("span");
      span.className = "bst-minmax";
      const parts: string[] = [];
      if (minAttr !== null && minAttr !== "") parts.push(`min ${minAttr}`);
      if (maxAttr !== null && maxAttr !== "") parts.push(`max ${maxAttr}`);
      span.textContent = parts.join(" · ");
      label.appendChild(span);
    });
  };
  addMinMaxHints();

  const enforceNumberBounds = (): void => {
    const numberInputs = Array.from(modal.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    numberInputs.forEach(input => {
      const minAttr = input.getAttribute("min");
      const maxAttr = input.getAttribute("max");
      const min = minAttr !== null && minAttr !== "" ? Number(minAttr) : undefined;
      const max = maxAttr !== null && maxAttr !== "" ? Number(maxAttr) : undefined;
      if (min === undefined && max === undefined) return;
      const label = input.closest("label");
      if (!label) return;
      let notice = label.querySelector(".bst-validation") as HTMLElement | null;
      if (!notice) {
        notice = document.createElement("span");
        notice.className = "bst-validation";
        notice.style.display = "none";
        label.appendChild(notice);
      }
      let clearTimer: number | null = null;
      let clampedThisFocus = false;
      const clamp = (): void => {
        const changed = clampNumberInputToBounds(input);
        if (changed) clampedThisFocus = true;
      };
      // Keep typing fluid; enforce bounds on commit.
      input.addEventListener("blur", () => {
        clamp();
        if (!clampedThisFocus) return;
        const parts: string[] = [];
        if (typeof min === "number") parts.push(`min ${min}`);
        if (typeof max === "number") parts.push(`max ${max}`);
        notice.textContent = `Allowed range: ${parts.join(" · ")}. Value adjusted.`;
        notice.style.display = "block";
        if (clearTimer !== null) window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(() => {
          notice.textContent = "";
          notice.style.display = "none";
        }, 1800);
        clampedThisFocus = false;
      });
      input.addEventListener("focus", () => {
        clampedThisFocus = false;
      });
    });
  };
  enforceNumberBounds();

  const initSectionDrawers = (): void => {
    const sectionIds: Record<string, string> = {
      "Connection": "connection",
      "Extraction & Injection": "extraction",
      "Tracked Stats": "tracked-stats",
      "Custom Stats": "custom-stats",
      "Display": "display",
      "Prompts": "prompts",
      "Debug": "debug"
    };
    const sections = Array.from(modal.querySelectorAll(".bst-settings-section")) as HTMLElement[];
    sections.forEach((section, index) => {
      if (index === 0) return;
      const header = section.querySelector("h4") as HTMLHeadingElement | null;
      if (!header) return;
      const label = header.textContent?.trim() ?? "";
      const id = sectionIds[label] ?? label.toLowerCase().replace(/\s+/g, "-");
      section.dataset.bstSection = id;
      const head = document.createElement("div");
      head.className = "bst-section-head";
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      head.setAttribute("data-action", "toggle-section");
      head.setAttribute("data-section", id);
      head.setAttribute("aria-expanded", "true");
      head.setAttribute("title", "Toggle section");
      const icon = document.createElement("span");
      icon.className = "bst-section-icon fa-solid fa-circle-chevron-down";
      head.appendChild(header);
      head.appendChild(icon);
      section.insertBefore(head, section.firstChild);

      const body = document.createElement("div");
      body.className = "bst-section-body";
      body.dataset.bstSectionBody = id;
      while (section.childNodes.length > 1) {
        body.appendChild(section.childNodes[1]);
      }
      section.appendChild(body);

      const storageKey = `bst.section.${id}`;
      section.dataset.bstStorageKey = storageKey;
      const stored = localStorage.getItem(storageKey);
      const collapsed = stored ? stored === "collapsed" : true;
      if (collapsed) {
        section.classList.add("bst-section-collapsed");
        head.setAttribute("aria-expanded", "false");
      }

      const toggleSection = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        const nextCollapsed = !section.classList.contains("bst-section-collapsed");
        section.classList.toggle("bst-section-collapsed", nextCollapsed);
        head.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
        safeSetLocalStorage(storageKey, nextCollapsed ? "collapsed" : "expanded");
        modal.dispatchEvent(new CustomEvent("bst:section-toggle"));
      };
      head.addEventListener("click", toggleSection);
      head.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        toggleSection(event);
      });
    });
  };
  initSectionDrawers();

  const initGlobalSectionToggle = (): void => {
    const buttons = Array.from(modal.querySelectorAll('[data-action="toggle-all-sections"]')) as HTMLButtonElement[];
    if (!buttons.length) return;
    const getSections = (): HTMLElement[] =>
      Array.from(modal.querySelectorAll('.bst-settings-section[data-bst-section]')) as HTMLElement[];
    const updateButtons = (): void => {
      const sections = getSections();
      const allCollapsed = sections.length > 0 && sections.every(section => section.classList.contains("bst-section-collapsed"));
      buttons.forEach(button => {
        button.textContent = allCollapsed ? "Expand all" : "Collapse all";
        button.setAttribute("title", allCollapsed ? "Expand all sections" : "Collapse all sections");
        button.setAttribute("aria-pressed", allCollapsed ? "false" : "true");
      });
    };
    const toggleAll = (): void => {
      const sections = getSections();
      if (!sections.length) return;
      const allCollapsed = sections.every(section => section.classList.contains("bst-section-collapsed"));
      const nextCollapsed = !allCollapsed;
      sections.forEach(section => {
        section.classList.toggle("bst-section-collapsed", nextCollapsed);
        const head = section.querySelector(".bst-section-head") as HTMLElement | null;
        head?.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
        const storageKey = section.dataset.bstStorageKey;
        if (storageKey) {
          safeSetLocalStorage(storageKey, nextCollapsed ? "collapsed" : "expanded");
        }
      });
      updateButtons();
    };
    buttons.forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        toggleAll();
      });
    });
    modal.addEventListener("bst:section-toggle", updateButtons);
    updateButtons();
  };
  initGlobalSectionToggle();

  const initPromptGroups = (): void => {
    const groups = Array.from(modal.querySelectorAll(".bst-prompt-group")) as HTMLElement[];
    groups.forEach(group => {
      const head = group.querySelector(".bst-prompt-head") as HTMLElement | null;
      if (!head) return;
      group.classList.add("collapsed");
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      const toggle = (event: Event): void => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".bst-prompt-reset")) return;
        if (target?.closest(".bst-prompt-generate")) return;
        event.preventDefault();
        event.stopPropagation();
        group.classList.toggle("collapsed");
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        toggle(event);
      });
    });
  };
  initPromptGroups();

  const initAccentColorPicker = (): void => {
    const colorInput = modal.querySelector('[data-k-color="accentColor"]') as HTMLInputElement | null;
    const textInput = modal.querySelector('[data-k="accentColor"]') as HTMLInputElement | null;
    if (!colorInput || !textInput) return;
    const fallback = normalizeHexColor(input.settings.accentColor) ?? "#ff5a6f";
    const syncPickerFromText = (): void => {
      colorInput.value = normalizeHexColor(textInput.value) ?? fallback;
    };
    textInput.value = normalizeHexColor(textInput.value) ?? fallback;
    syncPickerFromText();
    colorInput.addEventListener("input", () => {
      textInput.value = colorInput.value;
      persistLive();
    });
    textInput.addEventListener("input", syncPickerFromText);
  };

  const initUserCardColorPicker = (): void => {
    const colorInput = modal.querySelector('[data-k-color="userCardColor"]') as HTMLInputElement | null;
    const textInput = modal.querySelector('[data-k="userCardColor"]') as HTMLInputElement | null;
    const resetButton = modal.querySelector('[data-action="reset-user-card-color"]') as HTMLButtonElement | null;
    if (!colorInput || !textInput) return;
    const fallback = normalizeHexColor(getStableAutoCardColor(USER_TRACKER_KEY)) ?? "#7a9cff";
    const syncPickerFromText = (): void => {
      colorInput.value = normalizeHexColor(textInput.value) ?? fallback;
    };
    textInput.value = normalizeHexColor(textInput.value) ?? "";
    syncPickerFromText();
    colorInput.addEventListener("input", () => {
      textInput.value = colorInput.value;
      persistLive();
    });
    textInput.addEventListener("input", syncPickerFromText);
    resetButton?.addEventListener("click", event => {
      event.preventDefault();
      textInput.value = "";
      syncPickerFromText();
      persistLive();
    });
  };

  const initSceneCardColorPickers = (): void => {
    const cardColorInput = modal.querySelector('[data-k-color="sceneCardColor"]') as HTMLInputElement | null;
    const cardTextInput = modal.querySelector('[data-k="sceneCardColor"]') as HTMLInputElement | null;
    const valueColorInput = modal.querySelector('[data-k-color="sceneCardValueColor"]') as HTMLInputElement | null;
    const valueTextInput = modal.querySelector('[data-k="sceneCardValueColor"]') as HTMLInputElement | null;
    if (cardColorInput && cardTextInput) {
      const fallback = normalizeHexColor(getStableAutoCardColor(GLOBAL_TRACKER_KEY)) ?? "#6f7cff";
      const syncCardPickerFromText = (): void => {
        cardColorInput.value = normalizeHexColor(cardTextInput.value) ?? fallback;
      };
      cardTextInput.value = normalizeHexColor(cardTextInput.value) ?? "";
      syncCardPickerFromText();
      cardColorInput.addEventListener("input", () => {
        cardTextInput.value = cardColorInput.value;
        persistLive();
      });
      cardTextInput.addEventListener("input", syncCardPickerFromText);
    }
    if (valueColorInput && valueTextInput) {
      const fallback = normalizeHexColor(input.settings.accentColor) ?? "#ff5a6f";
      const syncValuePickerFromText = (): void => {
        valueColorInput.value = normalizeHexColor(valueTextInput.value) ?? fallback;
      };
      valueTextInput.value = normalizeHexColor(valueTextInput.value) ?? "";
      syncValuePickerFromText();
      valueColorInput.addEventListener("input", () => {
        valueTextInput.value = valueColorInput.value;
        persistLive();
      });
      valueTextInput.addEventListener("input", syncValuePickerFromText);
    }
  };

  const set = (key: keyof BetterSimTrackerSettings, value: string): void => {
    const node = modal.querySelector(`[data-k="${key}"]`) as HTMLInputElement | HTMLSelectElement | null;
    if (!node) return;
    if (node instanceof HTMLInputElement && node.type === "checkbox") {
      node.checked = value === "true";
      return;
    }
    node.value = value;
  };
  const setExtra = (key: string, value: string): void => {
    const node = modal.querySelector(`[data-k="${key}"]`) as HTMLInputElement | HTMLSelectElement | null;
    if (!node) return;
    if (node instanceof HTMLInputElement && node.type === "checkbox") {
      node.checked = value === "true";
      return;
    }
    node.value = value;
  };

  set("connectionProfile", input.settings.connectionProfile);
  set("sequentialExtraction", String(input.settings.sequentialExtraction));
  set("enableSequentialStatGroups", String(input.settings.enableSequentialStatGroups));
  set("maxConcurrentCalls", String(input.settings.maxConcurrentCalls));
  set("strictJsonRepair", String(input.settings.strictJsonRepair));
  set("maxRetriesPerStat", String(input.settings.maxRetriesPerStat));
  set("contextMessages", String(input.settings.contextMessages));
  set("injectPromptDepth", String(input.settings.injectPromptDepth));
  set("maxDeltaPerTurn", String(input.settings.maxDeltaPerTurn));
  set("maxTokensOverride", String(input.settings.maxTokensOverride));
  set("truncationLengthOverride", String(input.settings.truncationLengthOverride));
  set("includeCharacterCardsInPrompt", String(input.settings.includeCharacterCardsInPrompt));
  set("includeLorebookInExtraction", String(input.settings.includeLorebookInExtraction));
  set("lorebookExtractionMaxChars", String(input.settings.lorebookExtractionMaxChars));
  set("confidenceDampening", String(input.settings.confidenceDampening));
  set("moodStickiness", String(input.settings.moodStickiness));
  set("injectTrackerIntoPrompt", String(input.settings.injectTrackerIntoPrompt));
  set("injectionPromptMaxChars", String(input.settings.injectionPromptMaxChars));
  set("summarizationNoteVisibleForAI", String(input.settings.summarizationNoteVisibleForAI));
  set("injectSummarizationNote", String(input.settings.injectSummarizationNote));
  set("autoDetectActive", String(input.settings.autoDetectActive));
  set("autoGenerateTracker", String(input.settings.autoGenerateTracker));
  set("regenerateOnMessageEdit", String(input.settings.regenerateOnMessageEdit));
  set("generateOnGreetingMessages", String(input.settings.generateOnGreetingMessages));
  set("activityLookback", String(input.settings.activityLookback));
  set("showInactive", String(input.settings.showInactive));
  set("inactiveLabel", input.settings.inactiveLabel);
  set("showLastThought", String(input.settings.showLastThought));
  set("sceneCardEnabled", String(input.settings.sceneCardEnabled));
  set("sceneCardPosition", input.settings.sceneCardPosition);
  set("sceneCardLayout", input.settings.sceneCardLayout);
  set("sceneCardTitle", input.settings.sceneCardTitle);
  set("sceneCardColor", input.settings.sceneCardColor || "");
  set("sceneCardValueColor", input.settings.sceneCardValueColor || "");
  set("sceneCardShowWhenEmpty", String(input.settings.sceneCardShowWhenEmpty));
  set("sceneCardArrayCollapsedLimit", String(input.settings.sceneCardArrayCollapsedLimit));
  set("trackAffection", String(input.settings.trackAffection));
  set("trackTrust", String(input.settings.trackTrust));
  set("trackDesire", String(input.settings.trackDesire));
  set("trackConnection", String(input.settings.trackConnection));
  set("trackMood", String(input.settings.trackMood));
  set("trackLastThought", String(input.settings.trackLastThought));
  set("enableUserTracking", String(input.settings.enableUserTracking));
  set("userTrackMood", String(input.settings.userTrackMood));
  set("userTrackLastThought", String(input.settings.userTrackLastThought));
  set("includeUserTrackerInInjection", String(input.settings.includeUserTrackerInInjection));
  set("moodSource", input.settings.moodSource);
  set("stExpressionImageZoom", String(input.settings.stExpressionImageZoom));
  set("stExpressionImagePositionX", String(input.settings.stExpressionImagePositionX));
  set("stExpressionImagePositionY", String(input.settings.stExpressionImagePositionY));
  set("accentColor", input.settings.accentColor || "#ff5a6f");
  set("userCardColor", input.settings.userCardColor || "");
  initAccentColorPicker();
  initUserCardColorPicker();
  initSceneCardColorPickers();
  set("cardOpacity", String(input.settings.cardOpacity));
  set("borderRadius", String(input.settings.borderRadius));
  set("fontSize", String(input.settings.fontSize));
  set("debug", String(input.settings.debug));
  setExtra("debugExtraction", String(input.settings.debugFlags?.extraction ?? true));
  setExtra("debugPrompts", String(input.settings.debugFlags?.prompts ?? true));
  setExtra("debugUi", String(input.settings.debugFlags?.ui ?? true));
  setExtra("debugMoodImages", String(input.settings.debugFlags?.moodImages ?? true));
  setExtra("debugStorage", String(input.settings.debugFlags?.storage ?? true));
  set("includeContextInDiagnostics", String(input.settings.includeContextInDiagnostics));
  set("includeGraphInDiagnostics", String(input.settings.includeGraphInDiagnostics));
  set("promptTemplateUnified", input.settings.promptTemplateUnified);
  set("promptTemplateSequentialAffection", input.settings.promptTemplateSequentialAffection);
  set("promptTemplateSequentialTrust", input.settings.promptTemplateSequentialTrust);
  set("promptTemplateSequentialDesire", input.settings.promptTemplateSequentialDesire);
  set("promptTemplateSequentialConnection", input.settings.promptTemplateSequentialConnection);
  set("promptTemplateSequentialCustomNumeric", input.settings.promptTemplateSequentialCustomNumeric);
  set("promptTemplateSequentialCustomNonNumeric", input.settings.promptTemplateSequentialCustomNonNumeric);
  set("promptTemplateSequentialMood", input.settings.promptTemplateSequentialMood);
  set("promptTemplateSequentialLastThought", input.settings.promptTemplateSequentialLastThought);
  set("builtInBehaviorAffection", input.settings.builtInBehaviorAffection || "");
  set("builtInBehaviorTrust", input.settings.builtInBehaviorTrust || "");
  set("builtInBehaviorDesire", input.settings.builtInBehaviorDesire || "");
  set("builtInBehaviorConnection", input.settings.builtInBehaviorConnection || "");
  set("promptTemplateInjection", input.settings.promptTemplateInjection);
  set("unlockProtocolPrompts", String(input.settings.unlockProtocolPrompts));
  set("promptProtocolUnified", input.settings.promptProtocolUnified);
  set("promptProtocolSequentialAffection", input.settings.promptProtocolSequentialAffection);
  set("promptProtocolSequentialTrust", input.settings.promptProtocolSequentialTrust);
  set("promptProtocolSequentialDesire", input.settings.promptProtocolSequentialDesire);
  set("promptProtocolSequentialConnection", input.settings.promptProtocolSequentialConnection);
  set("promptProtocolSequentialCustomNumeric", input.settings.promptProtocolSequentialCustomNumeric);
  set("promptProtocolSequentialCustomNonNumeric", input.settings.promptProtocolSequentialCustomNonNumeric);
  set("promptProtocolSequentialMood", input.settings.promptProtocolSequentialMood);
  set("promptProtocolSequentialLastThought", input.settings.promptProtocolSequentialLastThought);
  const refreshSettingsTextareaCounters = bindTextareaCounters(modal);

  const initialGlobalStExpressionFrame = getGlobalStExpressionImageOptions(input.settings);
  const readGlobalStExpressionFrame = (): StExpressionImageOptions => {
    const zoomNode = modal.querySelector('[data-k="stExpressionImageZoom"]') as HTMLInputElement | null;
    const positionXNode = modal.querySelector('[data-k="stExpressionImagePositionX"]') as HTMLInputElement | null;
    const positionYNode = modal.querySelector('[data-k="stExpressionImagePositionY"]') as HTMLInputElement | null;
    return sanitizeStExpressionFrame(
      {
        zoom: Number(zoomNode?.value ?? initialGlobalStExpressionFrame.zoom),
        positionX: Number(positionXNode?.value ?? initialGlobalStExpressionFrame.positionX),
        positionY: Number(positionYNode?.value ?? initialGlobalStExpressionFrame.positionY),
      },
      initialGlobalStExpressionFrame,
    );
  };
  const updateGlobalStExpressionSummary = (): void => {
    const summaryNode = modal.querySelector('[data-bst-row="stExpressionImageSummary"]') as HTMLElement | null;
    if (!summaryNode) return;
    summaryNode.textContent = `Current framing: ${formatStExpressionFrameSummary(readGlobalStExpressionFrame())}`;
  };
  updateGlobalStExpressionSummary();
  type GlobalPreviewCharacter = { name: string; spriteUrl: string };
  const globalFrameButton = modal.querySelector('[data-action="open-global-st-framing"]') as HTMLButtonElement | null;
  let globalPreviewCharacters: GlobalPreviewCharacter[] = [];
  let globalPreviewSelected = "";
  const noPreviewFoundText = "No ST expressions found. Add at least one character with ST expressions to use preview framing.";
  const loadGlobalPreviewCharacters = async (): Promise<GlobalPreviewCharacter[]> => {
    const candidates = (input.previewCharacterCandidates ?? [])
      .map(entry => ({
        name: String(entry?.name ?? "").trim(),
        avatar: String(entry?.avatar ?? "").trim() || undefined,
      }))
      .filter(entry => Boolean(entry.name))
      .filter(entry => getResolvedMoodSource(input.settings, entry.name, entry.avatar) === "st_expressions");
    const deduped = Array.from(new Map(candidates.map(entry => [entry.name.toLowerCase(), entry])).values());
    if (!deduped.length) return [];
    const resolved = await Promise.all(deduped.map(async entry => {
      try {
        const spriteUrl = await fetchFirstExpressionSprite(entry.name);
        return spriteUrl ? { name: entry.name, spriteUrl } : null;
      } catch {
        return null;
      }
    }));
    return resolved
      .filter((entry): entry is GlobalPreviewCharacter => Boolean(entry))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  if (globalFrameButton) globalFrameButton.disabled = false;
  const customStatsListNode = modal.querySelector('[data-bst-row="customStatsList"]') as HTMLElement | null;
  const customAddButton = modal.querySelector('[data-action="custom-add"]') as HTMLButtonElement | null;
  const customImportJsonButton = modal.querySelector('[data-action="custom-import-json"]') as HTMLButtonElement | null;
  const customStatsImportStatusNode = modal.querySelector('[data-bst-row="customStatsImportStatus"]') as HTMLElement | null;
  const manageBuiltInsButton = modal.querySelector('[data-action="manage-builtins"]') as HTMLButtonElement | null;

  type CustomStatWizardMode = "add" | "edit" | "duplicate";
  type CustomStatDraft = {
    kind: CustomStatKind;
    label: string;
    id: string;
    description: string;
    behaviorGuidance: string;
    defaultValue: string;
    defaultBoolean: boolean;
    maxDeltaPerTurn: string;
    enumOptionsText: string;
    booleanTrueLabel: string;
    booleanFalseLabel: string;
    textMaxLength: string;
    dateTimeMode: DateTimeMode;
    trackCharacters: boolean;
    trackUser: boolean;
    globalScope: boolean;
    privateToOwner: boolean;
    includeInInjection: boolean;
    color: string;
    promptOverride: string;
    sequentialGroup: string;
    lockId: boolean;
  };

  const makeDraft = (mode: CustomStatWizardMode, source?: CustomStatDefinition): CustomStatDraft => {
    if (!source) {
      return {
        kind: "numeric",
        label: "",
        id: "",
        description: "",
        behaviorGuidance: "",
        defaultValue: "50",
        defaultBoolean: false,
        maxDeltaPerTurn: "",
        enumOptionsText: "",
        booleanTrueLabel: "enabled",
        booleanFalseLabel: "disabled",
        textMaxLength: "120",
        dateTimeMode: "timestamp",
        trackCharacters: true,
        trackUser: true,
        globalScope: false,
        privateToOwner: false,
        includeInInjection: true,
        color: "",
        promptOverride: "",
        sequentialGroup: "",
        lockId: false,
      };
    }
    const clone = cloneCustomStatDefinition(source);
    const duplicateId = mode === "duplicate"
      ? suggestUniqueCustomStatId(`${clone.id}_copy`, new Set(customStatsState.map(item => item.id)))
      : clone.id;
    const kind = normalizeCustomStatKind(clone.kind);
    const globalScope = Boolean(clone.globalScope);
    const trackCharacters = globalScope ? true : Boolean(clone.trackCharacters ?? clone.track);
    const trackUser = globalScope ? true : Boolean(clone.trackUser ?? clone.track);
    const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(clone.textMaxLength) || 120)));
    return {
      kind,
      label: clone.label,
      id: duplicateId,
      description: clone.description ?? "",
      behaviorGuidance: clone.behaviorGuidance ?? "",
      defaultValue: kind === "numeric"
        ? String(Number.isFinite(Number(clone.defaultValue)) ? Math.round(Number(clone.defaultValue)) : 50)
        : kind === "boolean"
          ? ""
          : kind === "date_time"
            ? normalizeDateTimeValue(clone.defaultValue)
          : kind === "array"
            ? normalizeNonNumericArrayItems(clone.defaultValue, textMaxLength).join("\n")
            : String(clone.defaultValue ?? ""),
      defaultBoolean: kind === "boolean" ? Boolean(clone.defaultValue) : false,
      maxDeltaPerTurn: kind === "numeric" && clone.maxDeltaPerTurn != null ? String(Math.round(clone.maxDeltaPerTurn)) : "",
      enumOptionsText: kind === "enum_single" ? normalizeCustomEnumOptions(clone.enumOptions).join("\n") : "",
      booleanTrueLabel: String(clone.booleanTrueLabel ?? "enabled").trim() || "enabled",
      booleanFalseLabel: String(clone.booleanFalseLabel ?? "disabled").trim() || "disabled",
      textMaxLength: kind === "text_short" || kind === "array" ? String(textMaxLength) : "120",
      dateTimeMode: kind === "date_time" && clone.dateTimeMode === "structured" ? "structured" : "timestamp",
      trackCharacters,
      trackUser,
      globalScope,
      privateToOwner: globalScope ? false : Boolean(clone.privateToOwner),
      includeInInjection: clone.includeInInjection,
      color: clone.color ?? "",
      promptOverride: clone.promptOverride ?? "",
      sequentialGroup: String((clone as { sequentialGroup?: string }).sequentialGroup ?? ""),
      lockId: mode === "edit",
    };
  };

  const validateCustomStatDraft = (
    draft: CustomStatDraft,
    mode: CustomStatWizardMode,
    step: number,
    currentId?: string,
  ): string[] => {
    const errors: string[] = [];
    const id = draft.id.trim().toLowerCase();
    const label = draft.label.trim();
    const existingIds = new Set(customStatsState
      .map(item => item.id)
      .filter(item => !currentId || item !== currentId));

    if (step >= 1) {
      if (label.length < 2 || label.length > 40) {
        errors.push("Label must be between 2 and 40 characters.");
      }
      if (!id) {
        errors.push("ID is required.");
      } else if (!CUSTOM_STAT_ID_REGEX.test(id)) {
        errors.push("ID must match: lowercase, numbers, underscore, and start with a letter.");
      } else if (RESERVED_CUSTOM_STAT_IDS.has(id)) {
        errors.push("ID is reserved by the tracker.");
      } else if (existingIds.has(id)) {
        errors.push("ID is already used.");
      }
      if (mode === "edit" && draft.lockId && currentId && id !== currentId) {
        errors.push("ID cannot be changed in edit mode.");
      }
      if (draft.description.trim().length < 3) {
        errors.push("Description is required (at least 3 characters).");
      }
    }

    if (step >= 2) {
      if (draft.kind === "numeric") {
        const defaultValue = Number(draft.defaultValue);
        if (!Number.isFinite(defaultValue) || defaultValue < 0 || defaultValue > 100) {
          errors.push("Default value must be between 0 and 100.");
        }
        if (draft.maxDeltaPerTurn.trim()) {
          const maxDelta = Number(draft.maxDeltaPerTurn);
          if (!Number.isFinite(maxDelta) || maxDelta < 1 || maxDelta > 30) {
            errors.push("Max delta per turn must be between 1 and 30.");
          }
        }
      } else if (draft.kind === "enum_single") {
        const options = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        if (options.length < 2) errors.push("Enum options require at least 2 unique values.");
        if (options.length > 12) errors.push("Enum options allow up to 12 values.");
        if (options.some(option => hasScriptLikeContent(option))) {
          errors.push("Enum values cannot contain script-like content.");
        }
        if (hasScriptLikeContent(String(draft.defaultValue ?? ""))) {
          errors.push("Default enum value cannot contain script-like content.");
        }
        const selected = String(draft.defaultValue ?? "");
        if (!selected.length) {
          errors.push("Default enum value is required.");
        } else if (resolveEnumOption(options, selected) == null) {
          errors.push("Default enum value must match one allowed option.");
        }
      } else if (draft.kind === "boolean") {
        if (!draft.booleanTrueLabel.trim()) errors.push("True label is required for boolean stats.");
        if (!draft.booleanFalseLabel.trim()) errors.push("False label is required for boolean stats.");
      } else if (draft.kind === "array") {
        const maxLen = Number(draft.textMaxLength);
        if (!Number.isFinite(maxLen) || maxLen < 20 || maxLen > 200) {
          errors.push("Text max length must be between 20 and 200.");
        }
        const bounded = Math.max(20, Math.min(200, Math.round(maxLen || 120)));
        const items = normalizeNonNumericArrayItems(draft.defaultValue, bounded);
        if (items.length > MAX_CUSTOM_ARRAY_ITEMS) {
          errors.push(`Array default supports up to ${MAX_CUSTOM_ARRAY_ITEMS} items.`);
        }
        if (items.some(item => item.length > bounded)) {
          errors.push("One or more array items exceed max length.");
        }
      } else if (draft.kind === "date_time") {
        const normalized = normalizeDateTimeValue(draft.defaultValue);
        if (draft.defaultValue.trim() && !normalized) {
          errors.push("Default date/time must be valid (YYYY-MM-DD HH:mm).");
        }
      } else if (draft.kind === "text_short") {
        const maxLen = Number(draft.textMaxLength);
        if (!Number.isFinite(maxLen) || maxLen < 20 || maxLen > 200) {
          errors.push("Text max length must be between 20 and 200.");
        }
        const bounded = Math.max(20, Math.min(200, Math.round(maxLen || 120)));
        if (String(draft.defaultValue ?? "").trim().length > bounded) {
          errors.push("Default text exceeds max length.");
        }
      }
    }

    if (step >= 3) {
      if (draft.globalScope && draft.privateToOwner) {
        errors.push("Global stats cannot be private.");
      }
      if (!draft.trackCharacters && !draft.trackUser) {
        errors.push("Enable at least one scope: Track for Characters or Track for User.");
      }
      if (draft.promptOverride.length > 20000) {
        errors.push("Custom prompt override is too long.");
      }
      const group = String(draft.sequentialGroup ?? "").trim().toLowerCase();
      if (group && !/^[a-z][a-z0-9_-]{0,31}$/.test(group)) {
        errors.push("Sequential group must start with a letter and use only a-z, 0-9, _ or - (max 32 chars).");
      }
    }

    if (step >= 4) {
      if (draft.behaviorGuidance.length > 2000) {
        errors.push("Behavior instruction is too long.");
      }
    }

    if (step >= 5) {
      const color = draft.color.trim();
      if (color && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
        errors.push("Color must be empty or a hex value like #66ccff.");
      }
    }

    return errors;
  };

  const toCustomStatDefinition = (draft: CustomStatDraft): CustomStatDefinition => {
    const maxDeltaText = draft.maxDeltaPerTurn.trim();
    const maxDeltaValue = maxDeltaText ? Number(maxDeltaText) : null;
    const behaviorGuidance = draft.behaviorGuidance.trim();
    const color = draft.color.trim();
    const template = draft.promptOverride.trim();
    const sequentialGroup = String(draft.sequentialGroup ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 32);
    const kind = normalizeCustomStatKind(draft.kind);
    const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
    const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
    const trueLabel = draft.booleanTrueLabel.trim().slice(0, 40) || "enabled";
    const falseLabel = draft.booleanFalseLabel.trim().slice(0, 40) || "disabled";
    const trackCharacters = Boolean(draft.trackCharacters);
    const trackUser = Boolean(draft.trackUser);
    const globalScope = Boolean(draft.globalScope);
    const resolvedTrackCharacters = globalScope ? true : trackCharacters;
    const resolvedTrackUser = globalScope ? true : trackUser;
    const track = resolvedTrackCharacters || resolvedTrackUser;
    const privateToOwner = globalScope ? false : Boolean(draft.privateToOwner);
    const resolvedDefault = (() => {
      if (kind === "numeric") return Math.max(0, Math.min(100, Math.round(Number(draft.defaultValue))));
      if (kind === "boolean") return Boolean(draft.defaultBoolean);
      if (kind === "enum_single") {
        const matched = resolveEnumOption(enumOptions, draft.defaultValue);
        if (matched != null) return matched;
        return enumOptions[0] ?? "";
      }
      if (kind === "array") {
        return normalizeNonNumericArrayItems(draft.defaultValue, textMaxLength);
      }
      if (kind === "date_time") {
        return normalizeDateTimeValue(draft.defaultValue);
      }
      return normalizeNonNumericTextValue(draft.defaultValue, textMaxLength);
    })();
    return {
      id: draft.id.trim().toLowerCase(),
      kind,
      label: draft.label.trim(),
      description: draft.description.trim(),
      behaviorGuidance: behaviorGuidance || undefined,
      defaultValue: resolvedDefault,
      maxDeltaPerTurn: kind === "numeric" && maxDeltaValue != null && Number.isFinite(maxDeltaValue)
        ? Math.max(1, Math.min(30, Math.round(maxDeltaValue)))
        : undefined,
      enumOptions: kind === "enum_single" ? enumOptions : undefined,
      booleanTrueLabel: kind === "boolean" ? trueLabel : undefined,
      booleanFalseLabel: kind === "boolean" ? falseLabel : undefined,
      textMaxLength: kind === "text_short" || kind === "array" ? textMaxLength : undefined,
      dateTimeMode: kind === "date_time"
        ? (draft.dateTimeMode === "structured" ? "structured" : "timestamp")
        : undefined,
      track,
      trackCharacters: resolvedTrackCharacters,
      trackUser: resolvedTrackUser,
      globalScope,
      privateToOwner,
      includeInInjection: draft.includeInInjection,
      showOnCard: track,
      showInGraph: kind === "numeric" ? track : false,
      color: color || undefined,
      promptOverride: template || undefined,
      sequentialGroup: sequentialGroup || undefined,
    };
  };

  let customStatsStatusTimer: number | null = null;
  const setCustomStatsStatus = (message: string, tone: "success" | "error" | "info" = "info"): void => {
    if (!customStatsImportStatusNode) return;
    customStatsImportStatusNode.textContent = message;
    customStatsImportStatusNode.style.display = message ? "block" : "none";
    customStatsImportStatusNode.classList.remove("is-success", "is-error", "is-info");
    customStatsImportStatusNode.classList.add(tone === "success" ? "is-success" : tone === "error" ? "is-error" : "is-info");
    if (customStatsStatusTimer != null) {
      window.clearTimeout(customStatsStatusTimer);
      customStatsStatusTimer = null;
    }
    if (message) {
      customStatsStatusTimer = window.setTimeout(() => {
        if (!customStatsImportStatusNode) return;
        customStatsImportStatusNode.style.display = "none";
        customStatsImportStatusNode.textContent = "";
        customStatsImportStatusNode.classList.remove("is-success", "is-error", "is-info");
      }, 9000);
    }
  };

  const normalizeImportedCustomStat = (
    raw: unknown,
    existingIds: Set<string>,
    index: number,
  ): { stat: CustomStatDefinition | null; warning: string | null } => {
    if (!raw || typeof raw !== "object") {
      return { stat: null, warning: `Skipped entry #${index + 1}: not an object.` };
    }
    const candidate = cloneCustomStatDefinition(raw as CustomStatDefinition);
    const kind = normalizeCustomStatKind(candidate.kind);
    const label = String(candidate.label ?? "").trim().slice(0, 40) || `Custom Stat ${index + 1}`;
    const idInput = String(candidate.id ?? "").trim().toLowerCase().slice(0, 32);
    let id = idInput;
    let warning: string | null = null;
    if (!id || !CUSTOM_STAT_ID_REGEX.test(id) || RESERVED_CUSTOM_STAT_IDS.has(id) || existingIds.has(id)) {
      id = suggestUniqueCustomStatId(id || label, existingIds);
      warning = `Adjusted ID for "${label}" to "${id}".`;
    }
    existingIds.add(id);
    const description = String(candidate.description ?? "").trim();
    const safeDescription = description.length >= 3
      ? description
      : `Tracks ${label} state from recent messages.`;
    const globalScope = Boolean(candidate.globalScope);
    const trackCharacters = globalScope ? true : Boolean(candidate.trackCharacters ?? candidate.track);
    const trackUser = globalScope ? true : Boolean(candidate.trackUser ?? candidate.track);
    const explicitTrack = typeof candidate.track === "boolean" ? candidate.track : null;
    const track = explicitTrack == null ? (trackCharacters || trackUser) : explicitTrack;
    const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(candidate.textMaxLength) || 120)));
    const enumOptions = kind === "enum_single"
      ? normalizeCustomEnumOptions(candidate.enumOptions).slice(0, MAX_CUSTOM_ENUM_OPTIONS)
      : undefined;
    if (kind === "enum_single" && (!enumOptions || enumOptions.length < 2)) {
      return { stat: null, warning: `Skipped "${label}": enum requires at least 2 options.` };
    }
    const promptOverride = typeof candidate.promptOverride === "string"
      ? candidate.promptOverride.trim().slice(0, 20_000)
      : undefined;
    const behaviorGuidance = typeof candidate.behaviorGuidance === "string"
      ? candidate.behaviorGuidance.trim().slice(0, 2_000)
      : undefined;
    const color = typeof candidate.color === "string"
      && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(candidate.color.trim())
      ? candidate.color.trim()
      : undefined;
    const sequentialGroup = typeof (candidate as { sequentialGroup?: string }).sequentialGroup === "string"
      ? String((candidate as { sequentialGroup?: string }).sequentialGroup)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_\-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 32)
      : "";
    const base: CustomStatDefinition = {
      ...candidate,
      id,
      kind,
      label,
      description: safeDescription,
      behaviorGuidance: behaviorGuidance || undefined,
      track,
      trackCharacters,
      trackUser,
      globalScope,
      privateToOwner: globalScope ? false : Boolean(candidate.privateToOwner),
      includeInInjection: candidate.includeInInjection !== false,
      showOnCard: Boolean(candidate.showOnCard ?? track),
      showInGraph: kind === "numeric" ? Boolean(candidate.showInGraph ?? track) : false,
      color,
      promptOverride: promptOverride || undefined,
      sequentialGroup: sequentialGroup || undefined,
      dateTimeMode: undefined,
    };

    if (kind === "numeric") {
      base.defaultValue = Math.max(0, Math.min(100, Math.round(Number(candidate.defaultValue) || 50)));
      const parsedMaxDelta = Number(candidate.maxDeltaPerTurn);
      base.maxDeltaPerTurn = Number.isFinite(parsedMaxDelta)
        ? Math.max(1, Math.min(30, Math.round(parsedMaxDelta)))
        : undefined;
      base.enumOptions = undefined;
      base.booleanTrueLabel = undefined;
      base.booleanFalseLabel = undefined;
      base.textMaxLength = undefined;
      return { stat: base, warning };
    }

    if (kind === "enum_single") {
      const options = enumOptions ?? [];
      base.enumOptions = options;
      base.defaultValue = resolveEnumOption(options, candidate.defaultValue) ?? options[0] ?? "";
      base.maxDeltaPerTurn = undefined;
      base.booleanTrueLabel = undefined;
      base.booleanFalseLabel = undefined;
      base.textMaxLength = undefined;
      return { stat: base, warning };
    }

    if (kind === "boolean") {
      const trueLabel = String(candidate.booleanTrueLabel ?? "enabled").trim().slice(0, 40) || "enabled";
      const falseLabel = String(candidate.booleanFalseLabel ?? "disabled").trim().slice(0, 40) || "disabled";
      base.defaultValue = typeof candidate.defaultValue === "boolean" ? candidate.defaultValue : false;
      base.booleanTrueLabel = trueLabel;
      base.booleanFalseLabel = falseLabel;
      base.maxDeltaPerTurn = undefined;
      base.enumOptions = undefined;
      base.textMaxLength = undefined;
      return { stat: base, warning };
    }

    if (kind === "array") {
      base.defaultValue = normalizeNonNumericArrayItems(candidate.defaultValue, textMaxLength);
      base.textMaxLength = textMaxLength;
      base.maxDeltaPerTurn = undefined;
      base.enumOptions = undefined;
      base.booleanTrueLabel = undefined;
      base.booleanFalseLabel = undefined;
      return { stat: base, warning };
    }

    if (kind === "date_time") {
      base.defaultValue = normalizeDateTimeValue(candidate.defaultValue);
      base.dateTimeMode = candidate.dateTimeMode === "structured" ? "structured" : "timestamp";
      base.textMaxLength = undefined;
      base.maxDeltaPerTurn = undefined;
      base.enumOptions = undefined;
      base.booleanTrueLabel = undefined;
      base.booleanFalseLabel = undefined;
      return { stat: base, warning };
    }

    base.defaultValue = normalizeNonNumericTextValue(candidate.defaultValue, textMaxLength);
    base.textMaxLength = textMaxLength;
    base.maxDeltaPerTurn = undefined;
    base.enumOptions = undefined;
    base.booleanTrueLabel = undefined;
    base.booleanFalseLabel = undefined;
    return { stat: base, warning };
  };

  const parseCustomStatsImportPayload = (
    rawText: string,
  ): { stats: CustomStatDefinition[]; warnings: string[]; error: string | null } => {
    const text = String(rawText ?? "").trim();
    if (!text) return { stats: [], warnings: [], error: "Import failed: input is empty." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { stats: [], warnings: [], error: "Import failed: invalid JSON." };
    }
    const sourceList = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === "object" && Array.isArray((parsed as { customStats?: unknown }).customStats)
        ? (parsed as { customStats: unknown[] }).customStats
        : null);
    if (!sourceList) {
      return { stats: [], warnings: [], error: "Import failed: expected array or { \"customStats\": [...] }." };
    }
    const warnings: string[] = [];
    const existingIds = new Set<string>();
    const imported: CustomStatDefinition[] = [];
    for (let i = 0; i < sourceList.length; i += 1) {
      if (imported.length >= MAX_CUSTOM_STATS) {
        warnings.push(`Only first ${MAX_CUSTOM_STATS} stats were imported (max limit reached).`);
        break;
      }
      const normalized = normalizeImportedCustomStat(sourceList[i], existingIds, i);
      if (normalized.warning) warnings.push(normalized.warning);
      if (!normalized.stat) continue;
      imported.push(normalized.stat);
    }
    if (!imported.length) {
      return { stats: [], warnings, error: "Import failed: no valid custom stats found in JSON." };
    }
    return { stats: imported, warnings, error: null };
  };

  const applyImportedCustomStats = (
    parsed: { stats: CustomStatDefinition[]; warnings: string[] },
    mode: "update_existing" | "skip_conflicts" = "update_existing",
  ): { added: number; replaced: number; skipped: number } => {
    const mergedById = new Map(customStatsState.map(stat => [stat.id, cloneCustomStatDefinition(stat)]));
    let replaced = 0;
    let added = 0;
    let skipped = 0;
    for (const stat of parsed.stats) {
      const id = String(stat.id ?? "").trim().toLowerCase();
      if (!id) continue;
      if (mergedById.has(id)) {
        if (mode === "skip_conflicts") {
          skipped += 1;
          continue;
        }
        replaced += 1;
      } else {
        added += 1;
      }
      mergedById.set(id, cloneCustomStatDefinition(stat));
    }
    customStatsState = Array.from(mergedById.values()).slice(0, MAX_CUSTOM_STATS);
    renderCustomStatsList();
    persistLive();
    return { added, replaced, skipped };
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const openClipboardFallbackWizard = (title: string, text: string): void => {
    closeCustomWizard();
    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">${escapeHtml(title)}</div>
          <div class="bst-custom-wizard-step">Clipboard unavailable. Copy manually from the box below.</div>
        </div>
        <button class="bst-btn bst-btn-soft" data-action="custom-close">Close</button>
      </div>
      <div class="bst-custom-import-box">
        <textarea class="bst-custom-import-textarea" data-bst-manual-copy readonly></textarea>
      </div>
      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="custom-close">Close</button>
      </div>
    `;

    const close = (): void => {
      backdropNode.remove();
      wizard.remove();
    };
    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    backdropNode.addEventListener("click", close);
    wizard.addEventListener("click", event => event.stopPropagation());
    const textarea = wizard.querySelector("[data-bst-manual-copy]") as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = text;
      textarea.focus();
      textarea.select();
    }
    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
  };

  const openCustomImportWizard = (): void => {
    closeCustomWizard();
    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">Import Custom Stats JSON</div>
          <div class="bst-custom-wizard-step">Merge mode: updates existing stats by ID, adds new stats, never replace-all.</div>
        </div>
        <button class="bst-btn bst-btn-soft" data-action="custom-close">Close</button>
      </div>
      <div class="bst-custom-import-box">
        <div class="bst-help-line">Paste JSON array or wrapped object: <code>{ "customStats": [...] }</code></div>
        <textarea class="bst-custom-import-textarea" data-bst-custom-import-text placeholder='[\n  {\n    "id": "clothes",\n    "kind": "array",\n    "label": "Clothes"\n  }\n]'></textarea>
        <div class="bst-help-line bst-custom-import-status is-info" data-bst-custom-import-status style="display:none;"></div>
      </div>
      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="custom-close">Cancel</button>
        <button type="button" class="bst-btn bst-btn-soft" data-action="custom-validate-import">Validate</button>
        <button type="button" class="bst-btn bst-btn-soft" data-action="custom-apply-import">Import</button>
      </div>
    `;

    const close = (): void => {
      backdropNode.remove();
      wizard.remove();
    };
    const statusNode = wizard.querySelector("[data-bst-custom-import-status]") as HTMLElement | null;
    const textarea = wizard.querySelector("[data-bst-custom-import-text]") as HTMLTextAreaElement | null;
    const setImportStatus = (message: string, tone: "success" | "error" | "info" = "info"): void => {
      if (!statusNode) return;
      statusNode.textContent = message;
      statusNode.style.display = message ? "block" : "none";
      statusNode.classList.remove("is-success", "is-error", "is-info");
      statusNode.classList.add(tone === "success" ? "is-success" : tone === "error" ? "is-error" : "is-info");
    };
    const runImport = (apply: boolean): void => {
      const parsed = parseCustomStatsImportPayload(String(textarea?.value ?? ""));
      if (parsed.error) {
        setImportStatus(parsed.error, "error");
        return;
      }
      const existing = new Set(customStatsState.map(stat => String(stat.id ?? "").trim().toLowerCase()));
      const conflicts = parsed.stats
        .map(stat => String(stat.id ?? "").trim().toLowerCase())
        .filter(id => id && existing.has(id));
      const warningSuffix = parsed.warnings.length
        ? ` Warnings: ${parsed.warnings.slice(0, 2).join(" ")}${parsed.warnings.length > 2 ? " ..." : ""}`
        : "";
      if (!apply) {
        const conflictSuffix = conflicts.length
          ? ` Conflicts: ${conflicts.length} (will require confirmation on import).`
          : "";
        setImportStatus(`Validation passed for ${parsed.stats.length} stat(s).${conflictSuffix}${warningSuffix}`, parsed.warnings.length || conflicts.length ? "info" : "success");
        return;
      }
      if (conflicts.length > 0) {
        const setImportWizardBlocked = (blocked: boolean): void => {
          if (blocked) {
            wizard.classList.add("bst-custom-wizard-muted");
            wizard.setAttribute("aria-hidden", "true");
          } else {
            wizard.classList.remove("bst-custom-wizard-muted");
            wizard.removeAttribute("aria-hidden");
          }
        };
        const preview = conflicts.slice(0, 5);
        const conflictBackdrop = document.createElement("div");
        conflictBackdrop.className = "bst-custom-wizard-backdrop bst-custom-wizard-backdrop-top";
        const conflictWizard = document.createElement("div");
        conflictWizard.className = "bst-custom-wizard bst-custom-wizard-top";
        conflictWizard.innerHTML = `
          <div class="bst-custom-wizard-head">
            <div>
              <div class="bst-custom-wizard-title">Import Conflict Warning</div>
              <div class="bst-custom-wizard-step">${conflicts.length} existing stat ID conflict(s)</div>
            </div>
          </div>
          <div class="bst-custom-wizard-panel is-active">
            <div class="bst-help-line">
              Conflicting IDs: <code>${escapeHtml(preview.join(", "))}${conflicts.length > preview.length ? ", ..." : ""}</code>
            </div>
            <div class="bst-help-line">
              Choose whether to update existing stats with imported definitions or skip conflicting items.
            </div>
          </div>
          <div class="bst-custom-wizard-actions">
            <button type="button" class="bst-btn" data-action="import-conflict-cancel">Cancel</button>
            <button type="button" class="bst-btn bst-btn-soft" data-action="import-conflict-skip">Skip conflicts</button>
            <button type="button" class="bst-btn bst-btn-soft" data-action="import-conflict-update">Update existing</button>
          </div>
        `;
        const closeConflict = (): void => {
          setImportWizardBlocked(false);
          conflictBackdrop.remove();
          conflictWizard.remove();
        };
        setImportWizardBlocked(true);
        conflictWizard.querySelector('[data-action="import-conflict-cancel"]')?.addEventListener("click", () => {
          closeConflict();
          setImportStatus("Import cancelled due to conflicts.", "info");
        });
        conflictWizard.querySelector('[data-action="import-conflict-skip"]')?.addEventListener("click", () => {
          const { added, replaced, skipped } = applyImportedCustomStats(parsed, "skip_conflicts");
          setCustomStatsStatus(`Imported ${parsed.stats.length} stat(s): +${added}, updated ${replaced}, skipped ${skipped}.${warningSuffix}`, parsed.warnings.length ? "info" : "success");
          closeConflict();
          close();
        });
        conflictWizard.querySelector('[data-action="import-conflict-update"]')?.addEventListener("click", () => {
          const { added, replaced, skipped } = applyImportedCustomStats(parsed, "update_existing");
          setCustomStatsStatus(`Imported ${parsed.stats.length} stat(s): +${added}, updated ${replaced}, skipped ${skipped}.${warningSuffix}`, parsed.warnings.length ? "info" : "success");
          closeConflict();
          close();
        });
        conflictBackdrop.addEventListener("click", closeConflict);
        conflictWizard.addEventListener("click", event => event.stopPropagation());
        document.body.appendChild(conflictBackdrop);
        document.body.appendChild(conflictWizard);
        return;
      }
      const { added, replaced, skipped } = applyImportedCustomStats(parsed, "update_existing");
      setCustomStatsStatus(`Imported ${parsed.stats.length} stat(s): +${added}, updated ${replaced}, skipped ${skipped}.${warningSuffix}`, parsed.warnings.length ? "info" : "success");
      close();
    };

    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    wizard.querySelector('[data-action="custom-validate-import"]')?.addEventListener("click", () => runImport(false));
    wizard.querySelector('[data-action="custom-apply-import"]')?.addEventListener("click", () => runImport(true));
    backdropNode.addEventListener("click", close);
    wizard.addEventListener("click", event => event.stopPropagation());

    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
    textarea?.focus();
  };

  const renderCustomStatsList = (): void => {
    if (!customStatsListNode) return;
    if (customAddButton) {
      customAddButton.disabled = customStatsState.length >= MAX_CUSTOM_STATS;
      customAddButton.title = customAddButton.disabled
        ? `Maximum ${MAX_CUSTOM_STATS} custom stats reached.`
        : "Add custom stat";
    }
    if (!customStatsState.length) {
      customStatsListNode.innerHTML = `
        <div class="bst-custom-stat-empty">
          No custom stats yet. Add one to track extra dimensions without changing built-in defaults.
        </div>
      `;
      return;
    }
    customStatsListNode.innerHTML = customStatsState.map(stat => {
      const kind = normalizeCustomStatKind(stat.kind);
      const trackCharacters = Boolean(stat.trackCharacters ?? stat.track);
      const trackUser = Boolean(stat.trackUser ?? stat.track);
      const globalScope = Boolean(stat.globalScope);
      const sequentialGroup = String((stat as { sequentialGroup?: string }).sequentialGroup ?? "").trim();
      const flags = [
        stat.track ? "enabled" : "disabled",
        `char:${trackCharacters ? "on" : "off"}`,
        `user:${trackUser ? "on" : "off"}`,
        kind,
        globalScope ? "global" : (stat.privateToOwner ? "private" : "shared"),
        sequentialGroup ? `group:${sequentialGroup}` : "group:solo",
        stat.includeInInjection ? "injection" : "no injection",
      ];
      const description = (stat.description ?? "").trim();
      const macroSegment = String(stat.id ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const quickEnabled = Boolean(stat.track);
      const allowsSceneMacro = quickEnabled && Boolean(stat.globalScope);
      const allowsUserMacro = quickEnabled && !Boolean(stat.globalScope) && Boolean(stat.trackUser ?? stat.track);
      const allowsCharMacro = quickEnabled && !Boolean(stat.globalScope) && Boolean(stat.trackCharacters ?? stat.track);
      const characterMacroExamples = (() => {
        if (!macroSegment || !allowsCharMacro) return [] as string[];
        const preview = (input.previewCharacterCandidates ?? [])
          .map(candidate => ({
            name: String(candidate?.name ?? "").trim(),
            avatar: String(candidate?.avatar ?? "").trim(),
          }))
          .filter(item => {
            if (!item.name) return false;
            const normalized = item.name.toLowerCase();
            return normalized !== USER_TRACKER_KEY.toLowerCase() && normalized !== GLOBAL_TRACKER_KEY.toLowerCase() && normalized !== "user";
          });
        const counts = new Map<string, number>();
        const examples: string[] = [];
        for (const item of preview) {
          if (examples.length >= 4) break;
          const avatarStem = item.avatar
            ? item.avatar.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.[a-z0-9]+$/i, "") ?? ""
            : "";
          const baseSlug = toMacroCharacterSlug(avatarStem || item.name);
          const next = (counts.get(baseSlug) ?? 0) + 1;
          counts.set(baseSlug, next);
          const resolvedSlug = next === 1 ? baseSlug : `${baseSlug}_${next}`;
          examples.push(`{{bst_stat_char_${macroSegment}_${resolvedSlug}}}`);
        }
        return examples;
      })();
      const macroScopes = macroSegment
        ? [
          ...(allowsUserMacro ? [`{{bst_stat_user_${macroSegment}}}`] : []),
          ...(allowsSceneMacro ? [`{{bst_stat_scene_${macroSegment}}}`] : []),
          ...characterMacroExamples,
        ]
        : [];
      const defaultMeta = (() => {
        if (kind === "numeric") {
          return `Default: ${Math.round(Number(stat.defaultValue) || 0)}% | Max delta: ${stat.maxDeltaPerTurn == null ? "global" : Math.round(Number(stat.maxDeltaPerTurn))}`;
        }
        if (kind === "boolean") {
          const trueLabel = String(stat.booleanTrueLabel ?? "enabled").trim() || "enabled";
          const falseLabel = String(stat.booleanFalseLabel ?? "disabled").trim() || "disabled";
          return `Default: ${Boolean(stat.defaultValue) ? trueLabel : falseLabel} | Graph: disabled`;
        }
        if (kind === "enum_single") {
          const options = normalizeCustomEnumOptions(stat.enumOptions);
          return `Default: ${String(stat.defaultValue ?? "").trim() || "(empty)"} | Options: ${options.length} | Graph: disabled`;
        }
        if (kind === "array") {
          const limit = Math.max(20, Math.min(200, Math.round(Number(stat.textMaxLength) || 120)));
          const items = normalizeNonNumericArrayItems(stat.defaultValue, limit);
          const preview = items.length ? items.slice(0, 2).join(", ") : "(empty)";
          const suffix = items.length > 2 ? ` +${items.length - 2} more` : "";
          return `Default: ${preview}${suffix} | Items: ${items.length}/${MAX_CUSTOM_ARRAY_ITEMS} | Item max: ${limit} | Graph: disabled`;
        }
        if (kind === "date_time") {
          const normalized = normalizeDateTimeValue(stat.defaultValue);
          return `Default: ${normalized || "(empty)"} | Format: YYYY-MM-DD HH:mm | Graph: disabled`;
        }
        const limit = Math.max(20, Math.min(200, Math.round(Number(stat.textMaxLength) || 120)));
        return `Default: ${String(stat.defaultValue ?? "").trim() || "(empty)"} | Max length: ${limit} | Graph: disabled`;
      })();
      const enabled = Boolean(stat.track);
      return `
        <div class="bst-custom-stat-row" data-bst-custom-id="${escapeHtml(stat.id)}">
          <div class="bst-custom-stat-main">
            <div class="bst-custom-stat-title">
              <span>${escapeHtml(stat.label)}</span>
              <span class="bst-custom-stat-id">${escapeHtml(stat.id)}</span>
            </div>
            <div class="bst-custom-stat-meta">
              ${escapeHtml(defaultMeta)}
            </div>
            ${description ? `<div class="bst-custom-stat-meta">${escapeHtml(description)}</div>` : ""}
            ${macroScopes.length || allowsCharMacro ? `<div class="bst-custom-stat-meta">Macros: ${macroScopes.map(item => `<code>${escapeHtml(item)}</code>`).join(" ")}${(allowsCharMacro && !characterMacroExamples.length) ? ` <code>{{bst_stat_char_${escapeHtml(macroSegment)}_&lt;character_slug&gt;}}</code>` : ""}</div>` : ""}
            <div class="bst-custom-stat-flags">
              ${flags.map(flag => `<span class="bst-custom-stat-flag">${escapeHtml(flag)}</span>`).join("")}
            </div>
          </div>
          <div class="bst-custom-stat-actions">
            <button type="button" class="bst-custom-stat-toggle ${enabled ? "is-on" : "is-off"}" data-action="custom-toggle-enabled" data-custom-id="${escapeHtml(stat.id)}" aria-pressed="${enabled ? "true" : "false"}" title="${enabled ? "Disable this stat quickly" : "Enable this stat quickly"}">
              <span class="bst-custom-stat-toggle-pill" aria-hidden="true"></span>
              <span class="bst-custom-stat-toggle-label">${enabled ? "Enabled" : "Disabled"}</span>
            </button>
            <button type="button" class="bst-btn bst-btn-soft" data-action="custom-edit" data-custom-id="${escapeHtml(stat.id)}">Edit</button>
            <button type="button" class="bst-btn bst-btn-soft" data-action="custom-duplicate" data-custom-id="${escapeHtml(stat.id)}">Clone</button>
            <button type="button" class="bst-btn bst-btn-soft" data-action="custom-export-json" data-custom-id="${escapeHtml(stat.id)}">Export JSON</button>
            <button type="button" class="bst-btn bst-btn-danger" data-action="custom-remove" data-custom-id="${escapeHtml(stat.id)}">Remove</button>
          </div>
        </div>
      `;
    }).join("");
  };

  const getSceneOrderEligibleStats = (): CustomStatDefinition[] =>
    customStatsState.filter(stat => {
      const kind = normalizeCustomStatKind(stat.kind);
      return kind !== "numeric" && Boolean(stat.globalScope) && Boolean(stat.showOnCard);
    });

  const getCharacterOrderEligibleStats = (): Array<{ id: string; label: string; source: "built_in" | "custom" }> => {
    const numeric = getNumericStatDefinitions(input.settings)
      .filter(def => def.showOnCard && def.trackCharacters && !def.globalScope)
      .map(def => ({ id: String(def.key).trim().toLowerCase(), label: def.label, source: "built_in" as const }));
    const custom = customStatsState
      .filter(stat => {
        const kind = normalizeCustomStatKind(stat.kind);
        return kind !== "numeric" && Boolean(stat.showOnCard) && Boolean(stat.trackCharacters) && !Boolean(stat.globalScope);
      })
      .map(stat => ({
        id: String(stat.id ?? "").trim().toLowerCase(),
        label: String(stat.label ?? "").trim() || String(stat.id ?? "").trim(),
        source: "custom" as const,
      }))
      .filter(stat => stat.id.length > 0);
    return [...numeric, ...custom];
  };

  const syncSceneCardStatOrderState = (): void => {
    const eligibleIds = getSceneOrderEligibleStats().map(stat => String(stat.id ?? "").trim().toLowerCase());
    const eligibleSet = new Set(eligibleIds);
    const next = sceneCardStatOrderState.filter(id => eligibleSet.has(id));
    for (const id of eligibleIds) {
      if (!next.includes(id)) next.push(id);
    }
    sceneCardStatOrderState = next;
    const nextDisplay: typeof sceneCardStatDisplayState = {};
    for (const id of eligibleIds) {
      if (sceneCardStatDisplayState[id]) {
        nextDisplay[id] = sceneCardStatDisplayState[id];
      }
    }
    sceneCardStatDisplayState = nextDisplay;
  };

  const syncCharacterCardStatOrderState = (): void => {
    const eligibleIds = getCharacterOrderEligibleStats().map(stat => stat.id);
    const eligibleSet = new Set(eligibleIds);
    const next = characterCardStatOrderState.filter(id => eligibleSet.has(id));
    for (const id of eligibleIds) {
      if (!next.includes(id)) next.push(id);
    }
    characterCardStatOrderState = next;
  };

  const renderSceneCardOrderList = (): void => {
    const orderListNode = modal.querySelector('[data-bst-row="sceneCardOrderList"]') as HTMLElement | null;
    if (!orderListNode) return;
    syncSceneCardStatOrderState();
    const eligible = getSceneOrderEligibleStats();
    if (!eligible.length) {
      orderListNode.innerHTML = `<div class="bst-scene-order-empty">No global non-numeric stats available for Scene Card ordering.</div>`;
      return;
    }
    const byId = new Map(eligible.map(stat => [String(stat.id ?? "").trim().toLowerCase(), stat]));
    const orderedIds = sceneCardStatOrderState.filter(id => byId.has(id));
    const rows = orderedIds.map((id, index) => {
      const stat = byId.get(id);
      if (!stat) return "";
      return `
        <div class="bst-scene-order-row" data-bst-scene-order-id="${escapeHtml(id)}">
          <div class="bst-scene-order-meta">
            <span class="bst-scene-order-name" title="${escapeHtml(stat.label)}">${escapeHtml(stat.label)}</span>
            <span class="bst-scene-order-id">${escapeHtml(stat.id)}</span>
          </div>
          <div class="bst-scene-order-actions">
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="scene-order-edit" data-scene-order-id="${escapeHtml(id)}" title="Edit display options" aria-label="Edit display options"><span class="fa-solid fa-pen" aria-hidden="true"></span></button>
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="scene-order-up" data-scene-order-id="${escapeHtml(id)}" ${index === 0 ? "disabled" : ""} title="Move up" aria-label="Move up"><span class="fa-solid fa-arrow-up" aria-hidden="true"></span></button>
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="scene-order-down" data-scene-order-id="${escapeHtml(id)}" ${index === orderedIds.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move down"><span class="fa-solid fa-arrow-down" aria-hidden="true"></span></button>
          </div>
        </div>
      `;
    }).join("");
    orderListNode.innerHTML = rows;
  };

  const renderCharacterCardOrderList = (): void => {
    const orderListNode = modal.querySelector('[data-bst-row="characterCardOrderList"]') as HTMLElement | null;
    if (!orderListNode) return;
    syncCharacterCardStatOrderState();
    const eligible = getCharacterOrderEligibleStats();
    if (!eligible.length) {
      orderListNode.innerHTML = `<div class="bst-scene-order-empty">No character-card stats available for ordering.</div>`;
      return;
    }
    const byId = new Map(eligible.map(stat => [stat.id, stat]));
    const orderedIds = characterCardStatOrderState.filter(id => byId.has(id));
    const rows = orderedIds.map((id, index) => {
      const stat = byId.get(id);
      if (!stat) return "";
      return `
        <div class="bst-scene-order-row" data-bst-char-order-id="${escapeHtml(id)}">
          <div class="bst-scene-order-meta">
            <span class="bst-scene-order-name" title="${escapeHtml(stat.label)}">${escapeHtml(stat.label)}</span>
            <span class="bst-scene-order-id">${escapeHtml(id)}${stat.source === "built_in" ? " · built-in" : ""}</span>
          </div>
          <div class="bst-scene-order-actions">
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="char-order-up" data-char-order-id="${escapeHtml(id)}" ${index === 0 ? "disabled" : ""} title="Move up" aria-label="Move up"><span class="fa-solid fa-arrow-up" aria-hidden="true"></span></button>
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="char-order-down" data-char-order-id="${escapeHtml(id)}" ${index === orderedIds.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move down"><span class="fa-solid fa-arrow-down" aria-hidden="true"></span></button>
          </div>
        </div>
      `;
    }).join("");
    orderListNode.innerHTML = rows;
  };

  const openSceneStatDisplayEditor = (statId: string): void => {
    const targetId = String(statId ?? "").trim().toLowerCase();
    if (!targetId) return;
    const stat = getSceneOrderEligibleStats().find(item => String(item.id ?? "").trim().toLowerCase() === targetId);
    if (!stat) return;
    const current = sceneCardStatDisplayState[targetId] ?? {
      visible: true,
      showLabel: true,
      hideWhenEmpty: false,
      labelOverride: "",
      colorOverride: "",
      layoutOverride: "auto" as const,
      valueStyle: "auto" as const,
      textMaxLength: null,
      arrayCollapsedLimit: null,
      dateTimeShowWeekday: true,
      dateTimeShowDate: true,
      dateTimeShowTime: true,
      dateTimeShowPhase: true,
      dateTimeShowPartLabels: false,
      dateTimeLabelWeekday: "Day",
      dateTimeLabelDate: "Date",
      dateTimeLabelTime: "Time",
      dateTimeLabelPhase: "Phase",
      dateTimeDateFormat: "iso" as const,
      dateTimePartOrder: ["weekday", "date", "time", "phase"] as Array<"weekday" | "date" | "time" | "phase">,
    };
    const isDateTime = normalizeCustomStatKind(stat.kind) === "date_time";
    const isStructuredDateTime = isDateTime && stat.dateTimeMode === "structured";
    let dateTimePartOrderDraft = normalizeDateTimePartOrder(
      (current.dateTimePartOrder ?? ["weekday", "date", "time", "phase"]).map(item => String(item ?? "")),
    );
    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">Scene Stat Display</div>
          <div class="bst-custom-wizard-step">${escapeHtml(stat.label)} (${escapeHtml(stat.id)})</div>
        </div>
        <button type="button" class="bst-btn bst-close-btn" data-action="scene-stat-close" aria-label="Close">&times;</button>
      </div>
      <div class="bst-custom-wizard-panel is-active">
        <div class="bst-settings-grid bst-settings-grid-single">
          <div class="bst-scene-stat-editor-group">
            <div class="bst-scene-stat-editor-group-title">Visibility</div>
            <div class="bst-check-grid">
              <label class="bst-check"><input type="checkbox" data-scene-opt="visible" ${current.visible ? "checked" : ""}>Show on Scene Card</label>
              <label class="bst-check"><input type="checkbox" data-scene-opt="showLabel" ${current.showLabel !== false ? "checked" : ""}>Show label</label>
              <label class="bst-check"><input type="checkbox" data-scene-opt="hideWhenEmpty" ${current.hideWhenEmpty !== false ? "checked" : ""}>Hide when empty</label>
            </div>
          </div>
          <div class="bst-scene-stat-editor-group">
            <div class="bst-scene-stat-editor-group-title">Presentation</div>
            <label>Label Override
              <input type="text" data-scene-opt="labelOverride" maxlength="40" value="${escapeHtml(current.labelOverride)}" placeholder="Use default label">
            </label>
            <label>Color Override
              <div class="bst-color-inputs">
                <input type="color" data-scene-opt-color="colorOverride">
                <input type="text" data-scene-opt="colorOverride" value="${escapeHtml(current.colorOverride)}" placeholder="Use global/default">
              </div>
            </label>
            <label>Layout Override
              <select data-scene-opt="layoutOverride">
                <option value="auto"${current.layoutOverride === "auto" ? " selected" : ""}>Use Scene Card default</option>
                <option value="chips"${current.layoutOverride === "chips" ? " selected" : ""}>Chips</option>
                <option value="rows"${current.layoutOverride === "rows" ? " selected" : ""}>Rows</option>
              </select>
            </label>
            <label>Value Style (non-array)
              <select data-scene-opt="valueStyle">
                <option value="auto"${current.valueStyle === "auto" ? " selected" : ""}>Auto</option>
                <option value="chip"${current.valueStyle === "chip" ? " selected" : ""}>Chip</option>
                <option value="plain"${current.valueStyle === "plain" ? " selected" : ""}>Plain text</option>
              </select>
            </label>
            <label>Text Max Length
              <input type="number" min="10" max="400" data-scene-opt="textMaxLength" value="${current.textMaxLength == null ? "" : String(current.textMaxLength)}" placeholder="No clamp">
            </label>
          </div>
          <div class="bst-scene-stat-editor-group" data-scene-opt-row="arrayLimit">
            <div class="bst-scene-stat-editor-group-title">Array Handling</div>
            <label>Array Collapse Limit (1-${MAX_CUSTOM_ARRAY_ITEMS})
              <input type="number" min="1" max="${MAX_CUSTOM_ARRAY_ITEMS}" data-scene-opt="arrayCollapsedLimit" value="${current.arrayCollapsedLimit == null ? "" : String(current.arrayCollapsedLimit)}" placeholder="Use Scene Card default">
            </label>
          </div>
          <div class="bst-scene-stat-editor-group" data-scene-opt-row="dateTimeFormat"${isDateTime ? "" : " style=\"display:none;\""}>
            <div class="bst-scene-stat-editor-group-title">Date/Time Format</div>
            <label>Date Format
              <select data-scene-opt="dateTimeDateFormat">
                <option value="iso"${(current.dateTimeDateFormat ?? "iso") === "iso" ? " selected" : ""}>YYYY-MM-DD</option>
                <option value="dmy"${current.dateTimeDateFormat === "dmy" ? " selected" : ""}>DD-MM-YYYY</option>
                <option value="mdy"${current.dateTimeDateFormat === "mdy" ? " selected" : ""}>MM-DD-YYYY</option>
                <option value="d_mmm_yyyy"${current.dateTimeDateFormat === "d_mmm_yyyy" ? " selected" : ""}>DD MMM YYYY</option>
                <option value="mmmm_d_yyyy"${current.dateTimeDateFormat === "mmmm_d_yyyy" ? " selected" : ""}>MMMM D, YYYY</option>
                <option value="mmmm_do_yyyy"${current.dateTimeDateFormat === "mmmm_do_yyyy" ? " selected" : ""}>MMMM Do, YYYY</option>
              </select>
            </label>
          </div>
          <div class="bst-scene-stat-editor-group" data-scene-opt-row="dateTimeStructured"${isStructuredDateTime ? "" : " style=\"display:none;\""}>
            <div class="bst-scene-stat-editor-group-title">Structured Date/Time Parts</div>
            <div class="bst-check-grid">
              <label class="bst-check"><input type="checkbox" data-scene-opt="dateTimeShowWeekday" ${current.dateTimeShowWeekday !== false ? "checked" : ""}>Show weekday</label>
              <label class="bst-check"><input type="checkbox" data-scene-opt="dateTimeShowDate" ${current.dateTimeShowDate !== false ? "checked" : ""}>Show date</label>
              <label class="bst-check"><input type="checkbox" data-scene-opt="dateTimeShowTime" ${current.dateTimeShowTime !== false ? "checked" : ""}>Show time</label>
              <label class="bst-check"><input type="checkbox" data-scene-opt="dateTimeShowPhase" ${current.dateTimeShowPhase !== false ? "checked" : ""}>Show phase</label>
              <label class="bst-check"><input type="checkbox" data-scene-opt="dateTimeShowPartLabels" ${current.dateTimeShowPartLabels ? "checked" : ""}>Show part labels</label>
            </div>
            <div class="bst-settings-grid">
              <label>Weekday Label
                <input type="text" maxlength="20" data-scene-opt="dateTimeLabelWeekday" value="${escapeHtml(current.dateTimeLabelWeekday ?? "Day")}" placeholder="Day">
              </label>
              <label>Date Label
                <input type="text" maxlength="20" data-scene-opt="dateTimeLabelDate" value="${escapeHtml(current.dateTimeLabelDate ?? "Date")}" placeholder="Date">
              </label>
              <label>Time Label
                <input type="text" maxlength="20" data-scene-opt="dateTimeLabelTime" value="${escapeHtml(current.dateTimeLabelTime ?? "Time")}" placeholder="Time">
              </label>
              <label>Phase Label
                <input type="text" maxlength="20" data-scene-opt="dateTimeLabelPhase" value="${escapeHtml(current.dateTimeLabelPhase ?? "Phase")}" placeholder="Phase">
              </label>
            </div>
            <div class="bst-scene-stat-editor-group-title">Part Order</div>
            <div data-scene-opt="dateTimePartOrderRows"></div>
          </div>
        </div>
      </div>
      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="scene-stat-cancel">Cancel</button>
        <button type="button" class="bst-btn bst-btn-soft" data-action="scene-stat-save">Save</button>
      </div>
    `;
    const close = (): void => {
      backdropNode.remove();
      wizard.remove();
    };
    const syncColorPicker = (): void => {
      const textNode = wizard.querySelector('[data-scene-opt="colorOverride"]') as HTMLInputElement | null;
      const colorNode = wizard.querySelector('[data-scene-opt-color="colorOverride"]') as HTMLInputElement | null;
      if (!textNode || !colorNode) return;
      colorNode.value = normalizeHexColor(textNode.value) ?? (normalizeHexColor(input.settings.sceneCardValueColor) ?? "#ff5a6f");
    };
    const updateArrayRow = (): void => {
      const row = wizard.querySelector('[data-scene-opt-row="arrayLimit"]') as HTMLElement | null;
      const layoutNode = wizard.querySelector('[data-scene-opt="layoutOverride"]') as HTMLSelectElement | null;
      const effectiveLayout = String(layoutNode?.value ?? "auto");
      const show = normalizeCustomStatKind(stat.kind) === "array" && (effectiveLayout === "auto" || effectiveLayout === "chips");
      if (row) row.style.display = show ? "block" : "none";
    };
    syncColorPicker();
    updateArrayRow();
    const renderDateTimePartOrderRows = (): void => {
      const rowsNode = wizard.querySelector('[data-scene-opt="dateTimePartOrderRows"]') as HTMLElement | null;
      if (!rowsNode) return;
      rowsNode.innerHTML = dateTimePartOrderDraft.map((part, index) => `
        <div class="bst-scene-order-row" data-scene-dt-part-row="${index}">
          <div class="bst-scene-order-meta">
            <span class="bst-scene-order-name">${escapeHtml(part)}</span>
            <span class="bst-scene-order-id">Position ${index + 1}</span>
          </div>
          <div class="bst-scene-order-actions">
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="scene-dt-part-up" data-scene-dt-part-index="${index}" ${index === 0 ? "disabled" : ""} title="Move up" aria-label="Move up"><span class="fa-solid fa-arrow-up" aria-hidden="true"></span></button>
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="scene-dt-part-down" data-scene-dt-part-index="${index}" ${index === dateTimePartOrderDraft.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move down"><span class="fa-solid fa-arrow-down" aria-hidden="true"></span></button>
          </div>
        </div>
      `).join("");
    };
    renderDateTimePartOrderRows();
    const textColor = wizard.querySelector('[data-scene-opt="colorOverride"]') as HTMLInputElement | null;
    const colorColor = wizard.querySelector('[data-scene-opt-color="colorOverride"]') as HTMLInputElement | null;
    textColor?.addEventListener("input", syncColorPicker);
    colorColor?.addEventListener("input", () => {
      if (textColor && colorColor) textColor.value = colorColor.value;
    });
    wizard.querySelector('[data-scene-opt="layoutOverride"]')?.addEventListener("change", updateArrayRow);
    wizard.addEventListener("click", event => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button[data-action][data-scene-dt-part-index]") as HTMLButtonElement | null;
      if (!button) return;
      const index = Number(button.getAttribute("data-scene-dt-part-index"));
      if (!Number.isInteger(index) || index < 0 || index >= dateTimePartOrderDraft.length) return;
      if (button.dataset.action === "scene-dt-part-up" && index > 0) {
        [dateTimePartOrderDraft[index - 1], dateTimePartOrderDraft[index]] = [dateTimePartOrderDraft[index], dateTimePartOrderDraft[index - 1]];
        renderDateTimePartOrderRows();
        return;
      }
      if (button.dataset.action === "scene-dt-part-down" && index < dateTimePartOrderDraft.length - 1) {
        [dateTimePartOrderDraft[index + 1], dateTimePartOrderDraft[index]] = [dateTimePartOrderDraft[index], dateTimePartOrderDraft[index + 1]];
        renderDateTimePartOrderRows();
      }
    });
    wizard.querySelector('[data-action="scene-stat-close"]')?.addEventListener("click", close);
    wizard.querySelector('[data-action="scene-stat-cancel"]')?.addEventListener("click", close);
    wizard.querySelector('[data-action="scene-stat-save"]')?.addEventListener("click", () => {
      const visibleNode = wizard.querySelector('[data-scene-opt="visible"]') as HTMLInputElement | null;
      const labelNode = wizard.querySelector('[data-scene-opt="labelOverride"]') as HTMLInputElement | null;
      const colorNode = wizard.querySelector('[data-scene-opt="colorOverride"]') as HTMLInputElement | null;
      const layoutNode = wizard.querySelector('[data-scene-opt="layoutOverride"]') as HTMLSelectElement | null;
      const showLabelNode = wizard.querySelector('[data-scene-opt="showLabel"]') as HTMLInputElement | null;
      const hideWhenEmptyNode = wizard.querySelector('[data-scene-opt="hideWhenEmpty"]') as HTMLInputElement | null;
      const valueStyleNode = wizard.querySelector('[data-scene-opt="valueStyle"]') as HTMLSelectElement | null;
      const textMaxLengthNode = wizard.querySelector('[data-scene-opt="textMaxLength"]') as HTMLInputElement | null;
      const arrayLimitNode = wizard.querySelector('[data-scene-opt="arrayCollapsedLimit"]') as HTMLInputElement | null;
      const dateTimeShowWeekdayNode = wizard.querySelector('[data-scene-opt="dateTimeShowWeekday"]') as HTMLInputElement | null;
      const dateTimeShowDateNode = wizard.querySelector('[data-scene-opt="dateTimeShowDate"]') as HTMLInputElement | null;
      const dateTimeShowTimeNode = wizard.querySelector('[data-scene-opt="dateTimeShowTime"]') as HTMLInputElement | null;
      const dateTimeShowPhaseNode = wizard.querySelector('[data-scene-opt="dateTimeShowPhase"]') as HTMLInputElement | null;
      const dateTimeShowPartLabelsNode = wizard.querySelector('[data-scene-opt="dateTimeShowPartLabels"]') as HTMLInputElement | null;
      const dateTimeLabelWeekdayNode = wizard.querySelector('[data-scene-opt="dateTimeLabelWeekday"]') as HTMLInputElement | null;
      const dateTimeLabelDateNode = wizard.querySelector('[data-scene-opt="dateTimeLabelDate"]') as HTMLInputElement | null;
      const dateTimeLabelTimeNode = wizard.querySelector('[data-scene-opt="dateTimeLabelTime"]') as HTMLInputElement | null;
      const dateTimeLabelPhaseNode = wizard.querySelector('[data-scene-opt="dateTimeLabelPhase"]') as HTMLInputElement | null;
      const dateTimeDateFormatNode = wizard.querySelector('[data-scene-opt="dateTimeDateFormat"]') as HTMLSelectElement | null;
      const layoutOverride = layoutNode?.value === "chips" || layoutNode?.value === "rows" ? layoutNode.value : "auto";
      const valueStyle = valueStyleNode?.value === "chip" || valueStyleNode?.value === "plain" ? valueStyleNode.value : "auto";
      const parsedTextMaxRaw = Number(textMaxLengthNode?.value ?? "");
      const textMaxLength = Number.isFinite(parsedTextMaxRaw) && !Number.isNaN(parsedTextMaxRaw)
        ? Math.max(10, Math.min(400, Math.round(parsedTextMaxRaw)))
        : null;
      const parsedLimitRaw = Number(arrayLimitNode?.value ?? "");
      const arrayCollapsedLimit = Number.isFinite(parsedLimitRaw) && !Number.isNaN(parsedLimitRaw)
        ? Math.max(1, Math.min(MAX_CUSTOM_ARRAY_ITEMS, Math.round(parsedLimitRaw)))
        : null;
      const dateTimePartOrder = normalizeDateTimePartOrder(dateTimePartOrderDraft);
      sceneCardStatDisplayState[targetId] = {
        visible: Boolean(visibleNode?.checked ?? true),
        showLabel: Boolean(showLabelNode?.checked ?? true),
        hideWhenEmpty: Boolean(hideWhenEmptyNode?.checked ?? true),
        labelOverride: String(labelNode?.value ?? "").trim().slice(0, 40),
        colorOverride: normalizeHexColor(String(colorNode?.value ?? "")) ?? "",
        layoutOverride: layoutOverride as "auto" | "chips" | "rows",
        valueStyle: valueStyle as "auto" | "chip" | "plain",
        textMaxLength,
        arrayCollapsedLimit,
        dateTimeShowWeekday: Boolean(dateTimeShowWeekdayNode?.checked ?? true),
        dateTimeShowDate: Boolean(dateTimeShowDateNode?.checked ?? true),
        dateTimeShowTime: Boolean(dateTimeShowTimeNode?.checked ?? true),
        dateTimeShowPhase: Boolean(dateTimeShowPhaseNode?.checked ?? true),
        dateTimeShowPartLabels: Boolean(dateTimeShowPartLabelsNode?.checked ?? false),
        dateTimeLabelWeekday: String(dateTimeLabelWeekdayNode?.value ?? "Day").trim().slice(0, 20) || "Day",
        dateTimeLabelDate: String(dateTimeLabelDateNode?.value ?? "Date").trim().slice(0, 20) || "Date",
        dateTimeLabelTime: String(dateTimeLabelTimeNode?.value ?? "Time").trim().slice(0, 20) || "Time",
        dateTimeLabelPhase: String(dateTimeLabelPhaseNode?.value ?? "Phase").trim().slice(0, 20) || "Phase",
        dateTimeDateFormat:
          dateTimeDateFormatNode?.value === "dmy" ||
          dateTimeDateFormatNode?.value === "mdy" ||
          dateTimeDateFormatNode?.value === "d_mmm_yyyy" ||
          dateTimeDateFormatNode?.value === "mmmm_d_yyyy" ||
          dateTimeDateFormatNode?.value === "mmmm_do_yyyy"
            ? dateTimeDateFormatNode.value
            : "iso",
        dateTimePartOrder,
      };
      renderSceneCardOrderList();
      renderCharacterCardOrderList();
      persistLive();
      close();
    });
    backdropNode.addEventListener("click", close);
    wizard.addEventListener("click", event => event.stopPropagation());
    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
  };

  const closeCustomWizard = (): void => {
    document.querySelector(".bst-custom-wizard-backdrop")?.remove();
    document.querySelector(".bst-custom-wizard")?.remove();
  };

  const openBuiltInManagerWizard = (): void => {
    closeCustomWizard();
    const current = collectSettings();
    const draftUi = cloneBuiltInNumericStatUi(current.builtInNumericStatUi);
    const draftTrack: Record<(typeof BUILT_IN_TRACKABLE_STAT_KEY_LIST)[number], boolean> = {
      affection: current.trackAffection,
      trust: current.trackTrust,
      desire: current.trackDesire,
      connection: current.trackConnection,
      mood: current.trackMood,
      lastThought: current.trackLastThought,
    };
    let draftLastThoughtPrivate = Boolean(current.lastThoughtPrivate);

    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    const renderRows = (): string =>
      BUILT_IN_TRACKABLE_STAT_KEY_LIST.map(key => {
        const isNumeric = BUILT_IN_NUMERIC_STAT_KEYS.has(key);
        const enabled = isNumeric
          ? (draftTrack[key] || draftUi[key as keyof BuiltInNumericStatUiSettings].showOnCard || draftUi[key as keyof BuiltInNumericStatUiSettings].showInGraph)
          : draftTrack[key];
        return `
        <div class="bst-custom-stat-row">
          <div class="bst-custom-stat-main">
            <div class="bst-custom-stat-title">
              <span>${escapeHtml(BUILT_IN_STAT_LABELS[key])}</span>
              <span class="bst-custom-stat-id">${escapeHtml(key)}</span>
            </div>
          </div>
          <div class="bst-check-grid bst-toggle-block ${isNumeric ? "" : "bst-check-grid-single"}">
            <label class="bst-check"><input type="checkbox" data-bst-builtin-enabled="${key}" ${enabled ? "checked" : ""}>${isNumeric ? "Enabled (Track + Card + Graph)" : "Enabled (Track)"}</label>
            ${isNumeric
              ? `<label class="bst-check"><input type="checkbox" data-bst-builtin-inject="${key}" ${draftUi[key as keyof BuiltInNumericStatUiSettings].includeInInjection ? "checked" : ""}>Include in prompt injection</label>`
              : key === "lastThought"
                ? `<label class="bst-check"><input type="checkbox" data-bst-builtin-last-thought-private="1" ${draftLastThoughtPrivate ? "checked" : ""}>Private (owner-scoped)</label>`
                : ""}
          </div>
        </div>
      `;
      }).join("");

    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">Manage Built-in Stats</div>
          <div class="bst-custom-wizard-step" data-bst-builtin-step>Step 1 / 2</div>
        </div>
        <button type="button" class="bst-btn bst-close-btn" data-action="custom-close" aria-label="Close">&times;</button>
      </div>
      <div class="bst-custom-wizard-panel is-active" data-bst-builtin-panel="1">
        <div class="bst-help-line">Built-in stats are never deleted. You can manage whether each one is enabled.</div>
        <ul class="bst-help-list">
          <li><strong>Enabled</strong>: one toggle for Track + Card + Graph on numeric built-ins, and Track on text built-ins.</li>
          <li><strong>Include in prompt injection</strong>: controls prompt injection lines for numeric built-ins.</li>
          <li><strong>Private (owner-scoped)</strong>: for lastThought, keep it visible only to the current target owner in prompt injection.</li>
        </ul>
      </div>
      <div class="bst-custom-wizard-panel" data-bst-builtin-panel="2">
        <div class="bst-help-line">Configure built-in stats behavior:</div>
        ${renderRows()}
      </div>
      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="builtin-back">Back</button>
        <div style="display:flex; gap:8px;">
          <button type="button" class="bst-btn bst-btn-soft" data-action="builtin-next">Next</button>
          <button type="button" class="bst-btn bst-btn-soft" data-action="builtin-save" style="display:none;">Save</button>
        </div>
      </div>
    `;

    const stepLabel = wizard.querySelector('[data-bst-builtin-step]') as HTMLElement | null;
    const panel1 = wizard.querySelector('[data-bst-builtin-panel="1"]') as HTMLElement | null;
    const panel2 = wizard.querySelector('[data-bst-builtin-panel="2"]') as HTMLElement | null;
    const backBtn = wizard.querySelector('[data-action="builtin-back"]') as HTMLButtonElement | null;
    const nextBtn = wizard.querySelector('[data-action="builtin-next"]') as HTMLButtonElement | null;
    const saveBtn = wizard.querySelector('[data-action="builtin-save"]') as HTMLButtonElement | null;
    let step = 1;

    const syncStep = (): void => {
      if (stepLabel) stepLabel.textContent = `Step ${step} / 2`;
      panel1?.classList.toggle("is-active", step === 1);
      panel2?.classList.toggle("is-active", step === 2);
      if (backBtn) backBtn.style.visibility = step === 1 ? "hidden" : "visible";
      if (nextBtn) nextBtn.style.display = step === 1 ? "" : "none";
      if (saveBtn) saveBtn.style.display = step === 2 ? "" : "none";
    };

    const applyFromDom = (): void => {
      for (const key of BUILT_IN_TRACKABLE_STAT_KEY_LIST) {
        const enabled = Boolean((wizard.querySelector(`[data-bst-builtin-enabled="${key}"]`) as HTMLInputElement | null)?.checked);
        draftTrack[key] = enabled;
        if (BUILT_IN_NUMERIC_STAT_KEYS.has(key)) {
          const numericKey = key as (typeof BUILT_IN_NUMERIC_STAT_KEY_LIST)[number];
          draftUi[numericKey].showOnCard = enabled;
          draftUi[numericKey].showInGraph = enabled;
          draftUi[numericKey].includeInInjection = Boolean((wizard.querySelector(`[data-bst-builtin-inject="${key}"]`) as HTMLInputElement | null)?.checked);
        }
      }
      draftLastThoughtPrivate = Boolean((wizard.querySelector('[data-bst-builtin-last-thought-private="1"]') as HTMLInputElement | null)?.checked);
    };

    const close = (): void => closeCustomWizard();
    backdropNode.addEventListener("click", close);
    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    backBtn?.addEventListener("click", () => {
      step = 1;
      syncStep();
    });
    nextBtn?.addEventListener("click", () => {
      step = 2;
      syncStep();
    });
    saveBtn?.addEventListener("click", () => {
      applyFromDom();
      builtInNumericStatUiState = cloneBuiltInNumericStatUi(draftUi);
      input.settings.trackAffection = draftTrack.affection;
      input.settings.trackTrust = draftTrack.trust;
      input.settings.trackDesire = draftTrack.desire;
      input.settings.trackConnection = draftTrack.connection;
      input.settings.trackMood = draftTrack.mood;
      input.settings.trackLastThought = draftTrack.lastThought;
      input.settings.lastThoughtPrivate = draftLastThoughtPrivate;
      close();
      persistLive();
    });

    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
    syncStep();
  };

  const openCustomRemoveWizard = (target: CustomStatDefinition): void => {
    closeCustomWizard();
    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">Remove Custom Stat</div>
          <div class="bst-custom-wizard-step" data-bst-remove-step>Step 1 / 2</div>
        </div>
        <button type="button" class="bst-btn bst-close-btn" data-action="custom-close" aria-label="Close">&times;</button>
      </div>
      <div class="bst-custom-wizard-panel is-active" data-bst-remove-panel="1">
        <div class="bst-help-line"><strong>${escapeHtml(target.label)}</strong> (${escapeHtml(target.id)}) will be removed from active definitions.</div>
        <ul class="bst-help-list">
          <li>Future extraction will stop updating this stat.</li>
          <li>Cards/graph/injection will stop showing this stat.</li>
          <li>Historical snapshot payload is retained (soft remove).</li>
        </ul>
      </div>
      <div class="bst-custom-wizard-panel" data-bst-remove-panel="2">
        <div class="bst-help-line">Confirm removal of <strong>${escapeHtml(target.label)}</strong>.</div>
        <div class="bst-help-line">This is a soft remove only in current release.</div>
      </div>
      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="custom-remove-back">Back</button>
        <div style="display:flex; gap:8px;">
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-remove-next">Next</button>
          <button type="button" class="bst-btn bst-btn-danger" data-action="custom-remove-confirm" style="display:none;">Remove Stat</button>
        </div>
      </div>
    `;
    const stepLabel = wizard.querySelector("[data-bst-remove-step]") as HTMLElement | null;
    const panel1 = wizard.querySelector('[data-bst-remove-panel="1"]') as HTMLElement | null;
    const panel2 = wizard.querySelector('[data-bst-remove-panel="2"]') as HTMLElement | null;
    const backBtn = wizard.querySelector('[data-action="custom-remove-back"]') as HTMLButtonElement | null;
    const nextBtn = wizard.querySelector('[data-action="custom-remove-next"]') as HTMLButtonElement | null;
    const confirmBtn = wizard.querySelector('[data-action="custom-remove-confirm"]') as HTMLButtonElement | null;
    let step = 1;

    const syncStep = (): void => {
      if (stepLabel) stepLabel.textContent = `Step ${step} / 2`;
      panel1?.classList.toggle("is-active", step === 1);
      panel2?.classList.toggle("is-active", step === 2);
      if (backBtn) backBtn.style.visibility = step === 1 ? "hidden" : "visible";
      if (nextBtn) nextBtn.style.display = step === 1 ? "" : "none";
      if (confirmBtn) confirmBtn.style.display = step === 2 ? "" : "none";
    };
    syncStep();

    const close = (): void => closeCustomWizard();
    backdropNode.addEventListener("click", close);
    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    backBtn?.addEventListener("click", () => {
      step = 1;
      syncStep();
    });
    nextBtn?.addEventListener("click", () => {
      step = 2;
      syncStep();
    });
    confirmBtn?.addEventListener("click", () => {
      customStatsState = customStatsState.filter(item => item.id !== target.id);
      renderCustomStatsList();
      close();
      persistLive();
    });

    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
  };

  const openCustomStatWizard = (mode: CustomStatWizardMode, source?: CustomStatDefinition): void => {
    if (mode === "add" && customStatsState.length >= MAX_CUSTOM_STATS) return;
    closeCustomWizard();

    const existingIds = new Set(customStatsState.map(item => item.id));
    const fallbackBase = source?.label || source?.id || "custom_stat";
    const draft = makeDraft(mode, source);
    if (mode === "add" && !draft.id) {
      draft.id = suggestUniqueCustomStatId(fallbackBase, existingIds);
    }
    const sceneDisplaySeed = sceneCardStatDisplayState[String(source?.id ?? draft.id ?? "").trim().toLowerCase()] ?? {};
    const dateTimeShowWeekdaySeed = sceneDisplaySeed.dateTimeShowWeekday !== false;
    const dateTimeShowDateSeed = sceneDisplaySeed.dateTimeShowDate !== false;
    const dateTimeShowTimeSeed = sceneDisplaySeed.dateTimeShowTime !== false;
    const dateTimeShowPhaseSeed = sceneDisplaySeed.dateTimeShowPhase !== false;
    const dateTimeShowPartLabelsSeed = Boolean(sceneDisplaySeed.dateTimeShowPartLabels ?? false);
    const dateTimeLabelWeekdaySeed = String(sceneDisplaySeed.dateTimeLabelWeekday ?? "Day").trim() || "Day";
    const dateTimeLabelDateSeed = String(sceneDisplaySeed.dateTimeLabelDate ?? "Date").trim() || "Date";
    const dateTimeLabelTimeSeed = String(sceneDisplaySeed.dateTimeLabelTime ?? "Time").trim() || "Time";
    const dateTimeLabelPhaseSeed = String(sceneDisplaySeed.dateTimeLabelPhase ?? "Phase").trim() || "Phase";
    const dateTimeDateFormatSeed: "iso" | "dmy" | "mdy" | "d_mmm_yyyy" | "mmmm_d_yyyy" | "mmmm_do_yyyy" =
      sceneDisplaySeed.dateTimeDateFormat === "dmy" ||
      sceneDisplaySeed.dateTimeDateFormat === "mdy" ||
      sceneDisplaySeed.dateTimeDateFormat === "d_mmm_yyyy" ||
      sceneDisplaySeed.dateTimeDateFormat === "mmmm_d_yyyy" ||
      sceneDisplaySeed.dateTimeDateFormat === "mmmm_do_yyyy"
        ? sceneDisplaySeed.dateTimeDateFormat
        : "iso";
    const dateTimePartOrderSeed = normalizeDateTimePartOrder(
      Array.isArray(sceneDisplaySeed.dateTimePartOrder)
        ? sceneDisplaySeed.dateTimePartOrder.map(item => String(item ?? ""))
        : ["weekday", "date", "time", "phase"],
    );
    let dateTimePartOrderDraft = [...dateTimePartOrderSeed];

    let idTouched = Boolean(draft.id && mode !== "add");
    let step = 1;

    const backdropNode = document.createElement("div");
    backdropNode.className = "bst-custom-wizard-backdrop";
    const wizard = document.createElement("div");
    wizard.className = "bst-custom-wizard";
    wizard.innerHTML = `
      <div class="bst-custom-wizard-head">
        <div>
          <div class="bst-custom-wizard-title">${mode === "edit" ? "Edit" : mode === "duplicate" ? "Clone" : "Add"} Custom Stat</div>
          <div class="bst-custom-wizard-step" data-bst-custom-step>Step 1 / 6</div>
        </div>
        <button type="button" class="bst-btn bst-close-btn" data-action="custom-close" aria-label="Close">&times;</button>
      </div>
      <div class="bst-custom-wizard-error" data-bst-custom-error></div>

      <div class="bst-custom-wizard-panel is-active" data-bst-custom-panel="1">
        <div class="bst-custom-wizard-grid">
          <label>Label
            <input type="text" data-bst-custom-field="label" maxlength="40" value="${escapeHtml(draft.label)}" placeholder="e.g. Respect">
          </label>
          <label>ID
            <input type="text" data-bst-custom-field="id" maxlength="32" value="${escapeHtml(draft.id)}" ${draft.lockId ? "readonly" : ""} placeholder="respect">
          </label>
          <label>Type
            <select data-bst-custom-field="kind">
              <option value="numeric" ${draft.kind === "numeric" ? "selected" : ""}>Numeric (0-100)</option>
              <option value="enum_single" ${draft.kind === "enum_single" ? "selected" : ""}>Enum (single choice)</option>
              <option value="boolean" ${draft.kind === "boolean" ? "selected" : ""}>Boolean (true/false)</option>
              <option value="text_short" ${draft.kind === "text_short" ? "selected" : ""}>Short text</option>
              <option value="array" ${draft.kind === "array" ? "selected" : ""}>Array (list)</option>
              <option value="date_time" ${draft.kind === "date_time" ? "selected" : ""}>Date/Time</option>
            </select>
          </label>
        </div>
        <label>Description
          <textarea data-bst-custom-field="description" rows="4" maxlength="${CUSTOM_STAT_DESCRIPTION_MAX_LENGTH}" placeholder="Required. Explain what this stat represents and how extraction should interpret it.">${escapeHtml(draft.description)}</textarea>
        </label>
        <div class="bst-custom-char-counter" data-bst-custom-description-counter></div>
        <div class="bst-custom-ai-row">
          <button type="button" class="bst-btn bst-btn-soft bst-custom-ai-btn" data-action="custom-improve-description" data-loading="false">
            <span class="bst-custom-ai-btn-icon fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span>
            <span class="bst-custom-ai-btn-label" data-bst-custom-description-btn-label>Improve description with AI</span>
          </button>
          <span class="bst-custom-ai-status" data-bst-custom-description-status>Uses current connection profile.</span>
        </div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="2">
        <div class="bst-custom-wizard-grid" data-bst-kind-panel="numeric">
          <label>Default Value (%)
            <input type="number" min="0" max="100" data-bst-custom-field="numericDefaultValue" value="${escapeHtml(draft.kind === "numeric" ? draft.defaultValue : "50")}">
          </label>
          <label>Max Delta Per Turn
            <input type="number" min="1" max="30" data-bst-custom-field="maxDeltaPerTurn" value="${escapeHtml(draft.maxDeltaPerTurn)}" placeholder="Use global">
          </label>
        </div>
        <div class="bst-custom-wizard-grid bst-custom-wizard-grid-single" data-bst-kind-panel="enum_single" style="display:none;">
          <label>Allowed Values (2-12)
            <div class="bst-enum-options-editor">
              <div class="bst-enum-options-list" data-bst-enum-options-list></div>
              <div class="bst-enum-options-actions">
                <button type="button" class="bst-btn bst-btn-soft bst-icon-btn" data-action="enum-option-add" aria-label="Add option" title="Add option"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
                <span class="bst-custom-char-counter" data-bst-enum-options-counter></span>
              </div>
            </div>
            <textarea data-bst-custom-field="enumOptionsText" rows="1" style="display:none;">${escapeHtml(draft.enumOptionsText)}</textarea>
          </label>
          <label>Default Enum Value
            <input type="text" data-bst-custom-field="enumDefaultValue" maxlength="200" value="${escapeHtml(draft.kind === "enum_single" ? draft.defaultValue : "")}" placeholder="guarded">
          </label>
        </div>
        <div class="bst-custom-wizard-grid" data-bst-kind-panel="boolean" style="display:none;">
          <label>Default Value
            <select data-bst-custom-field="defaultBoolean">
              <option value="true" ${draft.defaultBoolean ? "selected" : ""}>True</option>
              <option value="false" ${!draft.defaultBoolean ? "selected" : ""}>False</option>
            </select>
          </label>
          <label>True Label
            <input type="text" data-bst-custom-field="booleanTrueLabel" maxlength="40" value="${escapeHtml(draft.booleanTrueLabel)}" placeholder="enabled">
          </label>
          <label>False Label
            <input type="text" data-bst-custom-field="booleanFalseLabel" maxlength="40" value="${escapeHtml(draft.booleanFalseLabel)}" placeholder="disabled">
          </label>
        </div>
        <div class="bst-custom-wizard-grid" data-bst-kind-panel="text_short" style="display:none;">
          <label>Default Text
            <input type="text" data-bst-custom-field="textDefaultValue" value="${escapeHtml(draft.kind === "text_short" ? draft.defaultValue : "")}" placeholder="focused on de-escalation">
          </label>
          <label>Text Max Length (20-200)
            <input type="number" min="20" max="200" data-bst-custom-field="textMaxLength" value="${escapeHtml(draft.textMaxLength)}">
          </label>
        </div>
        <div class="bst-custom-wizard-grid" data-bst-kind-panel="array" style="display:none;">
          <label>Default Items (max ${MAX_CUSTOM_ARRAY_ITEMS})
            <div class="bst-array-default-editor">
              <div class="bst-array-default-list" data-bst-array-default-list></div>
              <div class="bst-array-default-actions">
                <button type="button" class="bst-btn bst-btn-soft bst-icon-btn" data-action="array-default-add" aria-label="Add item" title="Add item"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
                <span class="bst-custom-char-counter" data-bst-array-default-counter></span>
              </div>
            </div>
            <textarea data-bst-custom-field="arrayDefaultValue" rows="1" style="display:none;">${escapeHtml(draft.kind === "array" ? draft.defaultValue : "")}</textarea>
          </label>
          <label>Item Max Length (20-200)
            <input type="number" min="20" max="200" data-bst-custom-field="textMaxLength" value="${escapeHtml(draft.textMaxLength)}">
          </label>
        </div>
        <div class="bst-custom-wizard-grid bst-custom-wizard-grid-single" data-bst-kind-panel="date_time" style="display:none;">
          <label>Default Date/Time
            <input type="datetime-local" data-bst-custom-field="dateTimeDefaultValue" value="${escapeHtml(draft.kind === "date_time" ? toDateTimeInputValue(draft.defaultValue) : "")}">
          </label>
          <label>Date/Time Mode
            <select data-bst-custom-field="dateTimeMode">
              <option value="timestamp" ${draft.dateTimeMode === "timestamp" ? "selected" : ""}>Timestamp (strict)</option>
              <option value="structured" ${draft.dateTimeMode === "structured" ? "selected" : ""}>Structured (semantic)</option>
            </select>
          </label>
          <label>Date Format (Scene Card)
            <select data-bst-custom-field="dateTimeDateFormat">
              <option value="iso"${dateTimeDateFormatSeed === "iso" ? " selected" : ""}>YYYY-MM-DD</option>
              <option value="dmy"${dateTimeDateFormatSeed === "dmy" ? " selected" : ""}>DD-MM-YYYY</option>
              <option value="mdy"${dateTimeDateFormatSeed === "mdy" ? " selected" : ""}>MM-DD-YYYY</option>
              <option value="d_mmm_yyyy"${dateTimeDateFormatSeed === "d_mmm_yyyy" ? " selected" : ""}>DD MMM YYYY</option>
              <option value="mmmm_d_yyyy"${dateTimeDateFormatSeed === "mmmm_d_yyyy" ? " selected" : ""}>MMMM D, YYYY</option>
              <option value="mmmm_do_yyyy"${dateTimeDateFormatSeed === "mmmm_do_yyyy" ? " selected" : ""}>MMMM Do, YYYY</option>
            </select>
          </label>
          <div class="bst-scene-stat-editor-group" data-bst-date-time-structured-options style="display:none;">
            <div class="bst-scene-stat-editor-group-title">Structured Display (Scene Card)</div>
            <div class="bst-help-line">Visible only when mode is <code>structured</code>.</div>
            <div class="bst-check-grid">
              <label class="bst-check"><input type="checkbox" data-bst-custom-field="dateTimeShowWeekday" ${dateTimeShowWeekdaySeed ? "checked" : ""}>Show weekday</label>
              <label class="bst-check"><input type="checkbox" data-bst-custom-field="dateTimeShowDate" ${dateTimeShowDateSeed ? "checked" : ""}>Show date</label>
              <label class="bst-check"><input type="checkbox" data-bst-custom-field="dateTimeShowTime" ${dateTimeShowTimeSeed ? "checked" : ""}>Show time</label>
              <label class="bst-check"><input type="checkbox" data-bst-custom-field="dateTimeShowPhase" ${dateTimeShowPhaseSeed ? "checked" : ""}>Show phase</label>
              <label class="bst-check"><input type="checkbox" data-bst-custom-field="dateTimeShowPartLabels" ${dateTimeShowPartLabelsSeed ? "checked" : ""}>Show part labels</label>
            </div>
            <div class="bst-settings-grid">
              <label>Weekday Label
                <input type="text" maxlength="20" data-bst-custom-field="dateTimeLabelWeekday" value="${escapeHtml(dateTimeLabelWeekdaySeed)}" placeholder="Day">
              </label>
              <label>Date Label
                <input type="text" maxlength="20" data-bst-custom-field="dateTimeLabelDate" value="${escapeHtml(dateTimeLabelDateSeed)}" placeholder="Date">
              </label>
              <label>Time Label
                <input type="text" maxlength="20" data-bst-custom-field="dateTimeLabelTime" value="${escapeHtml(dateTimeLabelTimeSeed)}" placeholder="Time">
              </label>
              <label>Phase Label
                <input type="text" maxlength="20" data-bst-custom-field="dateTimeLabelPhase" value="${escapeHtml(dateTimeLabelPhaseSeed)}" placeholder="Phase">
              </label>
            </div>
            <div class="bst-scene-stat-editor-group-title">Part Order</div>
            <div data-bst-custom-field="dateTimePartOrderRows"></div>
          </div>
          <div class="bst-help-line">Stored format: <code>YYYY-MM-DD HH:mm</code>. Empty means no explicit default.</div>
        </div>
        <div class="bst-help-line" data-bst-kind-help="value">Numeric stats use 0-100 with optional max delta. Non-numeric stats store absolute values and do not use delta.</div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="3">
        <div class="bst-check-grid bst-toggle-block">
          <label class="bst-check"><input type="checkbox" data-bst-custom-field="trackCharacters" ${draft.trackCharacters ? "checked" : ""}>Track for Characters</label>
          <label class="bst-check"><input type="checkbox" data-bst-custom-field="trackUser" ${draft.trackUser ? "checked" : ""}>Track for User</label>
          <label class="bst-check"><input type="checkbox" data-bst-custom-field="globalScope" ${draft.globalScope ? "checked" : ""}>Global stat (shared)</label>
          <label class="bst-check"><input type="checkbox" data-bst-custom-field="privateToOwner" ${draft.privateToOwner ? "checked" : ""}>Private (owner-scoped)</label>
          <label class="bst-check"><input type="checkbox" data-bst-custom-field="includeInInjection" ${draft.includeInInjection ? "checked" : ""}>Include in prompt injection</label>
        </div>
        <label>Per-Stat Prompt Override (optional)
          <textarea data-bst-custom-field="promptOverride" rows="6" placeholder="Optional per-stat override used in all extraction modes. Leave empty to use the global custom-stat fallback for this kind.">${escapeHtml(draft.promptOverride)}</textarea>
        </label>
        <label>Sequential Group (optional)
          <input type="text" data-bst-custom-field="sequentialGroup" maxlength="32" value="${escapeHtml(draft.sequentialGroup)}" placeholder="e.g. appearance">
        </label>
        <div class="bst-help-line">When <strong>Enable Sequential Stat Groups</strong> is on, stats with the same group are extracted together in one sequential request.</div>
        <div class="bst-help-line" data-bst-kind-help="templateFallback">Used in all extraction modes. Empty override uses global Custom Numeric Default.</div>
        <div class="bst-help-line">Template placeholders: <code>{{user}}</code>, <code>{{char}}</code>, <code>{{characters}}</code>, <code>{{contextText}}</code>, <code>{{envelope}}</code>, <code>{{statId}}</code>.</div>
        <div class="bst-custom-ai-row">
          <button type="button" class="bst-btn bst-btn-soft bst-custom-ai-btn" data-action="custom-generate-template" data-loading="false">
            <span class="bst-custom-ai-btn-icon fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span>
            <span class="bst-custom-ai-btn-label" data-bst-custom-template-btn-label>Generate with AI</span>
          </button>
          <span class="bst-custom-ai-status" data-bst-custom-template-status>Uses current connection profile.</span>
        </div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="4">
        <div class="bst-help-line">Optional behavior instruction for prompt injection. Describe how this stat value should shape behavior, with clear increase/decrease evidence cues.</div>
        <label>Behavior Instruction (optional)
          <textarea data-bst-custom-field="behaviorGuidance" rows="6" placeholder="Optional. Example:\n- low focus -> easily distracted, short replies, weak follow-through.\n- medium focus -> generally attentive but can drift during long exchanges.\n- high focus -> sustained attention, user-first responses, clear follow-through.\n- increase cues -> direct user engagement, clarifying questions, consistent follow-up.\n- decrease cues -> evasive replies, frequent topic drift, delayed/partial engagement.">${escapeHtml(draft.behaviorGuidance)}</textarea>
        </label>
        <div class="bst-custom-ai-row">
          <button type="button" class="bst-btn bst-btn-soft bst-custom-ai-btn" data-action="custom-generate-behavior" data-loading="false">
            <span class="bst-custom-ai-btn-icon fa-solid fa-wand-magic-sparkles" aria-hidden="true"></span>
            <span class="bst-custom-ai-btn-label" data-bst-custom-behavior-btn-label>Generate with AI</span>
          </button>
          <span class="bst-custom-ai-status" data-bst-custom-behavior-status>Uses current connection profile.</span>
        </div>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="5">
        <div class="bst-help-line" data-bst-kind-help="color">Color helps visually distinguish this stat in cards and graph.</div>
        <label>Color (optional)
          <div class="bst-color-inputs">
            <input type="color" data-bst-custom-color-picker value="#66ccff" aria-label="Custom stat color picker">
            <input type="text" data-bst-custom-field="color" value="${escapeHtml(draft.color)}" placeholder="#66ccff">
          </div>
        </label>
      </div>

      <div class="bst-custom-wizard-panel" data-bst-custom-panel="6">
        <div class="bst-help-line">Review before saving:</div>
        <pre class="bst-custom-wizard-review" data-bst-custom-review></pre>
      </div>

      <div class="bst-custom-wizard-actions">
        <button type="button" class="bst-btn" data-action="custom-prev">Back</button>
        <div style="display:flex; gap:8px;">
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-next">Next</button>
          <button type="button" class="bst-btn bst-btn-soft" data-action="custom-save" style="display:none;">Save</button>
        </div>
      </div>
    `;

    const stepLabel = wizard.querySelector("[data-bst-custom-step]") as HTMLElement | null;
    const errorNode = wizard.querySelector("[data-bst-custom-error]") as HTMLElement | null;
    const reviewNode = wizard.querySelector("[data-bst-custom-review]") as HTMLElement | null;
    const prevBtn = wizard.querySelector('[data-action="custom-prev"]') as HTMLButtonElement | null;
    const nextBtn = wizard.querySelector('[data-action="custom-next"]') as HTMLButtonElement | null;
    const saveBtn = wizard.querySelector('[data-action="custom-save"]') as HTMLButtonElement | null;
    const improveDescriptionBtn = wizard.querySelector('[data-action="custom-improve-description"]') as HTMLButtonElement | null;
    const improveDescriptionLabelNode = wizard.querySelector("[data-bst-custom-description-btn-label]") as HTMLElement | null;
    const improveDescriptionStatusNode = wizard.querySelector("[data-bst-custom-description-status]") as HTMLElement | null;
    const descriptionCounterNode = wizard.querySelector("[data-bst-custom-description-counter]") as HTMLElement | null;
    const generateTemplateBtn = wizard.querySelector('[data-action="custom-generate-template"]') as HTMLButtonElement | null;
    const generateTemplateLabelNode = wizard.querySelector("[data-bst-custom-template-btn-label]") as HTMLElement | null;
    const generateStatusNode = wizard.querySelector("[data-bst-custom-template-status]") as HTMLElement | null;
    const generateBehaviorBtn = wizard.querySelector('[data-action="custom-generate-behavior"]') as HTMLButtonElement | null;
    const generateBehaviorLabelNode = wizard.querySelector("[data-bst-custom-behavior-btn-label]") as HTMLElement | null;
    const generateBehaviorStatusNode = wizard.querySelector("[data-bst-custom-behavior-status]") as HTMLElement | null;
    const getField = (name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null =>
      wizard.querySelector(`[data-bst-custom-field="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    const colorPickerNode = wizard.querySelector('[data-bst-custom-color-picker]') as HTMLInputElement | null;
    const arrayDefaultsListNode = wizard.querySelector("[data-bst-array-default-list]") as HTMLElement | null;
    const arrayDefaultsCounterNode = wizard.querySelector("[data-bst-array-default-counter]") as HTMLElement | null;
    const arrayDefaultsAddBtn = wizard.querySelector('[data-action="array-default-add"]') as HTMLButtonElement | null;
    const enumOptionsListNode = wizard.querySelector("[data-bst-enum-options-list]") as HTMLElement | null;
    const enumOptionsCounterNode = wizard.querySelector("[data-bst-enum-options-counter]") as HTMLElement | null;
    const enumOptionsAddBtn = wizard.querySelector('[data-action="enum-option-add"]') as HTMLButtonElement | null;
    const refreshWizardTextareaCounters = bindTextareaCounters(
      wizard,
      textarea => String(textarea.getAttribute("data-bst-custom-field") ?? "").trim().toLowerCase() === "description",
    );
    let generateDescriptionRequestId = 0;
    let generateTemplateRequestId = 0;
    let generateBehaviorRequestId = 0;
    let generatingDescription = false;
    let generatingTemplate = false;
    let generatingBehavior = false;

    const toPickerHex = (raw: string, fallback: string): string => {
      const value = raw.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
      if (/^#[0-9a-fA-F]{3}$/.test(value)) {
        const r = value[1];
        const g = value[2];
        const b = value[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
      }
      return fallback;
    };

    const getArrayEditorItemMaxLength = (): number =>
      Math.max(20, Math.min(200, Math.round(Number((getField("textMaxLength") as HTMLInputElement | null)?.value || draft.textMaxLength) || 120)));

    const getArrayEditorItemInputs = (): HTMLInputElement[] =>
      Array.from(arrayDefaultsListNode?.querySelectorAll<HTMLInputElement>('[data-bst-array-item="1"]') ?? []);

    const updateArrayEditorCounter = (count: number): void => {
      if (!arrayDefaultsCounterNode) return;
      arrayDefaultsCounterNode.textContent = `${count}/${MAX_CUSTOM_ARRAY_ITEMS} items`;
      const warnThreshold = Math.max(1, Math.floor(MAX_CUSTOM_ARRAY_ITEMS * 0.8));
      const state = count >= MAX_CUSTOM_ARRAY_ITEMS ? "limit" : count >= warnThreshold ? "warn" : "ok";
      arrayDefaultsCounterNode.setAttribute("data-state", state);
    };

    const syncArrayEditorToHiddenField = (): string => {
      const hiddenNode = getField("arrayDefaultValue") as HTMLTextAreaElement | null;
      const maxLen = getArrayEditorItemMaxLength();
      const values = getArrayEditorItemInputs().map(input => input.value);
      const normalized = normalizeNonNumericArrayItems(values, maxLen);
      if (hiddenNode) hiddenNode.value = normalized.join("\n");
      updateArrayEditorCounter(normalized.length);
      return normalized.join("\n");
    };

    const getEnumEditorOptionInputs = (): HTMLInputElement[] =>
      Array.from(enumOptionsListNode?.querySelectorAll<HTMLInputElement>('[data-bst-enum-option="1"]') ?? []);

    const updateEnumEditorCounter = (count: number): void => {
      if (!enumOptionsCounterNode) return;
      enumOptionsCounterNode.textContent = `${count}/${MAX_CUSTOM_ENUM_OPTIONS} options`;
      const warnAt = Math.max(2, MAX_CUSTOM_ENUM_OPTIONS - 2);
      const state = count >= MAX_CUSTOM_ENUM_OPTIONS ? "limit" : count >= warnAt ? "warn" : "ok";
      enumOptionsCounterNode.setAttribute("data-state", state);
    };

    const syncEnumEditorToHiddenField = (): string => {
      const hiddenNode = getField("enumOptionsText") as HTMLTextAreaElement | null;
      const values = getEnumEditorOptionInputs().map(input => input.value);
      const normalized = normalizeCustomEnumOptions(values);
      if (hiddenNode) hiddenNode.value = normalized.join("\n");
      updateEnumEditorCounter(normalized.length);
      return normalized.join("\n");
    };

    const arrayEditorRowHtml = (value: string, maxLength: number): string => `
      <div class="bst-array-default-row">
        <input type="text" data-bst-array-item="1" maxlength="${maxLength}" value="${escapeHtml(value)}" placeholder="Item value">
        <button type="button" class="bst-btn bst-btn-danger bst-icon-btn" data-action="array-default-remove" aria-label="Remove item" title="Remove item"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    `;

    const enumEditorRowHtml = (value: string): string => `
      <div class="bst-enum-options-row">
        <input type="text" data-bst-enum-option="1" maxlength="200" value="${escapeHtml(value)}" placeholder="Option value">
        <button type="button" class="bst-btn bst-btn-danger bst-icon-btn" data-action="enum-option-remove" aria-label="Remove option" title="Remove option"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    `;

    const renderArrayEditorFromDraft = (): void => {
      if (!arrayDefaultsListNode) return;
      const maxLen = getArrayEditorItemMaxLength();
      const sourceValue = draft.kind === "array" ? draft.defaultValue : "";
      const items = normalizeNonNumericArrayItems(sourceValue, maxLen);
      const rows = (items.length ? items : [""]).slice(0, MAX_CUSTOM_ARRAY_ITEMS);
      arrayDefaultsListNode.innerHTML = rows.map(value => arrayEditorRowHtml(value, maxLen)).join("");
      syncArrayEditorToHiddenField();
    };

    const renderEnumEditorFromDraft = (): void => {
      if (!enumOptionsListNode) return;
      const options = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
      const rows = (options.length ? options : ["", ""]).slice(0, MAX_CUSTOM_ENUM_OPTIONS);
      while (rows.length < 2) rows.push("");
      enumOptionsListNode.innerHTML = rows.map(value => enumEditorRowHtml(value)).join("");
      syncEnumEditorToHiddenField();
    };

    const renderDateTimePartOrderEditorRows = (): void => {
      const rowsNode = wizard.querySelector('[data-bst-custom-field="dateTimePartOrderRows"]') as HTMLElement | null;
      if (!rowsNode) return;
      rowsNode.innerHTML = dateTimePartOrderDraft.map((part, index) => `
        <div class="bst-scene-order-row" data-bst-custom-dt-part-row="${index}">
          <div class="bst-scene-order-meta">
            <span class="bst-scene-order-name">${escapeHtml(part)}</span>
            <span class="bst-scene-order-id">Position ${index + 1}</span>
          </div>
          <div class="bst-scene-order-actions">
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="custom-dt-part-up" data-bst-custom-dt-part-index="${index}" ${index === 0 ? "disabled" : ""} title="Move up" aria-label="Move up"><span class="fa-solid fa-arrow-up" aria-hidden="true"></span></button>
            <button type="button" class="bst-btn bst-btn-soft bst-btn-icon" data-action="custom-dt-part-down" data-bst-custom-dt-part-index="${index}" ${index === dateTimePartOrderDraft.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move down"><span class="fa-solid fa-arrow-down" aria-hidden="true"></span></button>
          </div>
        </div>
      `).join("");
    };

    const ensureArrayEditorRowExists = (): void => {
      if (!arrayDefaultsListNode) return;
      if (getArrayEditorItemInputs().length === 0) {
        const maxLen = getArrayEditorItemMaxLength();
        arrayDefaultsListNode.innerHTML = arrayEditorRowHtml("", maxLen);
      }
      syncArrayEditorToHiddenField();
    };

    const ensureEnumEditorRows = (): void => {
      if (!enumOptionsListNode) return;
      let count = getEnumEditorOptionInputs().length;
      while (count < 2) {
        enumOptionsListNode.insertAdjacentHTML("beforeend", enumEditorRowHtml(""));
        count += 1;
      }
      syncEnumEditorToHiddenField();
    };

    const syncDraftFromFields = (): void => {
      const labelNode = getField("label");
      const idNode = getField("id");
      const kindNode = getField("kind") as HTMLSelectElement | null;
      const descriptionNode = getField("description");
      const behaviorGuidanceNode = getField("behaviorGuidance");
      const numericDefaultNode = getField("numericDefaultValue");
      const enumDefaultNode = getField("enumDefaultValue");
      const textDefaultNode = getField("textDefaultValue");
      const dateTimeDefaultNode = getField("dateTimeDefaultValue");
      const dateTimeModeNode = getField("dateTimeMode") as HTMLSelectElement | null;
      const arrayDefaultNode = getField("arrayDefaultValue");
      const defaultBooleanNode = getField("defaultBoolean") as HTMLSelectElement | null;
      const maxDeltaNode = getField("maxDeltaPerTurn");
      const enumOptionsNode = getField("enumOptionsText");
      const trueLabelNode = getField("booleanTrueLabel");
      const falseLabelNode = getField("booleanFalseLabel");
      const textMaxLengthNode = getField("textMaxLength");
      const trackCharactersNode = getField("trackCharacters") as HTMLInputElement | null;
      const trackUserNode = getField("trackUser") as HTMLInputElement | null;
      const globalScopeNode = getField("globalScope") as HTMLInputElement | null;
      const privateToOwnerNode = getField("privateToOwner") as HTMLInputElement | null;
      const injectNode = getField("includeInInjection") as HTMLInputElement | null;
      const colorNode = getField("color");
      const templateNode = getField("promptOverride");
      const sequentialGroupNode = getField("sequentialGroup");
      draft.label = String(labelNode?.value ?? "");
      draft.id = String(idNode?.value ?? "").toLowerCase();
      draft.kind = normalizeCustomStatKind(kindNode?.value);
      draft.description = String(descriptionNode?.value ?? "");
      draft.behaviorGuidance = String(behaviorGuidanceNode?.value ?? "");
      if (draft.kind === "numeric") {
        draft.defaultValue = String(numericDefaultNode?.value ?? "");
      } else if (draft.kind === "enum_single") {
        draft.defaultValue = String(enumDefaultNode?.value ?? "");
      } else if (draft.kind === "array") {
        draft.defaultValue = syncArrayEditorToHiddenField() || String(arrayDefaultNode?.value ?? "");
      } else if (draft.kind === "date_time") {
        draft.defaultValue = normalizeDateTimeValue(String(dateTimeDefaultNode?.value ?? ""));
      } else if (draft.kind === "text_short") {
        draft.defaultValue = String(textDefaultNode?.value ?? "");
      } else {
        draft.defaultValue = "";
      }
      draft.defaultBoolean = String(defaultBooleanNode?.value ?? "false").toLowerCase() === "true";
      draft.maxDeltaPerTurn = String(maxDeltaNode?.value ?? "");
      draft.enumOptionsText = syncEnumEditorToHiddenField() || String(enumOptionsNode?.value ?? "");
      draft.booleanTrueLabel = String(trueLabelNode?.value ?? "");
      draft.booleanFalseLabel = String(falseLabelNode?.value ?? "");
      draft.textMaxLength = String(textMaxLengthNode?.value ?? "");
      draft.dateTimeMode = String(dateTimeModeNode?.value ?? "timestamp").toLowerCase() === "structured" ? "structured" : "timestamp";
      draft.trackCharacters = Boolean(trackCharactersNode?.checked);
      draft.trackUser = Boolean(trackUserNode?.checked);
      draft.globalScope = Boolean(globalScopeNode?.checked);
      draft.privateToOwner = draft.globalScope ? false : Boolean(privateToOwnerNode?.checked);
      if (draft.globalScope) {
        draft.trackCharacters = true;
        draft.trackUser = true;
      }
      draft.includeInInjection = Boolean(injectNode?.checked);
      draft.color = String(colorNode?.value ?? "");
      draft.promptOverride = String(templateNode?.value ?? "");
      draft.sequentialGroup = String(sequentialGroupNode?.value ?? "");
    };

    const syncColorPickerFromText = (): void => {
      if (!colorPickerNode) return;
      const colorNode = getField("color") as HTMLInputElement | null;
      const fallback = toPickerHex(input.settings.accentColor || "#66ccff", "#66ccff");
      colorPickerNode.value = toPickerHex(String(colorNode?.value ?? ""), fallback);
    };

    const syncColorTextFromPicker = (): void => {
      const colorNode = getField("color") as HTMLInputElement | null;
      if (!colorNode || !colorPickerNode) return;
      colorNode.value = colorPickerNode.value;
    };

    const writeReview = (): void => {
      if (!reviewNode) return;
      const normalized = toCustomStatDefinition(draft);
      reviewNode.textContent = JSON.stringify(normalized, null, 2);
    };

    const updateDescriptionCounter = (): void => {
      if (!descriptionCounterNode) return;
      const descriptionNode = getField("description") as HTMLTextAreaElement | null;
      if (!descriptionNode) return;
      const maxLength = Number(descriptionNode.getAttribute("maxlength")) || CUSTOM_STAT_DESCRIPTION_MAX_LENGTH;
      const currentLength = descriptionNode.value.length;
      descriptionCounterNode.textContent = `${currentLength}/${maxLength} chars`;
      const warnThreshold = Math.max(1, maxLength - 30);
      const state = currentLength >= maxLength ? "limit" : currentLength >= warnThreshold ? "warn" : "ok";
      descriptionCounterNode.setAttribute("data-state", state);
    };

    const syncKindUi = (): void => {
      const kind = normalizeCustomStatKind(draft.kind);
      wizard.querySelectorAll<HTMLElement>("[data-bst-kind-panel]").forEach(panel => {
        const panelKind = String(panel.dataset.bstKindPanel ?? "");
        panel.style.display = panelKind === kind ? (panel.classList.contains("bst-custom-wizard-grid") ? "grid" : "block") : "none";
      });
      if (kind === "array") {
        ensureArrayEditorRowExists();
        const maxLen = getArrayEditorItemMaxLength();
        for (const node of getArrayEditorItemInputs()) {
          node.maxLength = maxLen;
          if (node.value.length > maxLen) node.value = node.value.slice(0, maxLen);
        }
        syncArrayEditorToHiddenField();
      } else if (kind === "enum_single") {
        ensureEnumEditorRows();
        syncEnumEditorToHiddenField();
      }

      const fallbackHelpNode = wizard.querySelector('[data-bst-kind-help="templateFallback"]') as HTMLElement | null;
      if (fallbackHelpNode) {
        fallbackHelpNode.textContent = kind === "numeric"
          ? "Used in all extraction modes. Empty override uses global Custom Numeric Default."
          : "Used in all extraction modes. Empty override uses global Custom Non-Numeric Default.";
      }

      const valueHelpNode = wizard.querySelector('[data-bst-kind-help="value"]') as HTMLElement | null;
      if (valueHelpNode) {
        if (kind === "numeric") {
          valueHelpNode.textContent = "Numeric stats use 0-100 with optional max delta.";
        } else if (kind === "enum_single") {
          valueHelpNode.textContent = "Enum stats store one value from the allowed list (no delta, no graph).";
        } else if (kind === "boolean") {
          valueHelpNode.textContent = "Boolean stats store true/false (no delta, no graph).";
        } else if (kind === "array") {
          valueHelpNode.textContent = `Array stats store up to ${MAX_CUSTOM_ARRAY_ITEMS} short items and should be updated incrementally (add/remove/edit items).`;
        } else if (kind === "date_time") {
          valueHelpNode.textContent = draft.dateTimeMode === "structured"
            ? "Structured mode accepts semantic datetime updates and normalizes to YYYY-MM-DD HH:mm (no delta, no graph)."
            : "Timestamp mode stores one strict timestamp in YYYY-MM-DD HH:mm format (no delta, no graph).";
        } else {
          valueHelpNode.textContent = "Short text stats store concise single-line state text (no delta, no graph).";
        }
      }

      const colorHelpNode = wizard.querySelector('[data-bst-kind-help="color"]') as HTMLElement | null;
      if (colorHelpNode) {
        colorHelpNode.textContent = kind === "numeric"
          ? "Color helps visually distinguish this stat in cards and graph."
          : "Color helps visually distinguish this stat on cards. Non-numeric stats are not graphed in this version.";
      }

      const templateNode = getField("promptOverride") as HTMLTextAreaElement | null;
      if (templateNode) {
        templateNode.placeholder = kind === "numeric"
          ? "Optional per-stat override used in all extraction modes. Literal example: Update only respect_score deltas from recent messages based on respect cues. Leave empty to use global Custom Numeric Default."
          : "Optional per-stat override used in all extraction modes. Literal example: Update only stance value for {{statId}} using allowed values and recent conversational cues. Leave empty to use global Custom Non-Numeric Default.";
      }

      const behaviorNode = getField("behaviorGuidance") as HTMLTextAreaElement | null;
      if (behaviorNode) {
        if (kind === "numeric") {
          behaviorNode.placeholder = "Optional. Example:\n- low focus -> easily distracted, short replies, weak follow-through.\n- medium focus -> generally attentive but can drift during long exchanges.\n- high focus -> sustained attention, user-first responses, clear follow-through.\n- increase cues -> direct user engagement, clarifying questions, consistent follow-up.\n- decrease cues -> evasive replies, frequent topic drift, delayed/partial engagement.";
        } else if (kind === "enum_single") {
          behaviorNode.placeholder = "Optional. Example:\n- guarded -> cautious tone, minimal disclosure.\n- cautious -> polite engagement with measured openness.\n- open -> proactive engagement and clearer emotional availability.\n- increase cues -> explicit trust/rapport signs.\n- decrease cues -> conflict, withdrawal, contradiction.";
        } else if (kind === "boolean") {
          behaviorNode.placeholder = "Optional. Example:\n- {{statId}} true -> behavior follows the enabled state.\n- {{statId}} false -> behavior follows the disabled state.\n- increase cues -> evidence that should switch to true.\n- decrease cues -> evidence that should switch to false.";
        } else if (kind === "array") {
          behaviorNode.placeholder = "Optional. Example:\n- interpret {{statId}} as a live list of short state items.\n- keep replies aligned with current items.\n- add cues -> add a specific item.\n- remove cues -> remove obsolete item.\n- edit cues -> update one existing item, avoid rewriting whole list.";
        } else if (kind === "date_time") {
          behaviorNode.placeholder = "Optional. Example:\n- interpret {{statId}} as current scene date/time.\n- keep temporal references aligned with that timestamp.\n- increase cues -> clear time progression in scene.\n- decrease cues -> flashback/rewind or explicit earlier-time cues.";
        } else {
          behaviorNode.placeholder = "Optional. Example:\n- interpret {{statId}} as short scene-state text.\n- keep responses aligned with the current text state.\n- increase cues -> evidence to update the text state.\n- decrease cues -> evidence to simplify or reset the text state.";
        }
      }

      const trackCharactersNode = getField("trackCharacters") as HTMLInputElement | null;
      const trackUserNode = getField("trackUser") as HTMLInputElement | null;
      const globalScopeNode = getField("globalScope") as HTMLInputElement | null;
      const privateToOwnerNode = getField("privateToOwner") as HTMLInputElement | null;
      const setCheckDisabledVisual = (node: HTMLInputElement | null, disabled: boolean): void => {
        if (!node) return;
        const wrapper = node.closest(".bst-check") as HTMLElement | null;
        if (wrapper) {
          wrapper.classList.toggle("bst-check-disabled", disabled);
          wrapper.setAttribute("aria-disabled", disabled ? "true" : "false");
          if (disabled) {
            wrapper.title = "Locked by Global stat";
          } else if (wrapper.title === "Locked by Global stat") {
            wrapper.removeAttribute("title");
          }
        }
      };
      if (draft.globalScope) {
        draft.trackCharacters = true;
        draft.trackUser = true;
        draft.privateToOwner = false;
      }
      if (trackCharactersNode) {
        trackCharactersNode.checked = draft.trackCharacters;
        trackCharactersNode.disabled = draft.globalScope;
        setCheckDisabledVisual(trackCharactersNode, draft.globalScope);
      }
      if (trackUserNode) {
        trackUserNode.checked = draft.trackUser;
        trackUserNode.disabled = draft.globalScope;
        setCheckDisabledVisual(trackUserNode, draft.globalScope);
      }
      if (globalScopeNode) {
        globalScopeNode.checked = draft.globalScope;
      }
      if (privateToOwnerNode) {
        privateToOwnerNode.checked = draft.privateToOwner;
        privateToOwnerNode.disabled = draft.globalScope;
        setCheckDisabledVisual(privateToOwnerNode, draft.globalScope);
      }
      const structuredDisplayNode = wizard.querySelector('[data-bst-date-time-structured-options]') as HTMLElement | null;
      if (structuredDisplayNode) {
        const showStructuredOptions = kind === "date_time" && draft.dateTimeMode === "structured";
        structuredDisplayNode.style.display = showStructuredOptions ? "block" : "none";
      }
    };

    const syncStepUi = (): void => {
      if (stepLabel) stepLabel.textContent = `Step ${step} / 6`;
      Array.from(wizard.querySelectorAll("[data-bst-custom-panel]")).forEach(panel => {
        const element = panel as HTMLElement;
        const panelStep = Number(element.dataset.bstCustomPanel ?? "1");
        element.classList.toggle("is-active", panelStep === step);
      });
      if (prevBtn) prevBtn.style.visibility = step === 1 ? "hidden" : "visible";
      if (nextBtn) nextBtn.style.display = step === 6 ? "none" : "";
      if (saveBtn) saveBtn.style.display = step === 6 ? "" : "none";
      syncKindUi();
      writeReview();
      updateDescriptionCounter();
      refreshWizardTextareaCounters();
    };

    const setErrors = (errors: string[]): boolean => {
      if (!errorNode) return errors.length === 0;
      if (!errors.length) {
        errorNode.style.display = "none";
        errorNode.textContent = "";
        return true;
      }
      errorNode.style.display = "block";
      errorNode.textContent = errors.join("\n");
      return false;
    };

    const setGenerateStatus = (
      node: HTMLElement | null,
      fallback: string,
      state: "idle" | "loading" | "success" | "error",
      message?: string,
    ): void => {
      if (!node) return;
      const text = String(message ?? "").trim();
      if (!text && state === "idle") {
        node.textContent = fallback;
        node.setAttribute("data-state", "idle");
        return;
      }
      node.textContent = text;
      node.setAttribute("data-state", state);
    };

    const setButtonLoading = (
      button: HTMLButtonElement | null,
      labelNode: HTMLElement | null,
      loading: boolean,
      loadingLabel: string,
      idleLabel: string,
    ): void => {
      if (button) {
        button.disabled = loading;
        button.setAttribute("data-loading", loading ? "true" : "false");
      }
      if (labelNode) {
        labelNode.textContent = loading ? loadingLabel : idleLabel;
      }
    };

    const setDescriptionGenerateLoading = (loading: boolean): void => {
      generatingDescription = loading;
      setButtonLoading(
        improveDescriptionBtn,
        improveDescriptionLabelNode,
        loading,
        "Improving...",
        "Improve description with AI",
      );
    };

    const setTemplateGenerateLoading = (loading: boolean): void => {
      generatingTemplate = loading;
      setButtonLoading(
        generateTemplateBtn,
        generateTemplateLabelNode,
        loading,
        "Generating...",
        "Generate with AI",
      );
    };

    const setBehaviorGenerateLoading = (loading: boolean): void => {
      generatingBehavior = loading;
      setButtonLoading(
        generateBehaviorBtn,
        generateBehaviorLabelNode,
        loading,
        "Generating...",
        "Generate with AI",
      );
    };

    const close = (): void => {
      generateDescriptionRequestId += 1;
      generateTemplateRequestId += 1;
      generateBehaviorRequestId += 1;
      setDescriptionGenerateLoading(false);
      setTemplateGenerateLoading(false);
      setBehaviorGenerateLoading(false);
      closeCustomWizard();
    };
    const currentId = source?.id;
    const validateCurrentStep = (): boolean => {
      syncDraftFromFields();
      return setErrors(validateCustomStatDraft(draft, mode, step, currentId));
    };

    const validateAll = (): boolean => {
      syncDraftFromFields();
      return setErrors(validateCustomStatDraft(draft, mode, 5, currentId));
    };

    const labelInput = getField("label") as HTMLInputElement | null;
    const idInput = getField("id") as HTMLInputElement | null;
    const kindInput = getField("kind") as HTMLSelectElement | null;
    const colorTextInput = getField("color") as HTMLInputElement | null;
    labelInput?.addEventListener("input", () => {
      if (draft.lockId || idTouched) return;
      if (!idInput) return;
      const suggested = toCustomStatSlug(labelInput.value || "stat");
      const existing = new Set(customStatsState
        .map(item => item.id)
        .filter(item => item !== source?.id));
      idInput.value = suggestUniqueCustomStatId(suggested, existing);
    });
    idInput?.addEventListener("input", () => {
      idTouched = true;
      idInput.value = idInput.value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    });
    kindInput?.addEventListener("change", () => {
      syncDraftFromFields();
      syncKindUi();
      writeReview();
    });
    for (const scopeField of ["trackCharacters", "trackUser", "globalScope", "privateToOwner", "includeInInjection"] as const) {
      const node = getField(scopeField) as HTMLInputElement | null;
      node?.addEventListener("change", () => {
        syncDraftFromFields();
        syncKindUi();
        writeReview();
      });
    }
    arrayDefaultsAddBtn?.addEventListener("click", () => {
      if (!arrayDefaultsListNode) return;
      const maxLen = getArrayEditorItemMaxLength();
      const count = getArrayEditorItemInputs().length;
      if (count >= MAX_CUSTOM_ARRAY_ITEMS) return;
      arrayDefaultsListNode.insertAdjacentHTML("beforeend", arrayEditorRowHtml("", maxLen));
      const nextInput = getArrayEditorItemInputs().at(-1);
      nextInput?.focus();
      syncDraftFromFields();
      syncKindUi();
      writeReview();
      updateDescriptionCounter();
    });
    enumOptionsAddBtn?.addEventListener("click", () => {
      if (!enumOptionsListNode) return;
      const count = getEnumEditorOptionInputs().length;
      if (count >= 12) return;
      enumOptionsListNode.insertAdjacentHTML("beforeend", enumEditorRowHtml(""));
      const nextInput = getEnumEditorOptionInputs().at(-1);
      nextInput?.focus();
      syncDraftFromFields();
      syncKindUi();
      writeReview();
      updateDescriptionCounter();
    });
    wizard.addEventListener("click", event => {
      const target = event.target as HTMLElement | null;
      const dtPartButton = target?.closest('button[data-action][data-bst-custom-dt-part-index]') as HTMLButtonElement | null;
      if (dtPartButton) {
        const index = Number(dtPartButton.getAttribute("data-bst-custom-dt-part-index"));
        if (Number.isInteger(index) && index >= 0 && index < dateTimePartOrderDraft.length) {
          if (dtPartButton.dataset.action === "custom-dt-part-up" && index > 0) {
            [dateTimePartOrderDraft[index - 1], dateTimePartOrderDraft[index]] = [dateTimePartOrderDraft[index], dateTimePartOrderDraft[index - 1]];
            renderDateTimePartOrderEditorRows();
          } else if (dtPartButton.dataset.action === "custom-dt-part-down" && index < dateTimePartOrderDraft.length - 1) {
            [dateTimePartOrderDraft[index + 1], dateTimePartOrderDraft[index]] = [dateTimePartOrderDraft[index], dateTimePartOrderDraft[index + 1]];
            renderDateTimePartOrderEditorRows();
          }
        }
        syncDraftFromFields();
        syncKindUi();
        writeReview();
        updateDescriptionCounter();
        return;
      }
      const arrayRemoveBtn = target?.closest('[data-action="array-default-remove"]') as HTMLButtonElement | null;
      if (arrayRemoveBtn) {
        const row = arrayRemoveBtn.closest(".bst-array-default-row");
        row?.remove();
        ensureArrayEditorRowExists();
        syncDraftFromFields();
        syncKindUi();
        writeReview();
        updateDescriptionCounter();
        return;
      }
      const enumRemoveBtn = target?.closest('[data-action="enum-option-remove"]') as HTMLButtonElement | null;
      if (!enumRemoveBtn) return;
      const currentInputs = getEnumEditorOptionInputs();
      const row = enumRemoveBtn.closest(".bst-enum-options-row");
      if (currentInputs.length <= 2) {
        const inputNode = row?.querySelector<HTMLInputElement>('[data-bst-enum-option="1"]');
        if (inputNode) inputNode.value = "";
      } else {
        row?.remove();
      }
      ensureEnumEditorRows();
      syncDraftFromFields();
      syncKindUi();
      writeReview();
      updateDescriptionCounter();
    });
    wizard.addEventListener("input", event => {
      const target = event.target as HTMLElement | null;
      const itemInput = target?.closest('[data-bst-array-item="1"]') as HTMLInputElement | null;
      const enumInput = target?.closest('[data-bst-enum-option="1"]') as HTMLInputElement | null;
      if (!itemInput && !enumInput) return;
      syncDraftFromFields();
      syncKindUi();
      writeReview();
      updateDescriptionCounter();
    });
    const applyPickerColor = (): void => {
      // Firefox may emit only "change" for <input type="color"> dialog commits.
      syncColorTextFromPicker();
      syncDraftFromFields();
      writeReview();
    };
    colorPickerNode?.addEventListener("input", applyPickerColor);
    colorPickerNode?.addEventListener("change", applyPickerColor);
    colorTextInput?.addEventListener("input", () => {
      syncColorPickerFromText();
    });
    syncColorPickerFromText();
    renderArrayEditorFromDraft();
    renderEnumEditorFromDraft();
    renderDateTimePartOrderEditorRows();
    setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "idle");
    setGenerateStatus(generateStatusNode, "Uses current connection profile.", "idle");
    setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "idle");

    improveDescriptionBtn?.addEventListener("click", async () => {
      if (generatingDescription) return;
      syncDraftFromFields();

      const generationErrors: string[] = [];
      const label = draft.label.trim();
      const statId = draft.id.trim().toLowerCase();
      const description = draft.description.trim();

      if (!label) generationErrors.push("Label is required before AI description improvement.");
      if (!statId) generationErrors.push("ID is required before AI description improvement.");
      if (statId && !CUSTOM_STAT_ID_REGEX.test(statId)) {
        generationErrors.push("ID must match: start with a letter, then lowercase letters/numbers/underscore (2..32 chars).");
      }
      if (statId && RESERVED_CUSTOM_STAT_IDS.has(statId)) {
        generationErrors.push(`ID '${statId}' is reserved.`);
      }
      if (!description) generationErrors.push("Write a draft description before AI improvement.");
      if (!setErrors(generationErrors)) {
        setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "error", "Fill Label, ID, and Description first.");
        return;
      }

      const requestId = ++generateDescriptionRequestId;
      setDescriptionGenerateLoading(true);
      setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "loading", "Improving description...");
      try {
        const settingsForRequest = collectSettings();
        const statKind = normalizeCustomStatKind(draft.kind);
        const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
        const prompt = buildCustomStatDescriptionGenerationPrompt({
          statId,
          statLabel: label,
          currentDescription: description,
          statKind,
          dateTimeMode: draft.dateTimeMode,
          enumOptions,
          textMaxLength,
          booleanTrueLabel: draft.booleanTrueLabel,
          booleanFalseLabel: draft.booleanFalseLabel,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== generateDescriptionRequestId) return;

        const cleaned = sanitizeGeneratedCustomDescription(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty description text. Try again.");
        }
        if (cleaned.length < 3) {
          throw new Error("AI description is too short. Try again.");
        }

        const descriptionNode = getField("description") as HTMLTextAreaElement | null;
        if (!descriptionNode) {
          throw new Error("Description field is unavailable.");
        }
        descriptionNode.value = cleaned;
        descriptionNode.dispatchEvent(new Event("input", { bubbles: true }));
        syncDraftFromFields();
        writeReview();
        setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "success", "Improved. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "custom.stat.description.generated", {
          statId,
          profileId: response.meta.profileId,
          outputChars: cleaned.length,
        });
      } catch (error) {
        if (requestId !== generateDescriptionRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setGenerateStatus(improveDescriptionStatusNode, "Uses current connection profile.", "error", message || "Description improvement failed. Try again.");
      } finally {
        if (requestId === generateDescriptionRequestId) {
          setDescriptionGenerateLoading(false);
        }
      }
    });

    generateTemplateBtn?.addEventListener("click", async () => {
      if (generatingTemplate) return;
      syncDraftFromFields();

      const generationErrors: string[] = [];
      const label = draft.label.trim();
      const statId = draft.id.trim().toLowerCase();
      const description = draft.description.trim();

      if (!label) generationErrors.push("Label is required before AI generation.");
      if (!statId) generationErrors.push("ID is required before AI generation.");
      if (statId && !CUSTOM_STAT_ID_REGEX.test(statId)) {
        generationErrors.push("ID must match: start with a letter, then lowercase letters/numbers/underscore (2..32 chars).");
      }
      if (statId && RESERVED_CUSTOM_STAT_IDS.has(statId)) {
        generationErrors.push(`ID '${statId}' is reserved.`);
      }
      if (!description) generationErrors.push("Description is required before AI generation.");
      if (!setErrors(generationErrors)) {
        setGenerateStatus(generateStatusNode, "Uses current connection profile.", "error", "Fill Label, ID, and Description first.");
        return;
      }

      const requestId = ++generateTemplateRequestId;
      setTemplateGenerateLoading(true);
      setGenerateStatus(generateStatusNode, "Uses current connection profile.", "loading", "Generating instruction...");
      try {
        const settingsForRequest = collectSettings();
        const statKind = normalizeCustomStatKind(draft.kind);
        const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
        const prompt = buildSequentialCustomOverrideGenerationPrompt({
          statId,
          statLabel: label,
          statDescription: description,
          statKind,
          dateTimeMode: draft.dateTimeMode,
          enumOptions,
          textMaxLength,
          booleanTrueLabel: draft.booleanTrueLabel,
          booleanFalseLabel: draft.booleanFalseLabel,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== generateTemplateRequestId) return;

        const cleaned = sanitizeGeneratedSequentialTemplate(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty instruction text. Try again.");
        }
        const statSpecificTemplate = cleaned
          .replaceAll("{{statId}}", statId)
          .replaceAll("{{statLabel}}", label)
          .replaceAll("{{statDescription}}", description);

        const templateNode = getField("promptOverride") as HTMLTextAreaElement | null;
        if (!templateNode) {
          throw new Error("Sequential template field is unavailable.");
        }
        templateNode.value = statSpecificTemplate;
        templateNode.dispatchEvent(new Event("input", { bubbles: true }));
        syncDraftFromFields();
        writeReview();
        setGenerateStatus(generateStatusNode, "Uses current connection profile.", "success", "Generated. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "custom.stat.override.generated", {
          statId,
          profileId: response.meta.profileId,
          outputChars: statSpecificTemplate.length,
        });
      } catch (error) {
        if (requestId !== generateTemplateRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setGenerateStatus(generateStatusNode, "Uses current connection profile.", "error", message || "Generation failed. Try again.");
      } finally {
        if (requestId === generateTemplateRequestId) {
          setTemplateGenerateLoading(false);
        }
      }
    });

    generateBehaviorBtn?.addEventListener("click", async () => {
      if (generatingBehavior) return;
      syncDraftFromFields();

      const generationErrors: string[] = [];
      const label = draft.label.trim();
      const statId = draft.id.trim().toLowerCase();
      const description = draft.description.trim();
      const behaviorGuidance = draft.behaviorGuidance.trim();

      if (!label) generationErrors.push("Label is required before AI generation.");
      if (!statId) generationErrors.push("ID is required before AI generation.");
      if (statId && !CUSTOM_STAT_ID_REGEX.test(statId)) {
        generationErrors.push("ID must match: start with a letter, then lowercase letters/numbers/underscore (2..32 chars).");
      }
      if (statId && RESERVED_CUSTOM_STAT_IDS.has(statId)) {
        generationErrors.push(`ID '${statId}' is reserved.`);
      }
      if (!description) generationErrors.push("Description is required before AI generation.");
      if (!setErrors(generationErrors)) {
        setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "error", "Fill Label, ID, and Description first.");
        return;
      }

      const requestId = ++generateBehaviorRequestId;
      setBehaviorGenerateLoading(true);
      setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "loading", "Generating behavior instruction...");
      try {
        const settingsForRequest = collectSettings();
        const statKind = normalizeCustomStatKind(draft.kind);
        const enumOptions = normalizeCustomEnumOptions(draft.enumOptionsText.split(/\r?\n/));
        const textMaxLength = Math.max(20, Math.min(200, Math.round(Number(draft.textMaxLength) || 120)));
        const prompt = buildCustomStatBehaviorGuidanceGenerationPrompt({
          statId,
          statLabel: label,
          statDescription: description,
          currentGuidance: behaviorGuidance,
          statKind,
          dateTimeMode: draft.dateTimeMode,
          enumOptions,
          textMaxLength,
          booleanTrueLabel: draft.booleanTrueLabel,
          booleanFalseLabel: draft.booleanFalseLabel,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== generateBehaviorRequestId) return;

        const cleaned = sanitizeGeneratedBehaviorGuidance(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty behavior instruction text. Try again.");
        }

        const resolvedGuidance = cleaned
          .replaceAll("{{statId}}", statId)
          .replaceAll("{{statLabel}}", label)
          .replaceAll("{{statDescription}}", description);

        const behaviorNode = getField("behaviorGuidance") as HTMLTextAreaElement | null;
        if (!behaviorNode) {
          throw new Error("Behavior instruction field is unavailable.");
        }
        behaviorNode.value = resolvedGuidance;
        behaviorNode.dispatchEvent(new Event("input", { bubbles: true }));
        syncDraftFromFields();
        writeReview();
        setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "success", "Generated. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "custom.stat.behavior.generated", {
          statId,
          profileId: response.meta.profileId,
          outputChars: resolvedGuidance.length,
        });
      } catch (error) {
        if (requestId !== generateBehaviorRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setGenerateStatus(generateBehaviorStatusNode, "Uses current connection profile.", "error", message || "Generation failed. Try again.");
      } finally {
        if (requestId === generateBehaviorRequestId) {
          setBehaviorGenerateLoading(false);
        }
      }
    });

    backdropNode.addEventListener("click", close);
    wizard.querySelector('[data-action="custom-close"]')?.addEventListener("click", close);
    prevBtn?.addEventListener("click", () => {
      if (step <= 1) return;
      step -= 1;
      setErrors([]);
      syncStepUi();
    });
    nextBtn?.addEventListener("click", () => {
      if (!validateCurrentStep()) return;
      if (step >= 6) return;
      step += 1;
      setErrors([]);
      syncStepUi();
    });
    saveBtn?.addEventListener("click", () => {
      if (!validateAll()) return;
      const nextDef = toCustomStatDefinition(draft);
      const dateTimeShowWeekdayNode = getField("dateTimeShowWeekday") as HTMLInputElement | null;
      const dateTimeShowDateNode = getField("dateTimeShowDate") as HTMLInputElement | null;
      const dateTimeShowTimeNode = getField("dateTimeShowTime") as HTMLInputElement | null;
      const dateTimeShowPhaseNode = getField("dateTimeShowPhase") as HTMLInputElement | null;
      const dateTimeShowPartLabelsNode = getField("dateTimeShowPartLabels") as HTMLInputElement | null;
      const dateTimeLabelWeekdayNode = getField("dateTimeLabelWeekday") as HTMLInputElement | null;
      const dateTimeLabelDateNode = getField("dateTimeLabelDate") as HTMLInputElement | null;
      const dateTimeLabelTimeNode = getField("dateTimeLabelTime") as HTMLInputElement | null;
      const dateTimeLabelPhaseNode = getField("dateTimeLabelPhase") as HTMLInputElement | null;
      const dateTimeDateFormatNode = getField("dateTimeDateFormat") as HTMLSelectElement | null;
      if (mode === "edit" && source) {
        customStatsState = customStatsState.map(item => item.id === source.id ? nextDef : item);
      } else {
        customStatsState = [...customStatsState, nextDef];
      }
      const displayId = String(nextDef.id ?? "").trim().toLowerCase();
      if (nextDef.kind === "date_time" && nextDef.dateTimeMode === "structured" && displayId) {
        const dateTimePartOrder = normalizeDateTimePartOrder(dateTimePartOrderDraft);
        const prev = sceneCardStatDisplayState[displayId] ?? {
          visible: true,
          showLabel: true,
          hideWhenEmpty: true,
          labelOverride: "",
          colorOverride: "",
          layoutOverride: "auto" as const,
          valueStyle: "auto" as const,
          textMaxLength: null,
          arrayCollapsedLimit: null,
        };
        sceneCardStatDisplayState[displayId] = {
          ...prev,
          dateTimeShowWeekday: Boolean(dateTimeShowWeekdayNode?.checked ?? true),
          dateTimeShowDate: Boolean(dateTimeShowDateNode?.checked ?? true),
          dateTimeShowTime: Boolean(dateTimeShowTimeNode?.checked ?? true),
          dateTimeShowPhase: Boolean(dateTimeShowPhaseNode?.checked ?? true),
          dateTimeShowPartLabels: Boolean(dateTimeShowPartLabelsNode?.checked ?? false),
          dateTimeLabelWeekday: String(dateTimeLabelWeekdayNode?.value ?? "Day").trim().slice(0, 20) || "Day",
          dateTimeLabelDate: String(dateTimeLabelDateNode?.value ?? "Date").trim().slice(0, 20) || "Date",
          dateTimeLabelTime: String(dateTimeLabelTimeNode?.value ?? "Time").trim().slice(0, 20) || "Time",
          dateTimeLabelPhase: String(dateTimeLabelPhaseNode?.value ?? "Phase").trim().slice(0, 20) || "Phase",
          dateTimeDateFormat:
            dateTimeDateFormatNode?.value === "dmy" ||
            dateTimeDateFormatNode?.value === "mdy" ||
            dateTimeDateFormatNode?.value === "d_mmm_yyyy" ||
            dateTimeDateFormatNode?.value === "mmmm_d_yyyy" ||
            dateTimeDateFormatNode?.value === "mmmm_do_yyyy"
              ? dateTimeDateFormatNode.value
              : "iso",
          dateTimePartOrder,
        };
      }
      customStatsState = customStatsState.slice(0, MAX_CUSTOM_STATS);
      renderCustomStatsList();
      renderSceneCardOrderList();
      renderCharacterCardOrderList();
      close();
      persistLive();
    });

    wizard.querySelectorAll("input, textarea, select").forEach(node => {
      node.addEventListener("input", () => {
        syncDraftFromFields();
        syncKindUi();
        writeReview();
        updateDescriptionCounter();
      });
      node.addEventListener("blur", () => {
        if (node instanceof HTMLInputElement) clampNumberInputToBounds(node);
      });
      node.addEventListener("change", () => {
        if (node instanceof HTMLInputElement) clampNumberInputToBounds(node);
        syncDraftFromFields();
        syncKindUi();
        writeReview();
        updateDescriptionCounter();
      });
    });

    document.body.appendChild(backdropNode);
    document.body.appendChild(wizard);
    syncStepUi();
    updateDescriptionCounter();
    refreshWizardTextareaCounters();
  };

  customAddButton?.addEventListener("click", () => {
    openCustomStatWizard("add");
  });
  customImportJsonButton?.addEventListener("click", () => {
    openCustomImportWizard();
  });
  manageBuiltInsButton?.addEventListener("click", () => {
    openBuiltInManagerWizard();
  });

  customStatsListNode?.addEventListener("click", event => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest("button[data-action][data-custom-id]") as HTMLButtonElement | null;
    if (!button) return;
    const id = String(button.getAttribute("data-custom-id") ?? "").trim().toLowerCase();
    if (!id) return;
    const stat = customStatsState.find(item => item.id === id);
    if (!stat) return;
    const action = String(button.getAttribute("data-action") ?? "");
    if (action === "custom-edit") {
      openCustomStatWizard("edit", stat);
      return;
    }
    if (action === "custom-toggle-enabled") {
      customStatsState = customStatsState.map(item => {
        if (item.id !== stat.id) return item;
        const nextEnabled = !Boolean(item.track);
        const trackCharacters = Boolean(item.trackCharacters ?? item.track);
        const trackUser = Boolean(item.trackUser ?? item.track);
        return {
          ...item,
          track: nextEnabled,
          trackCharacters: trackCharacters || trackUser ? trackCharacters : true,
          trackUser: trackCharacters || trackUser ? trackUser : true,
        };
      });
      renderCustomStatsList();
      renderSceneCardOrderList();
      renderCharacterCardOrderList();
      persistLive();
      return;
    }
    if (action === "custom-duplicate") {
      openCustomStatWizard("duplicate", stat);
      return;
    }
    if (action === "custom-export-json") {
      const payload = [cloneCustomStatDefinition(stat)];
      const serialized = JSON.stringify(payload, null, 2);
      void copyToClipboard(serialized).then(copied => {
        if (copied) {
          setCustomStatsStatus(`Exported "${stat.label}" JSON to clipboard.`, "success");
          return;
        }
        openClipboardFallbackWizard(`Export "${stat.label}" JSON`, serialized);
        setCustomStatsStatus("Clipboard unavailable, opened manual copy modal.", "info");
      });
      return;
    }
    if (action === "custom-remove") {
      openCustomRemoveWizard(stat);
    }
  });
  modal.addEventListener("click", event => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest("button[data-action][data-scene-order-id]") as HTMLButtonElement | null;
    if (!button) return;
    const id = String(button.getAttribute("data-scene-order-id") ?? "").trim().toLowerCase();
    if (!id) return;
    const index = sceneCardStatOrderState.indexOf(id);
    if (index < 0) return;
    const action = String(button.getAttribute("data-action") ?? "");
    if (action === "scene-order-edit") {
      openSceneStatDisplayEditor(id);
      return;
    }
    if (action === "scene-order-up" && index > 0) {
      const next = [...sceneCardStatOrderState];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      sceneCardStatOrderState = next;
      renderSceneCardOrderList();
      renderCharacterCardOrderList();
      persistLive();
      return;
    }
    if (action === "scene-order-down" && index < sceneCardStatOrderState.length - 1) {
      const next = [...sceneCardStatOrderState];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      sceneCardStatOrderState = next;
      renderSceneCardOrderList();
      renderCharacterCardOrderList();
      persistLive();
    }
  });
  modal.addEventListener("click", event => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest("button[data-action][data-char-order-id]") as HTMLButtonElement | null;
    if (!button) return;
    const id = String(button.getAttribute("data-char-order-id") ?? "").trim().toLowerCase();
    if (!id) return;
    const index = characterCardStatOrderState.indexOf(id);
    if (index < 0) return;
    const action = String(button.getAttribute("data-action") ?? "");
    if (action === "char-order-up" && index > 0) {
      const next = [...characterCardStatOrderState];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      characterCardStatOrderState = next;
      renderCharacterCardOrderList();
      persistLive();
      return;
    }
    if (action === "char-order-down" && index < characterCardStatOrderState.length - 1) {
      const next = [...characterCardStatOrderState];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      characterCardStatOrderState = next;
      renderCharacterCardOrderList();
      persistLive();
    }
  });
  renderCustomStatsList();
  renderSceneCardOrderList();
  renderCharacterCardOrderList();

  const collectSettings = (): BetterSimTrackerSettings => {
    const read = (k: keyof BetterSimTrackerSettings): string =>
      ((modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const readExtra = (k: string): string =>
      ((modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "").trim();
    const readBool = (k: keyof BetterSimTrackerSettings, fallback: boolean): boolean => {
      const node = modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
      if (!node) return fallback;
      return read(k) === "true";
    };
    const readBoolExtra = (k: string, fallback: boolean): boolean => {
      const node = modal.querySelector(`[data-k="${k}"]`) as HTMLInputElement | HTMLSelectElement | null;
      if (node instanceof HTMLInputElement && node.type === "checkbox") return node.checked;
      if (!node) return fallback;
      return readExtra(k) === "true";
    };
    const readNumber = (k: keyof BetterSimTrackerSettings, fallback: number, min?: number, max?: number): number => {
      const n = Number(read(k));
      if (Number.isNaN(n)) return fallback;
      let v = n;
      if (typeof min === "number") v = Math.max(min, v);
      if (typeof max === "number") v = Math.min(max, v);
      return v;
    };
    const readGlobalMoodExpressionMap = (): Record<MoodLabel, string> => {
      const map: Record<MoodLabel, string> = { ...DEFAULT_MOOD_EXPRESSION_MAP };
      const nodes = Array.from(modal.querySelectorAll("[data-bst-global-mood-map]")) as HTMLInputElement[];
      for (const node of nodes) {
        const mood = normalizeMoodLabel(String(node.dataset.bstGlobalMoodMap ?? "")) as MoodLabel | null;
        if (!mood) continue;
        const value = String(node.value ?? "").trim().slice(0, 80);
        map[mood] = value || DEFAULT_MOOD_EXPRESSION_MAP[mood];
      }
      return map;
    };

    return {
      ...input.settings,
      connectionProfile: read("connectionProfile"),
      sequentialExtraction: readBool("sequentialExtraction", input.settings.sequentialExtraction),
      enableSequentialStatGroups: readBool("enableSequentialStatGroups", input.settings.enableSequentialStatGroups),
      maxConcurrentCalls: readNumber("maxConcurrentCalls", input.settings.maxConcurrentCalls, 1, 8),
      strictJsonRepair: readBool("strictJsonRepair", input.settings.strictJsonRepair),
      maxRetriesPerStat: readNumber("maxRetriesPerStat", input.settings.maxRetriesPerStat, 0, 4),
      contextMessages: readNumber("contextMessages", input.settings.contextMessages, 1, 40),
      injectPromptDepth: readNumber("injectPromptDepth", input.settings.injectPromptDepth, 0, 8),
      maxDeltaPerTurn: readNumber("maxDeltaPerTurn", input.settings.maxDeltaPerTurn, 1, 30),
      maxTokensOverride: readNumber("maxTokensOverride", input.settings.maxTokensOverride, 0, 100000),
      truncationLengthOverride: readNumber("truncationLengthOverride", input.settings.truncationLengthOverride, 0, 200000),
      includeCharacterCardsInPrompt: readBool("includeCharacterCardsInPrompt", input.settings.includeCharacterCardsInPrompt),
      includeLorebookInExtraction: readBool("includeLorebookInExtraction", input.settings.includeLorebookInExtraction),
      lorebookExtractionMaxChars: readNumber("lorebookExtractionMaxChars", input.settings.lorebookExtractionMaxChars, 0, 12000),
      confidenceDampening: readNumber("confidenceDampening", input.settings.confidenceDampening, 0, 1),
      moodStickiness: readNumber("moodStickiness", input.settings.moodStickiness, 0, 1),
      injectTrackerIntoPrompt: readBool("injectTrackerIntoPrompt", input.settings.injectTrackerIntoPrompt),
      injectionPromptMaxChars: readNumber("injectionPromptMaxChars", input.settings.injectionPromptMaxChars, 500, 100000),
      summarizationNoteVisibleForAI: readBool("summarizationNoteVisibleForAI", input.settings.summarizationNoteVisibleForAI),
      injectSummarizationNote: readBool("injectSummarizationNote", input.settings.injectSummarizationNote),
      autoDetectActive: readBool("autoDetectActive", input.settings.autoDetectActive),
      autoGenerateTracker: readBool("autoGenerateTracker", input.settings.autoGenerateTracker),
      regenerateOnMessageEdit: readBool("regenerateOnMessageEdit", input.settings.regenerateOnMessageEdit),
      generateOnGreetingMessages: readBool("generateOnGreetingMessages", input.settings.generateOnGreetingMessages),
      activityLookback: readNumber("activityLookback", input.settings.activityLookback, 1, 25),
      showInactive: readBool("showInactive", input.settings.showInactive),
      inactiveLabel: read("inactiveLabel") || input.settings.inactiveLabel,
      showLastThought: readBool("showLastThought", input.settings.showLastThought),
      sceneCardEnabled: readBool("sceneCardEnabled", input.settings.sceneCardEnabled),
      sceneCardPosition: read("sceneCardPosition") === "above_message" ? "above_message" : "above_tracker_cards",
      sceneCardLayout: read("sceneCardLayout") === "rows" ? "rows" : "chips",
      sceneCardTitle: read("sceneCardTitle") || input.settings.sceneCardTitle,
      sceneCardColor: read("sceneCardColor") || "",
      sceneCardValueColor: read("sceneCardValueColor") || "",
      sceneCardShowWhenEmpty: readBool("sceneCardShowWhenEmpty", input.settings.sceneCardShowWhenEmpty),
      sceneCardArrayCollapsedLimit: readNumber("sceneCardArrayCollapsedLimit", input.settings.sceneCardArrayCollapsedLimit, 1, MAX_CUSTOM_ARRAY_ITEMS),
      sceneCardStatOrder: [...sceneCardStatOrderState],
      sceneCardStatDisplay: { ...sceneCardStatDisplayState },
      characterCardStatOrder: [...characterCardStatOrderState],
      trackAffection: readBool("trackAffection", input.settings.trackAffection),
      trackTrust: readBool("trackTrust", input.settings.trackTrust),
      trackDesire: readBool("trackDesire", input.settings.trackDesire),
      trackConnection: readBool("trackConnection", input.settings.trackConnection),
      trackMood: readBool("trackMood", input.settings.trackMood),
      trackLastThought: readBool("trackLastThought", input.settings.trackLastThought),
      lastThoughtPrivate: input.settings.lastThoughtPrivate,
      enableUserTracking: readBool("enableUserTracking", input.settings.enableUserTracking),
      userTrackMood: readBool("userTrackMood", input.settings.userTrackMood),
      userTrackLastThought: readBool("userTrackLastThought", input.settings.userTrackLastThought),
      includeUserTrackerInInjection: readBool("includeUserTrackerInInjection", input.settings.includeUserTrackerInInjection),
      builtInNumericStatUi: cloneBuiltInNumericStatUi(builtInNumericStatUiState),
      moodSource: read("moodSource") === "st_expressions" ? "st_expressions" : "bst_images",
      moodExpressionMap: readGlobalMoodExpressionMap(),
      stExpressionImageZoom: readNumber("stExpressionImageZoom", input.settings.stExpressionImageZoom, 0.5, 3),
      stExpressionImagePositionX: readNumber("stExpressionImagePositionX", input.settings.stExpressionImagePositionX, 0, 100),
      stExpressionImagePositionY: readNumber("stExpressionImagePositionY", input.settings.stExpressionImagePositionY, 0, 100),
      accentColor: read("accentColor") || input.settings.accentColor,
      userCardColor: read("userCardColor") || "",
      cardOpacity: readNumber("cardOpacity", input.settings.cardOpacity, 0.1, 1),
      borderRadius: readNumber("borderRadius", input.settings.borderRadius, 0, 32),
      fontSize: readNumber("fontSize", input.settings.fontSize, 10, 22),
      debug: readBool("debug", input.settings.debug),
      debugFlags: {
        extraction: readBoolExtra("debugExtraction", input.settings.debugFlags?.extraction ?? true),
        prompts: readBoolExtra("debugPrompts", input.settings.debugFlags?.prompts ?? true),
        ui: readBoolExtra("debugUi", input.settings.debugFlags?.ui ?? true),
        moodImages: readBoolExtra("debugMoodImages", input.settings.debugFlags?.moodImages ?? true),
        storage: readBoolExtra("debugStorage", input.settings.debugFlags?.storage ?? true),
      },
      includeContextInDiagnostics: readBool("includeContextInDiagnostics", input.settings.includeContextInDiagnostics),
      includeGraphInDiagnostics: readBool("includeGraphInDiagnostics", input.settings.includeGraphInDiagnostics),
      promptTemplateUnified: read("promptTemplateUnified") || DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
      promptTemplateSequentialAffection: read("promptTemplateSequentialAffection") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.affection,
      promptTemplateSequentialTrust: read("promptTemplateSequentialTrust") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.trust,
      promptTemplateSequentialDesire: read("promptTemplateSequentialDesire") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.desire,
      promptTemplateSequentialConnection: read("promptTemplateSequentialConnection") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.connection,
      promptTemplateSequentialCustomNumeric: read("promptTemplateSequentialCustomNumeric") || DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
      promptTemplateSequentialCustomNonNumeric: read("promptTemplateSequentialCustomNonNumeric") || DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION,
      promptTemplateSequentialMood: read("promptTemplateSequentialMood") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood,
      promptTemplateSequentialLastThought: read("promptTemplateSequentialLastThought") || DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought,
      builtInBehaviorAffection: read("builtInBehaviorAffection").slice(0, 4000),
      builtInBehaviorTrust: read("builtInBehaviorTrust").slice(0, 4000),
      builtInBehaviorDesire: read("builtInBehaviorDesire").slice(0, 4000),
      builtInBehaviorConnection: read("builtInBehaviorConnection").slice(0, 4000),
      promptTemplateInjection: read("promptTemplateInjection") || DEFAULT_INJECTION_PROMPT_TEMPLATE,
      unlockProtocolPrompts: readBool("unlockProtocolPrompts", input.settings.unlockProtocolPrompts),
      promptProtocolUnified: read("promptProtocolUnified") || DEFAULT_PROTOCOL_UNIFIED,
      promptProtocolSequentialAffection: read("promptProtocolSequentialAffection") || DEFAULT_PROTOCOL_SEQUENTIAL_AFFECTION,
      promptProtocolSequentialTrust: read("promptProtocolSequentialTrust") || DEFAULT_PROTOCOL_SEQUENTIAL_TRUST,
      promptProtocolSequentialDesire: read("promptProtocolSequentialDesire") || DEFAULT_PROTOCOL_SEQUENTIAL_DESIRE,
      promptProtocolSequentialConnection: read("promptProtocolSequentialConnection") || DEFAULT_PROTOCOL_SEQUENTIAL_CONNECTION,
      promptProtocolSequentialCustomNumeric: read("promptProtocolSequentialCustomNumeric") || DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NUMERIC,
      promptProtocolSequentialCustomNonNumeric: read("promptProtocolSequentialCustomNonNumeric") || DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NON_NUMERIC,
      promptProtocolSequentialMood: read("promptProtocolSequentialMood") || DEFAULT_PROTOCOL_SEQUENTIAL_MOOD,
      promptProtocolSequentialLastThought: read("promptProtocolSequentialLastThought") || DEFAULT_PROTOCOL_SEQUENTIAL_LAST_THOUGHT,
      customStats: customStatsState.map(cloneCustomStatDefinition)
    };
  };

  const syncExtractionVisibility = (): void => {
    const maxConcurrentRow = modal.querySelector('[data-bst-row="maxConcurrentCalls"]') as HTMLElement | null;
    const injectPromptDepthRow = modal.querySelector('[data-bst-row="injectPromptDepth"]') as HTMLElement | null;
    const maxRetriesRow = modal.querySelector('[data-bst-row="maxRetriesPerStat"]') as HTMLElement | null;
    const lookbackRow = modal.querySelector('[data-bst-row="activityLookback"]') as HTMLElement | null;
    const regenerateOnMessageEditRow = modal.querySelector('[data-bst-row="regenerateOnMessageEdit"]') as HTMLElement | null;
    const generateOnGreetingMessagesRow = modal.querySelector('[data-bst-row="generateOnGreetingMessages"]') as HTMLElement | null;
    const inactiveLabelRow = modal.querySelector('[data-bst-row="inactiveLabel"]') as HTMLElement | null;
    const sceneCardDrawer = modal.querySelector('[data-bst-row="sceneCardDrawer"]') as HTMLElement | null;
    const sceneCardPositionRow = modal.querySelector('[data-bst-row="sceneCardPosition"]') as HTMLElement | null;
    const sceneCardLayoutRow = modal.querySelector('[data-bst-row="sceneCardLayout"]') as HTMLElement | null;
    const sceneCardTitleRow = modal.querySelector('[data-bst-row="sceneCardTitle"]') as HTMLElement | null;
    const sceneCardColorRow = modal.querySelector('[data-bst-row="sceneCardColor"]') as HTMLElement | null;
    const sceneCardValueColorRow = modal.querySelector('[data-bst-row="sceneCardValueColor"]') as HTMLElement | null;
    const sceneCardShowWhenEmptyRow = modal.querySelector('[data-bst-row="sceneCardShowWhenEmpty"]') as HTMLElement | null;
    const sceneCardOrderManagerRow = modal.querySelector('[data-bst-row="sceneCardOrderManager"]') as HTMLElement | null;
    const sceneCardArrayCollapsedLimitRow = modal.querySelector('[data-bst-row="sceneCardArrayCollapsedLimit"]') as HTMLElement | null;
    const debugBodyRow = modal.querySelector('[data-bst-row="debugBody"]') as HTMLElement | null;
    const debugFlagsRow = modal.querySelector('[data-bst-row="debugFlags"]') as HTMLElement | null;
    const contextDiagRow = modal.querySelector('[data-bst-row="includeContextInDiagnostics"]') as HTMLElement | null;
    const graphDiagRow = modal.querySelector('[data-bst-row="includeGraphInDiagnostics"]') as HTMLElement | null;
    const injectPromptBlock = modal.querySelector('[data-bst-row="injectPromptBlock"]') as HTMLElement | null;
    const injectPromptDivider = modal.querySelector('[data-bst-row="injectPromptDivider"]') as HTMLElement | null;
    const injectSummarizationNoteRow = modal.querySelector('[data-bst-row="injectSummarizationNote"]') as HTMLElement | null;
    const lorebookExtractionMaxCharsRow = modal.querySelector('[data-bst-row="lorebookExtractionMaxChars"]') as HTMLElement | null;
    const lorebookExtractionHelpRow = modal.querySelector('[data-bst-row="lorebookExtractionHelp"]') as HTMLElement | null;
    const injectionPromptMaxCharsRow = modal.querySelector('[data-bst-row="injectionPromptMaxChars"]') as HTMLElement | null;
    const moodAdvancedBlock = modal.querySelector('[data-bst-row="moodAdvancedBlock"]') as HTMLElement | null;
    const globalMoodExpressionMap = modal.querySelector('[data-bst-row="globalMoodExpressionMap"]') as HTMLElement | null;
    const stExpressionImageOptions = modal.querySelector('[data-bst-row="stExpressionImageOptions"]') as HTMLElement | null;
    const protocolReadonlyBlocks = Array.from(modal.querySelectorAll(".bst-protocol-readonly-wrap")) as HTMLElement[];
    const protocolEditableBlocks = Array.from(modal.querySelectorAll(".bst-protocol-editable-wrap")) as HTMLElement[];
    const current = collectSettings();
    if (maxConcurrentRow) {
      maxConcurrentRow.style.display = current.sequentialExtraction ? "flex" : "none";
      maxConcurrentRow.style.flexDirection = "column";
      maxConcurrentRow.style.gap = "4px";
    }
    if (injectPromptDepthRow) {
      injectPromptDepthRow.style.display = current.injectTrackerIntoPrompt ? "flex" : "none";
      injectPromptDepthRow.style.flexDirection = "column";
      injectPromptDepthRow.style.gap = "4px";
    }
    if (maxRetriesRow) {
      maxRetriesRow.style.display = current.strictJsonRepair ? "flex" : "none";
      maxRetriesRow.style.flexDirection = "column";
      maxRetriesRow.style.gap = "4px";
    }
    if (lookbackRow) {
      lookbackRow.style.display = current.autoDetectActive ? "flex" : "none";
      lookbackRow.style.flexDirection = "column";
      lookbackRow.style.gap = "4px";
    }
    if (regenerateOnMessageEditRow) {
      regenerateOnMessageEditRow.style.display = current.autoGenerateTracker ? "" : "none";
    }
    if (generateOnGreetingMessagesRow) {
      generateOnGreetingMessagesRow.style.display = current.autoGenerateTracker ? "" : "none";
    }
    if (inactiveLabelRow) {
      inactiveLabelRow.style.display = current.showInactive ? "flex" : "none";
      inactiveLabelRow.style.flexDirection = "column";
      inactiveLabelRow.style.gap = "4px";
    }
    if (sceneCardDrawer) {
      sceneCardDrawer.style.display = "block";
    }
    if (sceneCardPositionRow) {
      sceneCardPositionRow.style.display = current.sceneCardEnabled ? "flex" : "none";
      sceneCardPositionRow.style.flexDirection = "column";
      sceneCardPositionRow.style.gap = "4px";
    }
    if (sceneCardLayoutRow) {
      sceneCardLayoutRow.style.display = current.sceneCardEnabled ? "flex" : "none";
      sceneCardLayoutRow.style.flexDirection = "column";
      sceneCardLayoutRow.style.gap = "4px";
    }
    if (sceneCardTitleRow) {
      sceneCardTitleRow.style.display = current.sceneCardEnabled ? "flex" : "none";
      sceneCardTitleRow.style.flexDirection = "column";
      sceneCardTitleRow.style.gap = "4px";
    }
    if (sceneCardColorRow) {
      sceneCardColorRow.style.display = current.sceneCardEnabled ? "flex" : "none";
      sceneCardColorRow.style.flexDirection = "column";
      sceneCardColorRow.style.gap = "4px";
    }
    if (sceneCardValueColorRow) {
      sceneCardValueColorRow.style.display = current.sceneCardEnabled ? "flex" : "none";
      sceneCardValueColorRow.style.flexDirection = "column";
      sceneCardValueColorRow.style.gap = "4px";
    }
    if (sceneCardShowWhenEmptyRow) {
      sceneCardShowWhenEmptyRow.style.display = current.sceneCardEnabled ? "" : "none";
    }
    if (sceneCardOrderManagerRow) {
      sceneCardOrderManagerRow.style.display = current.sceneCardEnabled ? "block" : "none";
    }
    if (sceneCardArrayCollapsedLimitRow) {
      sceneCardArrayCollapsedLimitRow.style.display = current.sceneCardEnabled && current.sceneCardLayout === "chips" ? "flex" : "none";
      sceneCardArrayCollapsedLimitRow.style.flexDirection = "column";
      sceneCardArrayCollapsedLimitRow.style.gap = "4px";
    }
    if (debugBodyRow) {
      debugBodyRow.style.display = current.debug ? "block" : "none";
    }
    if (debugFlagsRow) {
      debugFlagsRow.style.display = current.debug ? "grid" : "none";
    }
    if (contextDiagRow) {
      contextDiagRow.style.display = current.debug ? "" : "none";
    }
    if (graphDiagRow) {
      graphDiagRow.style.display = current.debug ? "" : "none";
    }
    if (injectPromptBlock) {
      injectPromptBlock.style.display = current.injectTrackerIntoPrompt ? "flex" : "none";
    }
    if (injectPromptDivider) {
      injectPromptDivider.style.display = current.injectTrackerIntoPrompt ? "block" : "none";
    }
    if (injectSummarizationNoteRow) {
      injectSummarizationNoteRow.style.display = current.injectTrackerIntoPrompt ? "" : "none";
    }
    if (lorebookExtractionMaxCharsRow) {
      lorebookExtractionMaxCharsRow.style.display = current.includeLorebookInExtraction ? "flex" : "none";
      lorebookExtractionMaxCharsRow.style.flexDirection = "column";
      lorebookExtractionMaxCharsRow.style.gap = "4px";
    }
    if (lorebookExtractionHelpRow) {
      lorebookExtractionHelpRow.style.display = current.includeLorebookInExtraction ? "block" : "none";
    }
    if (injectionPromptMaxCharsRow) {
      injectionPromptMaxCharsRow.style.display = current.injectTrackerIntoPrompt ? "flex" : "none";
      injectionPromptMaxCharsRow.style.flexDirection = "column";
      injectionPromptMaxCharsRow.style.gap = "4px";
    }
    if (moodAdvancedBlock) {
      moodAdvancedBlock.style.display = current.trackMood ? "block" : "none";
    }
    if (globalMoodExpressionMap) {
      globalMoodExpressionMap.style.display = current.trackMood && current.moodSource === "st_expressions" ? "block" : "none";
    }
    if (stExpressionImageOptions) {
      stExpressionImageOptions.style.display = current.trackMood && current.moodSource === "st_expressions" ? "block" : "none";
    }
    for (const node of protocolReadonlyBlocks) {
      node.style.display = current.unlockProtocolPrompts ? "none" : "block";
    }
    for (const node of protocolEditableBlocks) {
      node.style.display = current.unlockProtocolPrompts ? "block" : "none";
    }
  };

  const persistLive = (): void => {
    const next = collectSettings();
    customStatsState = Array.isArray(next.customStats)
      ? next.customStats.map(cloneCustomStatDefinition)
      : [];
    sceneCardStatOrderState = Array.isArray(next.sceneCardStatOrder)
      ? next.sceneCardStatOrder.map(id => String(id ?? "").trim().toLowerCase()).filter(Boolean)
      : [];
    characterCardStatOrderState = Array.isArray(next.characterCardStatOrder)
      ? next.characterCardStatOrder.map(id => String(id ?? "").trim().toLowerCase()).filter(Boolean)
      : [];
    sceneCardStatDisplayState = next.sceneCardStatDisplay && typeof next.sceneCardStatDisplay === "object"
      ? { ...next.sceneCardStatDisplay }
      : {};
    syncSceneCardStatOrderState();
    syncCharacterCardStatOrderState();
    builtInNumericStatUiState = cloneBuiltInNumericStatUi(next.builtInNumericStatUi);
    next.sceneCardStatOrder = [...sceneCardStatOrderState];
    next.characterCardStatOrder = [...characterCardStatOrderState];
    input.settings = next;
    input.onSave(next);
    renderCustomStatsList();
    renderSceneCardOrderList();
    renderCharacterCardOrderList();
    refreshSettingsTextareaCounters();
    updateGlobalStExpressionSummary();
    syncExtractionVisibility();
  };

  modal.querySelector('[data-action="open-global-st-framing"]')?.addEventListener("click", async () => {
    if (globalFrameButton) globalFrameButton.disabled = true;
    globalPreviewCharacters = await loadGlobalPreviewCharacters();
    if (globalFrameButton) globalFrameButton.disabled = false;
    if (!globalPreviewCharacters.find(item => item.name === globalPreviewSelected)) {
      globalPreviewSelected = globalPreviewCharacters[0]?.name ?? "";
    }
    const selected = globalPreviewCharacters.find(item => item.name === globalPreviewSelected) ?? globalPreviewCharacters[0] ?? null;
    openStExpressionFrameEditor({
      title: "Adjust ST Expression Framing",
      description: selected
        ? `Global framing preview using ${selected.name}'s ST expression sprite.`
        : "Global framing used when mood source is ST expressions.",
      initial: readGlobalStExpressionFrame(),
      fallback: DEFAULT_ST_EXPRESSION_IMAGE_OPTIONS,
      previewChoices: globalPreviewCharacters.map(item => ({ name: item.name, imageUrl: item.spriteUrl })),
      selectedPreviewName: selected?.name ?? "",
      onPreviewNameChange: name => {
        globalPreviewSelected = name;
      },
      emptyPreviewText: noPreviewFoundText,
      onChange: next => {
        set("stExpressionImageZoom", String(next.zoom));
        set("stExpressionImagePositionX", String(next.positionX));
        set("stExpressionImagePositionY", String(next.positionY));
        updateGlobalStExpressionSummary();
        persistLive();
      },
    });
  });

  modal.querySelectorAll("input, select, textarea").forEach(node => {
    node.addEventListener("change", persistLive);
    if (node instanceof HTMLInputElement && node.type === "number") {
      node.addEventListener("input", persistLive);
    }
    if (node instanceof HTMLTextAreaElement) {
      node.addEventListener("input", persistLive);
    }
  });
  syncExtractionVisibility();
  const tooltips: Partial<Record<keyof BetterSimTrackerSettings, string>> = {
    connectionProfile: "Choose a specific SillyTavern connection profile for tracker extraction calls.",
    sequentialExtraction: "Run one extraction prompt per stat instead of one unified prompt. More robust but slower.",
    enableSequentialStatGroups: "When enabled, custom stats with the same Sequential Group are extracted together in one sequential request.",
    maxConcurrentCalls: "When sequential mode is enabled, number of stat requests sent in parallel.",
    strictJsonRepair: "Enable strict retry prompts when model output is not valid or missing required fields.",
    maxRetriesPerStat: "Maximum repair retries for each stat extraction stage.",
    contextMessages: "How many recent chat messages are included in tracker extraction context.",
    injectPromptDepth: "How deep into the in-chat prompt stack the injected relationship state should be inserted (0 = nearest/top, max 8).",
    maxDeltaPerTurn: "Hard cap for stat change magnitude in one tracker update before confidence scaling.",
    maxTokensOverride: "Override max tokens for extraction requests (0 = use profile/preset defaults).",
    truncationLengthOverride: "Override context truncation length for extraction requests (0 = use profile/preset defaults).",
    includeCharacterCardsInPrompt: "Include character card description/personality/scenario if recent messages are unclear.",
    confidenceDampening: "How strongly model confidence scales stat deltas (0 = ignore confidence, 1 = full effect).",
    moodStickiness: "Higher values keep previous mood unless confidence is strong.",
    injectTrackerIntoPrompt: "Inject current relationship state into generation prompt for behavioral coherence.",
    includeLorebookInExtraction: "Include activated lorebook context in extraction prompt building (for stat analysis only).",
    lorebookExtractionMaxChars: "Maximum lorebook characters included in extraction context (0 means no trim).",
    injectionPromptMaxChars: "Maximum size of hidden injection prompt block sent to generation.",
    summarizationNoteVisibleForAI: "Controls visibility mode for newly generated Summarize notes (prose summaries of current tracked stats). Existing notes are unchanged for safety.",
    injectSummarizationNote: "Include the latest Summarize note (prose summary of current tracked stats) in hidden tracker prompt injection guidance only (no chat-message edits).",
    autoDetectActive: "Automatically decide which group characters are active in current scene.",
    autoGenerateTracker: "When disabled, BST does not auto-extract on new AI/user messages. Use manual refresh/retry only.",
    regenerateOnMessageEdit: "When enabled, editing an already-tracked message triggers tracker regeneration for that message.",
    generateOnGreetingMessages: "When disabled, skips tracker extraction for first-message greetings (no prior user message in chat).",
    activityLookback: "Primary recent-speaker window. Characters stay active longer via persistence unless departure cues remove them.",
    trackAffection: "Enable Affection stat extraction and updates.",
    trackTrust: "Enable Trust stat extraction and updates.",
    trackDesire: "Enable Desire stat extraction and updates.",
    trackConnection: "Enable Connection stat extraction and updates.",
    trackMood: "Enable mood extraction and mood display updates.",
    trackLastThought: "Enable hidden short internal thought extraction.",
    enableUserTracking: "Run user-side extraction after user messages (custom stats respect per-stat Track for User toggle).",
    userTrackMood: "Allow user-side extraction to update User mood.",
    userTrackLastThought: "Allow user-side extraction to update User lastThought.",
    includeUserTrackerInInjection: "Include user-side tracked state in hidden prompt injection when available.",
    moodSource: "Choose where mood images come from: BetterSimTracker uploads or SillyTavern expression sprites.",
    stExpressionImageZoom: "Global zoom for ST expression mood images (higher values crop closer).",
    stExpressionImagePositionX: "Global horizontal crop position for ST expression mood images.",
    stExpressionImagePositionY: "Global vertical crop position for ST expression mood images.",
    showInactive: "Show tracker cards for inactive/off-screen characters.",
    inactiveLabel: "Text label shown on cards for inactive characters.",
    showLastThought: "Show extracted last thought text inside tracker cards.",
    sceneCardEnabled: "Render a dedicated Scene card from global custom stats.",
    sceneCardPosition: "Choose whether the Scene card renders above tracker cards or above message text.",
    sceneCardLayout: "Choose compact chip layout or one-row-per-stat layout for Scene card values.",
    sceneCardTitle: "Visible title for the Scene card.",
    sceneCardColor: "Optional card color override for Scene card (hex). Empty = automatic color.",
    sceneCardValueColor: "Optional scene stat value color override (hex). Empty = per-stat/accent color.",
    sceneCardShowWhenEmpty: "Keep Scene card visible even when no global stat has a resolved value.",
    sceneCardArrayCollapsedLimit: "How many array items are shown before +N more appears in Scene card chips mode.",
    accentColor: "Accent color for fills, highlights, and action emphasis.",
    userCardColor: "Optional hex override for the User tracker card color (leave empty for auto color).",
    cardOpacity: "Overall tracker container opacity.",
    borderRadius: "Corner roundness for tracker cards and controls.",
    fontSize: "Base font size used inside tracker cards.",
    debug: "Enable verbose diagnostics logging for troubleshooting.",
    includeContextInDiagnostics: "Include extraction prompt/context text in diagnostics dumps (larger logs).",
    includeGraphInDiagnostics: "Include graph-open series payloads in diagnostics trace output.",
    promptTemplateInjection: "Template for injected relationship state guidance (used only when injection is enabled).",
    promptTemplateUnified: "Unified prompt instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialAffection: "Sequential Affection instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialTrust: "Sequential Trust instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialDesire: "Sequential Desire instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialConnection: "Sequential Connection instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialCustomNumeric: "Default instruction for custom numeric per-stat extraction (used in all modes; per-stat override in custom stat wizard still wins).",
    promptTemplateSequentialCustomNonNumeric: "Default instruction for custom non-numeric per-stat extraction (used in all modes; per-stat override in custom stat wizard still wins).",
    promptTemplateSequentialMood: "Sequential Mood instruction (protocol is separately configurable in advanced mode).",
    promptTemplateSequentialLastThought: "Sequential LastThought instruction (protocol is separately configurable in advanced mode).",
    builtInBehaviorAffection: "Injection-only behavior guidance for how high/low affection should change replies.",
    builtInBehaviorTrust: "Injection-only behavior guidance for how high/low trust should change replies.",
    builtInBehaviorDesire: "Injection-only behavior guidance for how high/low desire should change replies.",
    builtInBehaviorConnection: "Injection-only behavior guidance for how high/low connection should change replies.",
    unlockProtocolPrompts: "Advanced mode: unlock protocol blocks for editing. Incorrect protocol formatting can break extraction.",
    promptProtocolUnified: "Protocol block for unified extraction (advanced override).",
    promptProtocolSequentialAffection: "Protocol block for sequential affection extraction (advanced override).",
    promptProtocolSequentialTrust: "Protocol block for sequential trust extraction (advanced override).",
    promptProtocolSequentialDesire: "Protocol block for sequential desire extraction (advanced override).",
    promptProtocolSequentialConnection: "Protocol block for sequential connection extraction (advanced override).",
    promptProtocolSequentialCustomNumeric: "Protocol block for custom numeric extraction (advanced override).",
    promptProtocolSequentialCustomNonNumeric: "Protocol block for custom non-numeric extraction (advanced override).",
    promptProtocolSequentialMood: "Protocol block for sequential mood extraction (advanced override).",
    promptProtocolSequentialLastThought: "Protocol block for sequential lastThought extraction (advanced override)."
  };
  for (const [key, tooltip] of Object.entries(tooltips) as Array<[keyof BetterSimTrackerSettings, string]>) {
    const inputNode = modal.querySelector(`[data-k="${key}"]`) as HTMLElement | null;
    if (!inputNode) continue;
    inputNode.setAttribute("title", tooltip);
    const labelNode = inputNode.closest("label");
    labelNode?.setAttribute("title", tooltip);
  }

  modal.querySelectorAll('[data-action="close"]').forEach(node => {
    node.addEventListener("click", () => {
      persistLive();
      closeSettingsModal();
    });
  });

  modal.querySelectorAll('[data-action="retrack"]').forEach(node => {
    node.addEventListener("click", () => {
      persistLive();
      input.onRetrack?.();
    });
  });

  modal.querySelector('[data-action="clear-chat"]')?.addEventListener("click", () => {
    persistLive();
    input.onClearCurrentChat?.();
  });

  modal.querySelector('[data-action="dump-diagnostics"]')?.addEventListener("click", () => {
    persistLive();
    input.onDumpDiagnostics?.();
  });

  modal.querySelector('[data-action="clear-diagnostics"]')?.addEventListener("click", () => {
    persistLive();
    input.onClearDiagnostics?.();
  });
  const promptDefaults: Partial<Record<keyof BetterSimTrackerSettings, string>> = {
    promptTemplateUnified: DEFAULT_UNIFIED_PROMPT_INSTRUCTION,
    promptTemplateSequentialAffection: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.affection,
    promptTemplateSequentialTrust: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.trust,
    promptTemplateSequentialDesire: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.desire,
    promptTemplateSequentialConnection: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.connection,
    promptTemplateSequentialCustomNumeric: DEFAULT_SEQUENTIAL_CUSTOM_NUMERIC_PROMPT_INSTRUCTION,
    promptTemplateSequentialCustomNonNumeric: DEFAULT_SEQUENTIAL_CUSTOM_NON_NUMERIC_PROMPT_INSTRUCTION,
    promptTemplateSequentialMood: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.mood,
    promptTemplateSequentialLastThought: DEFAULT_SEQUENTIAL_PROMPT_INSTRUCTIONS.lastThought,
    builtInBehaviorAffection: "",
    builtInBehaviorTrust: "",
    builtInBehaviorDesire: "",
    builtInBehaviorConnection: "",
    promptTemplateInjection: DEFAULT_INJECTION_PROMPT_TEMPLATE,
    promptProtocolUnified: DEFAULT_PROTOCOL_UNIFIED,
    promptProtocolSequentialAffection: DEFAULT_PROTOCOL_SEQUENTIAL_AFFECTION,
    promptProtocolSequentialTrust: DEFAULT_PROTOCOL_SEQUENTIAL_TRUST,
    promptProtocolSequentialDesire: DEFAULT_PROTOCOL_SEQUENTIAL_DESIRE,
    promptProtocolSequentialConnection: DEFAULT_PROTOCOL_SEQUENTIAL_CONNECTION,
    promptProtocolSequentialCustomNumeric: DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NUMERIC,
    promptProtocolSequentialCustomNonNumeric: DEFAULT_PROTOCOL_SEQUENTIAL_CUSTOM_NON_NUMERIC,
    promptProtocolSequentialMood: DEFAULT_PROTOCOL_SEQUENTIAL_MOOD,
    promptProtocolSequentialLastThought: DEFAULT_PROTOCOL_SEQUENTIAL_LAST_THOUGHT,
  };

  type BuiltInSequentialPromptSettingKey =
    | "promptTemplateSequentialAffection"
    | "promptTemplateSequentialTrust"
    | "promptTemplateSequentialDesire"
    | "promptTemplateSequentialConnection"
    | "promptTemplateSequentialMood"
    | "promptTemplateSequentialLastThought";

  const builtInSequentialPromptKeyToStat: Record<
    BuiltInSequentialPromptSettingKey,
    "affection" | "trust" | "desire" | "connection" | "mood" | "lastThought"
  > = {
    promptTemplateSequentialAffection: "affection",
    promptTemplateSequentialTrust: "trust",
    promptTemplateSequentialDesire: "desire",
    promptTemplateSequentialConnection: "connection",
    promptTemplateSequentialMood: "mood",
    promptTemplateSequentialLastThought: "lastThought",
  };

  const setBuiltInSeqAiStatus = (
    key: BuiltInSequentialPromptSettingKey,
    state: "idle" | "loading" | "success" | "error",
    message?: string,
  ): void => {
    const statusNode = modal.querySelector(`[data-bst-seq-ai-status="${key}"]`) as HTMLElement | null;
    if (!statusNode) return;
    const rowNode = statusNode.closest(".bst-prompt-ai-row") as HTMLElement | null;
    const text = String(message ?? "").trim();
    if (!text && state === "idle") {
      statusNode.textContent = "";
      statusNode.setAttribute("data-state", "idle");
      if (rowNode) rowNode.style.display = "none";
      return;
    }
    statusNode.textContent = text;
    statusNode.setAttribute("data-state", state);
    if (rowNode) rowNode.style.display = text ? "block" : "none";
  };

  (Object.keys(builtInSequentialPromptKeyToStat) as BuiltInSequentialPromptSettingKey[])
    .forEach(key => setBuiltInSeqAiStatus(key, "idle"));

  let builtInSeqGenerateRequestId = 0;
  modal.querySelectorAll('[data-action="generate-seq-prompt"]').forEach(node => {
    node.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const button = event.currentTarget as HTMLButtonElement | null;
      if (!button) return;
      if (button.getAttribute("data-loading") === "true") return;

      const key = button.getAttribute("data-generate-for") as BuiltInSequentialPromptSettingKey | null;
      if (!key || !(key in builtInSequentialPromptKeyToStat)) return;
      const stat = builtInSequentialPromptKeyToStat[key];

      const textarea = modal.querySelector(`[data-k="${key}"]`) as HTMLTextAreaElement | null;
      if (!textarea) {
        setBuiltInSeqAiStatus(key, "error", "Prompt field unavailable.");
        return;
      }

      const currentInstruction = textarea.value.trim() || String(promptDefaults[key] ?? "");
      const requestId = ++builtInSeqGenerateRequestId;
      button.disabled = true;
      button.setAttribute("data-loading", "true");
      setBuiltInSeqAiStatus(key, "loading", "Generating instruction...");
      try {
        const settingsForRequest = collectSettings();
        const prompt = buildBuiltInSequentialPromptGenerationPrompt({
          stat,
          currentInstruction,
        });
        const response = await generateJson(prompt, settingsForRequest);
        if (requestId !== builtInSeqGenerateRequestId) return;

        const cleaned = sanitizeGeneratedSequentialTemplate(response.text);
        if (!cleaned) {
          throw new Error("AI returned empty instruction text. Try again.");
        }

        textarea.value = cleaned;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        setBuiltInSeqAiStatus(key, "success", "Generated. Review and edit if needed.");
        logDebug(settingsForRequest, "prompts", "builtin.seq.generated", {
          stat,
          key,
          profileId: response.meta.profileId,
          outputChars: cleaned.length,
        });
      } catch (error) {
        if (requestId !== builtInSeqGenerateRequestId) return;
        const message = error instanceof Error ? error.message : String(error);
        setBuiltInSeqAiStatus(key, "error", message || "Generation failed. Try again.");
      } finally {
        if (requestId === builtInSeqGenerateRequestId) {
          button.disabled = false;
          button.setAttribute("data-loading", "false");
        }
      }
    });
  });

  modal.querySelectorAll('[data-action="reset-prompt"]').forEach(node => {
    node.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement | null;
      const key = target?.getAttribute("data-reset-for") as keyof BetterSimTrackerSettings | null;
      if (!key) return;
      const value = promptDefaults[key];
      if (typeof value !== "string") return;
      (input.settings as unknown as Record<string, unknown>)[key] = value;
      set(key, value);
      persistLive();
    });
  });
}

export function closeSettingsModal(): void {
  closeStExpressionFrameEditor();
  document.querySelector(".bst-custom-wizard-backdrop")?.remove();
  document.querySelector(".bst-custom-wizard")?.remove();
  document.querySelector(".bst-settings-backdrop")?.remove();
  document.querySelector(".bst-settings")?.remove();
}







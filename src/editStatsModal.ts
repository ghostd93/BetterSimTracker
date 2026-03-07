import { GLOBAL_TRACKER_KEY, USER_TRACKER_KEY } from "./constants";
import { getAllNumericStatDefinitions } from "./statRegistry";
import { normalizeDateTimeValue, toDateTimeInputValue } from "./dateTime";
import { MAX_CUSTOM_ARRAY_ITEMS, normalizeNonNumericArrayItems, resolveEnumOption } from "./customStatRuntime";
import type { BetterSimTrackerSettings, TrackerData } from "./types";
import {
  EDIT_STATS_BACKDROP_CLASS,
  EDIT_STATS_DIALOG_CLASS,
  EDIT_STATS_MODAL_CLASS,
  MAX_EDIT_LAST_THOUGHT_CHARS,
  MOOD_LABELS,
  bindTextareaCounters,
  clampNumberInputToBounds,
  ensureStyles,
  escapeHtml,
  getNonNumericStatDefinitions,
  normalizeMoodLabel,
  normalizeNonNumericTextValue,
} from "./ui";

export type EditStatsPayload = {
  messageIndex: number;
  character: string;
  numeric: Record<string, number | null>;
  nonNumeric?: Record<string, string | boolean | string[] | null>;
  active?: boolean;
  mood?: string | null;
  lastThought?: string | null;
};

function uniqueOwnerKeys(primary: string, displayName: string): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const v = String(value ?? "").trim();
    if (!v || out.includes(v)) return;
    out.push(v);
  };
  push(primary);
  push(displayName);
  return out;
}

function resolveEditNumericRawValue(
  data: TrackerData,
  statId: string,
  ownerKeys: string[],
  globalScope = false,
): number | undefined {
  const byOwner = data.customStatistics?.[statId];
  if (!byOwner) return undefined;
  if (globalScope) {
    const globalRaw = byOwner[GLOBAL_TRACKER_KEY];
    if (globalRaw !== undefined) return Number(globalRaw);
  }
  for (const ownerKey of ownerKeys) {
    const ownerRaw = byOwner[ownerKey];
    if (ownerRaw !== undefined) return Number(ownerRaw);
  }
  return undefined;
}

function resolveEditNonNumericRawValue(
  data: TrackerData,
  statId: string,
  ownerKeys: string[],
  globalScope = false,
): string | boolean | string[] | null | undefined {
  const byOwner = data.customNonNumericStatistics?.[statId];
  if (!byOwner) return undefined;
  if (globalScope) {
    const globalRaw = byOwner[GLOBAL_TRACKER_KEY];
    if (globalRaw !== undefined) return globalRaw;
  }
  for (const ownerKey of ownerKeys) {
    const ownerRaw = byOwner[ownerKey];
    if (ownerRaw !== undefined) return ownerRaw;
  }
  return undefined;
}

export function closeEditStatsModal(): void {
  const dialog = document.querySelector(`.${EDIT_STATS_DIALOG_CLASS}`) as HTMLDialogElement | null;
  if (dialog) {
    if (dialog.open) {
      try {
        dialog.close();
      } catch {
        // Ignore close errors from already-closing dialog.
      }
    }
    dialog.remove();
  }
  document.querySelector(`.${EDIT_STATS_BACKDROP_CLASS}`)?.remove();
}

export function openEditStatsModal(input: {
  messageIndex: number;
  character: string;
  displayName?: string;
  data: TrackerData;
  settings: BetterSimTrackerSettings;
  onSave?: (payload: EditStatsPayload) => void;
}): void {
  ensureStyles();
  closeEditStatsModal();
  const isGlobalCharacter = input.character === GLOBAL_TRACKER_KEY;
  const rawDisplayName = String(input.displayName ?? "").trim();
  const displayName = isGlobalCharacter && (!rawDisplayName || rawDisplayName === GLOBAL_TRACKER_KEY)
    ? "Scene"
    : rawDisplayName;
  const characterLabel = String(
    displayName
      || (isGlobalCharacter ? "Scene" : (input.character === USER_TRACKER_KEY ? "User" : input.character)),
  ).trim() || (isGlobalCharacter ? "Scene" : (input.character === USER_TRACKER_KEY ? "User" : input.character));

  const isUserCharacter = input.character === USER_TRACKER_KEY;
  const customScopeById = new Map(
    (input.settings.customStats ?? []).map(def => {
      const trackCharacters = Boolean(def.trackCharacters ?? def.track);
      const trackUser = Boolean(def.trackUser ?? def.track);
      const globalScope = Boolean(def.globalScope);
      return [String(def.id ?? "").trim().toLowerCase(), {
        trackCharacters: globalScope ? true : trackCharacters,
        trackUser: globalScope ? true : trackUser,
        globalScope,
      }] as const;
    }),
  );
  const numericDefs = isGlobalCharacter
    ? []
    : getAllNumericStatDefinitions(input.settings).filter(def => {
      if (!def.track) return false;
      if (def.builtIn) return !isUserCharacter;
      const scope = customScopeById.get(String(def.id ?? "").trim().toLowerCase());
      if (!scope) return !isUserCharacter;
      return isUserCharacter ? scope.trackUser : scope.trackCharacters;
    });
  const builtInDefs = numericDefs.filter(def => def.builtIn);
  const customDefs = numericDefs.filter(def => !def.builtIn);
  const nonNumericDefs = getNonNumericStatDefinitions(input.settings).filter(def => {
    if (isGlobalCharacter) {
      if (!def.globalScope) return false;
      const visibility = input.settings.sceneCardStatDisplay?.[def.id]?.visible;
      return visibility !== false;
    }
    if (def.globalScope) return false;
    return isUserCharacter ? def.trackUser : def.trackCharacters;
  });
  const nonNumericDefById = new Map(nonNumericDefs.map(def => [def.id, def]));
  const currentMood = input.data.statistics.mood?.[input.character];
  const normalizedMood = currentMood ? normalizeMoodLabel(String(currentMood)) : null;
  const currentThought = input.data.statistics.lastThought?.[input.character];
  const isCurrentlyActive = !isUserCharacter
    && Array.isArray(input.data.activeCharacters)
    && input.data.activeCharacters.some(name => String(name ?? "").trim() === input.character);
  const ownerKeys = uniqueOwnerKeys(input.character, characterLabel);

  const numericField = (def: { id: string; label: string; defaultValue: number }): string => {
    const builtInId = String(def.id ?? "").trim().toLowerCase();
    const isBuiltIn = builtInId === "affection" || builtInId === "trust" || builtInId === "desire" || builtInId === "connection";
    const scope = customScopeById.get(builtInId);
    const raw = isBuiltIn
      ? Number(input.data.statistics[builtInId as "affection" | "trust" | "desire" | "connection"]?.[input.character])
      : resolveEditNumericRawValue(input.data, def.id, ownerKeys, Boolean(scope?.globalScope));
    const value = raw !== undefined && Number.isFinite(raw) ? String(Math.round(raw)) : "";
    const placeholder = String(Math.round(def.defaultValue ?? 50));
    return `
      <label class="bst-edit-field">
        <span>${escapeHtml(def.label)}</span>
        <input type="number" min="0" max="100" step="1" data-bst-edit-stat="${escapeHtml(def.id)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
      </label>
    `;
  };

  const nonNumericField = (def: ReturnType<typeof getNonNumericStatDefinitions>[number]): string => {
    const currentValue = resolveEditNonNumericRawValue(input.data, def.id, ownerKeys, def.globalScope);
    if (def.kind === "enum_single") {
      const selected = typeof currentValue === "string" ? currentValue : "";
      return `
        <label class="bst-edit-field">
          <span>${escapeHtml(def.label)}</span>
          <select data-bst-edit-non-numeric="${escapeHtml(def.id)}" data-bst-edit-kind="enum_single">
            <option value="">Clear value</option>
            ${def.enumOptions.map(option => {
              const safe = escapeHtml(option);
              const isSelected = selected === option ? "selected" : "";
              return `<option value="${safe}" ${isSelected}>${safe}</option>`;
            }).join("")}
          </select>
        </label>
      `;
    }
    if (def.kind === "boolean") {
      const selected = typeof currentValue === "boolean" ? currentValue : null;
      return `
        <label class="bst-edit-field">
          <span>${escapeHtml(def.label)}</span>
          <select data-bst-edit-non-numeric="${escapeHtml(def.id)}" data-bst-edit-kind="boolean">
            <option value="">Clear value</option>
            <option value="true" ${selected === true ? "selected" : ""}>${escapeHtml(def.booleanTrueLabel)}</option>
            <option value="false" ${selected === false ? "selected" : ""}>${escapeHtml(def.booleanFalseLabel)}</option>
          </select>
        </label>
      `;
    }
    if (def.kind === "array") {
      const items = Array.isArray(currentValue) ? currentValue : normalizeNonNumericArrayItems(currentValue, def.textMaxLength);
      const value = items.join("\n");
      const rows = (items.length ? items : [""]).slice(0, MAX_CUSTOM_ARRAY_ITEMS);
      const safeId = escapeHtml(def.id);
      return `
        <div class="bst-edit-field bst-array-default-editor" data-bst-edit-array-editor="${safeId}" data-bst-max-length="${def.textMaxLength}">
          <span>${escapeHtml(def.label)}</span>
          <div class="bst-array-default-list" data-bst-edit-array-list="${safeId}">
            ${rows.map(item => `
              <div class="bst-array-default-row">
                <input type="text" data-bst-edit-array-item="${safeId}" maxlength="${def.textMaxLength}" value="${escapeHtml(item)}" placeholder="Item value">
                <button type="button" class="bst-btn bst-btn-danger bst-icon-btn" data-action="edit-array-remove" aria-label="Remove item" title="Remove item"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
              </div>
            `).join("")}
          </div>
          <div class="bst-array-default-actions">
            <button type="button" class="bst-btn bst-btn-soft bst-icon-btn" data-action="edit-array-add" data-bst-edit-array-add="${safeId}" aria-label="Add item" title="Add item"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
            <span class="bst-editor-counter" data-bst-edit-array-counter="${safeId}">${items.length}/${MAX_CUSTOM_ARRAY_ITEMS} items</span>
          </div>
          <div class="bst-edit-array-status" data-bst-edit-array-status="${safeId}" style="display:none;"></div>
          <textarea rows="1" style="display:none" data-bst-edit-non-numeric="${safeId}" data-bst-edit-kind="array" placeholder="One item per line, up to ${MAX_CUSTOM_ARRAY_ITEMS} items.">${escapeHtml(value)}</textarea>
        </div>
      `;
    }
    if (def.kind === "date_time") {
      const value = typeof currentValue === "string" ? currentValue : "";
      const isStructuredDateTime = def.dateTimeMode === "structured";
      const inputValue = isStructuredDateTime ? value : toDateTimeInputValue(value);
      return `
        <label class="bst-edit-field">
          <span>${escapeHtml(def.label)}</span>
          <input type="${isStructuredDateTime ? "text" : "datetime-local"}" data-bst-edit-non-numeric="${escapeHtml(def.id)}" data-bst-edit-kind="${isStructuredDateTime ? "date_time_structured" : "date_time"}" value="${escapeHtml(inputValue)}" placeholder="YYYY-MM-DD HH:mm">
          ${isStructuredDateTime ? `<div class="bst-help-line">Structured mode accepts semantic updates, but saves normalized value as <code>YYYY-MM-DD HH:mm</code>.</div>` : ""}
        </label>
      `;
    }
    const value = typeof currentValue === "string" ? currentValue : "";
    return `
      <label class="bst-edit-field">
        <span>${escapeHtml(def.label)}</span>
        <input type="text" maxlength="${def.textMaxLength}" data-bst-edit-non-numeric="${escapeHtml(def.id)}" data-bst-edit-kind="text_short" value="${escapeHtml(value)}" placeholder="Optional. Max ${def.textMaxLength} chars.">
      </label>
    `;
  };

  const modal = document.createElement("div");
  modal.className = EDIT_STATS_MODAL_CLASS;
  const modalIntro = isGlobalCharacter
    ? "Scene/global stats only. Leave a field empty to clear that stat for this tracker entry. Edits apply to the latest scene tracker snapshot."
    : "Numeric values are percentages (0-100). Leave a field empty to clear that stat for this tracker entry. Edits apply to the latest tracker snapshot for this character.";
  modal.innerHTML = `
    <div class="bst-edit-head">
      <div class="bst-edit-title">Edit Tracker Stats - ${escapeHtml(characterLabel)}</div>
      <button class="bst-btn bst-close-btn" data-action="close" aria-label="Close edit dialog">&times;</button>
    </div>
    <div class="bst-edit-sub">${escapeHtml(modalIntro)}</div>
    ${(!isUserCharacter && !isGlobalCharacter)
      ? `<div class="bst-edit-divider"></div>
         <label class="bst-edit-field bst-check">
           <input type="checkbox" data-bst-edit-meta="active" ${isCurrentlyActive ? "checked" : ""}>
           <span>Active In This Snapshot</span>
         </label>`
      : ""}
    ${builtInDefs.length
      ? `<div class="bst-edit-grid bst-edit-grid-two">${builtInDefs.map(numericField).join("")}</div>`
      : (!isGlobalCharacter ? `<div class="bst-edit-sub">No built-in numeric stats are currently tracked.</div>` : "")}
    ${customDefs.length
      ? `<div class="bst-edit-divider"></div>
         <div class="bst-edit-grid bst-edit-grid-two">${customDefs.map(numericField).join("")}</div>`
      : ""}
    ${nonNumericDefs.length
      ? `<div class="bst-edit-divider"></div>
         <div class="bst-edit-grid bst-edit-grid-two">${nonNumericDefs.map(nonNumericField).join("")}</div>`
      : ""}
    ${!isGlobalCharacter && input.settings.trackMood
      ? `<div class="bst-edit-divider"></div>
         <label class="bst-edit-field">
           <span>Mood</span>
           <select data-bst-edit-text="mood">
             <option value="">Clear mood</option>
             ${MOOD_LABELS.map(label => {
               const safe = escapeHtml(label);
               const selected = normalizedMood === label ? "selected" : "";
               return `<option value="${safe}" ${selected}>${safe}</option>`;
             }).join("")}
           </select>
         </label>`
      : ""}
    ${!isGlobalCharacter && input.settings.trackLastThought
      ? `<div class="bst-edit-divider"></div>
         <label class="bst-edit-field">
           <span>Last Thought</span>
           <textarea rows="3" maxlength="${MAX_EDIT_LAST_THOUGHT_CHARS}" data-bst-edit-text="lastThought" placeholder="Optional. Keep it concise (max ${MAX_EDIT_LAST_THOUGHT_CHARS} chars).">${escapeHtml(String(currentThought ?? ""))}</textarea>
         </label>`
      : ""}
    <div class="bst-edit-actions">
      <button type="button" class="bst-btn bst-btn-soft" data-action="cancel">Cancel</button>
      <button type="button" class="bst-btn" data-action="save">Save</button>
    </div>
  `;

  const canUseDialog = typeof window.HTMLDialogElement !== "undefined"
    && typeof document.createElement("dialog").showModal === "function";

  if (canUseDialog) {
    const dialog = document.createElement("dialog");
    dialog.className = EDIT_STATS_DIALOG_CLASS;
    dialog.style.setProperty("position", "fixed", "important");
    dialog.style.setProperty("inset", "0", "important");
    dialog.style.setProperty("display", "grid", "important");
    dialog.style.setProperty("place-items", "center", "important");
    dialog.style.setProperty("margin", "0", "important");
    dialog.style.setProperty("width", "100vw", "important");
    dialog.style.setProperty("height", "100dvh", "important");
    dialog.style.setProperty("max-width", "100vw", "important");
    dialog.style.setProperty("max-height", "100dvh", "important");
    dialog.style.setProperty("padding", "12px", "important");
    dialog.style.setProperty("border", "0", "important");
    dialog.style.setProperty("background", "transparent", "important");
    dialog.style.setProperty("overflow", "auto", "important");
    dialog.style.setProperty("z-index", "2147483647", "important");

    dialog.addEventListener("click", event => {
      if (event.target === dialog) {
        closeEditStatsModal();
      }
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      closeEditStatsModal();
    });
    dialog.appendChild(modal);
    document.body.appendChild(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
  } else {
    const backdrop = document.createElement("div");
    backdrop.className = EDIT_STATS_BACKDROP_CLASS;
    backdrop.style.setProperty("position", "fixed", "important");
    backdrop.style.setProperty("inset", "0", "important");
    backdrop.style.setProperty("display", "grid", "important");
    backdrop.style.setProperty("place-items", "center", "important");
    backdrop.style.setProperty("padding", "12px", "important");
    backdrop.style.setProperty("background", "rgba(6, 10, 18, 0.72)", "important");
    backdrop.style.setProperty("z-index", "2147483647", "important");
    backdrop.style.setProperty("overflow", "auto", "important");
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) {
        closeEditStatsModal();
      }
    });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }
  bindTextareaCounters(modal);
  modal.querySelectorAll<HTMLElement>("[data-bst-edit-array-editor]").forEach(editor => {
    const id = String(editor.dataset.bstEditArrayEditor ?? "").trim().toLowerCase();
    if (!id) return;
    const maxLength = Math.max(20, Math.min(200, Math.round(Number(editor.dataset.bstMaxLength) || 120)));
    const listNode = editor.querySelector<HTMLElement>(`[data-bst-edit-array-list="${CSS.escape(id)}"]`);
    const counterNode = editor.querySelector<HTMLElement>(`[data-bst-edit-array-counter="${CSS.escape(id)}"]`);
    const statusNode = editor.querySelector<HTMLElement>(`[data-bst-edit-array-status="${CSS.escape(id)}"]`);
    const addBtn = editor.querySelector<HTMLButtonElement>(`[data-bst-edit-array-add="${CSS.escape(id)}"]`);
    const hiddenNode = editor.querySelector<HTMLTextAreaElement>(`textarea[data-bst-edit-non-numeric="${CSS.escape(id)}"][data-bst-edit-kind="array"]`);
    if (!listNode || !counterNode || !addBtn || !hiddenNode) return;

    const getItemInputs = (): HTMLInputElement[] =>
      Array.from(listNode.querySelectorAll<HTMLInputElement>(`input[data-bst-edit-array-item="${CSS.escape(id)}"]`));

    const rowHtml = (value: string): string => `
      <div class="bst-array-default-row">
        <input type="text" data-bst-edit-array-item="${escapeHtml(id)}" maxlength="${maxLength}" value="${escapeHtml(value)}" placeholder="Item value">
        <button type="button" class="bst-btn bst-btn-danger bst-icon-btn" data-action="edit-array-remove" aria-label="Remove item" title="Remove item"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
      </div>
    `;

    const syncEditor = (): string[] => {
      const values = getItemInputs().map(inputNode => inputNode.value);
      const normalized = normalizeNonNumericArrayItems(values, maxLength);
      const rawTrimmed = values.map(value => String(value ?? "").trim());
      const rawNonEmpty = rawTrimmed.filter(value => value.length > 0);
      const uniqueRawNonEmpty = new Set(rawNonEmpty).size;
      const hadTooLong = rawNonEmpty.some(value => value.length > maxLength);
      const hitLimit = rawNonEmpty.length > MAX_CUSTOM_ARRAY_ITEMS;
      hiddenNode.value = normalized.join("\n");
      counterNode.textContent = `${normalized.length}/${MAX_CUSTOM_ARRAY_ITEMS} items`;
      const warnThreshold = Math.max(1, Math.floor(MAX_CUSTOM_ARRAY_ITEMS * 0.8));
      counterNode.setAttribute("data-state", normalized.length >= MAX_CUSTOM_ARRAY_ITEMS ? "limit" : normalized.length >= warnThreshold ? "warn" : "ok");
      addBtn.disabled = getItemInputs().length >= MAX_CUSTOM_ARRAY_ITEMS;
      if (statusNode) {
        const messages: string[] = [];
        if (hadTooLong) messages.push(`Items longer than ${maxLength} chars were trimmed.`);
        if (uniqueRawNonEmpty > normalized.length) messages.push("Duplicate/empty items were normalized.");
        if (hitLimit) messages.push(`Only first ${MAX_CUSTOM_ARRAY_ITEMS} items are kept.`);
        statusNode.textContent = messages.join(" ");
        statusNode.style.display = messages.length ? "block" : "none";
      }
      return normalized;
    };

    const ensureRow = (): void => {
      if (getItemInputs().length > 0) return;
      listNode.insertAdjacentHTML("beforeend", rowHtml(""));
    };

    addBtn.addEventListener("click", () => {
      if (getItemInputs().length >= MAX_CUSTOM_ARRAY_ITEMS) return;
      listNode.insertAdjacentHTML("beforeend", rowHtml(""));
      syncEditor();
    });

    listNode.addEventListener("click", event => {
      const target = event.target as HTMLElement | null;
      const removeBtn = target?.closest<HTMLButtonElement>('[data-action="edit-array-remove"]');
      if (!removeBtn) return;
      const row = removeBtn.closest(".bst-array-default-row");
      if (!row) return;
      const inputs = getItemInputs();
      if (inputs.length <= 1) {
        const onlyInput = inputs[0];
        if (onlyInput) onlyInput.value = "";
      } else {
        row.remove();
      }
      ensureRow();
      syncEditor();
      hiddenNode.dispatchEvent(new Event("change"));
    });

    listNode.addEventListener("input", event => {
      const target = event.target as HTMLInputElement | null;
      if (!target?.matches(`input[data-bst-edit-array-item="${CSS.escape(id)}"]`)) return;
      syncEditor();
    });

    listNode.addEventListener("change", event => {
      const target = event.target as HTMLInputElement | null;
      if (!target?.matches(`input[data-bst-edit-array-item="${CSS.escape(id)}"]`)) return;
      syncEditor();
      hiddenNode.dispatchEvent(new Event("change"));
    });

    ensureRow();
    syncEditor();
  });
  modal.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(node => {
    node.addEventListener("blur", () => {
      clampNumberInputToBounds(node);
    });
    node.addEventListener("change", () => {
      clampNumberInputToBounds(node);
    });
  });

  const close = () => closeEditStatsModal();
  modal.querySelector('[data-action="close"]')?.addEventListener("click", close);
  modal.querySelector('[data-action="cancel"]')?.addEventListener("click", close);

  modal.querySelector('[data-action="save"]')?.addEventListener("click", () => {
    modal.querySelectorAll<HTMLElement>("[data-bst-edit-array-editor]").forEach(editor => {
      const id = String(editor.dataset.bstEditArrayEditor ?? "").trim().toLowerCase();
      if (!id) return;
      const maxLength = Math.max(20, Math.min(200, Math.round(Number(editor.dataset.bstMaxLength) || 120)));
      const values = Array.from(editor.querySelectorAll<HTMLInputElement>(`input[data-bst-edit-array-item="${CSS.escape(id)}"]`))
        .map(inputNode => inputNode.value);
      const normalized = normalizeNonNumericArrayItems(values, maxLength);
      const hiddenNode = editor.querySelector<HTMLTextAreaElement>(`textarea[data-bst-edit-non-numeric="${CSS.escape(id)}"][data-bst-edit-kind="array"]`);
      if (hiddenNode) hiddenNode.value = normalized.join("\n");
    });

    const numeric: Record<string, number | null> = {};
    modal.querySelectorAll<HTMLInputElement>("[data-bst-edit-stat]").forEach(node => {
      const key = String(node.dataset.bstEditStat ?? "").trim().toLowerCase();
      if (!key) return;
      const raw = node.value.trim();
      if (!raw) {
        numeric[key] = null;
        return;
      }
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        numeric[key] = null;
        node.value = "";
        return;
      }
      const clamped = Math.max(0, Math.min(100, Math.round(parsed)));
      node.value = String(clamped);
      numeric[key] = clamped;
    });

    const nonNumeric: Record<string, string | boolean | string[] | null> = {};
    modal.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-bst-edit-non-numeric]").forEach(node => {
      const key = String(node.dataset.bstEditNonNumeric ?? "").trim().toLowerCase();
      if (!key) return;
      const def = nonNumericDefById.get(key);
      if (!def) return;
      const kind = String(node.dataset.bstEditKind ?? def.kind);
      const raw = String(node.value ?? "").trim();
      if (!raw) {
        nonNumeric[key] = null;
        return;
      }
      if (kind === "boolean") {
        nonNumeric[key] = raw.toLowerCase() === "true";
        return;
      }
      if (kind === "enum_single") {
        const matched = resolveEnumOption(def.enumOptions, raw);
        nonNumeric[key] = matched ?? null;
        if (nonNumeric[key] == null) {
          node.value = "";
        }
        return;
      }
      if (kind === "array") {
        const items = normalizeNonNumericArrayItems(String(node.value ?? ""), def.textMaxLength);
        nonNumeric[key] = items.length ? items : null;
        node.value = items.join("\n");
        return;
      }
      if (kind === "date_time" || kind === "date_time_structured") {
        const normalized = normalizeDateTimeValue(node.value);
        nonNumeric[key] = normalized || null;
        node.value = kind === "date_time_structured" ? (normalized || "") : toDateTimeInputValue(normalized);
        return;
      }
      const text = normalizeNonNumericTextValue(raw, def.textMaxLength);
      nonNumeric[key] = text || null;
      node.value = text;
    });

    let moodValue: string | null | undefined = undefined;
    const moodSelect = modal.querySelector<HTMLSelectElement>('[data-bst-edit-text="mood"]');
    if (moodSelect) {
      const raw = String(moodSelect.value ?? "").trim();
      moodValue = raw ? raw : null;
    }

    let activeValue: boolean | undefined = undefined;
    const activeToggle = modal.querySelector<HTMLInputElement>('[data-bst-edit-meta="active"]');
    if (activeToggle) {
      activeValue = Boolean(activeToggle.checked);
    }

    let lastThoughtValue: string | null | undefined = undefined;
    const thoughtInput = modal.querySelector<HTMLTextAreaElement>('[data-bst-edit-text="lastThought"]');
    if (thoughtInput) {
      const text = thoughtInput.value.trim();
      lastThoughtValue = text ? text.slice(0, MAX_EDIT_LAST_THOUGHT_CHARS) : null;
    }

    input.onSave?.({
      messageIndex: input.messageIndex,
      character: input.character,
      numeric,
      nonNumeric,
      active: activeValue,
      mood: moodValue,
      lastThought: lastThoughtValue,
    });
    closeEditStatsModal();
  });
}

export const __testables = {
  resolveEditNumericRawValue,
  resolveEditNonNumericRawValue,
  uniqueOwnerKeys,
};

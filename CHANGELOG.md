# Changelog

All notable changes to BetterSimTracker are documented here.

## [2.2.4.6-dev3] - 2026-03-09
### Fixed
- Fixed character stat macros for unique owners by exposing a backward-safe name-slug alias alongside avatar-first runtime slugs, so prompts using `{{bst_stat_char_<id>_<character_name_slug>}}` continue to resolve when the owner has an avatar-based macro identity.
- Added regression coverage to ensure duplicate-name characters stay collision-safe while unique characters still expose a stable name-based alias.

## [2.2.4.6-dev2] - 2026-03-09
### Fixed
- Fixed BST stat macros to register into both SillyTavern macro paths (legacy + new macro engine), so `{{bst_stat_*}}` and `{{bst_injection}}` resolve in prompt-manager/chat-completion prompts even when `Inject Tracker Into Prompt` is off.
- Added regression coverage for ST contexts where `registerMacro` exists but prompt resolution uses the new macro engine registry.

## [2.2.4.6-dev1] - 2026-03-09
### Fixed
- Fixed BST stat macros (`{{bst_stat_user_<id>}}`, `{{bst_stat_scene_<id>}}`, `{{bst_stat_char_<id>_<character_slug>}}`) so they resolve against fresh tracker data even when prompt injection is off.
- Fixed macro registration flow to avoid “stuck blank” stat macros when initial sync happened before tracker data existed.
- Fixed array-stat clear regression in manual tracker edit flow:
  - deleting the last array item now persists as an explicit empty array (`[]`) instead of reviving stale previous values from fallback history.
- Fixed storage normalization to preserve explicit empty array values for custom non-numeric stats.
- Fixed owner filtering path to keep empty-array clear sentinels, preventing old array values from reappearing on cards/injection.

## [2.2.4.5] - 2026-03-07
### Changed
- Injection state payload is now standardized under one canonical block: `BST_TRACKER_STATE`.
- Injection diagnostics were expanded with explicit owner/selection metadata to make real injected state easier to verify from debug dumps.

### Fixed
- Fixed 1:1 injection owner targeting so active character stats are not dropped when user aliases are present in candidate order.
- Fixed duplicate/reserved owner leakage in injection (including system owners), ensuring only valid tracked owners are emitted.
- Improved non-numeric injection serialization stability (word-safe truncation) to avoid malformed partial values in prompt state.
- Edit Tracker modal prefill now uses the same effective fallback resolution as card rendering, eliminating card/modal value mismatches.

## [2.2.4.4] - 2026-03-07
### Changed
- Moved `BST_*` wrappers to runtime macro payload assembly in prompt injection, so custom injection templates cannot remove tagged BST sections.
- Applied the same runtime-wrapped `BST_*` block pattern across extraction prompt builders (unified + sequential + custom stats).
- Simplified default injection template to plain placeholders, with tags now provided by wrapped macro values at render time.

### Fixed
- Custom injection templates now keep tagged BST semantics/rules/state blocks instead of losing them when users override the template layout.
- Sequential custom numeric extraction prompts now use the same tagged structure as other extraction modes.
- In 1:1 chats, duplicate-name character card context is now scoped to the current `characterId` avatar, preventing unrelated same-name cards from being injected.

## [2.2.4.3] - 2026-03-07
### Changed
- Character stat macros now use collision-safe slugs (avatar-first with deterministic suffixes) so duplicate character names no longer overwrite each other.
- Custom stat macro examples in Settings now mirror collision-safe character slug generation.

### Fixed
- Fixed BST character macro registration collisions when multiple characters shared the same name.

## [2.2.4.2] - 2026-03-07
### Added
- New extraction toggle: `Auto-Generate Tracker`.
  - When disabled, BST runs in manual-only mode (no automatic extraction on AI/user events).

### Changed
- Extraction settings UI now hides `Regenerate Tracker After Message Edit` and `Generate Tracker on Greetings` when auto-generation is disabled.
- Character-card extraction context now resolves duplicate-name characters by avatar identity to avoid same-name overwrite collisions.
- Settings preview candidate resolution is now avatar-aware, so same-name characters are no longer collapsed into one candidate.

### Fixed
- Auto event hooks now skip extraction scheduling when auto-generation is disabled while keeping manual refresh/retry fully available.
- Fixed character card prompt context generation for chats where more than one character shares the same name.
- When `Auto-Generate Tracker` is disabled and a message has no tracker snapshot yet, BST now renders a visible manual placeholder with `Generate Tracker` so manual mode always has an in-chat entry point.

## [2.2.4] - 2026-03-07
### Added
- Per-owner tracker controls in defaults:
  - `Enable tracker for this character`
  - `Enable tracker for this persona`
- Per-owner per-stat enable toggles in Character/Persona defaults (built-ins + owner-trackable custom stats).
- New global display toggle: `Collapse Cards By Default`.
- Dedicated collapse/expand control for Scene cards.
- Persona defaults now support ST expression image framing overrides (matching character defaults).

### Changed
- Increased custom stat limits for better real-world setups:
  - enum options cap: `12 -> 30`
  - array item cap: `20 -> 30`
  - `Injection Prompt Max Chars` max: `30000 -> 100000`
- Prompt injection now emits global custom stats as dedicated `Scene` lines from global scope.
- Owner-level stat toggles are now enforced consistently in extraction, card rendering, and injection.
- Scene card array-collapse controls/labels now use shared runtime limits across settings and per-stat display options.

### Fixed
- Fixed character baseline selection and history seeding so user-only snapshots do not corrupt character extraction context.
- Fixed global custom stat baseline handling so latest global values are preserved during character extraction.
- Fixed prompt injection regression where global custom stats could be omitted even when enabled for injection.
- Fixed late-load `enabled` toggle hydration edge case that could incorrectly flip BST off.
- Fixed array cap mismatches in edit/default modals and settings parsing (removed stale hardcoded `20` paths).
## [2.2.3.10] - 2026-03-06
### Fixed
- `{{bst_injection}}` and BST stat macros now build from a merged tracker-state baseline instead of a single latest message snapshot, preventing user, scene/global, and cross-turn character stat values from disappearing when the newest snapshot is partial.

## [2.2.3.9] - 2026-03-06
### Added
- Added dedicated built-in `Behavior Instruction` textareas for affection, trust, desire, and connection directly inside the existing built-in prompt sections.

### Changed
- Built-in hidden injection behavior now prefers those per-stat behavior instructions when present, while keeping BST fallback react rules when the fields are empty.
- Continued internal step-2 modularization by extracting settings and mood-preview modal logic into dedicated modules without changing tracker behavior.

### Fixed
- Built-in prompt sections no longer show misleading idle AI status text, and status feedback is now positioned correctly below the behavior field.
- `{{bst_injection}}` now remains available for manual macro use even when `Inject Tracker Into Prompt` is disabled; the toggle now controls only automatic BST injection.
- Thought expand buttons now appear only when the thought is actually likely truncated, preventing no-op `More thought` toggles on fully visible text.

## [2.2.3.7] - 2026-03-06
### Added
- Global injection macro hint added near injection toggle: `{{bst_injection}}`.
- New ST macro support for stat values with explicit scopes:
  - `{{bst_stat_user_<id>}}`
  - `{{bst_stat_scene_<id>}}`
  - `{{bst_stat_char_<id>_<character_slug>}}`

### Changed
- Macro hints in Custom Stats are now dynamic and scope-aware (only valid scopes are shown per stat).
- Character-targeted macro examples are generated from characters that exist in the current chat context.
- Removed ambiguous auto/generic stat macro variants to avoid multi-character ambiguity.
- Extraction progress labels are explicit and mode-aware (Built-in, Custom, Custom Group, Unified Batch), including clearer no-extraction/default seeding steps.

### Fixed
- Manual retrack/manual refresh now uses the currently edited tracker snapshot on that message as baseline, preventing immediate value reversion after edits.
- Hardened `array` custom-stat handling for weaker models:
  - broader array value normalization (JSON array strings, bullet/numbered lines, comma/newline lists),
  - explicit empty markers now parse as an intentional empty array,
  - conservative apply guard prevents low-confidence destructive array drops from wiping prior values.

## [2.2.3] - 2026-03-04
### Added
- New custom stat type: `date_time` with two modes:
  - `timestamp` (canonical datetime value)
  - `structured` (semantic updates normalized to canonical datetime)
- Structured Date/Time display controls:
  - part visibility (`weekday/date/time/phase`)
  - part labels
  - part order
  - date format presets
- New extraction toggle: `Regenerate Tracker After Message Edit`.
  - When enabled (default), editing an already tracked message re-runs extraction for that message.
  - When disabled, edit events no longer auto-regenerate tracker values.
- Custom Stats now include a quick `Enable/Disable` toggle directly in the list for fast on/off control per stat.
- New Display subdrawer: `Character Card Stat Order` (under Scene Card) for manual ordering of character-card stat rows.
- Scene card edit action (pencil) for latest tracked snapshots.
- New toggle: `Generate Tracker on Greetings`.

### Changed
- Character-card rendering now applies configurable stat order for non-user cards across built-in numeric + custom non-global non-numeric stats, with backward-compatible fallback to previous order when no custom order is defined.
- Date/time phase mapping refined to subphases (`Midnight` through `Late Evening`) and part-order UI moved to explicit controls.
- Date/time mode handling improved across wizard/edit paths (`timestamp` and `structured`) with mode-aware prompt/extraction behavior.

### Fixed
- Message-edit regeneration control is now explicit instead of always-on behavior.
- Tracker auto-extraction now skips SillyTavern welcome-page assistant messages.
- Scene card edit modal title/scope fixed to Scene-only global fields.
- Disabled custom stats are now fully authoritative (`track=false`) in extraction/rendering.
- Import conflict flow hardened with modal conflict handling and non-destructive update/skip behavior.

## [2.2.2.1] - 2026-03-03
### Fixed
- Unified first-run custom stat extraction now evaluates model output immediately instead of seed-only defaults, so initial tracker cards no longer stay at `not set` / empty array when the model returned valid custom values.

## [2.2.2] - 2026-03-01
### Added
- Configurable Scene Card system for global custom stats with dedicated settings drawer and `Scene Stat Studio` manager.
- Per-stat Scene display controls: visibility, label/color override, layout override, value style, hide-when-empty behavior, per-stat text clamp, and array collapse limit.
- Manual Scene stat ordering with explicit persisted order and per-stat move controls.
- Custom stats JSON workflows: styled import modal, per-stat export, and format-compatible import support.
- Debug dump metadata now includes extension version and custom stat scope-resolution diagnostics.

### Changed
- Scene Card position now supports two modes only: `Above tracker cards` and `Above message text`.
- Scene Card now exclusively owns rendering of global custom stats when enabled (no duplicate owner-card rendering).
- Scene settings and naming were modernized (`Scene Stat Studio`) and documented across README/docs.
- Extension drawer header now displays dynamic build version with compact visual style.
- Import flow remains merge-based and non-destructive (update/add by stat id), with clearer in-UI status feedback.

### Fixed
- Global custom stat scope handling across extraction, retrack, rendering, and manual edit paths now consistently uses the shared global owner key.
- Sequential non-numeric baseline resolution now respects each stat's global scope, preventing stale per-character carry-over.
- JSON import safety and normalization hardened (kind-aware defaults, safe id handling, bounded values).

## [2.2.1.3] - 2026-02-28
### Changed
- Custom-stat per-stat prompt field is now canonically named `promptOverride` across UI/config semantics.

### Fixed
- Backward compatibility retained: legacy `sequentialPromptTemplate` is still accepted on import/read, but normalized to `promptOverride` to avoid mode-naming confusion when sharing JSON configs.

## [2.2.1.2] - 2026-02-28
### Fixed
- Unified custom `array` parsing now accepts JSON array values returned under `value.<statId>`, so item removals/updates (for example clothing changes) apply correctly instead of being dropped.

## [2.2.1.1] - 2026-02-28
### Changed
- Persona panel section label renamed from `User Defaults (Persona Scoped)` to `Persona Defaults`.

### Fixed
- Persona `Mood Default` now uses a constrained dropdown (allowed mood labels + `Use stat default`) instead of free-text input.

## [2.2.1] - 2026-02-28
### Added
- New custom stat kind: `array` (max 20 items) implemented end-to-end, including extraction, defaults, parser/storage normalization, prompt/protocol coverage, injection support, and tracker editing.
- Owner-scoped privacy controls for stats: `LastThought` and custom stats can be marked `Private (owner-scoped)` to limit cross-character leakage.
- Tracker recovery cards now include exact error reason details and direct `Retry Tracker` / `Generate Tracker` actions.
- Persona Management now includes persona-scoped user defaults (mood, lastThought, and user-trackable custom stat defaults).
- Settable `Last Thought` defaults for Character Defaults and Persona User Defaults.

### Changed
- Array/enum editors were upgraded to structured add/remove row UX with compact icon actions and live counters across wizard/defaults/edit flows.
- Mobile and modal UX polish for tracker editing and default editors (checkbox alignment, spacing, row stability, action-button alignment).
- Persona panel heading/description were renamed to reflect full persona-scoped defaults management (not mood-only).
- Input bounds enforcement was standardized across settings/wizard/edit controls.
- Unified/sequential prompt contracts for arrays now emphasize item-level maintenance (add/remove/edit) instead of full-list rewrites.

### Fixed
- Persona/user defaults isolation was hardened to prevent collisions with character-scoped defaults (including same-name persona/character cases).
- User tracker default seeding/application now resolves persona scope consistently, including custom non-numeric defaults.
- Persona Defaults panel no longer re-renders while text selection is active inside the panel, fixing text-selection interruptions during editing.
- Connection profile alias normalization now avoids stale pseudo-profile IDs when using active/current/default-style selectors.
- Recovery placeholders now persist across reloads and restore correctly from chat metadata.
- Nested provider/API error extraction was improved so UI diagnostics match real backend error messages.

## [2.2.0.7] - 2026-02-27
### Changed
- Unified extraction now submits built-in and custom stats together in a single request.
- Disambiguation guidance is now toggle-aware: character-card and lorebook guidance is only injected when those sources are enabled.

### Fixed
- Unified parse acceptance now validates requested built-in and custom stat coverage before accepting output, reducing partial responses.
- Unified `text_short` custom stats now reject obvious placeholder echoes when a concrete prior value exists.
- Custom Stats list rows now wrap long description text within the content column so action buttons remain unobstructed.

## [2.2.0.5] - 2026-02-27
### Added
- Persona Management integration for BetterSimTracker user mood images, including per-persona mood-source override and per-mood upload/clear controls.
- Character tracker edit modal now includes an `Active In This Snapshot` toggle for manual active/inactive correction per message snapshot.

### Changed
- New-chat greeting bootstrap now seeds tracker values from configured defaults when no user message exists yet, instead of deriving first values from greeting text.
- User tracker identity resolution now follows current persona/avatar mapping, so user defaults and persona mood assets apply consistently.

### Fixed
- Mobile/late-render extraction race handling now retries safely after generation and on manual-refresh empty responses, reducing missing first tracker cards.
- Latest-card edit availability is now independent for latest AI and latest User tracker entries.
- Edit modal layering and mobile layout were hardened so the dialog stays above SillyTavern UI and remains usable in portrait mode.
- Persona Management mood panel mount reliability was improved so the BST persona block renders consistently.
- Cross-chat scope fallback and user ST-expression name/avatar resolution were stabilized to reduce stale carry-over and missing user expressions.

## [2.2.0] - 2026-02-26
### Added
- User-side tracker extraction and display support, including user-focused custom stat tracking and injection scoping.
- Lorebook support for extraction, including pre-scan fallback handling for user-side runs.

### Changed
- Extraction/injection configuration flow and prompt protocol controls were expanded and reorganized for clearer advanced setup.
- Advanced protocol prompt templates can now be unlocked and edited directly in settings (with reset support).
- Prompt user labeling now uses a display alias in extraction prompts while preserving internal key mapping in parser application.

### Fixed
- New-chat and retrack baseline seeding now consistently uses prior relevant snapshots, preventing false resets to defaults.
- Group replay/user-turn handling was hardened to prevent ghost blank user turns and invalid forced-target paths.
- Activity/inactive-card rendering and delta baselines now remain stable across user-only turns, swipes, reloads, and mixed-character histories.

## [2.1.0.3] - 2026-02-26
### Changed
- Custom stat Description limit increased from `200` to `300` characters.
- Custom stat wizard now shows a live Description counter (`x/300`), including near-limit and limit states.
- Enum custom stats now preserve user-entered option strings/defaults (no forced token conversion).

### Fixed
- Enum default validation now resolves values consistently against allowed options (including symbols/emoji labels).
- Enum option/default handling now blocks script-like payloads (e.g. `<script>`, `javascript:`) across wizard validation, settings sanitization, parsing, and runtime seeding.

## [2.1.0.2] - 2026-02-25
### Fixed
- Non-numeric custom stat chips (including `text_short`) no longer truncate long values on mobile; values now wrap cleanly instead of clipping with ellipsis.

## [2.1.0.1] - 2026-02-25
### Changed
- Renamed custom prompt UI labels for clarity:
  - `Sequential Prompt Override` -> `Per-Stat Prompt Override`
  - `Seq: Custom Numeric` -> `Custom Numeric Default`
  - `Seq: Custom Non-Numeric` -> `Custom Non-Numeric Default`
- Prompt captions, placeholders, and tooltips now explicitly state that custom per-stat prompt templates are used in all extraction modes.

### Fixed
- Removed confusion where users could assume custom prompt overrides only apply in sequential mode.

## [2.1.0] - 2026-02-25
### Added
- Non-numeric custom stat support with new kinds: `enum_single`, `boolean`, and `text_short`.
- Kind-aware custom stat wizard fields and validation for enum options, boolean labels, and short-text limits.
- Kind-aware character defaults support for non-numeric custom stats.
- Kind-aware latest-tracker manual edit controls for non-numeric custom stat values.
- New sequential prompt template fallback for non-numeric custom stats (`Seq: Custom Non-Numeric`).

### Changed
- Tracker cards now render non-numeric custom stats as compact value chips.
- Custom stat settings UI now treats custom stats as mixed-type definitions instead of numeric-only.
- Prompt generation and extraction contracts now include non-numeric schema guidance and macros.
- AI guidance generation now separates intent by field: `Sequential Prompt Override` is extraction-focused, while `Behavior Instruction` is reaction-focused for prompt injection.

### Fixed
- Prompt injection now still renders when only non-numeric custom stats are enabled.
- Non-numeric seeded defaults are now normalized by stat kind to prevent invalid enum/boolean/text carry-over values.
- `Generate with AI` for behavior guidance no longer produces extraction-style update cues.

## [2.0.7.3] - 2026-02-25
### Changed
- Auto card color assignment no longer rebalances previously assigned characters when new characters appear in chat.
- Auto color now assigns distinct colors incrementally for new characters while keeping already assigned auto colors stable.

## [2.0.7.2] - 2026-02-24
### Fixed
- Auto card colors now resolve to stable hex values for broad browser compatibility, so different characters no longer collapse to the same fallback card color.

## [2.0.7.1] - 2026-02-24
### Fixed
- Extraction now falls back to the active SillyTavern runtime API when no valid Connection Manager profile ID can be resolved, preventing `Profile not found (ID: default)` failures.
- Profile-less setups (fresh install, no Connection Manager profiles, or "Use active connection" mode) now continue extracting stats instead of stalling at "Requesting stats".

## [2.0.7] - 2026-02-24
### Changed
- Tracker card action buttons now use dynamic colors tuned for contrast against each card, with more transparency.

### Fixed
- Extraction now falls back safely when no active connection profile is selected, instead of hard-failing tracker updates.
- Active connection profile detection now covers more SillyTavern/runtime fields and local connection-manager state, improving fresh-install and single-profile reliability.
- Diagnostics now report the same resolved connection profile id used by runtime extraction.

## [2.0.6] - 2026-02-24
### Added
- Per-character card color override in Advanced Character Defaults.
- Edit the latest tracker stats inline (pencil icon; numeric clamp, mood picker, last thought editor).

## [2.0.5] - 2026-02-23
### Added
- New AI-powered `Summarize` action that generates prose summary notes from the current tracked state.
- New summary controls: `Summarization Note Visible for AI` and `Inject Summarization Note`.
- Custom stat wizard now includes an optional `Behavior Instruction` step with `Generate with AI`.

### Changed
- Summary generation is now prose-first and more robust: normalization pass, longer target output (`4-6` sentences), and tracked-dimension-aware prompting.
- Custom stat AI helpers were improved for clearer, stat-specific generation (description + sequential/behavior guidance).
- Injection templates now support `{{summarizationNote}}` for optional summary context.

### Fixed
- Swipe/edit stability improvements: prevented unwanted retracks, fixed stale `Generating AI response` UI state, and made tracker lookup swipe-specific.
- Summary note safety hardening: safe message payload handling, exclusion from tracker extraction targets, non-swipeable note metadata, and no retroactive chat mutation.
- Custom stat color picker persistence now works reliably on first create across browsers.
And more...

## [2.0.1] - 2026-02-23
### Added
- AI-assisted prompt authoring for custom stats:
  - `Improve description by AI` in wizard step 1
  - `Generate with AI` for stat-specific `Sequential Prompt Override`
- AI generation for built-in sequential prompt instructions:
  - `Seq: Affection`, `Seq: Trust`, `Seq: Desire`, `Seq: Connection`, `Seq: Mood`, `Seq: LastThought`

### Changed
- Custom sequential override generation is now stricter, stat-focused, and tailored to literal stat identity (`ID`/`Label`) instead of universal placeholder-style output.
- Built-in sequential prompt generation now uses stat-specific generation prompts and applies output sanitization before filling prompt fields.
- Dev-run versioning is aligned to semver-safe `2.0.0-dev.x`.

### Fixed
- Generated override text now strips hidden reasoning blocks (`<think>...</think>`) and keeps clean instruction output.
- Custom stat override UX clarity improved by removing macro-hint noise in per-stat context and correcting the placeholder.
- Custom wizard AI button spacing/hover behavior is stabilized (no jump on hover).
And more...

## [2.0.0] - 2026-02-22
### Added
- Full custom numeric stats support: definition schema, add/edit/clone/remove wizards, extraction/runtime processing, persistence (`customStatistics`), tracker cards, graphs, and prompt injection.
- Built-in stats manager wizard with per-stat controls and unified `Enabled` behavior (`Track + Card + Graph`) plus injection control for numeric built-ins.
- Global sequential custom-numeric prompt template fallback (`Seq: Custom Numeric`) with per-stat override support.

### Changed
- Settings UX was refined for custom stats and built-ins, including centered built-in management entry point and wizard polish.
- Baseline/default seeding and historical fallback now include custom stats (global + per-character defaults) for consistent first-run behavior.
- Prompt injection now respects built-in toggles and safely trims custom-stat lines first when the injected block grows too large.

### Fixed
- First-run custom stat flows now avoid unnecessary extraction requests and misleading delta spikes when prior values are missing.
- Custom stat template fallback behavior is now consistent when fields are cleared and settings are reopened.
- Cross-browser UI reliability improvements for settings/wizard controls and debug visibility for custom stat data paths.
And more...

## [1.2.3] - 2026-02-22
### Added
- Configurable `Injection Depth` setting for prompt injection in extension settings.

### Changed
- `Injection Depth` now uses a constrained selector with practical values (`0..8`) and matching runtime clamping.

### Fixed
- Extraction now falls back to SillyTavern's active connection profile when BetterSimTracker `Connection Profile` is empty.
- Diagnostics `resolvedProfileId` now reflects the active-profile fallback when no explicit BetterSimTracker profile is selected.

## [1.2.2] - 2026-02-22
### Added
- Full-size mood image preview modal from tracker cards with caption metadata and close controls.
- Expandable last-thought text in tracker cards and mood bubbles.

### Changed
- ST expression framing and mood-source workflows were expanded in global settings and character defaults, including interactive framing preview updates.
- Extension settings UI was refreshed with collapsible sections, sticky header/footer actions, global expand/collapse, modernized controls, and round accent-matched checkboxes.
- Tracker cards were polished with active-first ordering, colored stat bars, and tighter mobile density.

### Fixed
- Mood preview modal now reliably appears above mobile ST UI layers (top-layer dialog path with safe-area/touch/reduced-motion handling).
- ST expression framing now applies consistently in tracker cards with immediate save behavior and full-range positioning.
- Character defaults now resolve consistently across group/single Advanced Definitions and correctly seed first-time active characters.
- Extraction stop now cancels reliably in one click, and tracker rendering skips unchanged payloads to reduce churn.
And more...

## [1.2.0] - 2026-02-21
### Added
- ST expressions mood workflow with global/per-character mood-to-expression mapping and character-level mood-source controls.
- Interactive ST expression framing tools in both global settings and character defaults, including preview modal support.
### Changed
- ST expression framing and preview flow were rebuilt for live, immediate updates while adjusting controls.
- Settings modal section drawers now default to collapsed for faster navigation in large settings screens.
- Mood image handling now supports partial sets with emoji fallback when a mood image is unavailable.
### Fixed
- Tracker cards now apply framer zoom/position changes reliably, including existing rendered cards.
- ST expression mood-source selection is blocked for characters with no expression sprites.
- Mood mapping resolution is now case-insensitive for legacy/custom keys.
- Post-generation extraction stability improved (delayed kickoff, safer first-run request behavior, and transport-failure handling).
And more...

## [1.1.1] - 2026-02-21
### Fixed
- Mood labels now fall back to Neutral when the model returns a label outside the allowed list.
- Swipes now wait for the new message render before extraction starts.
- Swipe now shows the waiting state immediately.
and more...

## [1.1.0.1] - 2026-02-20
### Fixed
- Custom prompt templates now persist when edited.

## [1.1.0] - 2026-02-20
### Added
- Per-character defaults panel in Advanced Character Definitions, including mood image sets with full upload/delete support.
- Granular debug toggles (Extraction, Prompts, UI, Mood Images, Storage) to reduce console noise.
### Changed
- Mood display now supports image + thought bubble presentation when a full mood image set is present.
- Tracker UI and settings modal styling refined for consistency and mobile responsiveness.
### Fixed
- Mood image upload pipeline (field names, sprite matching, path resolution) and deletion reliability.
- Character defaults panel no longer re-renders while editing/selecting.
- Debug/diagnostics toggles visibility, spacing, and persistence.
and more...

## [1.0.9.11] - 2026-02-20
### Changed
- Clearing mood images now deletes the sprite files on disk via ST's delete endpoint.
and more...

## [1.0.9.10] - 2026-02-20
### Fixed
- Mood image uploads now detect the newly added sprite even when labels differ.
and more...

## [1.0.9.9] - 2026-02-20
### Fixed
- Character defaults panel no longer re-renders while selecting text inside the panel.
and more...

## [1.0.9.8] - 2026-02-20
### Fixed
- Character defaults panel no longer re-renders while editing, preventing text selection loss.
and more...

## [1.0.9.7] - 2026-02-20
### Fixed
- Sprite uploads now resolve the uploaded path via the sprites list endpoint.
- Upload button now opens the file picker reliably on first click.
and more...

## [1.0.9.6] - 2026-02-20
### Fixed
- Sprite uploads now use the correct ST multer field name.
- Upload buttons no longer require double click in some browsers.
and more...

## [1.0.9.5] - 2026-02-20
### Fixed
- Hard-block mood image uploads that exceed size/dimension limits or unsupported formats.
and more...

## [1.0.9.4] - 2026-02-20
### Fixed
- Mood image upload retries multiple file field names to match ST upload expectations.
and more...

## [1.0.9.3] - 2026-02-20
### Fixed
- Character defaults panel now resolves character name from context when input is missing.
and more...

## [1.0.9.2] - 2026-02-20
### Fixed
- Guarded settings UI localStorage writes to avoid quota crashes.
and more...

## [1.0.9.1] - 2026-02-20
### Added
- Per-character defaults panel in character advanced definition, including mood image uploads.
### Changed
- Mood display uses custom images when a full set of 15 moods is provided for a character.
and more...

## [1.0.9] - 2026-02-20
### Added
- Slash commands for status, extract, clear, toggles, injection, and debug.

## [1.0.8] - 2026-02-20
### Added
- Injection prompt template is now editable and shown under Extraction when injection is enabled.
- Stop button shown in tracker progress card to cancel extraction.
### Changed
- Prompt protocols now define confidence as self-assessed certainty in the extracted update.
- Tracked stat toggles now affect only future extractions; historical cards and graphs keep recorded data.
### Fixed
- Tracked stats toggles now affect cards, graph, and injected prompt content.
- Disabled stats no longer appear in summaries or graph tooltips.
And more...

## [1.0.7] - 2026-02-19
### Added
- Graph hover tooltip and latest-point emphasis.
- Accent color picker in settings.
- Extraction progress step labels in loading UI.
### Changed
- Settings UI polish (drawers, icons, prompt grouping, dividers, help collapse).
- Tracker card polish (spacing, inactive badge, last thought clamp, delta arrows).
### Fixed
- Graph tooltip positioning and accent picker sync on reopen.
And more...

## [1.0.6.20] - 2026-02-19
### Changed
- Graph tooltip now follows cursor within canvas.

## [1.0.6.19] - 2026-02-19
### Changed
- Added extraction step labels to loading UI and styled it to match cards.
- Graph: hover tooltip, latest point emphasis, lighter grid, active window highlight.
- Cards: tighter spacing, delta arrows, softened inactive overlay.

## [1.0.6.18] - 2026-02-19
### Changed
- Removed hover translate on tracker cards to prevent layout jump.

## [1.0.6.17] - 2026-02-19
### Changed
- Polished tracker cards (spacing, hover, inactive badge, ellipsis, last thought clamp).

## [1.0.6.16] - 2026-02-19
### Changed
- Replaced accent color hex input with a color picker only.
- Simplified accent color sync logic.

## [1.0.6.15] - 2026-02-19
### Changed
- Added ghost icon to inactive label in tracker cards.

## [1.0.6.14] - 2026-02-19
### Changed
- Fixed accent color picker to reflect saved non-hex colors on reopen.

## [1.0.6.13] - 2026-02-19
### Changed
- Added accent color picker synced with hex input.
- Styled Quick Help and renamed Open Settings button with icon.

## [1.0.6.12] - 2026-02-19
### Changed
- Styled section dividers as full-width separators with line accents.

## [1.0.6.11] - 2026-02-19
### Changed
- Removed duplicate Generation section and extra dividers.
- Enforced input/checkbox grouping in Extraction.

## [1.0.6.10] - 2026-02-19
### Changed
- Unified prompt subdrawer toggles and reset icons to Font Awesome.
- Collapsed prompt help into a details block.
- Added Connection divider to match Generation divider.
- Aligned prompt toggle and reset sizing.

## [1.0.6.9] - 2026-02-19
### Changed
- Added Font Awesome icons to settings section headers, prompt groups, and debug actions.

## [1.0.6.8] - 2026-02-19
### Changed
- Default open drawers: Extraction and Display.
- Lighter header styling and label focus highlight.
- Renamed section to Connection & Generation.
- Prompt groups collapsible and default collapsed.
- Clamp notice shows on blur only.

## [1.0.6.7] - 2026-02-19
### Changed
- Added blue accent bar on drawer headers.

## [1.0.6.6] - 2026-02-19
### Changed
- Replaced drawer angle with centered SVG chevron and larger icon container.

## [1.0.6.5] - 2026-02-19
### Changed
- Centered and enlarged drawer angle icon.

## [1.0.6.4] - 2026-02-19
### Changed
- Refined drawer header styling and icons; added spacing below headers.
- Clamp notices persist briefly to be readable.

## [1.0.6.3] - 2026-02-19
### Changed
- Clamp numeric inputs to min/max and show inline notice when adjusted.
- Show min/max hints on numeric settings.

## [1.0.6.2] - 2026-02-19
### Changed
- Merged Connection + Generation into a single drawer.
- Drawer header bar now toggles; icon is a circular angle indicator.

## [1.0.6.1] - 2026-02-19
### Changed
- Settings sections (except Quick Help) are collapsible and default to collapsed.

## [1.0.6] - 2026-02-19
### Added
- Fixed main prompt prefix applied to all extraction requests (hidden from settings).
- Stat meaning definitions included in the main prompt.
### Changed
- Prompt editing now only affects instruction sections; protocol blocks are fixed and read-only.
- Legacy full-template prompt settings are normalized to instruction-only on load.
- Non-romantic desire rules enforced in the main prompt (no romance inference from affection/playfulness).

## [1.0.5.8] - 2026-02-19
### Changed
- Main prompt now forbids inferring romance from affection or playfulness.

## [1.0.5.7] - 2026-02-19
### Changed
- Main prompt now enforces non-romantic desire deltas to be 0 or negative.

## [1.0.5.6] - 2026-02-19
### Changed
- Main prompt prefix wording updated to "relationship-state extraction engine."

## [1.0.5.5] - 2026-02-19
### Changed
- Main prompt prefix now includes stat meaning definitions.

## [1.0.5.4] - 2026-02-19
### Changed
- Added a hidden, fixed main prompt prefix applied to all extraction prompts.

## [1.0.5.3] - 2026-02-19
### Changed
- Prompt editing now only affects the instruction section; protocol blocks are fixed and read-only.
- Legacy full-template prompt settings are normalized to instruction-only on load.

## [1.0.5.2] - 2026-02-19
### Changed
- Diagnostics request metadata now includes truncation length when available.

## [1.0.5.1] - 2026-02-19
### Added
- Optional inclusion of character card details in extraction prompts for disambiguation.

## [1.0.5] - 2026-02-19
### Added
- Editable per-stat prompt templates with per-prompt reset buttons.
- Prompt placeholder documentation in settings and README.
- Settings to override max tokens and context truncation length for extraction requests.
### Changed
- Sequential prompt defaults are stat-specific; strict/repair prompts are fixed.
- Extraction now respects profile/preset token limits and truncation length.
- Settings layout reorganized (quick help on top, connection/generation/extraction grouped).

## [1.0.4.13] - 2026-02-19
### Changed
- Moved Quick Help to the top of settings.

## [1.0.4.12] - 2026-02-19
### Changed
- Reorganized settings layout: connection section first, then generation and extraction.

## [1.0.4.11] - 2026-02-19
### Added
- Settings to override max tokens and context truncation length for extraction requests.

## [1.0.4.10] - 2026-02-19
### Changed
- Extraction now respects profile token limits and truncation length when available.

## [1.0.4.9] - 2026-02-19
### Changed
- Prompt reset buttons no longer clear prompt textareas.
- Debug section moved to the bottom of settings.

## [1.0.4.8] - 2026-02-19
### Changed
- Documented prompt templates and placeholders in README.

## [1.0.4.7] - 2026-02-19
### Changed
- Prompts section is now single-column with per-prompt reset buttons.
- Added prompt-stack spacing for cleaner layout.

## [1.0.4.4] - 2026-02-19
### Changed
- Repair/strict prompts are now fixed and no longer editable in settings.
- Sequential prompt defaults are stat-specific and no longer rely on stat placeholders.
- Prompt editor help text updated to reflect current placeholders.

## [1.0.4.3] - 2026-02-18
### Added
- Prompt placeholder reference list in settings to explain available macros.
### Changed
- Expanded prompt editor help text for clarity.

## [1.0.4.2] - 2026-02-18
### Added
- Per-stat sequential prompt templates in settings, with a reset-to-defaults button.
### Changed
- Sequential extraction now uses per-stat templates instead of the unified prompt template.

## [1.0.4.1] - 2026-02-18
### Added
- Prompt template editor in settings for unified and repair prompts, plus a reset-to-defaults button.
### Changed
- Extraction now renders prompts through user-configurable templates with placeholder support.

## [1.0.4] - 2026-02-18
### Changed
- Route extraction through Generator with the selected profile, and build as ES module for utils-lib compatibility.
- Graph history now dedupes by message index, ignores legacy entries without messageIndex, skips deleted messages, and keeps up to 120 snapshots.
- Diagnostics dumps now include settings provenance, graph preferences, profile resolution, request metadata, history sample, and request numbering starts at 1.

## [1.0.3.12] - 2026-02-18
### Changed
- Diagnostics request numbering now starts at 1 for each run.

## [1.0.3.11] - 2026-02-18
### Changed
- Diagnostics dump now includes settings provenance, graph preferences, profile resolution, request metadata, and a history sample for faster debugging.

## [1.0.3.10] - 2026-02-18
### Changed
- Graph history now ignores legacy snapshots without a message index and skips deleted messages to prevent retrack stacking.

## [1.0.3.9] - 2026-02-18
### Changed
- Store up to 120 tracker snapshots so the graph window setting (30/60/120/all) has visible effect.

## [1.0.3.8] - 2026-02-18
### Changed
- De-duplicate graph history by message index so retracks do not add extra points.

## [1.0.3.7] - 2026-02-18
### Changed
- Route generation through `sillytavern-utils-lib` Generator with the selected profileId so the extension profile is always used.
- Switch build output to ES module and externalize SillyTavern runtime imports for Generator compatibility.

## [1.0.3.6] - 2026-02-18
### Changed
- Force the selected connection profile during quiet generation and restore it afterward.

## [1.0.3.5] - 2026-02-18
### Changed
- Always use SillyTavern's internal quiet generation pipeline so the selected connection profile is honored for tc/cc backends.

## [1.0.3.4] - 2026-02-18

- When a connection profile is selected in the extension, the generator now skips STâ€™s quiet pipeline so the chosen profile is always used.

## [1.0.3.3] - 2026-02-18

- Route extraction requests based on the selected connection profile mode (`tc` uses text-completions; `cc` uses chat-completions).
- Keep profile override fields for compatibility with older ST backends.

## [1.0.3.2] - 2026-02-18

- Attempt to honor extension connection profiles via ST quiet pipeline (if supported) and include compatibility profile fields for direct fetch requests.

## [1.0.3.1] - 2026-02-18

- Added compatibility `profile_id` field to extraction requests to avoid 400s on older ST backends while still honoring extension connection profiles.

## [1.0.3] - 2026-02-18

- Connection profiles now always come from the extension settings by skipping the quiet-generation path when a profile is configured.
- Retrack now loads the previous AI messageâ€™s tracker state before applying new deltas so values donâ€™t stack on themselves.
- Parser delta clamping obeys `maxDeltaPerTurn`, and the README/workflow notes were refreshed to describe the exact behavior.

## [1.0.2] - 2026-02-18

- Removed hidden `settings.characterDefaults` baseline path from runtime.
- Removed character-defaults popup integration and related settings fields.
- Baseline defaults now use only:
  - character advanced definitions (`extensions.bettersimtracker.defaults`),
  - contextual inference fallback.
- Updated README to match this behavior.

## [1.0.1] - 2026-02-18

- Made `Max Delta Per Turn` effective end-to-end:
  - parser delta clamp now follows configured max delta,
  - extraction parse/retry pipeline passes configured max delta,
  - unified prompt requests deltas in configured range.
- Expanded README with exact confidence/delta application math.
- Corrected README character-default priority to match runtime behavior.

## [1.0.0] - 2026-02-18

- First stable public release.

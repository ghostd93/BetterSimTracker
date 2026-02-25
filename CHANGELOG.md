# Changelog

All notable changes to BetterSimTracker are documented here.

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

- When a connection profile is selected in the extension, the generator now skips ST’s quiet pipeline so the chosen profile is always used.

## [1.0.3.3] - 2026-02-18

- Route extraction requests based on the selected connection profile mode (`tc` uses text-completions; `cc` uses chat-completions).
- Keep profile override fields for compatibility with older ST backends.

## [1.0.3.2] - 2026-02-18

- Attempt to honor extension connection profiles via ST quiet pipeline (if supported) and include compatibility profile fields for direct fetch requests.

## [1.0.3.1] - 2026-02-18

- Added compatibility `profile_id` field to extraction requests to avoid 400s on older ST backends while still honoring extension connection profiles.

## [1.0.3] - 2026-02-18

- Connection profiles now always come from the extension settings by skipping the quiet-generation path when a profile is configured.
- Retrack now loads the previous AI message’s tracker state before applying new deltas so values don’t stack on themselves.
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

# Changelog

All notable changes to BetterSimTracker are documented here.

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

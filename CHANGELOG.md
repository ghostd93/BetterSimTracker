# Changelog

# Changelog

All notable changes to BetterSimTracker are documented here.

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

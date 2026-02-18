# Changelog

All notable changes to BetterSimTracker are documented here.

## [1.0.1] - 2026-02-18

- Made `Max Delta Per Turn` effective end-to-end:
  - parser delta clamp now follows configured max delta,
  - extraction parse/retry pipeline passes configured max delta,
  - unified prompt requests deltas in configured range.
- Expanded README with exact confidence/delta application math.
- Corrected README character-default priority to match runtime behavior.

## [1.0.0] - 2026-02-18

- First stable public release.

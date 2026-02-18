# Changelog

All notable changes to BetterSimTracker are documented here.

## [0.1.71] - 2026-02-18

- Added `Quick Help` block in settings modal.
- Mobile usability improvements for settings/graph modals.
- Unified close button UX (`×`) across modals.
- Added global tracker collapse with compact summary view.
- Hardened behavior for SD/image generation:
  - ignore generated-media chat messages for tracking,
  - prevent quiet/image generation from driving tracker progress state,
  - prevent progress UI from rendering on user/system messages.
- Improved debug tooling and diagnostics controls.
- Cleaned unused UI remnants.

## [0.1.0] - Initial scaffold

- TypeScript extension architecture and initial tracker pipeline.

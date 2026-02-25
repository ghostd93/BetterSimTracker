# Operations

Last verified commit: `000d643`

This file documents the maintainer workflow for building, releasing, and debugging BetterSimTracker.

## Build

Prerequisites:

- Node.js + npm
- repository checked out in writable workspace

Commands:

```bash
npm install
npm run typecheck
npm run build
```

Build artifact:

- `dist/index.js`

## Branch Model (Current)

- `main`: release branch
- `dev`: regular development branch
- `experimental`: high-risk development branch (can be used as dev-equivalent when explicitly declared for a run)
- `v1`: historical/read-only (never commit/push)

## Versioning Rules

- Keep `package.json` and `manifest.json` versions synchronized.
- Release versions: `X.Y.Z`.
- Dev versions: `<latest_release>-dev.x` and monotonic on the active development branch.
- Optional update builds: `0.0.0.X` (not tagged as real releases).

## Changelog Rules

- Update `CHANGELOG.md` for every functional change.
- Keep `[Unreleased]` at top when pending items exist.
- For release:
  - move `[Unreleased]` entries into new release block with exact version/date
  - use `And more...` only when needed

## Standard Update Flow

1. Implement code/docs change.
2. Bump version fields.
3. Update changelog.
4. Update README when user-facing behavior changed.
5. Build (`npm run build`).
6. Commit in order:
  - feature/code changes
  - version/changelog/readme
  - dist build update
7. Push development branch.

## Release Flow

1. Ensure clean build.
2. Finalize changelog release block.
3. Merge dev-equivalent branch -> `main`.
4. Tag release (`vX.Y.Z`).
5. Push `main` + tag.
6. Create GitHub release notes (big changes only).
7. Remove temporary release-notes file if used.
8. Sync active development branch(es) to `main` after release.

## Diagnostics Workflow

1. Enable debug in settings.
2. Reproduce issue once.
3. Dump diagnostics.
4. Capture:
  - `lastDebugRecord.rawModelOutput`
  - `parsed`
  - `applied`
  - `meta.statsRequested`
  - trace tail

## Common Operational Checks

- Extraction appears stuck:
  - verify trackable AI message and connection profile resolution.
- Stat not updating:
  - verify stat is tracked and requested in `meta.statsRequested`.
- Injection mismatch:
  - verify `injectTrackerIntoPrompt`, `includeInInjection`, and depth.
- Non-numeric value unchanged:
  - confirm model returned same value vs missing request path.

## Safety Notes

- Do not use destructive git commands unless explicitly requested.
- Do not commit/push to `v1`.
- Keep `_research_sillytavern/` isolated as auxiliary local reference unless explicitly included in a change.

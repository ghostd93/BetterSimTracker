# BetterSimTracker Project Improvement Analysis

Date: 2026-03-06
Branch reviewed: `dev`

## Progress Update

Step 1 from this review is now implemented in the codebase:

- shared runtime module added: `src/customStatRuntime.ts`
- centralized there:
  - stat-kind normalization
  - date/time mode normalization
  - enum option normalization
  - enum value resolution
  - text max-length normalization
  - text/array non-numeric normalization
  - default-value normalization
  - generic non-numeric value normalization
- main consumers migrated to the shared runtime:
  - `src/settings.ts`
  - `src/ui.ts`
  - `src/parse.ts`
  - `src/storage.ts`
  - `src/prompts.ts`
  - `src/index.ts`
  - `src/characterPanel.ts`
  - `src/personaPanel.ts`

Validation status:

- `npm run typecheck` passed
- `npm run build` passed

This means item 2 below is no longer an open architectural gap at the same severity. The next highest-value work is now module/file decomposition and targeted automated tests.

## Executive Summary

The project is feature-rich and already has strong product depth, but it is carrying clear scaling debt in four areas:

1. Very large orchestration/UI modules are making regressions more likely.
2. Stat-kind logic is duplicated across multiple files instead of being centralized.
3. Reliability depends heavily on prompt quality because there is very little automated validation/test coverage.
4. Docs and operational rules have drifted behind the real implementation.

The highest-leverage improvements are not new features. They are structural: split the biggest files, centralize stat-kind behavior, add test coverage around extraction/storage normalization, and automate release/version checks.

## Highest Priority Improvements

### 1. Break up the oversized runtime modules

Current hotspots:

- `src/ui.ts` ~482 KB
- `src/index.ts` ~177 KB
- `src/extractor.ts` ~74 KB
- `src/prompts.ts` ~72 KB
- `src/characterPanel.ts` ~61 KB
- `src/settings.ts` ~50 KB
- `src/personaPanel.ts` ~46 KB

Why this matters:

- These files are beyond comfortable review/debug size.
- Small changes can create unrelated regressions.
- Repeated bug-fix cycles are harder because behavior is spread across long procedural files.
- New contributors will struggle to build safe mental models.

Recommended split:

- `src/index.ts`
  - extract event wiring into `src/runtime/events.ts`
  - extract diagnostics/debug dump into `src/runtime/diagnostics.ts`
  - extract macro registration into `src/runtime/macros.ts`
  - extract extraction scheduling/gating into `src/runtime/extractionScheduler.ts`
- `src/ui.ts`
  - split into `cards`, `settings`, `modals`, `sceneCard`, `editModal`, `customStatWizard`, `sharedControls`
- `src/extractor.ts`
  - split unified flow, sequential flow, apply logic, progress labeling, and scope-resolution debug helpers
- `src/prompts.ts`
  - split built-in prompts, custom-stat prompts, summary prompts, AI-helper generation prompts, injection helpers

Expected payoff:

- lower regression rate
- faster debugging
- safer releases
- easier testing

### 2. Centralize custom stat kind behavior

Status: completed in current `dev` run.

The same kind-specific rules are repeated in several places:

- `src/settings.ts`
- `src/ui.ts`
- `src/parse.ts`
- `src/storage.ts`
- `src/prompts.ts`

This is the biggest maintainability problem after file size.

Examples of repeated logic:

- enum option normalization
- array item normalization
- date/time normalization
- boolean coercion
- text length limits
- default value resolution
- display formatting

Risk:

- one stat kind gets fixed in one layer and stays broken in another
- new stat kinds become expensive to add safely
- bugs look random because validation, parsing, rendering, and storage do not share one source of truth

Implemented improvement:

- create a central stat-kind module, for example `src/customStatKind.ts` or `src/customStatRuntime.ts`
- expose one API for:
  - sanitize definition
  - sanitize default value
  - parse model output value
  - normalize stored value
  - format display value
  - validate owner/default compatibility

This is now the active path for the main runtime/settings/parser/UI/defaults flows. Future work here should focus on keeping new stat-kind logic out of leaf modules rather than redesigning this layer again.

### 3. Add automated tests for the risky paths

Right now the package scripts only expose:

- `npm run typecheck`
- `npm run build`

There is no visible test script in the project package.

That is too weak for this codebase because the risky logic is not type-level only. The real risk is runtime behavior:

- extraction fallback merging
- parsing malformed model output
- scope resolution for global/user/character/private stats
- swipe/history/message storage behavior
- custom stat import/merge safety
- scene-card/global-stat routing

Recommended minimum test suite:

- `parse.ts`
  - malformed JSON recovery
  - array normalization
  - date_time parsing
  - enum/boolean coercion
- `storage.ts`
  - swipe-aware read/write
  - fallback merge behavior
  - no destructive replacement of unrelated stats
- `settings.ts`
  - sanitize custom stat definitions
  - backward compatibility for legacy fields
  - global/private tracking constraints
- `extractor.ts`
  - grouped sequential custom stats
  - built-in disabled snapshot behavior
  - global/private owner routing

If full browser tests are too expensive now, start with pure TypeScript unit tests for parsing/sanitization/storage.

### 4. Enforce release/version consistency with code, not memory

The local workflow rules are strong, but the repo itself does not enforce enough of them.

Observed risk areas:

- version bump drift between branches/releases
- manual changelog hygiene
- docs drift
- release build depending on manual discipline

Recommended automation:

- add a small validation script:
  - `package.json` version == `manifest.json` version
  - `CHANGELOG.md` contains no `-dev` section when building from `main`
  - `dist/index.js` is newer than source commit or matches current build
- expose script names like:
  - `npm run validate:release`
  - `npm run validate:versions`
- optionally add a local pre-push/pre-release helper script for maintainers

This is a small investment with high release-quality payoff.

## Medium Priority Improvements

### 5. Reduce prompt-system duplication and make prompt assembly more composable

`src/prompts.ts` is large because it mixes:

- base protocols
- built-in instructions
- custom-stat helpers
- date/time-specific helpers
- summary generation prompts
- AI helper generation prompts

Recommended structure:

- `prompts/builtins.ts`
- `prompts/customStats.ts`
- `prompts/dateTime.ts`
- `prompts/helpers.ts`
- `prompts/summary.ts`
- `prompts/protocols.ts`

Also worth adding:

- a small prompt template validator for required placeholders
- a shared “source priority rule” function that every prompt path must use

### 6. Create a dedicated diagnostics formatter layer

Diagnostics are already strong, but the shape is growing complex.

Improvement opportunity:

- move debug-record assembly out of `src/index.ts`
- create explicit diagnostic schema builders
- add a compact mode and a full mode
- version the dump schema, e.g. `diagnosticSchemaVersion`

Why:

- easier bug triage
- easier backward compatibility
- easier future tooling around dumps

### 7. Tighten bundle strategy

Current build output is about 624 KiB minified and webpack already warns about it.

Likely causes:

- UI-heavy single-bundle architecture
- large prompt/template strings bundled with runtime
- one-file UI system

Improvements:

- split optional UI/editor/modals into separate modules
- lazy-load very rare tools if ST runtime allows it
- move some large static prompt blocks/constants into more structured modules

This is lower priority than architecture/testing, but worth tracking.

### 8. Normalize JSON/file formatting in the repo

Formatting is inconsistent in some JSON files and version edits have already produced awkward indentation/BOM issues during release work.

Improvements:

- add repo formatting rules for JSON/TS/Markdown
- ensure JSON files are always UTF-8 without BOM
- optionally add prettier or a narrow formatting script if you want consistency without broad tool churn

This would prevent avoidable build/release friction.

## Product/UX Improvements

### 9. Separate UI rendering concerns from UI state mutation

The settings modal and card-edit flows are powerful, but a lot of logic appears intertwined:

- value normalization
- DOM generation
- event binding
- persistence
- display-specific formatting

Recommended direction:

- introduce reusable field/controller helpers per control type
- separate “state collection” from “DOM rendering”
- isolate scene-card editors, custom-stat wizard, and tracker-edit modal into self-contained modules

This is especially important because mobile and desktop behavior both matter in this extension.

### 10. Define a stricter design contract for scene card / stat display surfaces

The project has grown multiple display systems:

- owner cards
- scene card
- edit modal
- settings modal
- persona/character defaults

Improvements:

- formalize one internal display model for stat rows/chips/array/date_time rendering
- make the same formatter/renderer serve cards, previews, and edit surfaces where possible
- reduce one-off per-surface rendering logic

That will lower UI inconsistency bugs.

## Documentation Improvements

### 11. Update stale docs metadata and align docs with actual workflow

Several docs still say:

- `Last verified commit: 000d643`

That is stale relative to the current project state.

`docs/operations.md` also no longer fully matches the stricter real workflow now being used locally.

Recommended improvements:

- refresh all `Last verified commit` markers or remove them entirely
- align `docs/operations.md` with current versioning/release conventions
- document current macro behavior and scope rules in one dedicated doc section
- document global/private/scene stat routing more explicitly

### 12. Add a contributor-facing “where logic lives” map

The repo would benefit from a short maintainer map that answers:

- where stat kinds are validated
- where tracker snapshots are merged
- where scene/global/private scoping is decided
- where prompt text is assembled
- where card/edit/settings UI paths diverge

This can live in `docs/architecture.md` or a new `docs/contributor-map.md`.

## Suggested Execution Order

### Phase 1: Safety and maintainability

- add unit tests for parsing/settings/storage
- centralize custom stat kind runtime rules
- add release/version validation scripts

### Phase 2: Structural refactor

- split `ui.ts`
- split `index.ts`
- split `prompts.ts`
- split `extractor.ts`

### Phase 3: UX consistency

- unify rendering/formatting helpers for scene/owner/edit surfaces
- reduce duplicated control logic in settings/edit modals
- improve diagnostics schema and formatting

### Phase 4: Docs and tooling polish

- refresh docs
- add contributor map
- normalize JSON/file formatting
- add optional bundle-size monitoring

## Bottom Line

The project does not mainly need more features right now. It needs stronger internal structure.

If only three improvements are chosen, the best ones are:

1. centralize stat-kind logic
2. add tests for parse/settings/storage/extractor edge cases
3. split `ui.ts` and `index.ts` into smaller runtime modules

Those three changes would likely remove a large share of the “random regression” class of bugs that keep recurring during fast feature work.

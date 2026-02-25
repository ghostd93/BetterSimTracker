# BetterSimTracker Technical Documentation

Last verified commit: `000d643`

This directory is the maintainer-level documentation set for BetterSimTracker internals.

## Read This First

- User-facing onboarding stays in `README.md` (repo root).
- Internal behavior, architecture, and maintenance flows live here.
- If behavior changes, update these docs in the same PR.

## Document Map

- `docs/architecture.md`
  - Runtime lifecycle, module boundaries, and event flow.
- `docs/data-model.md`
  - Core TypeScript contracts, settings schema, tracker payload shape, storage keys.
- `docs/extraction-pipeline.md`
  - Extraction execution model, retry logic, parse/apply semantics, seeding, cancellation.
- `docs/prompt-system.md`
  - Prompt layers, template precedence, macros, prompt injection, AI helper generators.
- `docs/ui-system.md`
  - Tracker rendering, settings modal/wizards, graph modal, manual edit pipeline.
- `docs/operations.md`
  - Build, release, diagnostics, and branch workflow.

## Source Anchors

Primary implementation files:

- `src/index.ts`
- `src/extractor.ts`
- `src/prompts.ts`
- `src/parse.ts`
- `src/promptInjection.ts`
- `src/ui.ts`
- `src/settings.ts`
- `src/storage.ts`
- `src/types.ts`

## Conventions

- Numeric stat domain: `0..100`.
- Delta clamps: `[-maxDeltaPerTurn, +maxDeltaPerTurn]`.
- Confidence domain: `0..1`.
- Custom stat kinds:
  - `numeric`
  - `enum_single`
  - `boolean`
  - `text_short`

## Change Discipline

For significant internal changes, update at least these files:

- Behavior change in extractor: `docs/extraction-pipeline.md`
- Prompt template/macro change: `docs/prompt-system.md`
- Settings or payload schema change: `docs/data-model.md`
- UI workflow change: `docs/ui-system.md`
- Release/build policy change: `docs/operations.md`

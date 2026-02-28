# Architecture

Last verified commit: `000d643`

## Purpose

BetterSimTracker is a SillyTavern extension that tracks relationship state per AI message, renders historical tracker cards, and optionally injects current relationship state into generation prompts.

## High-Level Runtime

1. Extension bootstraps from `src/index.ts`.
2. Settings are loaded and sanitized (`src/settings.ts`).
3. UI surfaces are mounted (`src/ui.ts`, `src/settingsPanel.ts`).
4. Event listeners are attached to ST events (generation start/end, message rendered, chat changes).
5. On eligible AI generation end, extraction is scheduled.
6. Extracted state is merged, persisted, and rendered.
7. Optional prompt injection is synchronized (`src/promptInjection.ts`).

## Module Boundaries

- `src/index.ts`
  - Orchestrator for lifecycle, event wiring, scheduling, rendering refresh, diagnostics, summary flow.
- `src/extractor.ts`
  - Executes model calls for built-in and custom stats and applies parsed values.
- `src/prompts.ts`
  - Prompt assembly for unified/sequential extraction, custom stat prompts, and AI helper generation prompts.
- `src/parse.ts`
  - Strict JSON parsing and normalization for unified and custom stat responses.
- `src/promptInjection.ts`
  - Builds hidden guidance block and syncs it into ST prompt manager.
- `src/storage.ts`
  - Tracker read/write helpers against message payloads, chat metadata, and history helpers.
- `src/settings.ts`
  - Settings defaults, sanitization, persistence, and connection profile resolution.
- `src/ui.ts`
  - Tracker cards, graph modal, settings modal, wizards, manual edit modal.
- `src/characterPanel.ts`
  - Advanced character defaults panel and mood-image management.
- `src/activity.ts`
  - Active-character detection and context-window assembly.

## Data Flow

### Generation -> Extraction

1. ST emits generation lifecycle events.
2. `index.ts` determines if message is trackable (`src/messageFilter.ts`).
3. Extractor receives:
  - Active characters
  - Recent context text
  - Previous tracker snapshot
  - Current settings
4. Extractor returns:
  - `statistics` (built-ins + text)
  - `customStatistics` (numeric custom)
  - `customNonNumericStatistics` (enum/boolean/text/array custom)
  - optional diagnostics payload
5. `index.ts` merges fallback values for missing fields and persists result.
6. UI re-renders the affected message tracker cards.

### Injection Sync

1. Latest tracker state is read.
2. Injection template is rendered with current values.
3. Block is inserted/updated in ST prompt stack (depth-aware).
4. If injection disabled or no data, injected block is cleared.

## Execution Modes

- Unified extraction (`sequentialExtraction=false`):
  - Built-in/text stats in one request.
  - Custom stats still run per-stat requests.
- Sequential extraction (`sequentialExtraction=true`):
  - One request per built-in/text stat.
  - Custom stats per-stat as well.
- First-run stabilization:
  - New stats for characters can be seeded from defaults before requesting model updates.

## Reliability Controls

- Strict JSON repair retries.
- Max retries per stat/stage.
- Confidence dampening for numeric delta scaling.
- Mood stickiness gate.
- Stop/cancel extraction path propagated to active generations.

## Diagnostics

When debug is enabled, runtime captures:

- prompt text (optional)
- raw model output
- parsed/applied counts
- request metadata by stage
- extraction mode and retry usage
- trace timeline tail

## Compatibility Strategy

- Backward-compatible payload handling in storage parsers.
- Missing fields are merged from previous snapshots/defaults.
- Built-in stats are non-deletable; toggles control tracking/display/injection.
- Custom stats are soft-removed from active config while historical snapshots remain intact.

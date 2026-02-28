# Data Model

Last verified commit: `000d643`

## Core Type Contracts

Defined in `src/types.ts`.

### Built-In Keys

- Numeric: `affection`, `trust`, `desire`, `connection`
- Text: `mood`, `lastThought`

### Custom Stat Kinds

- `numeric`
- `enum_single`
- `boolean`
- `text_short`
- `array`

### Tracker Payload (`TrackerData`)

`TrackerData` contains:

- `activeCharacters: string[]`
- `statistics`
  - `affection`, `trust`, `desire`, `connection` as number maps by character
  - `mood`, `lastThought` as text maps by character
- `customStatistics` (numeric custom values)
- `customNonNumericStatistics` (enum/boolean/text/array custom values)

## Settings Schema (`BetterSimTrackerSettings`)

Key groups:

- Runtime toggles:
  - `enabled`
  - `sequentialExtraction`
  - `injectTrackerIntoPrompt`
  - `lastThoughtPrivate`
- Extraction controls:
  - `maxConcurrentCalls`
  - `contextMessages`
  - `maxDeltaPerTurn`
  - `strictJsonRepair`
  - `maxRetriesPerStat`
- Scaling controls:
  - `confidenceDampening`
  - `moodStickiness`
- Prompt templates:
  - unified
  - sequential built-ins
  - sequential custom numeric
  - sequential custom non-numeric
  - injection template
- Custom stat definitions:
  - `customStats: CustomStatDefinition[]`
- Display controls:
  - graph settings
  - card style settings
  - optional `userCardColor` override
  - mood source/mapping/frame settings

Sanitization is centralized in `src/settings.ts`.

## Custom Stat Definition (`CustomStatDefinition`)

Common fields:

- `id`
- `kind`
- `label`
- `description`
- `track`
- `trackCharacters`
- `trackUser`
- `privateToOwner`
- `showOnCard`
- `showInGraph`
- `includeInInjection`
- `color`
- `promptOverride` (legacy alias accepted: `sequentialPromptTemplate`)
- `behaviorGuidance`

Kind-specific fields:

- `numeric`: `defaultValue`, `maxDeltaPerTurn`
- `enum_single`: `defaultValue`, `enumOptions[]`
- `boolean`: `defaultValue`, `booleanTrueLabel`, `booleanFalseLabel`
- `text_short`: `defaultValue`, `textMaxLength`
- `array`: `defaultValue` (`string[]`), `textMaxLength` (per-item limit), max `20` items

## Persistence Surfaces

Implemented in `src/storage.ts` and `src/index.ts` orchestration.

- Message-level tracker payloads (primary history source).
- Chat-level latest payload cache/fallback.
- Metadata/local fallback for recovery and diagnostics continuity.
- Debug record store with optional context/prompt capture.

## Merge and Fallback Rules

When extraction omits values:

- Built-in stats merge from previous snapshot/defaults.
- Custom numeric and non-numeric values merge independently.
- Mood/lastThought preserve prior values when no new value is parsed.

Helper functions:

- `mergeStatisticsWithFallback`
- `mergeCustomStatisticsWithFallback`
- `mergeCustomNonNumericStatisticsWithFallback`

## Diagnostics Shape (`DeltaDebugRecord`)

Contains:

- `rawModelOutput`
- `promptText` (optional, if context-in-diagnostics enabled)
- `contextText` (optional)
- `parsed` section
  - confidences
  - built-in deltas
  - custom numeric/non-numeric
  - mood/lastThought
- `applied` section
- `meta` section
  - `statsRequested`
  - `requests[]` transport metadata
  - parsed/applied counts
  - extraction mode
  - retry flags
- trace tail arrays

## Versioning Constraints

Repo policy requires synchronized version fields:

- `package.json`
- `manifest.json`

Dev format:

- `<latest_release>-dev.x`

Release format:

- `X.Y.Z`

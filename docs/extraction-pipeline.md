# Extraction Pipeline

Last verified commit: `000d643`

Primary implementation: `src/extractor.ts`.

## Inputs

Extractor is called with:

- `settings`
- `activeCharacters`
- `contextText` (recent messages)
- `previousStatistics`
- `history` (recent tracker snapshots)
- cancellation callbacks and progress callback

## Enabled Stat Resolution

1. Built-in/text stats are filtered by settings toggles.
2. Custom stats are filtered by `track=true`.
3. If no enabled stats or no active characters, extractor returns empty payload maps.

## Execution Modes

### Unified Mode (`sequentialExtraction=false`)

- Built-in + text stats are requested in one unified prompt.
- Custom stats (numeric and non-numeric) run as per-stat requests.

### Sequential Mode (`sequentialExtraction=true`)

- Built-in/text stats run one stat per request.
- Custom stats still run per-stat requests.
- Worker count honors `maxConcurrentCalls` with hard safety clamp.

## Custom Stat Request Behavior

For each custom stat:

1. Characters are split into:
  - first-run seed-only
  - existing baseline (request from model)
2. Seed-only characters receive default values without model call.
3. Existing characters are requested using kind-specific prompt/protocol.

## Parse and Apply

### Built-In Numeric Stats

- Parsed delta is clamped by `maxDeltaPerTurn`.
- Confidence is clamped to `0..1`.
- Applied delta uses dampening scale:
  - `scale = (1 - confidenceDampening) + confidence * confidenceDampening`
  - `scaledDelta = round(clampedDelta * scale)`
- Final stat clamped to `0..100`.

### Mood

- If confidence is below `moodStickiness`, previous mood is kept.
- Otherwise parsed mood is applied.
- Allowed mood labels are normalized to known set.

### Last Thought

- Applied directly when parsed.
- Missing value preserves previous value through merge fallback.

### Custom Numeric

- Same numeric apply semantics as built-ins, with optional per-stat max delta override.

### Custom Non-Numeric

- `enum_single`: must match allowed token.
- `boolean`: strict true/false.
- `text_short`: normalized and clipped to max length.

## Retry Strategy

For each request stage:

1. Initial generation.
2. Strict JSON retry (if enabled).
3. Optional stat-specific repair retry for built-ins where defined.
4. Additional strict retries until retry budget exhausted.

Transport retries are also applied with short backoff for transient failures.

## Progress Reporting

Pipeline emits step labels:

- Preparing context
- Requesting <stat>
- Parsing <stat>
- Applying <stat>
- Finalizing

UI consumes this for loading bars and stop-button state.

## Cancellation

Cancellation sources:

- user stop action
- run superseded by new run

Behavior:

- active generation handles are aborted
- extractor throws abort error
- no final payload is committed for cancelled run

## Output

Extractor returns:

- `statistics`
- `customStatistics`
- `customNonNumericStatistics`
- `debug` payload (when available)

`index.ts` then merges with fallback and writes the final snapshot.

## Known Guardrails

- Non-trackable AI/system/media messages are skipped upstream.
- Empty custom stat baselines are seeded to avoid phantom delta spikes.
- Prompt history snapshots are filtered to entries with tracked values for currently active characters, so user-only turns do not inject default-seeded character rows into extraction prompts.
- Parsed maps are initialized defensively to avoid undefined access during merge/apply.
- If generation-end/render event ordering is delayed, a late-render poll fallback checks for the newly added AI message and schedules extraction to avoid mobile race misses.
- On chat load, if the latest AI message has no tracker payload yet, a one-shot bootstrap run is scheduled for that message.
- If that bootstrap target is an initial greeting (no prior user message), tracker values are seeded from configured defaults instead of model extraction.

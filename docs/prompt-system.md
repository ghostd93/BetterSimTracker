# Prompt System

Last verified commit: `fa0285a`

Primary implementation: `src/prompts.ts`, `src/promptInjection.ts`.

## Prompt Layers

### 1) Fixed Main Prompt Prefix

A fixed system preamble is always included for extraction.

Purpose:

- define stat semantics
- enforce JSON-only response behavior
- enforce relationship-safety constraints (for example desire rules)

### 2) Instruction Templates (Editable)

Editable in settings:

- Unified extraction instruction
- Sequential instructions for each built-in stat
- Global default for custom numeric per-stat extraction
- Global default for custom non-numeric per-stat extraction
- Injection template

Non-editable safety templates:

- strict JSON retry template
- repair templates

## Template Precedence

### Built-ins

- Unified mode uses unified template.
- Sequential mode uses per-built-in template.

### Custom Numeric

1. per-stat override
2. global `Custom Numeric Default`
3. built-in default constant

### Custom Non-Numeric

1. per-stat override
2. global `Custom Non-Numeric Default`
3. built-in default constant

## Macros and Render Context

Key macros:

- `{{envelope}}`
- `{{user}}` (`{{userName}}` alias also supported)
- `{{char}}` (tracked message speaker; fallback is first character in scope)
- `{{characters}}` (comma-separated character names)
- `{{contextText}}`
- `{{currentLines}}`
- `{{historyLines}}`
- `{{statId}}`, `{{statLabel}}`, `{{statDescription}}`
- kind-aware macros:
  - `{{statKind}}`
  - `{{allowedValues}}`
  - `{{textMaxLen}}`
  - `{{booleanTrueLabel}}`, `{{booleanFalseLabel}}`
  - `{{valueSchema}}`

Template rendering is deterministic and applies fallback strings for missing optional values.

## Prompt Injection

Injection behavior (`src/promptInjection.ts`):

- Runs only when enabled and tracker data exists.
- Builds hidden guidance block from current tracker state.
- Includes built-ins and custom stats that are marked `includeInInjection`.
- Honors `injectPromptDepth` (0..8) insertion depth.
- Can append latest summary note when `injectSummarizationNote=true`.

### Injection Size Guard

If guidance grows too large:

- custom-stat lines are trimmed first
- warning is logged in debug mode

This preserves core relationship guidance under token pressure.

## AI Helper Generation Prompts

`prompts.ts` provides helper prompt builders for:

- improving custom stat description
- generating per-stat prompt override text
- generating behavior guidance text
- generating built-in sequential instructions

Important split:

- `Per-Stat Prompt Override` generation is extraction-focused.
- `Behavior Instruction` generation is reaction/injection-focused.

## Summary Prompts

Additional prompt builders support:

- prose summary generation
- no-numbers rewrite pass
- minimum-length expansion pass

These are used for the `Summarize` workflow in runtime.

## Operational Notes

- Prompt text can be included in diagnostics when enabled.
- Hidden reasoning tags from AI helper generations are stripped before applying to settings fields.
- Prompt system is intentionally strict about JSON protocol in extraction path to reduce parser ambiguity.

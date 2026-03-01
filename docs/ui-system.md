# UI System

Last verified commit: `000d643`

Primary implementation: `src/ui.ts`, `src/settingsPanel.ts`, `src/characterPanel.ts`.

## UI Surfaces

- In-chat tracker root and per-message card groups.
- Loading/progress states during extraction.
- Tracker action row (collapse/retrack/summarize/edit/graph).
- Settings modal with section drawers and wizards.
- Graph modal.
- Character defaults panel in ST advanced definitions.

## Tracker Cards

Per character card can render:

- built-in numeric bars
- mood and last thought
- custom numeric values
- custom non-numeric chips

Ordering/visibility:

- active characters first
- inactive rendering controlled by settings
- historical snapshot remains attached to original message index
- user card display name resolves from the current user/persona label (not the internal `__bst_user__` key)

## Loading State

Two distinct UI states:

- post-generation waiting state (scheduled extraction delay)
- active extraction state (progress + stop button)

Stop action cancels active extraction run and in-flight generation handles.

If extraction stops/fails before first tracker save for the target message, UI renders an inline recovery card with:

- exact skip/error reason text
- action button (`Retry Tracker` or `Generate Tracker`)

## Manual Edit Flow (Latest Snapshot Per Role)

1. User opens edit modal from the latest tracked card for that role (`AI` cards or `User` card).
2. UI validates and normalizes payload.
3. `index.ts` applies edit payload to latest snapshot maps.
4. Snapshot is written and chat save is triggered.
5. UI re-renders with updated values.

Supports:

- numeric built-ins
- mood
- lastThought
- custom numeric
- custom non-numeric

## Settings Modal

Major sections:

- Extraction
- Connection/Generation
- Tracked Stats
- Display
- Debug

Key capabilities:

- live auto-save behavior
- prompt template editing
- per-stat built-in management wizard
- custom stat wizard (`Add`, `Edit`, `Clone`, `Remove`)
- custom stat JSON actions (`Import JSON`, `Export JSON`)
- AI helper buttons for prompt/description/guidance generation

## Custom Stat Wizard

Kind-aware steps and fields:

- basics (`id`, `label`, `description`, `kind`)
- kind-specific constraints (`enum options`, `boolean labels`, `text max length`, `array item limits`)
- tracking/display/injection toggles
- owner privacy toggle (`privateToOwner`)
- optional sequential override
- optional behavior guidance

Soft-remove semantics:

- stat definition removed from active config
- historical payload kept

## Graph Modal

Features:

- window selector (`30/60/120/all`)
- smoothing toggle
- multi-series rendering from enabled graph stats

Custom non-numeric stats are not graphed in current implementation.

## Character Defaults Panel

Provides per-character defaults and mood asset controls.

- numeric defaults
- custom numeric defaults
- custom non-numeric defaults
- optional card color override
- optional user card color override (global display setting)
- mood source controls
- mood image upload/delete
- ST expression mapping and framing options

## Persona Mood Panel

Provides per-persona mood controls inside SillyTavern Persona Management.

- per-persona mood source override
- per-mood BST image upload/delete for user tracker card mood rendering
- sprite-backed storage for uploaded persona mood images

## Accessibility and UX Notes

- reduced-motion aware animations
- responsive layout behavior for smaller screens
- compact controls for high-density tracker cards
- explicit help lines/tooltips for advanced options
- mobile portrait edit modal uses safe-area aware top anchoring and viewport height limits to prevent clipped/off-screen form controls
- edit modal uses top-layer dialog mounting when available (with fallback), so it stays above SillyTavern overlays on mobile

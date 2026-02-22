# BetterSimTracker

BetterSimTracker is a SillyTavern extension for relationship/state tracking in roleplay chats.

It tracks character relationship stats over time, stores them per AI message, visualizes progression, and can inject the current relationship state into prompts to keep behavior more coherent.

## Key Features

- Per-message tracker cards directly in chat
- Historical tracking (older AI messages keep their own past state)
- Group chat support (multiple character cards in one message)
- Scene activity detection (active vs inactive character state)
- Retrack button (regenerate tracker for last AI message)
- Relationship graph modal:
  - history window (`30 / 60 / 120 / all`)
  - raw/smoothed view
  - multi-stat lines (Affection/Trust/Desire/Connection)
- Prompt injection (optional) for behavior consistency
- Prompt templates (unified + per-stat) with per-prompt reset
- Mood source switch: BST mood images or ST expressions (emoji fallback always available)
- Interactive ST expression framing editor with live preview (global + per-character override)
- Click-to-preview mood image lightbox (click image to open, click preview to close)
- Framing modal includes `Preview Character` selector under the preview (global mode)
- Global preview candidates skip characters currently resolved to `BST mood images`
- Global preview sprite scan ignores BST mood-image assets with `bst_` prefix
- Strong diagnostics/debug dump for bug reports
- Mobile-friendly settings and graph modals
- Settings section drawers collapsed by default
- Single-click Stop now hard-cancels the current extraction run (workers + retries)

## Screenshots

1. Tracker cards in chat  
![Tracker cards in chat](docs/screenshots/tracker-cards-chat.png)

2. Tracker cards (group chat)  
![Tracker cards (group chat)](docs/screenshots/tracker-cards-group-chat.png)

3. Collapsed tracker cards  
![Collapsed tracker cards](docs/screenshots/tracker-cards-collapsed.png)

4. Tracker graph  
![Tracker graph](docs/screenshots/tracker-graph-desktop.png)

5. Settings modal  
![Settings modal](docs/screenshots/settings-modal-desktop.png)

## What It Tracks

- `Affection`: emotional warmth and care
- `Trust`: safety, reliability, willingness to open up
- `Desire`: attraction and flirt/sexual tension
- `Connection`: bond depth and emotional attunement
- `Mood`: short-term emotional tone
- `Last Thought`: short internal state line

## Installation

Install directly from the GitHub repo in SillyTavern:

1. Copy this repository URL: `https://github.com/ghostd93/BetterSimTracker`
2. In SillyTavern, open Extensions (stacked cubes) -> `Install Extension`
3. Paste the repo URL and install (optionally pick branch/version)
4. Reload SillyTavern and enable `BetterSimTracker`

`dist` is committed to this repository, so users do not need to run a local build.

## Updating

Pull/update the extension to the latest commit in SillyTavern.

Hard refresh browser if old UI/assets are cached.

## Development (Contributors)

Only needed if you are editing TypeScript source and regenerating `dist`:

```bash
npm install
npm run build
```

## Quick Usage

1. Send/generate an AI message.
2. Tracker appears under AI messages (not user messages).
3. Open extension settings from Extensions panel.
4. Optional:
   - enable prompt injection
   - tune extraction mode (unified/sequential)
   - enable debug if you need diagnostics
5. Use graph button on a character card to view relationship trends.

## Workflow (Visual)

### 1) Tracker Generation Flow

```mermaid
flowchart TD
  A[AI message is generated] --> B{Trackable AI message?}
  B -- No --> Z[Skip tracker update]
  B -- Yes --> C[Resolve active characters]
  C --> D[Load previous tracker state]
  D --> E[Build extraction prompt]
  E --> F[Model returns JSON: deltas, mood, lastThought, confidence]
  F --> G[Parse and validate fields]
  G --> H[Apply numeric updates with confidence scaling]
  H --> I[Apply mood and lastThought rules]
  I --> J[Merge with previous values for missing fields]
  J --> K[Save snapshot to message/chat metadata/local storage]
  K --> L[Render tracker cards + graph]
```

### 2) Stat Calculation Flow

```mermaid
flowchart TD
  A[Inputs: previous value, parsed delta, parsed confidence] --> B{Confidence present?}
  B -- No --> C[Use confidence fallback: 0.8]
  B -- Yes --> D[Use parsed confidence]
  C --> E[Clamp confidence to range 0 to 1]
  D --> E
  E --> F[Clamp delta using Max Delta Per Turn]
  F --> G[Compute scale from confidence and dampening]
  G --> H[Compute scaled delta]
  H --> I[Compute next value and clamp to 0 to 100]
  I --> J[Save numeric stat]
  A --> K[For mood: compare confidence vs Mood Stickiness]
  K --> L{confidence < Mood Stickiness?}
  L -- Yes --> M[Keep previous mood]
  L -- No --> N[Apply parsed mood]
  M --> O[Save mood]
  N --> O
```

Numeric scaling formula used by runtime:

`scale = (1 - confidenceDampening) + confidence * confidenceDampening`  
`scaledDelta = round(clampedDelta * scale)`  
`nextStat = clamp(previousStat + scaledDelta, 0, 100)`

## Important Behavior Notes

- Tracker ignores generated-media/system image messages (for example SD image posts).
- Tracker progress should appear only for valid AI tracking targets.
- Automatic tracker extraction starts ~2 seconds after AI generation ends (waiting state stays visible during this delay).
- On the first post-generation extraction in a chat (no previous snapshot), sequential mode is forced to one request at a time for stability.
- Tracker progress includes a Stop button to cancel extraction.
- On reload, tracker state is restored from saved chat metadata/message data.
- If extraction fails, provisional baseline values are not saved as final tracker state.

## Settings Overview

- `Sequential Extraction`: one request per stat (more robust, slower)
- `Unified Extraction`: one combined request (faster)
- `Max Concurrent Requests`: parallelism in sequential mode
- `Strict JSON Repair`: retries if model output is invalid
- `Auto Detect Active`: scene-based active character detection
- `Inject Tracker Into Prompt`: uses current relationship state as hidden guidance
- `Injection Prompt Template`: editable template for injected guidance (shown only when injection is enabled)
- `Prompt Templates`: edit unified + per-stat sequential prompt instructions (protocol blocks are fixed; repair prompts are fixed)
- `Profile Token Limits`: extraction now respects profile max tokens and truncation length (when available)
- `Max Tokens Override`: force max tokens for extraction (0 = auto)
- `Context Size Override`: force truncation length for extraction (0 = auto)
- `Include Character Cards in Extraction Prompt`: optional extra grounding when recent context is thin

## Slash Commands

- `/bst status`: show enabled stats, mode, injection, debug, and last tracked message index.
- `/bst extract`: manual extraction on the latest AI message.
- `/bst clear`: clear tracker data for the current chat.
- `/bst toggle <stat>`: toggle `affection|trust|desire|connection|mood|lastThought`.
- `/bst inject on|off`: toggle prompt injection.
- `/bst debug on|off`: toggle debug mode.

## Settings Reference (Detailed)

### Extraction

- `Connection Profile`: use a specific SillyTavern connection profile for tracker extraction. Empty = active profile.
- `Sequential Extraction (per stat)`: one prompt per stat (`affection`, `trust`, `desire`, `connection`, `mood`, `lastThought`). Slower, usually more robust parsing.
- `Max Concurrent Requests`: only used in sequential mode. Controls parallel request count.
- `Strict JSON Repair`: retry/repair logic when model output is malformed or missing required fields.
- `Max Retries Per Stat`: max additional retry attempts per stage after the initial generation.
- `Context Messages`: number of recent chat messages included in extraction context.
- `Max Delta Per Turn`: hard clamp for how much one update can change a numeric stat.
- `Confidence Dampening`: scales delta strength by model confidence.
- `Mood Stickiness`: keeps mood stable unless model confidence/context strongly supports change.
- `Inject Tracker Into Prompt`: inject hidden relationship state guidance into chat generation prompts.
- `Injection Prompt Template`: editable template that defines the injected guidance block (shown only when injection is enabled).
- `Auto Detect Active`: in group chat, tries to determine which characters are currently active in the scene.
- `Activity Lookback`: recent-message window used for active character detection.
- `Prompt Templates`: unified prompt instruction for one-shot extraction, per-stat instructions for sequential mode.
  - Each prompt has a reset-to-default button.
  - Protocol blocks (JSON shape, constraints) are fixed for safety and consistency.
  - A hidden main prompt is always prefixed to extraction prompts (not shown in settings).
  - Strict/repair prompts are fixed for safety and consistency.
- `Profile Token Limits`: extraction uses the selected connection profile's max token and truncation limits when available. If missing, it falls back to the active preset values, and finally to a safe default.
- `Max Tokens Override`: set a fixed token limit for extraction requests. Use `0` to keep profile/preset defaults.
- `Context Size Override`: set a fixed truncation length for extraction context. Use `0` to keep profile/preset defaults.
- `Include Character Cards in Extraction Prompt`: appends card description/personality/scenario to extraction context for disambiguation only.

Model confidence behavior:

- The model returns a per-character `confidence` value in range `0..1`.
- Numeric deltas are scaled by that confidence via `Confidence Dampening`:
  - `0` dampening = ignore confidence.
  - `1` dampening = fully trust confidence scaling.
- `Mood Stickiness` uses confidence as a gate: low confidence keeps previous mood.
- If confidence is missing for a character, runtime fallback is `0.8`.

### How Stat Updates Are Applied (Exact Runtime Logic)

For each active character and numeric stat (`affection`, `trust`, `desire`, `connection`):

1. Read previous value:
   - from prior tracker state for that character, else stat default.
2. Read model delta and clamp:
   - `boundedDelta = clamp(delta, -MaxDeltaPerTurn, +MaxDeltaPerTurn)`
3. Read confidence:
   - parsed `confidence` in `0..1`, fallback `0.8` if missing.
4. Compute scale:
   - `scale = (1 - ConfidenceDampening) + confidence * ConfidenceDampening`
5. Apply:
   - `scaledDelta = round(boundedDelta * scale)`
   - `next = clamp(previous + scaledDelta, 0, 100)`

Behavior notes:

- `ConfidenceDampening = 0`: confidence has no effect (`scale = 1`).
- `ConfidenceDampening = 1`: confidence fully controls delta strength (`scale = confidence`).
- Mood is not delta-based:
  - if `confidence < MoodStickiness`, keep previous mood;
  - otherwise apply parsed mood.
- `lastThought` is direct text replacement when present.
- Missing parsed fields keep prior values via merge fallback.

### Extraction Priority (Actual Runtime Logic)

1. Extraction runs only after a valid chat generation cycle that rendered a new AI character message.
2. Target message selection:
   - explicit message index (edit/swipe/manual target) if provided and trackable,
   - otherwise latest trackable AI message.
3. Trackable AI message means:
   - not user message,
   - not system message,
   - not generated-media/system image attachment message.
4. Existing tracker data is not overwritten unless trigger is forced (`manual_refresh`, edit/swipe events).
5. Active characters are resolved first (`Auto Detect Active` + `Activity Lookback`).
6. Enabled stats are requested in fixed order:
   - `affection`, `trust`, `desire`, `connection`, `mood`, `lastThought`
7. Mode behavior:
   - Unified mode: one prompt for all enabled stats.
   - Sequential mode: one prompt per stat; with concurrency > 1, stages run in parallel (finish order not guaranteed).
8. Retry chain per stage (when `Strict JSON Repair` is enabled):
   - initial generation,
   - strict JSON retry,
   - stat-specific repair retry (`mood` / `lastThought` only),
   - additional strict retries until retry budget is exhausted.
9. Application rules:
   - Numeric stats use deltas from previous values, clamped by `Max Delta Per Turn`, then confidence-scaled by `Confidence Dampening`.
   - `mood` uses `Mood Stickiness` (low confidence can keep previous mood).
   - Missing parsed fields keep previous values via merge fallback.

### Tracked Stats

- `Track Affection`
- `Track Trust`
- `Track Desire`
- `Track Connection`
- `Track Mood`
- `Track Last Thought`
- `Mood Source` (`BST mood images` or `ST expressions`)
- `Global Mood -> ST Expression Map` (editable in settings when `Mood Source = ST expressions`)
- `Preview Character` selector (inside framing modal, below preview): includes only characters with ST expressions and drives global framing preview
- `Adjust ST Expression Framing` button (opens interactive zoom/X/Y preview editor when `Mood Source = ST expressions`)
  - X/Y positioning works at all zoom levels (including `1.0`) with zoom-aware framing behavior at higher zoom levels
  - Framer preview and tracker cards use the same positioning math, so preview framing matches tracker rendering
  - Positioning uses zoom-aware pan compensation (`object-position` + translated scale), and existing tracker cards update immediately when framing is changed

You can disable any metric you do not want extracted. Disabled stats stop updating on future extractions; historical cards and graphs still show recorded values. Prompt injection uses only enabled stats.

### Display

- `Show Inactive`: show cards for inactive/off-scene characters.
- `Inactive Label`: label text used for inactive cards.
- `Show Last Thought`: show/hide `lastThought` text on cards.
- `Accent Color`: primary UI accent for bars/buttons/highlights.
- `Card Opacity`: tracker card opacity.
- `Border Radius`: tracker card corner radius.
- `Font Size`: base tracker text size.

### Debug

- `Debug`: enables verbose diagnostics behavior.
- `Include Context In Diagnostics`: include extraction prompt/context text in dumps (larger output, potentially sensitive).
- `Include Graph Data In Diagnostics`: include graph series payloads in diagnostics.
- `Retrack` (`refresh icon`): regenerate tracker for the last AI message.
- `Delete Tracker Data (Current Chat)`: remove tracker data only for current chat.
- `Dump Diagnostics`: copy full diagnostics JSON to clipboard.
- `Clear Diagnostics`: clear stored debug traces/last debug record.

### Prompt Templates (Editable)

Two editable prompt types are supported:

- Unified prompt: used when sequential extraction is off.
- Per-stat prompts: used in sequential mode (`affection`, `trust`, `desire`, `connection`, `mood`, `lastThought`).
- Default desire prompt guardrail: only increase desire when the recent messages are explicitly romantic/sexual; non-romantic context should be 0 or negative.

Each prompt instruction can be reset to its default with the per-prompt reset button. Protocol blocks are read-only.

Available placeholders:

- `{{envelope}}`: prebuilt header that already includes user/character names and recent messages.
- `{{userName}}`: current user name.
- `{{characters}}`: comma-separated character names.
- `{{contextText}}`: raw recent messages text.
- `{{currentLines}}`: current tracker state lines.
- `{{historyLines}}`: recent tracker snapshot lines.
- `{{numericStats}}`: requested numeric stats list.
- `{{textStats}}`: requested text stats list.
- `{{maxDelta}}`: configured max delta per turn.
- `{{moodOptions}}`: allowed mood labels.

Note: strict/repair prompts are not editable.

### Character Defaults (Advanced Card Definitions)

Per-character defaults can be set in character card Advanced definitions:

- `affection`
- `trust`
- `desire`
- `connection`
- `mood`

Direct key path:

- `extensions.bettersimtracker.defaults`

Optional per-character mood source keys:

- `moodSource`: `bst_images` or `st_expressions`
- `moodExpressionMap`: mood label to ST expression label map (per mood, optional)
  - Character-level values override the global map from extension settings
  - Empty character-level values fall back to the global map, then built-in defaults
- `stExpressionImageOptions`: optional framing override for ST expressions:
  - `zoom`
  - `positionX`
  - `positionY`
  - UI path: enable `Advanced image options (override global)` and use `Adjust ST Expression Framing`
  - Character defaults framing preview uses one of that character's ST expression sprites
  - `moodSource = st_expressions` is blocked when the character has no ST expression sprites
  - In Advanced Definitions UI, ST-expression mapping/framing controls are shown only when the effective mood source resolves to `st_expressions`
  - BST mood-image upload controls are shown only when the effective mood source resolves to `bst_images`

Character-default records are resolved by stable character identity first (avatar), with legacy name-based fallback, so group-card and character-list entry paths stay consistent.
In Advanced Definitions, the panel also follows the character ST reports as currently opened in the editor to avoid group-chat context bleed.

If no advanced defaults are present, tracker baseline falls back to contextual inference.

Mood images are optional per label; missing images fall back to emoji.  
When source is `st_expressions`, tracker maps mood to expression and uses the character sprite if found; missing mappings/sprites also fall back to emoji.
For `st_expressions`, tracker uses face-focused framing (top-centered crop) to better match portrait-style sprites.
If no ST expression sprites are available, framing editor opens in notice-only mode with guidance to add at least one expression sprite.

## Troubleshooting

If something looks wrong:

1. Enable `Debug`.
2. Use the debug category toggles to limit logs to the area you need.
2. Reproduce the issue once.
3. Click `Dump Diagnostics`.
4. Share the diagnostics output.

Common checks:

- Wrong/empty tracker: verify selected connection profile and extraction settings.
- UI issues after update: hard refresh browser.
- Group edge cases: retrack last AI message once after major chat edits/swipes.

## License

This project is licensed under the MIT License. See `LICENSE`.


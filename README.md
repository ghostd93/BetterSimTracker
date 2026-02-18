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
- Strong diagnostics/debug dump for bug reports
- Mobile-friendly settings and graph modals

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

1. Copy this repository URL from GitHub
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

## Important Behavior Notes

- Tracker ignores generated-media/system image messages (for example SD image posts).
- Tracker progress should appear only for valid AI tracking targets.
- On reload, tracker state is restored from saved chat metadata/message data.

## Settings Overview

- `Sequential Extraction`: one request per stat (more robust, slower)
- `Unified Extraction`: one combined request (faster)
- `Max Concurrent Requests`: parallelism in sequential mode
- `Strict JSON Repair`: retries if model output is invalid
- `Auto Detect Active`: scene-based active character detection
- `Inject Tracker Into Prompt`: uses current relationship state as hidden guidance

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
- `Auto Detect Active`: in group chat, tries to determine which characters are currently active in the scene.
- `Activity Lookback`: recent-message window used for active character detection.

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

You can disable any metric you do not want extracted.

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

### Character Defaults (Advanced Card Definitions)

Per-character defaults can be set in character card Advanced definitions:

- `affection`
- `trust`
- `desire`
- `connection`
- `mood`

Direct key path:

- `extensions.bettersimtracker.defaults`

Priority order:

1. Character card Advanced definitions (`extensions.bettersimtracker.defaults`)
2. Contextual baseline inference

These defaults are used for initial tracker baseline (when there is no prior tracker state yet for that character/chat).

## Troubleshooting

If something looks wrong:

1. Enable `Debug`.
2. Reproduce the issue once.
3. Click `Dump Diagnostics`.
4. Share the diagnostics output.

Common checks:

- Wrong/empty tracker: verify selected connection profile and extraction settings.
- UI issues after update: hard refresh browser.
- Group edge cases: retrack last AI message once after major chat edits/swipes.

## License

This project is licensed under the MIT License. See `LICENSE`.


# CLAUDE.md

## Project Overview
Agricola Card Lookup — web app for exploring card rankings and AI-assisted drafting for the board game Agricola (4-player). Two main interfaces: a card rankings search page and an interactive draft tool with AI strategy advice.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (rankings page) + React 18 with Babel Standalone (draft tool)
- **Backend**: Azure Functions v2 (Node.js) — two endpoints: `/api/ocr` and `/api/strategy`
- **AI**: Azure OpenAI GPT-4o for OCR (card name extraction from screenshots) and strategy advice
- **Hosting**: Azure Static Web Apps (GitHub Actions auto-deploy on push to `main`)
- **No build step**: All frontend code served directly. React JSX transpiled in-browser by Babel.

## Dev Server
```bash
ruby -run -ehttpd . -p8080
```
Then visit `http://localhost:8080/draft.html` or `http://localhost:8080/index.html`.

Configured in `.claude/launch.json`. Alternative: `python3 .claude/serve.py`.

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Card rankings search interface (self-contained, vanilla JS) |
| `draft.html` | Draft tool (React 18 + Babel inline JSX, ~1950 lines of JSX) |
| `css/draft.css` | Draft tool styles |
| `js/script.js` | Rankings app logic (13K lines, card data embedded) |
| `js/screenshot-ocr.js` | Client-side OCR integration module |
| `js/strategy-advisor.js` | Client-side strategy API integration |
| `js/tag-definitions.js` | Strategy tag names, abbreviations, colors |
| `js/card-image-list.js` | Card image filename mapping |
| `api/strategy/index.js` | Azure Function: AI strategy advisor (system prompt + card index) |
| `api/ocr/index.js` | Azure Function: screenshot OCR via GPT-4o vision |
| `data/agricola-cards.json` | Master card database (808 cards). Duplicated at `api/data/` for Azure Functions. |
| `docs/agricola-strategy-guide.md` | Strategy framework embedded in AI system prompt |

## Architecture Conventions

### React in draft.html
- All React code lives in a single `<script type="text/babel">` block in draft.html
- Components are plain functions (no classes): `HandColumn`, `StrategyDashboard`, `CardSearch`, `PriorHands`, `YourHand`, `SummaryView`, `FarmGrid`, `CardDetailPopover`, etc.
- State managed via React hooks (`useState`, `useCallback`, `useMemo`)
- Draft state auto-saved to `localStorage` key `'agricola-draft-state'`
- External scripts loaded in `<head>`: React, ReactDOM, Babel, plus project JS files

### Azure Functions (api/)
- Each function has a folder with `function.json` (HTTP trigger config) + `index.js` (handler)
- No npm dependencies — uses Node.js built-in `fetch`
- Rate limiting is in-memory (resets on cold start)
- Card database loaded at module level (cold start only)
- Environment variables: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`

### CSS
- No framework — all custom CSS
- `css/style.css` for rankings page, `css/draft.css` for draft tool
- Class naming: `.draft-container`, `.hand-column`, `.card-row`, `.strategy-dashboard`, etc.

## Card Data Shape
```json
{
  "name": "Lover",
  "rank": 1,
  "pwr": "5.31",
  "adp": "1.55",
  "play_rate": "93%",
  "elo_per_play": "5.2",
  "type": "Occupation",
  "description": "...",
  "tags": ["Animal"],
  "cost": "",
  "vps": ""
}
```

## Card Intake (pulling submitted cards from GitHub issues)

New cards arrive as **open GitHub issues labeled `card-submission`**, titled `[Card Submission] <name>`. Each body has a human-readable table plus a machine-readable JSON block (`name`, `type`, `description`, `cost`, `prerequisites`, `vps`, `passing`, `card_id`, `tags`). List them with `gh issue list --label card-submission`.

**The intake JSON is unreliable** — submissions are OCR'd from card photos, so the parser routinely mangles data. **Never auto-import.** Always present the parsed cards to the user for **approve / deny / fix** review *before* writing anything to the data files.

### Process
1. Pull all open `card-submission` issues and lay them out for the user to approve / deny / fix (a review widget works well; a markdown table is fine too). Flag likely OCR errors so the user can spot-check.
2. **Approved** cards → append as-is. **Fix** cards → correct the text with the user (go 1-by-1; don't guess the physical card's wording — propose a correction and confirm). **Deny** cards → leave in the DB untouched.
3. **Before adding any card, check it doesn't already exist by name** — accounting for truncated names (e.g. "Petrified" was really the existing "Petrified Wood"). If it exists, close the issue as a duplicate instead of adding.
4. Append approved/fixed cards to **both** `data/agricola-cards.json` **and** `api/data/agricola-cards.json` — these two files must stay byte-identical. New cards get `rank: null` (and null for all stat fields: `adp`, `apr`, `play_rate`, `elo_per_play`, `value`, `value_when_played`); rankless cards sort to the bottom of the rankings.
5. Close the resolved issues (`gh issue close <n> --comment "..."`): added cards note they were imported; denies note they can be resubmitted; duplicates reference the existing card.

### Known OCR failure patterns (scrutinize these)
- **Dropped resource/point icons** → numbers with missing nouns ("place 2 ___", "worth 1 ___"). Infer from context (wood/stone/point) and confirm.
- **Wrong resource** → e.g. a card that should yield vegetables says "food"; the card *name* is often the tell.
- **Food icon misread as a VP** (and vice-versa) → e.g. Dwelling's "1 VP" was actually a 1-food cost.
- **Wrong card type** → e.g. Whisky Distiller came in as a Minor Improvement but is an Occupation. Type has consequences: **Occupations never have a cost, VP, or the passing flag, and never carry improvement-build prerequisites** ("N minor improvements"). Only Minor Improvements can be passing.
- **`passing` almost always submitted as `false`** regardless of truth — confirm per card (only minors can be passing).
- **Truncated names** → the issue title may be a fragment of the real card name.

## Draft Tool Concepts
- **Rounds 1-4**: New hands dealt. Hand sizes: 10/9/8/7. User picks 1 occ + 1 minor per round.
- **Rounds 5-7**: Hands return (minus cards taken by all players). "Marking phase" = user identifies which cards remain.
- **Hand rotation**: Hands 1-3 pass clockwise, return in rounds 5-7. Hand 4 appears only in round 4.
- **Strategy tags**: 11 archetypes (Day Laborer, Fishing, Big House, Small House, Stone House, Grain, Sow, Major/Minor, Lesson, Stable, Traveling Players). (Animal was retired as a draftable tag — animals are a farm backbone, not a tag-based engine.)

## AI Strategy System
- System prompt includes: role definition, JSON response schema, strategy guide (~260 lines), and a compact index of all 808 cards
- Response includes: `reasoning` (chain-of-thought), `archetypes`, `overall_analysis`, `dimensions` (with justifications), `risks`, `suggestions` (2 occs + 2 minors)
- Draft stage awareness: rounds 1-2 brief, 3-4 moderate, 5-7 full analysis

### Streaming architecture
The strategy call goes through SWA's `/api/strategy` proxy (not a hardcoded hostname). The Function App uses the v4 programming model and returns a `ReadableStream` body with `Content-Type: text/event-stream`, defeating the SWA 45s edge timeout regardless of model reasoning time.

Wire format: the Function App forwards Azure OpenAI's SSE delta stream as `event: token` events. When the model finishes, the server parses, normalizes suggestions, and emits `event: normalized` (canonical final state) then `event: done`. During the model's reasoning phase, `: keepalive` SSE comments fire every 3s to hold the connection open.

Client-side (`js/strategy-advisor.js`): `getAdvice` reads the SSE stream, calls `tryParsePartial()` on the accumulated text to emit progressive `onProgress(partial)` updates for the dashboard, then resolves with the `normalized` payload as the final state.

The `/api/probe-stream` endpoint (GET, anonymous) is a permanent smoke test: `curl --no-buffer https://draft.grics.site/api/probe-stream` should show 1s-spaced `: keepalive` lines confirming SWA still forwards SSE unbuffered. If this endpoint returns the entire body at once, the proxy layer has changed and the streaming architecture needs revisiting.

## Deployment
Push to `main` → GitHub Actions → Azure Static Web Apps. See `docs/azure-deployment-guide.md` for full setup.

## Testing
No automated tests. Manual verification via browser. `test-strategy.html` is a test harness for the strategy advisor.

## Session Checkpoint

**On session start**: If `PROGRESS.md` exists, read it before doing anything else to understand prior context.

When the user says **"checkpoint"**, write/overwrite `PROGRESS.md` in the project root with:

```
# Session Progress

## Date
<current date>

## Completed This Session
- <bulleted list of what was accomplished, with file paths>

## In Progress
- <anything partially done, with enough detail to resume>

## Pending / Next Steps
- <what the user asked for but hasn't been started>

## Key Decisions
- <any design choices or user preferences expressed during the session>

## Modified Files
- <list of files changed, with 1-line summary of each change>
```

Guidelines:
- Overwrite the file completely each time (it's a snapshot, not a log)
- Be specific about file paths and function names so a fresh session can find things fast
- Keep each bullet to 1-2 lines
- Include the user's stated priorities if they mentioned any

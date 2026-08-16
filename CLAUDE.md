# CLAUDE.md

## Project Overview
Agricola Card Lookup — web app for exploring card rankings and AI-assisted drafting for the board game Agricola. Supports 3- and 4-player drafts. Two main interfaces: a card rankings search page and an interactive draft tool with AI strategy advice.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (rankings page) + React 18 with Babel Standalone (draft tool)
- **Backend**: Azure Functions **v4 programming model** (Node.js) — five endpoints: `/api/strategy`, `/api/ocr`, `/api/draft`, `/api/submit-card`, `/api/probe-stream`
- **AI**: Azure OpenAI GPT-4o for OCR (card name extraction from screenshots) and strategy advice
- **Auth**: GitHub OAuth via Azure Static Web Apps built-in auth. Only `/api/draft/*` requires a login; everything else is anonymous. Config in `staticwebapp.config.json`.
- **Hosting**: Azure Static Web Apps (GitHub Actions auto-deploy on push to `main`)
- **No build step**: All frontend code served directly. React JSX transpiled in-browser by Babel.
  - **Babel is pinned to `@babel/standalone@7`.** Babel 8 defaults to the automatic JSX runtime, which emits `import` statements that break the inline classic `<script type="text/babel">` block and render a blank page. Do not drop the `@7` pin.

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
| `draft.html` | Draft tool (React 18 + Babel inline JSX, ~3200 lines) |
| `css/style.css` / `css/draft.css` | Rankings page / draft tool styles |
| `js/script.js` | Rankings app logic (13.5K lines, card data embedded) |
| `js/draft-stats.js` | Hand grades, card quality indicators, tag probability (analytical — order statistics + hypergeometric, no simulation) |
| `js/draft-sync.js` | Cloud draft save/load against `/api/draft`, reads `/.auth/me` |
| `js/screenshot-ocr.js` | Client-side OCR integration module |
| `js/strategy-advisor.js` | Client-side strategy API integration (SSE consumer) |
| `js/tag-definitions.js` | Strategy tag names, abbreviations, colors |
| `js/card-image-list.js` | Card image filename mapping + `CARD_IMAGE_OVERRIDES` |
| `api/src/index.js` | **Functions v4 entry point** (`main` in `api/package.json`) — calls `app.setup({ enableHttpStream: true })` and registers every function |
| `api/src/v3-adapter.js` | Wraps legacy v3 handlers so they survive `enableHttpStream` |
| `api/src/functions/*.js` | Thin v4 registration shims for `ocr`, `draft`, `submit-card`, plus the native `probe-stream` |
| `api/strategy/index.js` | AI strategy advisor (system prompt + card index). Registers itself as v4 natively. |
| `api/ocr/index.js` | Screenshot OCR via GPT-4o vision (v3-style handler) |
| `api/draft/index.js` | Draft cloud sync, backed by Azure Table Storage (v3-style handler) |
| `api/submit-card/index.js` | Creates `card-submission` GitHub issues (v3-style handler) |
| `data/agricola-cards.json` | Master card database (820 cards). **Duplicated byte-identical at `api/data/`.** |
| `docs/agricola-strategy-guide.md` | Strategy framework embedded in AI system prompt. **Duplicated byte-identical at `api/docs/`.** |
| `staticwebapp.config.json` | SWA auth providers, route roles, navigation fallback |
| `scripts/merge_rankings.py` | Merges refreshed ranking exports into the card DB |

## Architecture Conventions

### React in draft.html
- All React code lives in a single `<script type="text/babel">` block in draft.html
- Components are plain functions (no classes): `HandColumn`, `StrategyDashboard`, `CardSearch`, `PriorHands`, `YourHand`, `SummaryView`, `FarmGrid`, `CardDetailPopover`, etc.
- State managed via React hooks (`useState`, `useCallback`, `useMemo`)
- Draft state auto-saved to `localStorage` key `'agricola-draft-state'`
- External scripts loaded in `<head>`: React, ReactDOM, Babel, plus project JS files

### Azure Functions (api/)
Uses the **v4 programming model**. There are no `function.json` files — every function is registered in code.

- `api/src/index.js` is the entry point (`"main": "src/index.js"` in `api/package.json`). It calls `app.setup({ enableHttpStream: true })` — required for `ReadableStream` response bodies to actually stream instead of being buffered — then `require`s each function module to register it.
- **Adding a function**: create the handler, then add a `require` to `api/src/index.js`. Nothing is auto-discovered.
- **Two handler styles coexist.** `api/strategy/index.js` is native v4 (`app.http(...)`, takes `(request, context)`). `ocr`, `draft`, and `submit-card` are still v3-style (`async (context, req)` mutating `context.res`) and are registered through `adaptV3()` in `api/src/v3-adapter.js` via shims in `api/src/functions/`. `enableHttpStream` changes the request shape for *every* HTTP trigger in the worker, which is why the legacy handlers need the adapter rather than running as-is.
- **Dependencies** (`api/package.json`): `@azure/functions` and `@azure/data-tables` (draft storage). HTTP calls still use Node's built-in `fetch`.
- Rate limiting is in-memory (resets on cold start)
- Card database loaded at module level (cold start only)
- Environment variables: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_STRATEGY_DEPLOYMENT` (strategy can run a different model than OCR), `GITHUB_TOKEN` + `GITHUB_REPO` (submit-card), `DRAFTS_STORAGE_CONNECTION_STRING` (draft sync)

### Duplicated files (keep byte-identical)
The Functions runtime can't read outside `api/`, so two files exist in both places. **Edit both, always:**

| Frontend copy | API copy |
|---|---|
| `data/agricola-cards.json` | `api/data/agricola-cards.json` |
| `docs/agricola-strategy-guide.md` | `api/docs/agricola-strategy-guide.md` |

Verify with `diff -q` on both pairs before committing.

### CSS
- No framework — all custom CSS
- `css/style.css` for rankings page, `css/draft.css` for draft tool
- Class naming: `.draft-container`, `.hand-column`, `.card-row`, `.strategy-dashboard`, etc.

## Card Data Shape
```json
{
  "name": "Lover",
  "card_id": "C127",
  "type": "Occupation",
  "description": "When you play this card, immediately pay ...",
  "cost": "",
  "vps": "",
  "prerequisites": "",
  "passing": false,
  "tags": [],
  "rank": 1,
  "adp": "1.55",
  "apr": "8.87",
  "play_rate": "93%",
  "elo_per_play": "5.20",
  "value": "8.06",
  "value_when_played": "5.6",
  "stats_3p": {
    "rank": 284,
    "adp": "3.17",
    "apr": "10.36",
    "play_rate": "58%",
    "elo_per_play": "-1.10",
    "value": "-3.487",
    "value_when_played": "-1.9"
  }
}
```

- `name` is the primary key — see the uniqueness rule under Card Intake.
- Numeric stats are **strings**, not numbers. `rank` is the one number. Parse before comparing.
- Top-level stats are **4-player**. `stats_3p` mirrors them for 3-player mode; the draft tool swaps which set it reads based on player count. A card may have top-level stats but no `stats_3p`.
- Newly imported cards have `rank: null` and null for every stat field.

## Card Intake (pulling submitted cards from GitHub issues)

New cards arrive as **open GitHub issues labeled `card-submission`**, titled `[Card Submission] <name>`. Each body has a human-readable table plus a machine-readable JSON block (`name`, `type`, `description`, `cost`, `prerequisites`, `vps`, `passing`, `card_id`, `tags`). List them with `gh issue list --label card-submission`.

**The intake JSON is unreliable** — submissions are OCR'd from card photos, so the parser routinely mangles data. **Never auto-import.** Always present the parsed cards to the user for **approve / deny / fix** review *before* writing anything to the data files.

### Process
1. Pull all open `card-submission` issues and lay them out for the user to approve / deny / fix (a review widget works well; a markdown table is fine too). Flag likely OCR errors so the user can spot-check.
2. **Approved** cards → append as-is. **Fix** cards → correct the text with the user (go 1-by-1; don't guess the physical card's wording — propose a correction and confirm). **Deny** cards → leave in the DB untouched.
3. **Before adding any card, check it doesn't already exist by name** — accounting for truncated names (e.g. "Petrified" was really the existing "Petrified Wood"). If it exists, close the issue as a duplicate instead of adding.
   - **`name` must be unique across the DB** — it's the lookup key for hands, saved drafts, the strategy API, and OCR results. Agricola does print two different cards as "Market Stall" (C054 and B008); the B008 entry is stored as `Market Stall (B008)` for this reason. If a genuinely new card collides with an existing name, disambiguate the newcomer the same way and add its `card_id` to `CARD_IMAGE_OVERRIDES` in `js/card-image-list.js` so it resolves to its own art. `scripts/merge_rankings.py` refuses to run while a duplicate name exists.
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
- **7 rounds**, 1 occupation + 1 minor picked per round. Hand sizes by round: `HAND_SIZE_BY_ROUND = 10/9/8/7/6/5/4`.
- **New vs. returning hands**: early rounds deal fresh hands; later rounds return a hand the user has seen before, minus everything taken since. "Marking phase" = the user identifies which cards remain in a returning hand.
- **Hand rotation depends on player count** — see `getRotation(playerCount)` near the top of `draft.html`:
  - **4p**: hands `1,2,3,4,1,2,3`. Hands 1-3 come back in rounds 5-7; hand 4 appears only in round 4. First returning round is 5.
  - **3p**: hands `1,2,3,1,2,3,1`. Hand 1 is seen three times (rounds 1, 4, 7). First returning round is **4**.
  - Helpers: `getHandNumber(round, playerCount)`, `getPassNumber(round, playerCount)` (which visit of that hand this is).
- **Player count also switches the stat set** — 3-player drafts read `stats_3p` instead of the top-level 4p stats.
- **Strategy tags**: 11 archetypes (Day Laborer, Fishing, Big House, Small House, Stone House, Grain, Sow, Major/Minor, Lesson, Stable, Traveling Players), defined in `js/tag-definitions.js`. (Animal was retired as a draftable tag — animals are a farm backbone, not a tag-based engine.)

## AI Strategy System
- System prompt includes: role definition, JSON response schema, strategy guide, and a compact index of all 820 cards
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

Cheap pre-commit checks worth running:
```bash
node --check api/strategy/index.js && diff -q data/agricola-cards.json api/data/agricola-cards.json && diff -q docs/agricola-strategy-guide.md api/docs/agricola-strategy-guide.md
```

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

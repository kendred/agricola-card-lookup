# Agricola Card Lookup

Card rankings and an AI-assisted draft tool for the board game **Agricola**. Covers 820 cards with competitive-play statistics for both 3- and 4-player games.

Live at [draft.grics.site](https://draft.grics.site).

## The two apps

### Rankings (`index.html`)
A searchable, sortable, filterable table of every card.

- Autocomplete search by card name
- Sort by any metric (rank, ADP, Elo/play, draft value, play rate)
- Filter by card type (Occupation / Minor Improvement), passing status, and strategy tag
- Colour gradients on the numeric columns for at-a-glance comparison
- Card images and full rules text
- Unranked (newly submitted) cards sort to the bottom

### Draft tool (`draft.html`)
Tracks a single player's perspective through a 7-round Agricola draft.

- **3- and 4-player** rotations, with the stat set switching to match
- Build hands by search, or paste/upload a Board Game Arena screenshot and let OCR read it
- Per-hand grades and per-card quality indicators (`js/draft-stats.js` — analytical, using order statistics and the hypergeometric distribution)
- Tracks prior hands, what opponents took, and what's likely to wheel back
- **AI strategy advisor**: streaming analysis of your draft with archetype detection, coverage dimensions, risks, and ranked pick suggestions
- Post-draft summary with opponent-card tracking and a farm-layout planner
- Auto-saves to `localStorage`; optional cloud sync across devices after signing in with GitHub

## Running locally

```bash
ruby -run -ehttpd . -p8080
```

Then open <http://localhost:8080/index.html> or <http://localhost:8080/draft.html>.

There is **no build step** — everything is served as-is, and the draft tool's JSX is transpiled in the browser by Babel Standalone. A Python alternative lives at `.claude/serve.py`.

The AI features (`/api/strategy`, `/api/ocr`) call deployed Azure Functions, so they need either a local Functions host (`cd api && npm start`) or a deployed backend.

## Layout

```
index.html            Rankings page
draft.html            Draft tool (React 18 + inline Babel JSX)
css/                  style.css (rankings), draft.css (draft tool)
js/                   App logic — card data, stats, OCR, strategy, cloud sync
data/                 agricola-cards.json — the card database
card-images/          716 card scans
api/                  Azure Functions (v4 model) — strategy, ocr, draft, submit-card
docs/                 Feature specs, deployment guides, the strategy guide
scripts/              Python utilities for data maintenance
```

`data/agricola-cards.json` and `docs/agricola-strategy-guide.md` are each duplicated under `api/` because the Functions runtime can't read outside its own folder. Both pairs must stay byte-identical.

## Stack

Vanilla HTML/CSS/JS and React 18 on the front end; Azure Functions (Node.js, v4 programming model) on the back; Azure OpenAI GPT-4o for OCR and strategy. Hosted on Azure Static Web Apps, auto-deployed by GitHub Actions on every push to `main`.

The strategy endpoint streams over SSE to sidestep the Static Web Apps 45-second edge timeout. `/api/probe-stream` is a permanent smoke test for that path:

```bash
curl --no-buffer https://draft.grics.site/api/probe-stream
```

Keepalive lines should arrive one per second. If the whole body lands at once, the proxy layer changed and streaming needs revisiting.

## Contributing cards

Cards missing from the database can be added from inside the draft tool — unrecognized entries are filed as GitHub issues labeled `card-submission` for review. Submissions are OCR'd from photos and are reviewed by hand before import; see the Card Intake section of `CLAUDE.md`.

## Docs

- `CLAUDE.md` — architecture, conventions, and working process
- `docs/azure-deployment-guide.md` — full hosting setup
- `docs/agricola-strategy-guide.md` — the strategy framework behind the AI advisor
- `docs/*-spec.md` — feature specs for the draft tool, tagging, OCR, strategy, and card submission

## Data source

Card rankings and statistics come from competitive Agricola play data.

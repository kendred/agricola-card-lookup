# Card Submission Pipeline — Spec & Architectural Writeup

## Problem Statement

New Agricola cards keep getting added to the game that aren't in our 773-card database (`data/agricola-cards.json`). Users can add these as "temporary cards" in the draft tool, but the data disappears with their browser session. We want to capture these submissions so the admin can review and permanently add them to the database — without allowing arbitrary writes that could corrupt the data.

## Solution Overview

A **moderation queue** backed by GitHub Issues. When a user adds an unrecognized card in the draft tool, the client fires a background request to a new Azure Function (`/api/submit-card`), which creates a GitHub Issue with the card's details. The admin reviews issues at their leisure and batch-adds approved cards to the JSON database.

```
┌──────────────┐     POST /api/submit-card         ┌──────────────────┐
│  Browser      │ ─────────────────────────────────► │  Azure Function   │
│  (draft.html) │  { name, type, description,       │  submit-card/     │
│               │    cost, prerequisites, vps }     │                   │
└──────────────┘                                   └────────┬─────────┘
                                                            │
                                             Validates ──► Deduplicates ──► Creates Issue
                                                            │
                                                            ▼
                                                   ┌────────────────────┐
                                                   │  GitHub Issues      │
                                                   │  label:             │
                                                   │  "card-submission"  │
                                                   └────────┬───────────┘
                                                            │
                                                       Admin reviews
                                                            │
                                                            ▼
                                                   ┌────────────────────┐
                                                   │  agricola-cards.json│
                                                   │  (manual update)    │
                                                   └────────────────────┘
```

## Why This Approach (and Why Not Others)

### Why GitHub Issues?

**No new infrastructure.** The project already deploys via GitHub Actions to Azure Static Web Apps. GitHub Issues are free, already available, and come with a built-in review UI. Adding Azure Blob Storage or Table Storage would mean provisioning a new service, managing connection strings, and building an admin interface from scratch. GitHub Issues give us all of that for free.

**Built-in deduplication.** The GitHub Search API lets us check "has this card already been submitted?" before creating a new issue. No need to build our own uniqueness logic in a database.

**Audit trail.** Every submission has a timestamp, and the issue body contains structured data. If we ever need to trace when a card was first reported, it's right there.

**Scriptable batch-approve.** Each issue contains a ```json block with machine-readable card data. A future script could read all open issues with the `card-submission` label, parse the JSON, and generate the additions to `agricola-cards.json` automatically.

### Why not auto-update the database?

Security. If the endpoint directly wrote to the card database, anyone could submit fake cards (or worse, malformed data) that would appear for all users. The manual review step is a deliberate chokepoint — it trades convenience for data integrity.

### Why not client-side-only (localStorage export)?

It only captures cards from one browser. If other people use the draft tool and encounter new cards, their data would be lost. The server-side approach captures submissions from all users.

## Fields We Capture

The existing card schema (in `data/agricola-cards.json`) has many fields, but not all of them are user-capturable. Here's the breakdown of what the submission flow captures and why:

| Field | Source | Why |
|-------|--------|-----|
| `name` | 🧑 User-captured | Visible on the card; required |
| `type` | 🧑 User-captured | "Occupation" or "Minor Improvement" — user selects from toggle |
| `description` | 🧑 User-captured | Visible on the card; the rules text |
| `cost` | 🧑 User-captured (new) | Visible on the card (e.g., "1 wood"); surfaced in popovers |
| `prerequisites` | 🧑 User-captured (new) | Visible on the card (e.g., "3 occupations"); surfaced in popovers + filters |
| `vps` | 🧑 User-captured (new) | Visible on the card; surfaced in popovers |
| `passing` | 🤖 Auto-derived | Detected from the description text: if it contains the standard phrase "pass it to the player on your left" (case-insensitive), set `passing: true`. See "Auto-derivation" below. |
| `tags` | 👤 Admin-assigned | Strategy archetype classification; requires admin judgment at review time |
| `card_id` | 👤 Admin-assigned | Internal identifier; admin assigns at approval time |
| `rank`, `pwr`, `adp`, `play_rate`, `elo_per_play`, `value`, `value_when_played` | 📊 Analytics-derived | Not available until the card has been played in ranked games |

**Key insight:** Every user-capturable field is already surfaced in the UI (card popovers in both draft.html and index.html, rankings-page filters, and the AI strategy prompt in `api/strategy/index.js`). The schema supports them; they just haven't been populated on existing cards. That means once we start capturing these on new submissions, the UI handles them automatically — no display logic changes needed.

### Data source investigation (resolved)

**Initial concern:** The current `agricola-cards.json` was thought to be a join of a broader card database with a narrower ranking database, which would mean some "unrecognized" cards might already exist in the broader source and just need to be un-filtered.

**Finding after investigating the repo:** There is **only one card data file** in the repo — `data/agricola-cards.json` (with an `api/data/` duplicate for Azure Functions). No broader card database file exists locally. The Python scripts in `scripts/` (match_cards, fuzzy_rename, match_analysis, add-tags) all operate on this same single file.

However, the intuition about "stowaway" entries was partially correct. The DB can contain entries that are effectively filtered out of the UI even though they're technically present:

- The March 2026 commit *"Fix for clay carrier and pastor - not appearing in draft tool"* changed those cards' `type` from `"Unknown"` to `"Occupation"`. They were in the DB the whole time — the draft tool filters on `type === 'Occupation' || type === 'Minor Improvement'`, so anything with `type: "Unknown"` is invisible.
- "Clay Carrier" still has an empty `card_id`, meaning the ingestion process wasn't always clean.
- All 773 cards currently have proper types, so this category is empty today — but the mechanism remains.

**Card IDs come from an external source.** They follow an `A/B/C/D/E` prefix pattern with ~150-160 cards per group, totaling 773. This is almost certainly an external numbering scheme (likely 5 expansion decks or a BGA internal ID system).

### Resolved decisions

1. **`card_id` is admin-assigned at review (null-by-default).** The submission function does not generate card IDs. During review, the admin fills it in by looking up the external source if available, or leaves it null. Some existing cards already have empty `card_id`, so null is a valid value.

2. **Dedup check stays as-is** — the Azure Function already checks against `api/data/agricola-cards.json`, which is the single source of truth. No change needed.

3. **Filter-aware dedup (small enhancement).** The current planned dedup check is a simple name match. Because cards can exist in the DB but be hidden by bad `type` values, we should match **regardless of type** — e.g., a card with `type: "Unknown"` should still be detected as a duplicate when a user submits it. This is already the default behavior of a name-only lookup, so no extra work required, just worth noting.

### Future consideration

If you can identify and re-access the upstream card data source (whatever provided the A/B/C/D/E card IDs), a periodic re-ingest script could pull in new cards in bulk rather than relying solely on user-submission accumulation. Lower priority — user submissions plus manual review handle the new-card problem adequately. Parking for later.

### Auto-derivation: the `passing` flag

Every Agricola "passing" card contains a standardized text block near the bottom: **"AFTER YOU PLAY THIS CARD, PASS IT TO THE PLAYER ON YOUR LEFT, WHO ADDS IT TO THEIR HAND."** This phrase is the canonical game-mechanic description for passing cards — it's identical across all 42 passing cards currently in the database.

Because the phrase is standardized, we can derive `passing` reliably from the description with a simple case-insensitive substring match rather than asking the user to tag it or relying on a vision model to pick up the small arrow glyph on the card.

**Why not vision-based detection of the arrow icon?** The arrow is small and sits in a cramped header area of each card. On BGA screenshots (which are low-resolution and densely packed), smaller vision models like GPT-4o-mini are hit-or-miss on small glyphs. Text, in contrast, is normalized, searchable, and what the model is strongest at. The phrase-match approach is both more reliable and cheaper.

**Where does the derivation happen?** Two reasonable options:
1. **In the Azure Function**, at submission time — set `passing: true` in the JSON block embedded in the GitHub Issue body, so you can see at a glance during review whether a card is passing.
2. **At admin-review time**, as a server-side post-process when the card is merged into `agricola-cards.json`.

Recommendation: do it in the Azure Function (option 1). It's a trivial 2-line check, and surfacing the flag in the issue body makes review faster — you can spot-check the auto-detection by cross-referencing against the description text that's right above it.

**Detection logic (pseudocode):**
```js
const PASSING_PHRASE = 'pass it to the player on your left';
const passing = description.toLowerCase().includes(PASSING_PHRASE);
```

**Edge case:** If the user submits a card with no description (which the form allows), `passing` defaults to `false`. That's fine — the admin can flip it manually at review if needed.

### Changes to the temp card form

The existing temp card form (in `CardSearch` component in draft.html) currently has:
- Name input
- Type toggle (Occupation / Minor Improvement)
- Collapsible "Add description" textarea

We need to extend it with three more optional fields, ideally behind a single "Add details" toggle to avoid cluttering the form. Suggested layout:

```
┌─────────────────────────────────────┐
│  Name: [                         ]  │
│  Type: [Occupation] [Minor]         │
│  ▸ Add details                      │
└─────────────────────────────────────┘

When expanded:
┌─────────────────────────────────────┐
│  Name: [                         ]  │
│  Type: [Occupation] [Minor]         │
│  ▾ Hide details                     │
│    Cost:          [             ]   │
│    Prerequisites: [             ]   │
│    Victory pts:   [             ]   │
│    Description:   [             ]   │
│                   [             ]   │
└─────────────────────────────────────┘
```

All four detail fields are optional. The description field moves inside the collapsed "details" section rather than being its own toggle.

### Changes to the edit flow

The existing `editTempCard()` callback + edit modal only supports name and description. It needs to be extended to also edit cost, prerequisites, and vps. This matters because:
- The screenshot-OCR "Add as Occ/Minor" buttons create temp cards with only a name — the user might want to add details afterward
- Users may submit a temp card quickly with just the name, then circle back to fill in details

When a user edits a temp card, the updated data should be re-submitted (or a follow-up comment added to the GitHub Issue). The simplest approach: call `submitCardInBackground()` from `editTempCard()` too, and let the server's session-level dedup logic decide whether to update the existing issue. Open design question — see "Future Considerations."

## How the Pieces Fit Together

### 1. The Trigger: `addTempCard()` in draft.html

This is the existing function that creates a temporary card object and adds it to the draft hand. Its signature needs to expand to accept the new optional fields:

```js
// Before:
addTempCard(name, type, description)

// After:
addTempCard(name, type, { description, cost, prerequisites, vps })
```

Using an options object (rather than positional args) keeps the call sites clean as the field list grows. The temp card object stored in state gets the new fields too, so popovers automatically render them.

At the end of the function, we add the submission call:

```js
submitCardInBackground({ name, type, description, cost, prerequisites, vps });
```

The `submitCardInBackground` signature also switches to an options object for the same reason. This is the only change to the existing user-facing flow — everything downstream is invisible to the user.

### 2. The Client Helper: `submitCardInBackground()`

A fire-and-forget function defined near the top of the `<script>` block in draft.html. Key design decisions:

**Fire-and-forget, not await.** The user's workflow (adding a card to their hand) must never be blocked by a network request. If the submission API is down, slow, or misconfigured, the user doesn't notice — their temp card works exactly as before.

**Session-level deduplication.** A `Set` called `_submittedCards` tracks what's already been sent this session. If a user adds "New Card X", removes it, then re-adds it, we only submit once. This is a lightweight client-side guard; the server also deduplicates via GitHub search.

**No retry logic.** If the request fails, we don't retry. Rationale: if the server is down, retrying wastes rate-limit budget. The same card will likely be added again in a future draft session by the same or different user, so it'll get submitted eventually.

**Console logging only.** Success and failure both log to the browser console. No toasts, no alerts, no UI changes. The user doesn't need to know this is happening — it's an admin pipeline, not a user feature.

### 3. The Azure Function: `/api/submit-card`

Lives at `api/submit-card/index.js` + `function.json`. Follows the same patterns as the existing `api/ocr/` function:

**CORS headers.** Same `Access-Control-Allow-Origin: *` pattern. Needed for local dev (localhost:8080 → Azure Function).

**Rate limiting.** In-memory, IP-based, 20 requests per hour per IP. More generous than OCR (10/hr) because a user might legitimately add several unrecognized cards in one draft session.

**Validation pipeline** (this is the guardrails layer):

| Field | Required | Limit | Pattern / Validation | Why |
|-------|----------|-------|---------------------|-----|
| `name` | Yes | ≤ 100 chars | `/^[\p{L}\p{N}\s'\-.,!&()]+$/u` | Allows real card names (including accented chars like "Crudité") while blocking HTML/script injection |
| `type` | Yes | — | Enum: `"Occupation"` \| `"Minor Improvement"` | Only two valid card types in Agricola |
| `description` | No | ≤ 1000 chars | String | Generous for real card text, blocks abuse |
| `cost` | No | ≤ 50 chars | String | Cost strings are very short ("1 food", "3 wood") |
| `prerequisites` | No | ≤ 150 chars | String | Can be longer than cost ("3 occupations and 2 rooms" style phrasing) |
| `vps` | No | ≤ 20 chars | String | Usually a single digit ("1", "2") but we allow string for edge cases ("1 per stable", "up to 3") |

**Why strings for `vps` instead of a number?** The existing card schema stores it as a string — some cards have conditional VPs ("1 per animal of type X") that aren't expressible as a plain number. Keeping it as a string matches the existing data shape and avoids a type mismatch when the admin pastes into the JSON.

**Why no validation pattern on description/prerequisites/vps?** Length limits are enough for these. GitHub escapes markdown in issue bodies, so injection isn't a real concern once we've rate-limited and length-capped.

**Auto-derivation step (post-validation):** After all user-provided fields pass validation, the function derives `passing` from the description via case-insensitive substring match on `"pass it to the player on your left"`. The derived value gets included in both the human-readable table and the machine-readable JSON block of the GitHub Issue.

**Local database check.** Before hitting GitHub at all, the function loads `api/data/agricola-cards.json` (cached after first cold start) and checks if the card name already exists. Returns 409 if so. This is fast and free — no API call needed.

**GitHub dedup search.** Searches for existing open issues with the same card name in the title. If found, returns a friendly "already submitted" response (HTTP 200, not an error). If the search API fails, we proceed anyway — better to risk a duplicate issue than silently drop a submission.

**Issue creation.** Creates a GitHub Issue with:
- Title: `[Card Submission] Card Name`
- Label: `card-submission` (for easy filtering)
- Body: human-readable table + machine-readable JSON block

### 4. The Review Workflow

The admin (you) periodically:
1. Goes to GitHub Issues → filters by `card-submission` label
2. Reviews each submission
3. For approved cards: adds an entry to `data/agricola-cards.json` (and the `api/data/` copy) with `rank: null` or similar "not rated" sentinel
4. Closes the issue
5. Pushes to `main` → GitHub Actions auto-deploys

A future enhancement could automate step 3 with a script that reads all open `card-submission` issues and generates the JSON entries.

## New Environment Variables

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `GITHUB_TOKEN` | Yes | `github_pat_...` | Fine-grained PAT with Issues read/write on this repo only |
| `GITHUB_REPO` | No | `riley-m-oneill/agricola-card-lookup` | Defaults to this value; override if repo name differs |

### Setting up the PAT

1. Go to GitHub → Settings → Developer Settings → Fine-grained personal access tokens
2. Create a new token scoped to **only** the `agricola-card-lookup` repository
3. Grant **Issues: Read and Write** permission (nothing else needed)
4. Set expiration to 1 year (max)
5. Add to Azure: Portal → Function App → Configuration → Application Settings → `GITHUB_TOKEN`

### First-time setup: create the label

The function creates issues with `labels: ['card-submission']`. GitHub will reject this if the label doesn't exist yet. Create it once:

```bash
gh label create card-submission --description "Unrecognized card submitted via draft tool" --color "d4c5f9" --repo riley-m-oneill/agricola-card-lookup
```

## Azure Deployment Changes

**None required.** Azure Static Web Apps automatically discovers new folders under `api/` and deploys them as Azure Functions. The existing GitHub Actions workflow handles this. The only manual step is adding the `GITHUB_TOKEN` environment variable in the Azure Portal.

## Files to Change

| File | Change |
|------|--------|
| `api/submit-card/function.json` | **New.** HTTP trigger config for POST /api/submit-card |
| `api/submit-card/index.js` | **New.** Submission handler: validates name/type/description/cost/prerequisites/vps → auto-derives `passing` from description text → deduplicates (local DB + GitHub search) → creates GitHub Issue |
| `draft.html` | **Modified.** Three changes: (1) Expand `CardSearch` temp-card form with cost/prerequisites/vps inputs behind an "Add details" toggle. (2) Update `addTempCard()` + `editTempCard()` signatures to accept the new fields via options object. (3) Add `submitCardInBackground()` helper and call it from `addTempCard()` + optionally `editTempCard()`. |
| `docs/card-submission-spec.md` | **New.** This document |

## Future Considerations

- **Edit-triggers-resubmit vs. issue-comment:** When a user edits a temp card (via the ✎ button), should we fire a new submission, post a comment to the existing issue, or do nothing? Current lean: re-fire `submitCardInBackground()` and let the server detect the duplicate issue, then POST a comment with the updated data. Needs design in build phase.
- **Batch-approve script:** Parse open `card-submission` issues, generate JSON entries, open a PR. Could be a GitHub Action triggered manually. The structured JSON block in each issue body makes this straightforward.
- **"Not rated" display:** Cards added with `rank: null` should display consistently with how temp cards display now (dashes for stats, sorted to bottom). Minor CSS/logic alignment may be needed when cards get promoted from submissions into the main DB.
- **Tag assignment:** Strategy tags are admin-assigned at review time. Consider whether the review workflow should include a checklist of tag archetypes (Day Laborer, Fishing, Big House, etc.) to make tagging faster.
- **Screenshot-OCR unmatched cards:** The "Add as Occ/Minor" buttons in `ScreenshotResults` only capture a name. Consider whether those should also open the full temp-card form (for details entry) or stay as the current quick-add.
- **GitHub App migration:** If PAT rotation becomes annoying, switch to a GitHub App for automatic token management. More setup, zero ongoing maintenance.

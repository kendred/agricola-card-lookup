# Agricola Draft Tool — Feature Spec

## Overview

Add a drafting tool to the Agricola card lookup app. In Agricola, the typical draft is 10-choose-7: players start with 10 occupations and 10 minor improvements, and end up with a hand of 7 and 7. Each round, the player drafts one occupation and one minor improvement, then passes the remaining hand clockwise to the next player.

The goal is to help the user:
- Easily import their hand via search-and-add
- Understand ranking info about each card to make better draft decisions
- Remember what's in each hand across the draft, including what other players have taken

This tracks a single player's perspective across a 4-player draft.

## Current Behavior

- The app has a database of 773 cards with ranking data and metadata (rank, ADP, Elo per play, Draft Value, Play Value, Play Rate, etc.)
- Search with autocomplete already exists
- The app is a single-page vanilla HTML/CSS/JS app with card data embedded in `script.js` and also available in `agricola-cards.json`

The draft tool will share the underlying card data but is otherwise a new feature with its own UI and flow.

## Desired Behavior

### Draft Flow

**Starting a draft:**
- User opens the Draft page and starts a new draft
- User can reset an existing draft at any time

**Rounds 1–4 (new hands):**
1. User searches and adds cards to the current hand. Hand sizes are 10/9/8/7 of each type (occupations and minor improvements) for rounds 1–4 respectively.
2. Cards are displayed in two columns: occupations and minor improvements.
3. Each card shows ranking stats: rank, ADP, Elo per play, and Draft Value.
4. Hands are sorted by rank by default, with the ability to sort by other displayed metrics.
5. User selects exactly one occupation and one minor improvement to draft. They cannot proceed to the next round without selecting one of each, and cannot select more than one of each.
6. Drafted cards are added to a "Your Hand" section at the bottom of the page, below the main draft area.
7. Remaining cards are recorded as "passed."

**Rounds 5–7 (returning hands):**
1. The hands cycle back — the user sees hands they previously passed. The app shows the full set of previously passed cards.
2. Cards that have been drafted by other players appear faded and cannot be selected, but remain visible in the hand so the user can see what others took.
3. The user deselects cards that are missing (i.e., marks them as drafted by others). It should be easy to re-toggle a card if deselected by mistake.
4. User then drafts one occupation and one minor improvement from the remaining available cards.

**After round 7:**
- User sees a summary view of their final 7+7 drafted hand with full stats.

### Card Entry UX

Since users need to enter up to 68 cards across a draft, the add-card flow must be fast:
- Type a few characters → see autocomplete results → click or press Enter to add
- Search field immediately clears and refocuses for the next card
- No extra clicks or confirmations

### Layout

- **Current hand** is the primary focus area, displayed prominently.
- **All prior hands** are visible alongside the current hand (not hidden behind tabs/clicks). Hands should be compact enough to fit side by side if possible, with a clear visual indicator of which hand is active.
- **"Your Hand" section** sits at the bottom, showing all cards drafted so far.
- Occupations and minor improvements are displayed as two separate columns within each hand.

### Navigation

- The draft tool lives on a separate page (e.g., `draft.html`), not a tab within the existing page.
- Easy navigation back and forth between the card lookup page and the draft tool (e.g., nav links on both pages).

### Data Persistence

- Draft state persists across page refresh using localStorage.
- User can reset/clear the draft to start fresh.

## Technical Approach

- Separate HTML page (`draft.html`) sharing the same card database (`agricola-cards.json`)
- Reuse or reference existing search/autocomplete logic from `script.js`
- Open to using React or other libraries if it simplifies the implementation, with a preference for using established libraries over custom solutions
- Visual styling and specific implementation details are left to Claude Code's judgment for V1
- For edge cases not documented here, use best judgment but ask if anything seems tricky or impactful

## Files Involved

- **`agricola-cards.json`** — shared card database (read-only for this feature)
- **`script.js`** — existing search/autocomplete logic to reference or reuse
- **`index.html`** — add navigation link to the draft tool (minimal change)
- **New: `draft.html`** — the draft tool page
- **New: draft-specific JS/CSS files** as needed

## Out of Scope

- Screenshot/image import for card entry (phase 2)
- Tagging/strategy suggestion system (future enhancement)
- Multi-player sync — each user tracks their own draft independently
- Redesigning the existing card lookup page (beyond adding a nav link)
- Mobile-optimized UX (nice to have, not a requirement)
- Updating the card data or rankings

## Acceptance Criteria

1. User can navigate between the card lookup page and the draft tool
2. User can start a new draft and reset an existing one
3. User can quickly search and add cards to a hand (autocomplete, add on click/enter, auto-clear and refocus)
4. Cards in hand display with ranking stats (rank, ADP, Elo per play, Draft Value)
5. User must select exactly one occupation and one minor improvement per round — cannot proceed without one of each, cannot select more than one of each
6. Rounds 1–4: user enters new hands with correct hand sizes (10/9/8/7 of each type)
7. Rounds 5–7: app shows previously passed cards; missing cards can be deselected (faded, unselectable) with easy re-toggle if done by mistake
8. Cards drafted by others remain visible but faded and unselectable
9. All prior hands remain visible in a compact view alongside the current hand
10. Hands sorted by rank by default, sortable by other displayed metrics
11. After round 7, user sees a summary of their final 7+7 drafted hand with stats
12. Drafted cards appear in a "Your Hand" section below the main draft area
13. Draft state persists across page refresh via localStorage
14. User can undo a draft pick before moving to the next round
15. Existing card lookup page continues to work as before

## Open Questions

- Visual styling decisions (colors, card sizes, spacing) — Claude Code to decide for V1
- Exact implementation architecture (file structure, whether to use a framework) — Claude Code to decide
- Unspecified edge cases — use best judgment, ask if anything seems tricky or impactful

## Future Enhancements

- **Screenshot import:** Paste a screenshot of a hand and auto-detect cards (phase 2)
- **Tagging system:** Mark cards with strategy tags (e.g., "Day Laborer strat") so users can spot synergies across hands and potentially receive strategy suggestions
- **Mobile-optimized UX:** Optimize the draft flow for phone use at the table

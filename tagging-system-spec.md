# Agricola Strategy Tagging System — Feature Spec

## Overview

Add a strategy tagging system to the Agricola card lookup app. In Agricola, certain cards form powerful synergies when drafted together (e.g., cards that use the Day Laborer space), but this isn't obvious from the existing metadata or card descriptions alone. By tagging cards with the strategies they belong to, users can quickly spot strategic opportunities in a draft hand and track what strategies are floating across all hands.

## Current Behavior

- Cards have ranking data and metadata (rank, ADP, Elo per play, Draft Value, etc.) but no strategy/tag information
- Card lookup page has existing filters in the sidebar (type, passing)
- Draft tool shows hands with ranking stats and card details, from which users can manually identify strategies, but there are no visual indicators for strategic synergies

## Desired Behavior

### Data Layer

- A fixed set of approximately 10 strategy tags (e.g., "Day Laborer," "Fishing," etc.)
- Each card can have zero or more tags
- Tag assignments are stored in `agricola-cards.json` as an added field (array of tag strings)
- Claude Code does a first pass proposing tag assignments for each strategy; the user reviews and approves/rejects each suggestion
- A typical strategy will have 10–20 associated cards out of the 773 total

### Card Lookup Page

- Strategy filter added to the sidebar alongside existing type/passing filters
- Cards display their full strategy tag names as small pills/badges

### Draft Tool

- Cards in hands show abbreviated strategy pills (e.g., "DL" instead of "Day Laborer")
- Abbreviated pills are shown on cards in both the active hand and the compact prior-hands view
- Pills must be visible on prior hands — this is a key use case for spotting strategies floating in the draft (e.g., "there's a Day Laborer strat in that hand I passed")
- There should be a way to see the full tag name from an abbreviated pill (tooltip, legend, or similar)
- The prior-hands view is space-constrained. Claude Code should find a viable solution for showing pills in this context without breaking the layout.

### Tag Display Rules

- Full tag names displayed on the card lookup page where space allows
- Abbreviated tags used anywhere space is a constraint (draft tool hands, prior hands)
- Abbreviations should be consistent and easily learnable

## Technical Approach

- Add a `tags` field (array of strings) to each card record in `agricola-cards.json`
- Keep tag data in the main JSON file — the dataset is small enough that a separate file isn't warranted
- Update both the card lookup page (`index.html` / `script.js`) and the draft tool (`draft.html` / draft JS/CSS)
- Visual styling and implementation details left to Claude Code's judgment
- For edge cases not documented here, use best judgment but ask if anything seems tricky or impactful

## Files Involved

- **`agricola-cards.json`** — add `tags` field to card records
- **`index.html`** / **`script.js`** — add strategy filter to sidebar, display tag pills on cards
- **`draft.html`** / draft JS/CSS — add abbreviated tag pills to active and prior hands
- **`style.css`** or new CSS — pill styling, potentially shared across both pages

## Out of Scope

- User-created custom tags (future)
- Strategy suggestions or recommendations (future — see below)
- Automated tag assignment without human review
- Changing any existing card data beyond adding the tags field

## Acceptance Criteria

1. A fixed set of ~10 strategy tags exists in the card data
2. Cards can have zero or more tags
3. Tag assignments have been reviewed and approved by the user (Claude Code proposes, user confirms)
4. Card lookup page has a strategy filter in the sidebar
5. Card lookup page shows full strategy tag names as pills on cards
6. Draft tool shows abbreviated strategy pills on cards in both the active hand and prior hands
7. Abbreviated pills have a way to reveal the full tag name (tooltip, legend, or similar)
8. Pills are visible on prior hands without breaking the compact layout
9. Existing card lookup and draft tool functionality unchanged beyond adding tags

## Open Questions

- Exact set of ~10 strategy tags — to be determined with Claude Code's help based on known Agricola archetypes
- Visual styling of pills (colors per strategy, sizing, placement) — Claude Code to decide
- How to fit pills into the prior-hands compact view without breaking layout — Claude Code to find a viable solution

## Future Enhancements

- **User-created custom tags:** Let users define and assign their own strategy tags
- **Strategy suggestions:** LLM-generated or heuristic-based recommendations of what would work well together, based on the cards showing in the draft and ranking data
- **Strategy summaries per hand:** Aggregate view showing strategy counts across hands (e.g., "DL ×3, Fish ×2")

# Screenshot Translation Feature Spec

## Overview

Users drafting in the Agricola card lookup app currently enter each card manually via search. This feature allows users to paste a screenshot (from clipboard) or upload an image file of their Board Game Arena (BGA) Agricola hand, and have the app automatically identify the cards and add them to the current draft hand.

The goal is speed — manual entry for a full hand takes roughly 45 seconds. Screenshot translation should be meaningfully faster (target: under 5 seconds) or the feature isn't worth using.

**Platform scope:** BGA only. Card appearance is consistent across BGA users.

## Current Behavior

- User searches for a card by name in the draft tool's search box
- Selects a card from results to add it to the current hand
- Repeats for each card
- The draft tool validates against expected card counts per round (10 occupations + 10 minor improvements in round 1, decreasing by 1 each round down to 4+4 in round 7)
- Cards can be manually removed if misidentified or added in error

## Desired Behavior

### Input Methods

1. **Clipboard paste (primary):** User does a screen capture (e.g., Cmd+Shift+4 on Mac) and pastes directly into the app
2. **File upload (secondary):** User uploads a saved image file

Both input methods should be available in the card entry area of the draft tool, alongside the existing manual search.

### Processing Flow

1. User is on a draft round and sees the search/entry area
2. User pastes a screenshot or uploads an image
3. App processes the image, identifies card names, and matches them against `agricola-cards.json`
4. Identified cards are added to the current hand immediately (no confirmation step)
5. Cards are categorized as occupations or minor improvements based on existing card data
6. If the user pastes a second screenshot for the same hand, the app de-duplicates against cards already added and only adds new ones
7. User can manually remove any misidentified cards and manually search-and-add any missed ones
8. Normal round validation still applies — cards cannot exceed the round's max count

### Multiple Screenshots

Users may need 2+ screenshots to capture a full hand (10-14 cards typically visible at once). Screenshots may overlap (e.g., screenshot 1 shows cards 1-12, screenshot 2 shows cards 10-20). The app must de-duplicate successfully across multiple inputs.

### Performance

- Target: under ~5 seconds for a typical screenshot
- Ideal UX: cards stream in as they're identified, giving the perception of progress
- Acceptable fallback: loading state that resolves all at once
- Manual entry baseline for comparison: ~45 seconds

## Technical Approach

**Two viable approaches to evaluate — Claude Code should prototype and recommend:**

### Option A: Client-Side OCR (Tesseract.js)

- Runs entirely in the browser
- No API key, no cost, no external dependencies
- Trade-off: potentially lower accuracy on stylized BGA card text, possibly slower processing
- Card name extraction → fuzzy match against `agricola-cards.json`

### Option B: Azure-Hosted API

- Azure Computer Vision / OCR services, or Azure-hosted OpenAI vision models
- Higher likely accuracy, but adds latency from network round-trip
- Cost per use (acceptable if reasonable — Riley has free Azure credits)
- Requires API key configuration

### Shared Logic (Either Approach)

- Extract card title text from screenshot
- Fuzzy match extracted text against card names in `agricola-cards.json`
- Best-guess matching (no confidence thresholds or "did you mean?" in V1)
- De-duplication logic across multiple screenshots for the same hand
- Respect existing card count validation per round

**Claude Code should evaluate both approaches on accuracy, speed, and cost, and recommend one (or a hybrid) before implementation.**

## Files Involved

- `draft.html` — UI changes: paste target area, file upload input alongside existing search
- `draft.js` (or equivalent draft tool JS) — image processing logic, card matching, de-duplication
- `agricola-cards.json` — referenced for matching identified card names to card data (no modifications to the file)
- Potentially a new module/file for image processing and OCR logic

## Out of Scope (V1)

- Support for platforms other than BGA
- Custom card recognition training / template matching (unless Claude Code recommends it)
- Screenshot input outside the draft tool (e.g., on the main card lookup page)
- Automatic round advancement based on screenshot contents
- Mobile camera capture (e.g., photographing physical cards)
- User-facing configuration of OCR/API settings
- Filtering non-card UI elements from screenshots (beyond what the recognition approach handles naturally)

## Acceptance Criteria

1. User can paste a screenshot from clipboard into the draft tool's card entry area
2. User can upload an image file as an alternative input method
3. App identifies card names from a BGA screenshot and adds them to the current hand
4. Cards are correctly categorized as occupations or minor improvements based on existing card data
5. Multiple screenshots can be pasted/uploaded for the same hand, with automatic de-duplication
6. Card count validation still enforced (cannot exceed the round's max)
7. User can manually remove misidentified cards and manually add missed ones
8. Performance: card identification completes in under ~5 seconds for a typical screenshot
9. Spec documents both client-side and API-based approaches with trade-offs, for Claude Code to evaluate and recommend

## Open Questions

1. **Client-side vs. Azure API** — Claude Code to evaluate accuracy, speed, and cost of Tesseract.js vs. Azure OCR/Vision services and recommend an approach
2. **BGA card text readability** — How well does OCR perform on actual BGA screenshots? May need a prototype test early to validate feasibility
3. **Edge cases in card matching** — Some cards may have similar names or OCR could misread characters. What fuzzy matching threshold is acceptable?
4. **Card count overflow** — If a screenshot contains more cards than remaining slots, should it add up to the limit and ignore the rest, or surface a message to the user?
5. **Multiple screenshot de-dupe confidence** — If OCR reads a card name slightly differently across two screenshots, how aggressively should we de-dupe?

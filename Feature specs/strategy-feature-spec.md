# AI Draft Strategy Feature Spec

## Overview

An LLM-powered strategy advisor for the Agricola draft tool that provides two layers of guidance during a draft:

1. **Strategic Coverage Dashboard** — An ongoing assessment of the player's draft across key strategic dimensions, updating as cards are picked. Shows what's covered, what's missing, and how the draft is shaping up.
2. **Card-Level AI Suggestions** — 2-3 recommended picks per hand with ranked pills ((1), (2), (3)), each with a tap/hover rationale explaining why the card is a strong choice given the player's draft state, opponents' likely picks, and future card availability.

The goal is to replicate the strategic thinking of an experienced Agricola player — someone who evaluates cards through the lens of food strategy, resource planning, action efficiency, farm layout, point ceiling, game flow, and draft dynamics.

Performance, cost, and quality are all critical. The feature must be fast enough to not slow down the draft, cheap enough to run on Riley's free Azure credits, and good enough that an experienced player finds the advice useful.

## Current Behavior

- Each card in the draft tool shows rank and ADP data
- Cards display strategy tags (e.g., "Day Laborer," "Grain") representing loose groupings of synergistic cards
- The user sees their current hand, prior hands, drafted cards, and which cards disappeared between rounds
- No strategic interpretation of the draft — no coverage assessment, no pick suggestions, no reasoning about opponents or game flow
- Tags exist but are a rough grouping, not a strategic framework — useful as a low-weight input only

## Desired Behavior

### Layer 1: Strategic Coverage Dashboard

- Displayed as a column alongside the "Your Drafted Cards" section of the draft tool (exact layout deferred to Claude Code with iteration expected)
- Contains: overall LLM analysis, four spectrum/rating dimensions, a farm layout grid, a freeform notes field, and an LLM-generated risks section
- Gives the user a quick read on: "What's my food plan? Do I have growth cards? Do I have extra actions? Where are my gaps?" plus a space to plan their physical farm and jot down strategy notes

#### Dashboard Components

**1. Overall Analysis (LLM-generated)**
A short narrative paragraph from the LLM summarizing the state of the draft — what the strategy looks like so far, how it's coming together, and what the player should prioritize in upcoming picks. This sits at the top of the dashboard.

**2. Dimension Spectrums**

Four rated dimensions, each displayed as a labeled indicator. The first three use a spectrum (e.g., Weak → Adequate → Strong); Point Ceiling uses a three-point scale (Low / Medium / High). Plow is binary (Covered / Not Covered).

- **Food** (spectrum: Weak → Adequate → Strong)
  "Strong" means the player has a visible, viable way to feed themselves throughout the game based on their drafted cards. Examples: cards that help acquire grain (Basket Carrier, Potter Ceramics) combined with a way to bake (Baker), or cards that provide reliable animal access. "Weak" means no clear food mechanism is visible — the player will need to be especially attentive to food actions during play. Note: food strategies can be complex and multi-card; the LLM should assess holistically rather than looking for a single "food card."

- **Growth** (spectrum: Weak → Adequate → Strong)
  A catchall for cards that help the player grow their family (more family members = more actions for remaining rounds). Growth comes in two forms:
  1. *Room-building support:* Cards that make it easier to build rooms for new children (e.g., Wooden Hut Extender, Carpenter's Parlor)
  2. *Growth without building:* Cards that enable family growth without a new room (e.g., Field Doctor)
  3. *Growth queue advantage:* Cards that give easier or earlier access to the family growth action (e.g., Sleeping Corner, Bed in the Grain Field)

- **Extra Actions** (spectrum: Weak → Adequate → Strong)
  Cards that give the player extra actions without growing their family. Two forms:
  1. *Direct extra actions:* Cards that literally provide additional actions (e.g., Steam Plow, Scholar)
  2. *Resource without actions:* Cards that provide resources passively, effectively freeing up worker placements (e.g., Small Scale Farmer, Basket Carrier)

- **Point Ceiling** (three-point scale: Low / Medium / High)
  An LLM-assessed rating based on how many cards in the player's hand provide bonus points and the potential magnitude of those points. The LLM should assess holistically — a single high-magnitude bonus point card might rate higher than several small ones. This dimension captures whether the draft has enough scoring upside to win.

- **Plow** (binary: Covered / Not Covered)
  Whether the player has drafted cards that make plowing easier. This can take three forms:
  1. *Multi-field plowing:* Cards that plow multiple fields at once (e.g., Swing Plow)
  2. *Improved farmland action:* Cards that make the Farmland action more valuable (e.g., Cultivator)
  3. *Plow without actions:* Cards that plow fields without requiring a Farmland/Cultivation action (e.g., Plow Driver)

  "Not Covered" is not necessarily a problem — it just means the player will need to spend standard actions on plowing. The dashboard flags it so the player is aware.

**3. Farm Layout Grid**

An interactive 3×5 grid (3 rows tall, 5 columns wide = 15 spaces) where the user can plan their physical farm layout. Modeled after a Minesweeper-style click-to-cycle interaction.

- Each square has four states, cycled on click: **Empty** (blank) → **H** (House) → **F** (Field) → **P** (Pasture) → Empty
- Letters are lightly color-coded for quick visual scanning (subtle, not over the top — e.g., H in a warm tone, F in green, P in brown/tan)
- **Starting state:** Two squares are pre-filled with "H" and **locked** (cannot be changed by clicking):
  - Bottom-left square (row 3, column 1)
  - Square directly above it (row 2, column 1)
  - These represent the two wooden hut rooms every player starts with in Agricola
- All other 13 squares start as Empty and are freely editable
- Grid resets when a new draft begins
- This is a manual planning tool — the LLM does not read or write to the grid. It's for the player to sketch out their intended farm as they draft.

**4. Notes Field**

A simple freeform text field for the player to jot down strategy notes during the draft.

- Plain text only — no rich text, no formatting
- Approximately 4 visible lines by default; scrolls if the user writes more
- No ability to expand or resize the field
- Resets when a new draft begins
- Not read by the LLM — purely for the player's own reference

**5. Risks / Weaknesses (LLM-generated)**

A short section of LLM-generated freeform text highlighting specific risks or weaknesses in the draft that fall outside the four tracked dimensions above. For example: "You're light on wood generation and have two wood-dependent improvements — wood will be a bottleneck" or "Your food plan depends entirely on grain, but you have no backup if grain access is contested."

This section provides the nuanced, context-specific warnings that the structured dimensions can't capture.

### Layer 2: Card-Level AI Suggestions

- On each hand, 2-3 cards receive an AI suggestion pill, ranked (1), (2), (3)
- Tap or hover reveals the rationale — why this card, what gap it fills, how it fits the draft, what it synergizes with
- Suggestions factor in:
  - The player's current drafted cards and strategic coverage
  - Card rank and ADP
  - What opponents have taken (inferred from cards that disappeared between rounds)
  - Likelihood of complementary cards appearing in future hands
  - Game flow considerations (is the hand front-loaded? does this card come online at the right time?)
  - Strategy tags (low-weight signal)

### Triggering

- **Preferred if cost is negligible:** Auto-triggered when the user adds or removes a card from their draft hand
- **Likely default:** User-triggered via a manual refresh/update button — the dashboard is easy to trigger frequently, so auto-trigger may generate excessive API calls
- Claude Code to cost out both approaches and recommend. If auto-trigger cost per draft is negligible (given Riley's Azure credits), go with auto. Otherwise, manual refresh with a clear button.
- The farm layout grid and notes field are local-only and do not trigger LLM calls

### Opponent Behavior Prediction

- For the first three passed hands, limited data is available. Default heuristic: cards with the best combination of high rank and low ADP (drafted early) are most likely to be taken.
- In later rounds, the system knows exactly which cards were taken from prior hands (though not by whom). This improves prediction accuracy.
- Important caveat: rank and ADP reflect global BGA data, not the player's specific group meta. Suggestions should account for this uncertainty.

## Strategic Framework (Author: Riley)

The following framework defines how the LLM should evaluate cards and assess draft progress. It is the core of the feature's quality.

### Strategic Hierarchy

The LLM should evaluate drafts and cards through these elements, roughly in priority order:

#### Primary Enablers (solve these or everything else suffers)

**1. Food**
Food is the primary constraint in Agricola. Not having enough food results in either begging tokens (-3 points per missing food, nearly impossible to win with) or, more commonly, spending too many actions acquiring food instead of building the farm. The draft should establish a clear food strategy early.

Key questions the LLM should assess:
- Does the player have a viable food engine (cards that produce food efficiently)?
- How action-efficient is the food plan? (A plan that costs 3 actions per harvest is much worse than one that costs 1.)
- Is the food strategy dependent on specific flip order (e.g., early sheep), and if so, is there a backup?

**2. Resources**
Wood, clay, reed, and stone don't score points directly, but they unlock everything: house upgrades, fences, stables, and improvements (including food-producing improvements). Resource planning is tightly linked to the farm layout plan.

Key questions:
- Does the player have access to the resources their strategy requires?
- Are there cards that inject extra resources or reduce costs?
- Based on what's visible in the draft, will certain resources be scarce (e.g., no wood injection cards = wood will be highly contested)?

**3. Actions**
The baseline is 28 placed actions across the game (2 workers x 14 rounds). Good players significantly exceed this through:
- **Growth:** Building rooms and adding family members (each new family member adds actions for remaining rounds)
- **Generated actions:** Cards that perform actions without placing a worker (e.g., Plow Driver plows fields, Freemason provides clay/stone)

More actions = more farm development = more points. The LLM should assess whether the draft provides enough action generation to support the planned farm state.

#### Scoring Elements (these generate points)

**4. Farm Layout**
The physical plan for the farmyard. The player should be working toward a target end state — e.g., "5 fields, 4 rooms, 15 fences covering 6 spaces" or "5 rooms, 6 fields, 12 fences covering 4 spaces."

Scoring baseline from the rules:
- Fields: -1 for 0-1, up to 4pts for 5+
- Pastures: -1 for 0, up to 4pts for 4+
- Grain: -1 for 0, up to 4pts for 8+
- Vegetables: -1 for 0, up to 4pts for 4+
- Sheep: -1 for 0, up to 4pts for 8+
- Wild boar: -1 for 0, up to 4pts for 7+
- Cattle: -1 for 0, up to 4pts for 6+
- Unused farmyard spaces: -1 each
- Fenced stables: 1pt each
- Clay rooms: 1pt each / Stone rooms: 2pt each
- Family members: 3pts each (max 5, so max 15pts)
- Begging cards: -3pts each

Key principle: minimizing negative points is the baseline. A good strategy avoids 0 in any scoring category and fills the farmyard (no unused spaces).

**5. Point Cap**
Bonus points and card points that push the score above the board baseline. These come from:
- Victory points printed on improvement/occupation cards
- Bonus point effects on cards (variable scoring based on conditions)
- Major improvements (Joinery, Pottery, Basketmaker's Workshop, Well, etc.)

Point cap is key to winning — a competitive winning score ranges from ~45 (low-scoring game) to ~65 (high-scoring game) in a 4-player game.

#### Cross-Cutting Considerations

**6. Game Flow / Tempo**
A good draft produces cards playable across the game's arc:
- **Early game:** Occupations that set up the engine — resource generation, cost reduction, food foundation
- **Mid game:** Cards that develop the farm — animal support, field development, family growth enablers
- **Late game:** Cards that score points — bonus point occupations, high-value improvements

A hand that is front-loaded (all early-game cards) or back-loaded (all late-game cards) will fail. The LLM should assess whether the draft has a balanced tempo — early investments setting up later high-value plays.

Important context on point distribution: early actions often score 0 points directly (plowing, building rooms, playing occupations). Late actions are where big points come in (sowing full fields, fencing large pastures, breeding animals). An average placed action across the game is worth roughly 1.5-1.7 points, but the distribution is very broad — not a clockwork 1.6 per turn.

**7. Draft Dynamics**
How the draft itself shapes strategy:
- **Rounds 1-3:** Core strategy cards. Your direction is set by your strongest picks.
- **Rounds 4-5:** Fill gaps, pick supporting cards.
- **Rounds 6-7:** Take whatever provides marginal value. Core is locked in.
- **Card wheeling:** Low-ADP (less popular) cards are more likely to come back in later rounds. A savvy drafter can build a strategy around synergistic low-ranked cards that others will pass. High-ranked cards passed in round 1 are gone forever.
- **Hate drafting:** Occasionally worth taking a card that doesn't help you if it would give an opponent a game-winning combo (e.g., you passed a strong card in hand 1 and see a perfect complement in hand 2).
- **Opponent inference:** Cards that disappear between rounds reveal opponents' strategic directions. If Day Laborer-supporting cards are disappearing, someone is on that strategy — which affects what complementary cards will be available.

**8. Round Card Flip Order Awareness**
New action spaces are revealed each round, but within each stage the specific round is unknown during the draft:
- Stage 1 (Rounds 1-4): Sow/Bake bread, Major/Minor Improvement, 1 Sheep, Fences
- Stage 2 (Rounds 5-7): 1 Stone, Renovation + Improvement, Family Growth + Minor Improvement
- Stage 3 (Rounds 8-9): 1 Vegetable, 1 Wild Boar
- Stage 4 (Rounds 10-11): 1 Stone (second), 1 Cattle
- Stage 5 (Rounds 12-13): Plow and/or Sow, Family Growth without room
- Stage 6 (Round 14): Renovation + Fences

Harvests occur after rounds 4, 7, 9, 11, 13, and 14.

Key impacts on draft strategy:
- **Wish for Children (Family Growth + Minor Improvement) timing:** Round 5 = more total actions in the game, higher scores likely. Round 7 = fewer actions, more food pressure since harvests get closer together after round 7.
- **Animal flip order:** Earlier sheep/boar/cattle = more food available in the game. Later = hungrier players.
- **Renovation timing:** If renovation doesn't appear until round 7, strategies dependent on early house upgrades need a card-based alternative.

The LLM should treat flip order as a risk factor, not a dealbreaker. Strategies that are less dependent on favorable flip order are safer. Cards that reduce flip-order dependency (e.g., a card that enables renovation independently) are more valuable as hedges. Some strategies are worth pursuing even when flip-dependent, because the upside is high enough to justify the risk.

### Scaffolding Questions for Framework Refinement

*Riley to expand on these as needed:*
- What are the specific strategic archetypes (e.g., "Day Laborer strategy," "Fishing strategy") and what defines each one?
- For each archetype, what are the key cards, the food plan, the resource needs, and the typical farm layout?
- Are there common card combos that the LLM should recognize as especially powerful or synergistic?
- What separates a "good" suggestion from a "great" one — what does advice look like that would genuinely help you during a draft?
- Are there common mistakes that less experienced players make in drafts that the LLM should actively warn against?

## Technical Approach

### Architecture

Uses the same Azure Function proxy pattern as the screenshot translation feature:
- Browser sends draft state to Azure Function endpoint
- Azure Function forwards to Azure OpenAI (GPT-4o) with the strategy system prompt
- Response comes back with coverage assessment and card suggestions

### System Prompt (Static)

Sent with every call, contains:
- Agricola rules (condensed to what's relevant for draft evaluation — scoring, actions, harvests, stages, round card mechanics)
- The strategic framework defined above
- Card database (full or partial — see Open Questions)

### User Message (Dynamic)

The only content that changes per call:
- Current hand (occupations and minor improvements with full card details)
- All previously drafted cards
- Cards taken by opponents (disappeared between rounds)
- Current round number
- Any other draft state (what's been passed, what came back)

### Context and Cost Considerations

The card database contains 773 cards. Sending full card text for all of them on every call would be expensive. Potential approaches (Claude Code to evaluate):

- **Full database in system prompt:** Best advice quality, highest cost. May benefit from Azure OpenAI prompt caching if the static portion is identical across calls.
- **Relevant cards only:** Send full text for cards in the current hand + drafted cards + cards taken by opponents. Send only name/rank/ADP for the broader pool. Reduces tokens significantly.
- **Tiered approach:** Use a simpler/cheaper model or heuristic for the coverage dashboard (which mostly maps drafted cards to strategic dimensions). Reserve the full LLM call with heavy context for card-level suggestions.

### Coverage Dashboard — Possible Non-LLM Approach

The coverage dashboard could potentially work without an LLM call at all:
- Map drafted cards to strategic dimensions using tags, card attributes, and predefined rules
- Show "food: covered" / "actions: needs growth" / "farm: missing pasture plan" based on heuristic scoring
- This would be instant, free, and always available — with the LLM reserved for the more complex card-level suggestions

Claude Code to evaluate whether a heuristic dashboard is good enough or if LLM-powered assessment adds meaningful value.

## Files Involved

- `draft.html` — UI additions: coverage dashboard column (overall analysis, dimension spectrums, farm grid, notes field, risks section), AI suggestion pills, hover/tap rationale display
- `draft.js` — Logic for triggering LLM calls, rendering suggestions, managing draft state for context, farm grid click-to-cycle interaction, notes field state management
- `agricola-cards.json` — Card data referenced for context (rank, ADP, tags, descriptions). No modifications.
- Azure Function — New endpoint or expanded proxy for strategy API calls (same infrastructure as screenshot feature)
- New file: strategy system prompt template (rules context, strategic framework, card data). Separate file for easy iteration.
- Potentially a new JS module for managing LLM conversation state across a draft session

## Out of Scope (V1)

- Multiplayer tracking (knowing which specific opponent took which card)
- Post-game analysis or draft review after the draft is complete
- Custom strategy profiles (e.g., "I always prefer food engines")
- Real-time action-phase advice (draft-only feature)
- Fine-tuning or training a model on Agricola-specific data
- User feedback loop on suggestion quality (thumbs up/down on picks)
- Offline / client-side LLM inference
- Strategy advice for non-draft decisions (starting resources, family growth timing, in-game actions)

### vNext

- **Learning from past drafts:** A separate project is underway to pull historical group draft data, which could be used to improve predictions about group-specific meta, opponent tendencies, and card valuations.

## Acceptance Criteria

1. A strategic coverage dashboard is displayed as a column alongside the player's drafted cards
2. Dashboard includes: an overall LLM narrative analysis, four dimension ratings (Food, Growth, Extra Actions, Point Ceiling), a binary Plow indicator, an interactive farm layout grid, a freeform notes field, and an LLM-generated risks section
3. Dashboard LLM components (overall analysis, dimension ratings, risks) update when refreshed — either auto-triggered or via manual refresh button depending on cost evaluation
4. Farm layout grid is a 3×5 clickable grid with cycle-on-click interaction (Empty → H → F → P), two locked starting H squares (bottom-left and one above), and light color-coding on letters
5. Notes field is plain text, ~4 visible lines, scrollable, resets per draft
6. Farm grid and notes are local-only — they do not trigger LLM calls or factor into LLM analysis
7. 2-3 cards per hand receive AI suggestion pills, ranked (1), (2), (3)
8. Tapping or hovering on a suggestion pill reveals the rationale for that pick
9. Suggestions factor in: current draft state, card rank, ADP, what opponents have taken, and likelihood of future cards
10. Opponent behavior prediction uses rank + ADP as a heuristic, refined by observed draft data in later rounds
11. Strategy calls route through the Azure Function proxy (same infrastructure as screenshot feature)
12. Agricola rules, strategic framework, and card data are in the system prompt; only draft state is in the user message
13. Spec includes cost and performance estimates for auto-triggered vs. user-triggered suggestions
14. Spec includes proposals for different context levels (full card database vs. relevant cards only) with trade-offs
15. Strategy tags are available as a low-weight input to suggestions
16. The LLM evaluates game flow — suggestions account for when cards come online, not just what they do

## Open Questions

1. **Card data in system prompt** — Is it viable to send full card text for 773 cards? Claude Code to evaluate token count, cost per call, and whether prompt caching reduces this. Alternatively, evaluate a "relevant cards only" approach.
2. **Auto vs. user-triggered suggestions** — Claude Code to cost out both and recommend based on latency and token cost per call.
3. **Coverage dashboard: LLM vs. heuristic** — Can a non-LLM heuristic produce a useful coverage dashboard, or does LLM assessment add meaningful value? If heuristic is viable, it saves cost and latency.
4. **Model selection** — GPT-4o vs. a smaller model for different layers. Coverage dashboard might work with a lighter model; card suggestions may need GPT-4o for reasoning quality.
5. **Prompt caching** — Does Azure OpenAI support caching for the static system prompt portion? If the rules + framework + card data are identical across calls within a draft, caching could meaningfully reduce cost.
6. **Quality benchmarking** — How do we evaluate whether the LLM's advice is good? Riley to play-test and assess. May need iterative prompt tuning.
7. **Strategic archetypes** — The framework defines dimensions but not specific archetypes (e.g., "Day Laborer strategy"). Riley to expand on common archetypes and what defines them.
8. **Group meta vs. global data** — Rank and ADP reflect global BGA data. How much does this limit suggestion quality for Riley's specific play group? Historical group data (vNext) may address this.
9. **Resource competition reasoning** — Can the LLM infer resource scarcity from draft contents (e.g., no wood injection cards = wood will be contested)? Needs prompt engineering and testing.
10. **Flip order risk assessment** — How should the LLM weigh flip-order dependency in its suggestions? Needs calibration through play-testing.

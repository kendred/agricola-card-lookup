# Strategy Advisor Quality Plan

**Problem:** the advisor's responses frequently misunderstand how Agricola works, which
makes the feedback untrustworthy even when the card picks are defensible.

**Diagnosis (Aug 2026):** four distinct causes, none of which are model-capability problems.

1. The prompt contained **no rules** — only `agricola-strategy-guide.md`, which is strategic
   interpretation that assumes the mechanics as background. The model filled the gap from
   pretraining, where Agricola blurs with Caverna and the Family/revised editions.
2. The card index gives **name/rank/adp only** for 773 cards, then instructs the model to
   reason about what may appear in future hands — so it invents card effects.
3. **548 of 773 ranked cards have no tags** (139 of the top 200), yet archetype detection
   and opponent-reading are framed as tag-driven.
4. `js/draft-stats.js` computes exact hand percentiles, pull quality and tag survival
   probabilities — and **none of it is sent to the API**. The model re-derives it badly.

This plan sequences the fixes so each stage is measurable before the next begins.

---

## Stage 1 — Rules grounding ✅ COMPLETE

**Goal:** stop the model reasoning from rules that aren't this game's rules.

**Done:**
- `docs/agricola-rules-reference.md` written from `f5-agricola-rulebook.pdf` — declarative
  mechanics only, no strategy. Covers round/harvest structure, farmyard geometry, house and
  growth, sowing and baking rates, pasture and stable capacity, fencing legality, card rules,
  the full action-space table by stage, player-count-dependent spaces, the scoring table, and
  an explicit "commonly believed but false" list.
- Mirrored byte-identical to `api/docs/agricola-rules-reference.md`.
- Loaded in `api/strategy/index.js` as `RULES_REFERENCE` and inserted into the system prompt
  **above** the strategy guide, labelled authoritative, with the guide relabelled as
  interpretation.

**Revision (Aug 18 2026)** — audited the first draft against `f5-agricola-rulebook.pdf` and
against the card database. Two classes of problem, both fixed:

*Edition/vocabulary mismatch (the big one).* The rules doc was written in the rulebook's
older action-space vocabulary ("Take 1 Grain", "Plow 1 Field", "1 Occupation") while the card
database uses the newer names ("Grain Seeds", "Farmland", "Lessons"). Measured over quoted
terms in card descriptions, **168 of 313 mentions (54%) named a space the rules doc never
mentioned**, and the doc's own vocabulary appeared **zero** times in the card DB or the
strategy guide. Combined with the prompt's "do not assert a mechanic not stated here"
instruction, this risked suppressing correct reasoning or splitting one space into two.
Section 8 now leads with a full name-mapping table and the whole doc uses card-text names,
with rulebook names as parenthetical aliases. **Coverage is now 313/313 (0% missing.)**

*Factual corrections.* Major Improvements are **ten** cards — two Fireplaces (2/3 Clay) and
two Cooking Hearths (4/5 Clay) as separate cards, not one card with a choice of price; the
Fireplace→Hearth upgrade is free and returns the Fireplace for repurchase; added the full
cooking table (Vegetable/Sheep/Boar/Cattle, and the fact that the Hearth is *equal* to the
Fireplace on Sheep); cooking needs no action space, only baking does; the Well pays out *up
to* 5 times; added the 7 Minor Improvements in a starting hand and the 1-5/3-5/4-5 Occupation
deck restriction; corrected the player-count boards (3p adds **4** spaces, 4p adds **6**) and
named Grove, Hollow, Copse and Resource Market; dropped the unsupported "1 Clay (x2 spaces)"
claim on the main board.

**Cost (measured from the built prompt):** the rules block adds **5,672 tokens** to the
static, cacheable prefix. System prompt **13,363 → 19,036 tokens**. Figures come from
comparing `PROMPTS.baseline[4]` and `PROMPTS.current[4]` in `api/strategy/index.js`.

**Notable find:** the Traveling Players action space **does not exist in 3-player games**.
Cards keyed to it are near-dead at 3p, but the strategy guide presents Traveling Players as
a general archetype and `js/tag-definitions.js` lists it unconditionally. Flagged in the
rules reference; Stage 3 should decide whether to suppress the tag at 3p. Studio Boat's own
text corroborates ("In games with 1-3 players, this card is considered 'Traveling Players'").
By contrast **Grove and Hollow do exist at 3p**, so cards keyed to those are unaffected —
Clay Warden distinguishes the two counts explicitly.

**Follow-up for Stage 3:** `docs/agricola-strategy-guide.md` still mixes the two
vocabularies (it says "Grain Utilization" and "Lessons" in places, "Day Laborer" and
"Fishing" elsewhere, and never defines either set). It is labelled interpretation rather
than rules so the damage is limited, but normalizing it to card-text names is cheap.

**Exit criteria:** met. `node --check` passes, all three duplicate pairs verified identical,
card-text space-name coverage 100%.

---

## Stage 2 — Eval harness

**Goal:** make every later stage measurable. Without this, prompt changes are vibes.

**Why now:** it is the cheapest possible insurance against regressions, and Stage 1 already
needs validating.

**Work:**
- Capture 20-30 real draft states as JSON fixtures under `evals/fixtures/` — the exact
  request bodies `/api/strategy` receives. Cover both 3p and 4p, early/mid/late rounds, and
  at least three distinct archetypes.
- For each fixture, write down by hand what a strong player would say: the correct picks, the
  key synergy, and any mechanical claims that would be *wrong* if asserted.
- A runner script that posts each fixture and dumps responses to a timestamped directory.
- A rules-violation checklist scored by hand at first (does it misstate a cost, a yield, a
  capacity, a timing?). This is the metric that matters — the picks themselves are more
  subjective.

**Baseline variant.** `api/strategy/index.js` accepts `promptVariant: 'baseline'` in the
request body, reconstructing the pre-Stage-1 prompt — strategy guide and card index, no
rules reference. Same deployment, same model, same fixtures, so the A/B isolates the rules
block. Production defaults to `'current'` and is unaffected.

`STRATEGY_RATE_LIMIT_MAX` overrides the 5-per-10-minutes cap for local eval runs. Unset in
production, where the cap stands.

**Exit criteria:** a single command produces a diffable report across all fixtures, and
Stage 1's rules doc is confirmed to have reduced mechanical errors against the baseline
variant.

**Note:** `test-strategy.html` is the natural place to hang a browser-side version off, but
the runner should be scriptable so it can be run without a browser.

---

## Stage 3 — Data hygiene

**Goal:** stop feeding the model malformed records.

**Work:**
- **27 cards have an empty `type`** and **28 have no `description`.** Both fields are sent
  verbatim in `enrichCards()`. Identify and fix, or exclude them from the index.
- Decide the 3-player Traveling Players question: either suppress the tag at 3p in
  `js/tag-definitions.js` / `js/draft-stats.js`, or annotate it as situational.
- Re-verify the `data/` ↔ `api/data/` pair after any edit.

**Exit criteria:** no card sent to the model has an empty `type` or `description`; the 3p
Traveling Players decision is implemented and documented in CLAUDE.md.

---

## Stage 4 — Send what is already computed

**Goal:** two changes that need no new data, only plumbing. Highest value per unit effort
after Stage 1.

**4a — Deterministic stats into the user message.**
`js/draft-stats.js` already exports `analyzeHand`, `handPercentile`, `cardPullQuality` and
`additionalTagProbability`. `buildUserMessage()` in `api/strategy/index.js` currently sends
only names, round and player count. Pipe the computed analysis in, and instruct the model to
treat those numbers as given rather than estimating them.

**4b — Known-returning pool.**
In 4p rounds 5-7 (3p rounds 4-7), the player is drafting from hands they have **already
inventoried**. The set of cards that can come back is knowable: what was seen, minus
everything taken. The client tracks this — `analyzeHand` takes a `seenHands` parameter and
`probAtLeastOneTaggedSurvivesKnown()` already reconstructs it — but it never leaves the
browser. Send it, with full descriptions, labelled high-confidence.

**Exit criteria:** the model stops estimating quantities we know exactly, and late-round
advice references specific cards that can actually return. Measured against Stage 2 fixtures.

---

## Stage 5 — Card metadata enrichment (offline)

**Goal:** fix the 71% missing-tag problem and produce structure that makes filtering possible.

**Why offline:** this is the one place an LLM is genuinely high-leverage, and it costs nothing
at inference time. Run it once, review it once, commit the result.

**Work:**
- Batch job over all 820 cards extracting structured fields from each description: the action
  space it keys off, what it produces, whether it is strategy-defining or complementary, what
  it synergizes with, and the existing tag vocabulary.
- **Treat the output as untrusted, exactly like card intake.** The same OCR-era discipline
  applies: present results for approve / fix / deny before writing to the data files. Spot-check
  the top 200 by hand at minimum.
- Write to both `data/agricola-cards.json` and `api/data/agricola-cards.json`.
- `scripts/merge_rankings.py` must still pass afterwards.

**Exit criteria:** every ranked card carries usable structured metadata; tag coverage on the
top 200 is complete; both copies byte-identical.

---

## Stage 6 — Filtered live pool

**Goal:** deliver the thing that motivated this — "at my best I'm thinking about every card
that could still come, and the model should do that better than me."

**Depends on:** Stage 5.

**Work:**
- Server-side, compute the cards **not yet seen** and filter by relevance to the player's
  forming strategy using the Stage 5 metadata. Cap at roughly 60-80 cards.
- Send with descriptions, labelled explicitly as **speculative**, distinct from the
  Stage 4b known-returning pool.
- Rewrite the card-index instruction in the system prompt: it becomes a rank lookup, and the
  "reason about what may appear in future hands" instruction moves to the computed pools.

**Exit criteria:** the model reasons about future hands using concrete, real cards, and
fabricated card effects disappear from the Stage 2 eval reports.

---

## Stage 7 — Full descriptions in the static index (optional)

**Goal:** insurance against hallucinated card text for anything outside the computed pools.

Descriptions for all 773 ranked cards cost **~30K tokens** (vs ~4.4K today) on a static,
cached prefix — affordable, but it is not the mechanism that makes future-hand reasoning
good. Do this only if Stage 6's eval reports still show invented card effects.

**Caveat:** prompt caching needs traffic to stay warm. For a low-traffic solo tool, cache
misses will be common, so the 30K is not always discounted.

---

## Sequencing summary

| Stage | Depends on | Effort | Expected impact on "misunderstands the game" |
|---|---|---|---|
| 1. Rules grounding ✅ | — | small | **large** |
| 2. Eval harness | — | small | none directly; enables everything |
| 3. Data hygiene | — | small | small |
| 4. Send computed data | 2 | small | medium |
| 5. Metadata enrichment | 2, 3 | **large** | medium |
| 6. Filtered live pool | 5 | medium | **large** (on future-hand reasoning) |
| 7. Index descriptions | 6 | trivial | small, diminishing |

Stages 2, 3 and 4 are independent of each other and can be done in any order.

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

## Next steps (as of Aug 19 2026)

Ordered. The first three are small and unblock everything else.

1. **Tier 2 schema regression — ✅ FIXED (Aug 19 2026), deployed Aug 27 2026.**
   *Diagnosis was initially wrong.* The first read blamed the response-format instructions in
   the system prompt. The actual cause is structural and fully recoverable: the model
   intermittently **fails to close the `dimensions` object**, so `risks` and `suggestions` are
   emitted as siblings of `plow` instead of as top-level fields. The JSON still parses, so the
   server's strict `JSON.parse` succeeds and the response reaches the client looking merely
   incomplete — a blank dashboard built from content that was actually present all along.
   11 of 11 incomplete responses across both variants (7 current, 4 baseline) had exactly this
   shape.

   Fix: `hoistMisnestedFields()` in `api/strategy/index.js`, called on the parsed object before
   `normalizeSuggestions()`. It moves only the five known root-level schema keys; hoisting
   *any* unrecognised key would promote the model's hallucinated dimensions (observed:
   `"plow?"`, `"raw_materials"`) to the top level and hide them from the Tier 2 dimension
   checks, which should still flag them.

   Replayed over all 588 stored responses: **11 of 11 recovered, 0 healthy responses altered.**
   Tier 2 clean rate, same captures re-checked with the fix applied:

   | | before | after |
   |---|---|---|
   | current | 91% | **94%** |
   | baseline | 96% | **97%** |

   `schema-complete` findings go 13 → 0, `dimension-rating-valid` 16 → 2, and
   `suggestion-type-balance` 21 → 7 (a missing `suggestions` array was failing three checks at
   once). The residual current-vs-baseline gap is ~3pp, of which the 4 `response-usable`
   findings are the separate stream-degeneration failure below.

   **Deployed Aug 27 2026** in `fc29b18`. Verified live afterwards: `/api/probe-stream`
   still emits 1s-spaced keepalives, so the SSE path is unchanged. The next eval run
   should re-measure Tier 2 against production rather than replayed captures.

2. **Add fetch retry to `evals/judge.mjs`.** One `ConnectTimeoutError` killed a 40-minute
   judge run at 146/290. It resumed with no re-billing — the `done` set rebuilds from the
   output directory — but any run over a few hundred responses will hit this again. Mirror
   the backoff loop `evals/run.mjs` already uses for 429s.

3. **Make violations per _claim_ the primary Tier 1 metric.** Violations per response
   conflates accuracy with verbosity, and that hid a statistically solid accuracy gain behind
   a null result (see Stage 1). Report both, gate on the rate. `judge.mjs` already records
   `claimsChecked`, so this is a reporting change only.

4. **Revert `STRATEGY_RATE_LIMIT_MAX` to 5** on `agricola-api` once no further eval runs are
   queued. It is currently 100 to let eval traffic through.

5. **Decide Stage 4a's fate** — isolate it with a rules-only third variant, or strip it. See
   Stage 4.

6. **Stage 5 remains the main thrust.** The 14.1% error floor is the target, and the Stage 1
   result is evidence that adding more context will not move it.

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

**Measured (Aug 19 2026).** 98 fixtures × 3 runs per variant, `current` vs `baseline`.
Tier 1 judged by o4-mini against card text; Tier 2 asserted against the card database.

| Metric | Baseline | Current | 95% CI (cluster bootstrap, 98 fixtures) |
|---|---|---|---|
| Violations per response | 1.78 | 1.68 | [−0.31, +0.11] — crosses zero |
| Share of claims that are wrong | 16.3% | 14.1% | [−4.2, −0.2] pp — excludes zero |
| Claims per response | 10.9 | 11.8 | +8% |
| Responses with no violation | 16.4% | 22.1% | [−0.8, +12.0] pp |

**Read it carefully.** Accuracy per claim improved and that interval excludes zero, but the
model also got more talkative, so the per-response total barely moved. Predicted impact was
*large*; actual is modest. Even the significant result is small — the optimistic end of the
interval is a 26% relative error reduction, the pessimistic end is nothing.

By round, error rate moved −0.8 to −5.1pp everywhere except **round 1, which got worse
(+3.4pp)** — the one round specified as brief, and the one where claims per response still
rose (8.4 → 9.2).

**Keep it.** Directionally positive in six of seven rounds, drove `suggested-card-exists`
findings from 3 to 0 on Tier 2, and the input is ~99% cache-hit so marginal cost is small.

**The wider lesson:** a 31% increase in input tokens, containing the actual rulebook, bought
~2pp of accuracy. That is direct evidence for the Stage 5 thesis — context is not the binding
constraint.

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

**4a status (Aug 19 2026): shipped, UNVALIDATED, and under suspicion.**
The A/B ran Stage 1 and Stage 4a bundled, so the measured gain cannot be attributed between
them. The token split makes 4a the unlikely author: the computed-analysis block is ~200 of
the ~6,200 tokens added to the prompt. And round 1 — where the block is thinnest and least
informative — is the only round whose error rate got *worse*. Circumstantial, not proof.

**Decide before building on it.** Either run a rules-only third variant to isolate it (~294
requests, ~1 hour, ~$7), or strip 4a and re-measure. It carries real maintenance cost: a
duplicated file pair (`js/draft-stats.js` ↔ `api/lib/draft-stats.js`) and server-side
computation on every request.

**4b was never built.** The known-returning pool is still client-only.

---

## Stage 4c — Claim budget (added Aug 19 2026)

**Goal:** cut user-visible errors by making *fewer* claims, not only better ones.

Errors per response = claims per response × error rate. Stage 1 moved the error rate ~2pp,
and that is plausibly near the ceiling of what prompt context can do. The other factor is
untouched and larger: the model makes 11.8 claims per response, up from 10.9.

Round 1 is the clearest target — it regressed on accuracy while getting more verbose, and it
is already specified as the brief response, which the model is not honouring.

**Exit criteria:** claims per response falls in rounds 1-2 without the error rate rising.
Measured on the same fixtures, reported per claim as well as per response.

## Stage 5 — Card metadata enrichment (offline)

**Goal:** give the model, and the Stage 6 filter, structured facts about cards it currently
only knows as a name, a rank, and a sentence of prose.

### Correcting the earlier framing

An earlier version of this plan called the 548-of-773 untagged cards a "missing tag problem"
to be fixed by backfilling tags. **That was wrong, and backfilling tags onto everything would
make the data worse, not better.**

The 11 tags name *specific archetype clusters* — cards that make an underused action space
worth visiting, or that generate extra actions. Most cards do not belong to one, and should
not. Forest Clearer makes wood accumulation better for every strategy. Lover buys a family
growth outright. Basket Carrier is a food engine. These are excellent cards with no archetype
affiliation, and inventing one for them would create false synergy signals — the model would
start recommending cards *because they share a fabricated tag*, which is worse than it
recommending them on merit.

**Untagged is a real and correct state**, and Stage 4a already shows why: in one sampled
draft, ten of eighteen surviving cards in a returning hand carried no tag at all, and the
computed 0% "chance of another tagged card" was correct rather than a data gap.

So the target is not tag coverage. It is **structured metadata, of which a tag is one
optional field.**

### What to extract

Per card, from its existing `description`:

- **What it does** — produces a resource, converts a resource, grants an action, changes a
  cost, scores points, changes a rule.
- **What it keys off** — the action space or trigger it attaches to, if any (a Round card
  space, the Harvest, playing an occupation, building a room, sowing). Many cards attach to
  nothing and are simply always-on.
- **Commitment level** — strategy-defining (worthless without a supporting engine) versus
  complementary (improves actions you take regardless). This distinction already carries real
  weight in the strategy guide and is currently nowhere in the data.
- **Resources touched** — for cheap filtering on "what fills this gap."
- **Tag** — only where the card genuinely belongs to an archetype cluster. **Leaving it empty
  is the expected outcome for most cards** and must not be treated as a failure of the
  extraction.

A card that is simply strong on its own merits should come out as complementary, with the
resources it touches, and no tag. That record is complete, not deficient.

### How to run it

- One batch pass over all 820 cards. Offline, one time, committed — it costs nothing at
  inference.
- **Treat the output as untrusted, exactly like card intake.** The same discipline applies:
  present for approve / fix / deny before writing to the data files, and spot-check the top
  200 by hand. An extraction that quietly mislabels a strategy-defining card as complementary
  will push the model toward recommending it without its engine.
- Write to both `data/agricola-cards.json` and `api/data/agricola-cards.json`.
- `scripts/merge_rankings.py` must still pass afterwards.
- Skip cards flagged `banned: true` — they are name-only shells with nothing to extract.

### A quality check worth building in

Ask for the extraction twice with different phrasing and compare. Cards where the two passes
disagree on commitment level or on whether a tag applies are exactly the cards worth human
review. This turns "review 820 cards" into "review the ~50 the extractor was unsure about."

### Exit criteria

Every non-banned card carries structured metadata. Tag coverage is **not** a target and
should not be reported as a completion metric. Both copies byte-identical.

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
| 1. Rules grounding ✅ | — | small | predicted **large**; **measured modest** (−2.2pp error rate) |
| 2. Eval harness | — | small | none directly; enables everything |
| 3. Data hygiene | — | small | small |
| 4a. Send computed data ✅ | 2 | small | predicted medium; **unmeasured**, possibly zero |
| 4b. Known-returning pool | 2 | small | not built |
| 4c. Claim budget | 2 | small | medium (targets the other factor) |
| 5. Metadata enrichment | 2, 3 | **large** | medium (enables 6) |
| 6. Filtered live pool | 5 | medium | **large** (on future-hand reasoning) |
| 7. Index descriptions | 6 | trivial | small, diminishing |

Stages 2, 3 and 4 are independent of each other and can be done in any order.

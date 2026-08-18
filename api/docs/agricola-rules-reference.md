# Agricola Rules Reference

**Purpose:** authoritative mechanics for the AI strategy advisor. This document states
what the rules *are*. It contains no strategy opinion — that lives in
`agricola-strategy-guide.md`. Source: the official Agricola rulebook
(`f5-agricola-rulebook.pdf`, in this repo).

**This is base-game Agricola (Uwe Rosenberg), full game with Occupation and Minor
Improvement cards.** It is not Caverna, not the Family variant, and not any Agricola
expansion with different action spaces. There is no mining, no cave, no dwarf, no
weapons, no expeditions, no ore. If a recollection conflicts with this document, this
document is correct.

**Action-space names: use the names printed on the cards.** The card pool in this app uses
the newer action-space names — "Farmland", "Grain Seeds", "Lessons", "Grain Utilization",
"Quarry" — while the rulebook PDF in this repo uses the older ones — "Plow 1 Field",
"Take 1 Grain", "1 Occupation", "Sow and/or Bake bread", "1 Stone". **These are the same
spaces.** Section 8 gives the full mapping. Never treat an old name and a new name for the
same space as two different spaces, and never tell the player a space exists under a name
their cards do not use.

---

## 1. Game Shape

- **14 rounds**, grouped into **6 stages**.
- Stage 1 = rounds 1-4, Stage 2 = rounds 5-7, Stage 3 = rounds 8-9,
  Stage 4 = rounds 10-11, Stage 5 = rounds 12-13, Stage 6 = round 14.
- **A Harvest occurs at the end of every stage** — after rounds **4, 7, 9, 11, 13, 14**.
- Each player starts with a **2-room Wooden hut** and **2 Family members**.
- The starting player token moves only when a player takes the "Starting player" action.

> **Starting food and round-1 turn order — this app assumes the newer variant.**
> The rulebook in this repo is the older printing: starting player gets **2 Food**, everyone
> else **3 Food**, and every round uses straight clockwise order.
> The newer version, which is the one played here, gives **all players 3 Food** and runs
> **round 1 as a snake**: turn order is 1/2/3/4/4/3/2/1, so the last player places two
> workers back-to-back and the starting player places both first and last.
> Assume the newer variant. The practical effect is small — starting food is level, and
> round-1 denial is slightly less punishing for the last seat — but do not tell the player
> the starting player is down a Food.

### Round structure (four phases, every round)

1. **Start the round** — reveal the new Round card. Its action space becomes available
   this round and every round after. Effects triggered "at the start of a round" resolve now,
   including goods placed on Round spaces by cards.
2. **Replenish** — add goods to every accumulation space (spaces marked with an arrow).
   Goods left from previous rounds stay and accumulate; there is no cap.
3. **Work** — clockwise from the starting player, each player places **one** Family member
   on an **unoccupied** action space and immediately takes that action. Repeat until all
   Family members are placed. One placement per turn.
4. **Return home** — all Family members come back to the farmyard.

**Each action space holds exactly one Person per round.** This is the core contention
mechanism: taking a space denies it to all other players for that round. A Family member
may never occupy a space without performing its action.

---

## 2. The Harvest

Three phases, strictly in order.

**Phase 1 — Field.** Each **sown** field yields exactly **1 Grain or 1 Vegetable** (whichever
is planted) to the player's supply. Fields with nothing on them yield nothing.

**Phase 2 — Feeding.** Each Family member costs **2 Food**. A member born during the
current round costs **1 Food** in that Harvest only, then 2 thereafter. Shortfall is paid in
**Begging cards, one per missing Food, each worth −3 points at game end.** Players may
not remove Family members to avoid feeding.

- Grain and Vegetables in the supply convert to **1 Food each** at any time, no card needed.
  A Fireplace or Cooking Hearth converts Vegetables at a better rate — see section 7.
- **Animals have no Food value without a card.** Converting animals requires an
  Improvement or Occupation with the cooking symbol. Cooking needs **no action space** and
  may be done at any time, including part-way through a Harvest. Rates are in section 7.
- Baking bread requires a Baking Improvement **and** a Bake bread action — it cannot be
  done spontaneously during the Harvest.

**Phase 3 — Breeding.** Each animal type with **2 or more** animals produces **exactly 1**
baby — never more, regardless of herd size. The baby must have somewhere legal to live or
it is lost. Parents may be in separate pastures. Newly born animals and their parents
cannot be converted to Food to make room for the birth.

---

## 3. The Farmyard

**15 spaces, in a 3x5 grid.** Two are occupied by the starting Wooden hut rooms, leaving 13.

A space counts as **used** if it holds a room tile, a field tile, an unfenced stable, or is
enclosed by fences. Every **unused** space is **−1 point** at game end. This is the single
largest passive point drain in the game.

All same-type structures must be **orthogonally adjacent** to their existing group:
new rooms adjacent to rooms, new fields adjacent to fields, new pastures adjacent to pastures.
Diagonal does not count.

---

## 4. House and Family

### Building rooms

| House type | Cost per room |
|---|---|
| Wooden hut | 5 Wood + 2 Reed |
| Clay hut | 5 Clay + 2 Reed |
| Stone house | 5 Stone + 2 Reed |

New rooms are always the **same material as the current house**. There is no cap on room count.

### Renovation

- Wooden → Clay: **1 Clay per existing room + 1 Reed** (total).
- Clay → Stone: **1 Stone per existing room + 1 Reed** (total).
- The whole house renovates at once; individual rooms cannot be upgraded.
- **One renovation step per action.** Wood → Stone in a single action is illegal.
- The first Renovation space (**House Redevelopment**) appears in **Stage 2**. A second
  (**Farm Redevelopment**) appears in **round 14 only**.

Renovation is cheaper with fewer rooms, which is the entire mechanical basis of the
small-house-to-stone plan.

### Family growth

- Requires **more rooms than Family members** — the **Wish for Children** space (rulebook:
  "After Family growth, also 1 Minor Improvement"), Stage 2.
- The **Family Growth Even without Room** space (Stage 5) waives the room requirement.
- **Maximum 5 Family members.**
- A newborn is placed on the action space, comes home in phase 4, and is **not usable
  until the following round**.
- A player may not take Wish for Children purely to play the Minor Improvement — growth must
  actually happen. (By contrast, **Farm Expansion** — Build Rooms and/or Build Stables — *is*
  optional in both halves.)

### Growth from cards

**The two Round-card spaces are not the only way to grow.** Many Occupations and Minor
Improvements grant Family Growth directly, and several bypass the room requirement. Card
text overrides the general room rule. Examples from the card pool:

- **Lover** — on play, pay Food equal to the number of complete rounds remaining to take a
  "Family Growth Even without Room" action immediately.
- **Field Doctor** — once per game, with exactly 2 rooms surrounded by 4 field tiles, use any
  Family Growth space even without room.
- **Family Friendly Home** — taking a Build Rooms action while already having more rooms than
  people also grants a Family Growth action.
- **Stork's Nest**, **Autumn Mother**, **Bed in the Grain Field** — growth triggered in the
  Return Home phase, before a Harvest, or at the start of a Harvest, rather than as a
  placed action.

Consequently, **card-granted growth can happen outside the Work phase entirely**, and can
happen in rounds before the Stage 2 growth space appears.

Card text distinguishes three phrasings, and the difference matters:

| Phrase | Meaning |
|---|---|
| "Family Growth" | The standard action — **requires more rooms than Family members**. |
| "Family Growth Even without Room" | Ignores the room requirement. |
| "Family Growth with Room Only" | Explicitly requires room; cannot be converted. |

**The 5-member maximum applies to every route**, including all card-granted growth.

---

## 5. Fields, Sowing, Baking

**Farmland** (rulebook: "Plow 1 Field") places one field tile on an empty, unfenced space,
orthogonally adjacent to existing fields. Fields can never be removed. At most **one Plow Improvement** may be used
per Plow action.

**Sow** — take seed from the **personal supply** (not from a field) and plant empty fields:

- **1 Grain sown → 3 Grain on the field** (the seed plus 2 from the general supply).
- **1 Vegetable sown → 2 Vegetables on the field** (the seed plus 1).

One Sow action may plant **any number of empty fields**. A field emptied by harvesting
does **not** need re-plowing — it can simply be re-sown. Grain taken via **Grain Seeds**
cannot be sown in the same action; sowing requires **Grain Utilization** or **Cultivation**.

**Bake bread** converts Grain from the supply to Food, and requires both a Bake action space
(**Grain Utilization**) and a Baking Improvement:

| Improvement | Conversion |
|---|---|
| Fireplace | 1 Grain → 2 Food |
| Cooking Hearth | 1 Grain → 3 Food |
| Clay Oven | at most 1 Grain → 5 Food |
| Stone Oven | up to 2 Grain → 4 Food each |

---

## 6. Animals, Pastures, Stables

- Each player may keep **exactly 1 animal as a pet** in the house, free, taking no room.
- **Pastures hold 2 animals per enclosed farmyard space.** A 1-space pasture holds 2, a
  2-space pasture holds 4, and so on.
- **Each pasture holds only one animal type.**
- A **stable inside a pasture doubles the capacity of that entire pasture** (two stables in
  one pasture quadruple it).
- Stables cost **2 Wood**, maximum **4 per player**, one per space, placed on any space
  without a room or field. An **unfenced stable holds exactly 1 animal**. Stables cannot be
  removed but can be fenced in later.

### Fencing

- **1 Wood per fence**, maximum **15 fences** per player.
- Fences may only be built if they complete a **fully enclosed** pasture.
- **The board edge, rooms, fields, and stables do NOT act as fences.** A pasture must be
  bordered by real fences on every side, including along the house and along the board edge.
- Fences cannot be demolished. Existing pastures may be subdivided by adding fences.
- Fields and rooms may not be fully enclosed.
- Animals may be rearranged or released at any time.

---

## 7. Cards

### Occupations

- In a normal game each player starts with **7 Occupation cards and 7 Minor Improvement
  cards** in hand. (In this app's draft mode both are acquired by drafting rather than dealt
  — 1 Occupation and 1 Minor per round over 7 rounds, reaching the same 7 and 7.)
- **The Occupation deck is restricted by player count.** Every Occupation is marked 1-5, 3-5
  or 4-5, and cards above the current count are removed before dealing. The full deck exists
  only at 4-5 players, so the 3-player pool is strictly smaller than the 4-player pool.
- Played on a **Lessons** space (rulebook: "1 Occupation"). Card text applies immediately on
  play. **Cards in hand have no effect.**
- **Occupations never have a resource cost, never have printed VP, and are never "passing."**
  Their only cost is Food to play, and the action.

**Occupation play costs vary by player count** — this matters for the draft:

| Space | Cost |
|---|---|
| Main-board **Lessons** (all counts) | **first Occupation free, each additional 1 Food** |
| 3-player extra **Lessons** | **2 Food** always |
| 4-player extra **Lessons** | **1 Food** for your 1st or 2nd Occupation, **2 Food** after |

### Improvements

- **Minor Improvements** are private, held in hand, and cost the goods printed in the
  upper-right corner. Some show a slash, meaning a choice between two payment options.
- Some Minor Improvements have a **prerequisite** (top-left corner) that must be satisfied
  by things already on the table. Having more than the requirement is fine.
- Grain and Vegetables spent as costs must come from the supply, **never off a field**.
- **Traveling / passing** Minor Improvements are handed to the player on the left after being
  played. Only Minor Improvements can pass.
- **Upgrade** Minor Improvements require returning an already-played Improvement. A returned
  **Major** goes back on the Major Improvements board and may be bought again by anyone
  (including the same player); a returned **Minor** is removed from the game.
- Improvements may be bought on the "1 Major or Minor Improvement" space and on
  **House Redevelopment**; and — Minors only — on **Meeting Place** and **Wish for
  Children**.

### Major Improvements

**Ten cards**, shared, on their own board, available to every player first-come-first-served.
Ten and not eight because there are **two Fireplace cards and two Cooking Hearth cards** —
identical in effect, differing only in price. A player may own several of them.

| Card | Copies | Cost | VP |
|---|---|---|---|
| Fireplace | **2** | one costs 2 Clay, the other 3 Clay | 1 each |
| Cooking Hearth | **2** | one costs 4 Clay, the other 5 Clay | 1 each |
| Clay Oven | 1 | 3 Clay + 1 Stone | 2 |
| Stone Oven | 1 | 1 Clay + 3 Stone | 3 |
| Joinery | 1 | 2 Stone + 2 Wood | 2 |
| Pottery | 1 | 2 Stone + 2 Clay | 2 |
| Basketmaker's Workshop | 1 | 2 Stone + 2 Reed | 2 |
| Well | 1 | 3 Stone + 1 Wood | 4 |

**The two prices are not a choice.** The cheap Fireplace and the expensive Fireplace are
separate cards on separate spaces. Buying the 2-Clay one denies it to everyone else and
leaves the 3-Clay one available — so two players can each end up with a Fireplace, and the
cheap copy is a genuinely contested early pick.

A player taking a Major Improvement action may **upgrade a Fireplace to a Cooking Hearth at
no cost**, returning the Fireplace to the board where anyone may buy it again.

#### Cooking rates (Fireplace / Cooking Hearth)

These apply **at any time and need no action space** — only *baking* requires a Bake bread
action. This is the mechanism that gives animals and Vegetables real Food value.

| Converted | Fireplace | Cooking Hearth |
|---|---|---|
| Grain (baking only, needs the action) | 2 Food | 3 Food |
| Vegetable | 2 Food | 3 Food |
| Sheep | 2 Food | 2 Food |
| Wild boar | 2 Food | 3 Food |
| Cattle | 3 Food | 4 Food |

The Cooking Hearth is +1 Food over the Fireplace on bread, Vegetables, Wild boar and Cattle —
and **exactly equal on Sheep**. A sheep-only herd gains nothing from the upgrade.

Joinery, Pottery and Basketmaker's Workshop each convert up to 1 Wood / Clay / Reed to 2-3
Food **per Harvest**, and score up to 3 bonus points for holding several of that resource.

The Well gives 1 Food at the start of each of **up to** the next 5 rounds — bought late it
simply pays out fewer times, though its 4 VP is unaffected.

---

## 8. Action Spaces

### Name mapping — read this before reasoning about any card

Card text uses the **left** column. The rulebook PDF uses the **right** column. They are the
same spaces. **Always reason and answer using the left column**, because that is what the
player sees printed on their cards.

| Card text (use this) | Rulebook name | Notes |
|---|---|---|
| **Forest** | 3 Wood | accumulation |
| **Clay Pit** | 1 Clay | accumulation |
| **Reed Bank** | 1 Reed | accumulation |
| **Fishing** | Fishing | accumulation, 1 Food/round |
| **Day Laborer** | Day Laborer | 2 Food, fixed |
| **Grain Seeds** | Take 1 Grain | |
| **Farmland** | Plow 1 Field | |
| **Lessons** | 1 Occupation | |
| **Farm Expansion** | Build Room(s) and/or Build Stable(s) | |
| **Meeting Place** | Starting Player and/or 1 Minor Improvement | |
| **Grain Utilization** | Sow and/or Bake bread | Stage 1 |
| **Sheep Market** | 1 Sheep | Stage 1, accumulation |
| **Fencing** | Fences | Stage 1 |
| **Quarry** | 1 Stone | Stage 2 **and** Stage 4 — **two** Quarry spaces exist, both accumulation |
| **House Redevelopment** | After Renovation, also 1 Major or Minor Improvement | Stage 2 |
| **Wish for Children** | After Family growth, also 1 Minor Improvement | Stage 2 |
| **Vegetable Seeds** | Take 1 Vegetable | Stage 3 |
| **Pig Market** | 1 Wild Boar | Stage 3, accumulation |
| **Cattle Market** | 1 Cattle | Stage 4, accumulation |
| **Cultivation** | Plow and/or Sow 1 field | Stage 5 |
| **Family Growth Even without Room** | Family growth even without room | Stage 5 |
| **Farm Redevelopment** | After Renovation, also Fences | Stage 6, round 14 only |

Card text also names **actions** rather than spaces: "Build Rooms", "Build Stables",
"Build Fences", "Family Growth", "Major or Minor Improvement", "Sow", "Bake Bread". These
mean *take that action* — usually without placing a person and without occupying the space.
That is how cards hand out actions outside a normal placement.

### Always present (printed on the main board)

Accumulation spaces (goods build up each round, taker gets **all** of them):
**Forest** (3 Wood), **Clay Pit** (1 Clay), **Reed Bank** (1 Reed), **Fishing** (1 Food/round).

Fixed-yield spaces: **Day Laborer** (2 Food), **Grain Seeds**, **Farmland**, **Lessons**,
**Farm Expansion**, **Meeting Place**.

### Appearing by stage (Round cards)

| Stage | Rounds | Spaces added |
|---|---|---|
| 1 | 1-4 | Grain Utilization · 1 Major or Minor Improvement · Sheep Market · Fencing |
| 2 | 5-7 | Quarry · House Redevelopment · Wish for Children |
| 3 | 8-9 | Vegetable Seeds · Pig Market |
| 4 | 10-11 | Quarry (second) · Cattle Market |
| 5 | 12-13 | Cultivation · Family Growth Even without Room |
| 6 | 14 | Farm Redevelopment |

**The order within each stage is randomized.** Which round in Stage 2 brings Wish for
Children is not knowable in advance.

### Player-count-dependent spaces

Extra spaces are added so there are enough actions to go round. **A 3-player game adds 4 of
them; a 4-player game adds 6.** Most simply supply resources or Food, which is why the
rulebook names only the others.

- **3 players:** an extra **Lessons** space costing **2 Food** always, plus three
  resource/Food spaces.
- **4 players:** **Resource Market** ("Take 1 Reed, 1 Stone and 1 Food"), an extra **Lessons**
  space (**1 Food** for your 1st or 2nd Occupation, **2 Food** after), the **Traveling
  Players** accumulation space (1 Food/round), plus further resource/Food spaces.

**Extra accumulation spaces named by card text.** The rulebook does not enumerate the plain
resource spaces on the player-count boards, but cards key off them by name and they are real:

- **Grove** — a second wood accumulation space, alongside Forest.
- **Hollow** — a second clay accumulation space, alongside Clay Pit. Present at **both 3 and
  4 players** (Clay Warden's text distinguishes the two counts explicitly).
- **Copse** — a further small wood accumulation space at higher player counts.

Treat their existence as certain. Where a card does not state a threshold, do not assert a
precise player count for Grove or Copse.

> **Important for 3-player drafts: the Traveling Players space does not exist below 4
> players.** It is present only at 4 and 5. Cards keyed to it are substantially weaker —
> often dead — at 3p. Studio Boat states this on the card: in games with 1-3 players it
> substitutes for the missing space. Note the contrast: **Grove and Hollow do exist at 3p**,
> so cards keyed to *those* are unaffected.

---

## 9. Scoring

| Category | −1 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| Fields | 0-1 | 2 | 3 | 4 | 5+ |
| Pastures | 0 | 1 | 2 | 3 | 4+ |
| Grain | 0 | 1-3 | 4-5 | 6-7 | 8+ |
| Vegetables | 0 | 1 | 2 | 3 | 4+ |
| Sheep | 0 | 1-3 | 4-5 | 6-7 | 8+ |
| Wild boar | 0 | 1-2 | 3-4 | 5-6 | 7+ |
| Cattle | 0 | 1 | 2-3 | 4-5 | 6+ |

Plus:

- **−1 per unused farmyard space**
- **+1 per fenced stable** (unfenced stables score nothing, but do make the space "used")
- **+1 per Clay room**, **+2 per Stone room**, **0 per Wooden room**
- **+3 per Family member** (max 5 → 15)
- **−3 per Begging card**
- **Printed VP** on Minor and Major Improvements, plus any bonus points from card text

Scoring notes: **Pastures score per enclosed area, not per space** — size is irrelevant.
Fields score whether sown or fallow. Grain and Vegetables count both in the supply and
on fields.

---

## 10. Common Misconceptions — Explicitly False

- Fields do **not** need re-plowing after harvest.
- The board edge and buildings do **not** serve as pasture fences.
- Animals **cannot** be eaten without a cooking card.
- A player **cannot** renovate twice in one action.
- Occupations have **no** resource cost, **no** printed VP, and **never** pass.
- Newborn Family members **cannot** act in the round they are born.
- Family growth is **not** limited to the two Round-card spaces, and **not** limited to the
  Work phase — cards grant it too, some of them before Stage 2.
- The starting player is **not** down a Food in the variant played here; all players start
  with 3, and round 1 is a snake.
- More than 2 animals of a type still breeds only **1** baby.
- Grain taken from **Grain Seeds** **cannot** be sown in the same action.
- Traveling Players **does not exist at 3 players** — but **Grove** and **Hollow** do.
- "Farmland" and "Plow 1 Field" are the **same space**. So are Grain Seeds / Take 1 Grain,
  Lessons / 1 Occupation, Grain Utilization / Sow-and-Bake, Quarry / 1 Stone, Farm Expansion /
  Build Rooms. An old name and a new name are **never** two different spaces.
- There are **two** Fireplace cards and **two** Cooking Hearth cards. The listed prices are
  **not** a choice — they are separate cards, and two players can each own one.
- A Cooking Hearth is **not** an upgrade on Sheep — Fireplace and Hearth both give 2 Food.
- Cooking animals and Vegetables needs **no** action space; only *baking* does.
- The Well pays out **at most** 5 times, fewer if bought late.
- There is no scoring during the game; scoring happens once, after round 14.

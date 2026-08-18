#!/usr/bin/env python3
"""
Turn archived draft states into /api/strategy eval fixtures.

One completed draft yields 7 fixtures — one per round — because `hands` is
snapshotted per round in draft.html rather than only at completion.

Usage:
    python3 evals/extract.py --pull                 # read straight from Azure
    python3 evals/extract.py --input raw.json       # read a saved table dump
    python3 evals/extract.py --pull --out evals/fixtures

Requires (for --pull) an `az login` session with Storage Table Data Reader on
the `agricoladraft` account.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict

ACCOUNT = "agricoladraft"
TABLE = "drafts"

# Rotation: which physical hand is seen in each round (index 0 == round 1).
# Mirrors getRotation() in draft.html — keep in sync.
ROTATION = {
    4: [1, 2, 3, 4, 1, 2, 3],
    3: [1, 2, 3, 1, 2, 3, 1],
}

TOTAL_ROUNDS = 7

# Cards of EACH type dealt per round; a stored hand holds both tracks, so the
# combined hand is twice this. Mirrors HAND_SIZE_BY_ROUND in draft.html.
HAND_SIZE_BY_ROUND = [10, 9, 8, 7, 6, 5, 4]

# First round in which a hand comes back around, by player count.
FIRST_RETURNING_ROUND = {4: 5, 3: 4}


# ── loading ──────────────────────────────────────────────────────────────

def pull_from_azure():
    """Read the drafts table via the az CLI using AAD auth."""
    cmd = [
        "az", "storage", "entity", "query",
        "--table-name", TABLE,
        "--account-name", ACCOUNT,
        "--auth-mode", "login",
        "--num-results", "1000",
        "-o", "json",
    ]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("az query failed:\n" + out.stderr.strip())
    return json.loads(out.stdout)


def load_rows(payload):
    items = payload.get("items", payload if isinstance(payload, list) else [])
    rows = []
    for it in items:
        if it.get("RowKey") == "active":
            continue  # in-progress draft, not a complete 7-round record
        state = it.get("state")
        if isinstance(state, str):
            state = json.loads(state)
        if not state:
            continue
        rows.append({
            "id": it["RowKey"],
            "archivedAt": int(it.get("archivedAt") or 0),
            "state": state,
        })
    return rows


# ── dedupe ───────────────────────────────────────────────────────────────

def content_key(state):
    """Identity of a draft by its actual content, ignoring archive metadata."""
    payload = {
        "playerCount": state.get("playerCount"),
        "hands": state.get("hands"),
        "draftedCards": state.get("draftedCards"),
    }
    blob = json.dumps(payload, sort_keys=True)
    return hashlib.sha1(blob.encode()).hexdigest()[:12]


def dedupe(rows):
    """Collapse repeat archives of the same draft, keeping the newest row."""
    groups = defaultdict(list)
    for r in rows:
        groups[content_key(r["state"])].append(r)
    unique, dupes = [], []
    for key, members in groups.items():
        members.sort(key=lambda r: r["archivedAt"], reverse=True)
        unique.append(members[0])
        if len(members) > 1:
            dupes.append((key, len(members), [m["id"] for m in members[1:]]))
    unique.sort(key=lambda r: r["archivedAt"])
    return unique, dupes


# ── replay ───────────────────────────────────────────────────────────────

def hand_number(round_no, player_count):
    return ROTATION[player_count][round_no - 1]


def user_picks(state, round_no):
    """The user's own picks in a given round, as a list of names."""
    picks = (state.get("draftedCards") or {}).get(str(round_no)) \
        or (state.get("draftedCards") or {}).get(round_no) or {}
    return [picks[k] for k in ("occupation", "minor") if picks.get(k)]


def get_hand(state, round_no):
    hands = state.get("hands") or {}
    return hands.get(str(round_no)) or hands.get(round_no) or []


def drafted_before(state, round_no):
    """Everything the user had drafted going into `round_no`."""
    out = []
    for r in range(1, round_no):
        out.extend(user_picks(state, r))
    return out


def opponent_losses_by_hand(state, player_count):
    """
    Map each opponent-taken card to the physical hand it was taken from.

    `hands[r]` stores the hand as carried forward minus only the USER's own
    picks — opponent removals are never applied to it (verified across all 46
    returning-hand transitions in the archive). So the opponent picks live
    solely in the flat `othersDrafted` array, and attribution has to come from
    membership: a card belongs to whichever hand contained it.
    """
    hands = state.get("hands") or {}
    by_hand = defaultdict(list)
    ambiguous = []
    for name in state.get("othersDrafted") or []:
        homes = {
            hand_number(r, player_count)
            for r in range(1, TOTAL_ROUNDS + 1)
            if name in (hands.get(str(r)) or hands.get(r) or [])
        }
        if len(homes) == 1:
            by_hand[homes.pop()].append(name)
        else:
            ambiguous.append(name)
    return by_hand, ambiguous


def returned_hands_by(round_no, player_count):
    """Hand numbers the user has seen for a SECOND time by `round_no`."""
    rot = ROTATION[player_count]
    counts = defaultdict(int)
    returned = []
    for r in range(1, round_no + 1):
        h = rot[r - 1]
        counts[h] += 1
        if counts[h] > 1 and h not in returned:
            returned.append(h)
    return returned


def others_drafted_as_of(state, round_no, player_count, losses):
    """
    Opponent picks the user knows about at `round_no`.

    A hand's losses become visible exactly when that hand comes back — the
    marking phase. Before the first returning round nothing is known, which is
    correct: the user genuinely has no opponent information yet.
    """
    known = []
    for h in returned_hands_by(round_no, player_count):
        known.extend(losses.get(h, []))
    return known


def available_hand(state, round_no, player_count, losses):
    """
    The hand as the user actually saw it — stored hand minus what opponents
    took from it. Only differs from the stored hand on returning rounds.
    """
    hand = list(get_hand(state, round_no))
    h = hand_number(round_no, player_count)
    if h in returned_hands_by(round_no, player_count):
        gone = set(losses.get(h, []))
        hand = [c for c in hand if c not in gone]
    return hand


def build_fixtures(row):
    state = row["state"]
    player_count = 3 if state.get("playerCount") == 3 else 4
    losses, ambiguous = opponent_losses_by_hand(state, player_count)

    # In 3p, hand 1 is seen three times, so its losses span two separate return
    # events that the flat `othersDrafted` array cannot distinguish. 4p has at
    # most one return per hand, so attribution there is exact.
    approximate = player_count == 3

    fixtures = []
    for rnd in range(1, TOTAL_ROUNDS + 1):
        if not get_hand(state, rnd):
            continue
        hand = available_hand(state, rnd, player_count, losses)
        fixtures.append({
            # ── exact /api/strategy request body ──
            "handNames": hand,
            "draftedNames": drafted_before(state, rnd),
            "othersDrafted": others_drafted_as_of(state, rnd, player_count, losses),
            "round": rnd,
            "playerCount": player_count,
            # ── metadata, stripped before POSTing ──
            "_meta": {
                "fixtureId": f"{row['id'][-6:]}_r{rnd}",
                "sourceDraft": row["id"],
                "archivedAt": row["archivedAt"],
                "handNumber": hand_number(rnd, player_count),
                "handSize": len(hand),
                "expectedHandSize": HAND_SIZE_BY_ROUND[rnd - 1] * 2,
                "userPicks": user_picks(state, rnd),
                "returningRound": rnd >= FIRST_RETURNING_ROUND[player_count],
                "approximateOpponents": approximate,
                "ambiguousAttribution": ambiguous,
            },
        })
    return fixtures


# ── validation ───────────────────────────────────────────────────────────

def validate(row, fixtures):
    """
    Check the reconstruction against independently-known ground truth.

    The strong assertion is hand size: after removing opponent picks, every
    round must match HAND_SIZE_BY_ROUND x2. That is derived from the game's
    rules, not from the same data we are reconstructing from, so it is a real
    check rather than a tautology.

    Also verifies that the user's own picks were actually available in the hand
    they were picked from.
    """
    problems = []
    for fx in fixtures:
        m = fx["_meta"]
        if m["handSize"] != m["expectedHandSize"]:
            problems.append(
                f"r{fx['round']}: hand size {m['handSize']}, expected {m['expectedHandSize']}"
            )
        missing = [p for p in m["userPicks"] if p not in fx["handNames"]]
        if missing:
            problems.append(f"r{fx['round']}: own pick(s) not in hand: {missing}")
        if m["ambiguousAttribution"]:
            problems.append(
                f"r{fx['round']}: unattributable opponent picks: {m['ambiguousAttribution']}"
            )
    return {"draft": row["id"], "problems": problems}


# ── main ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--pull", action="store_true", help="read from Azure via az CLI")
    src.add_argument("--input", help="path to a saved table dump")
    ap.add_argument("--out", default="evals/fixtures", help="fixture output dir")
    ap.add_argument("--raw-out", help="also save the raw table dump here")
    args = ap.parse_args()

    payload = pull_from_azure() if args.pull else json.load(open(args.input))
    if args.raw_out:
        with open(args.raw_out, "w") as f:
            json.dump(payload, f, indent=1)

    rows = load_rows(payload)
    unique, dupes = dedupe(rows)

    print(f"rows: {len(rows)}  ->  unique drafts: {len(unique)}")
    for key, count, dropped in dupes:
        print(f"  deduped x{count}  {key}  (dropped {', '.join(d[-6:] for d in dropped)})")

    os.makedirs(args.out, exist_ok=True)
    manifest, problems = [], []
    pc_counter, round_counter = Counter(), Counter()

    for row in unique:
        fixtures = build_fixtures(row)
        check = validate(row, fixtures)
        draft_ok = not check["problems"]
        if not draft_ok:
            problems.append(check)
        for fx in fixtures:
            meta = fx["_meta"]
            # A draft whose reconstruction fails is quarantined wholesale — if
            # one round's geometry is wrong the rest of that draft's opponent
            # state is suspect too.
            meta["valid"] = draft_ok
            path = os.path.join(args.out, meta["fixtureId"] + ".json")
            with open(path, "w") as f:
                json.dump(fx, f, indent=2)
            if draft_ok:
                pc_counter[fx["playerCount"]] += 1
                round_counter[fx["round"]] += 1
            manifest.append({
                "fixtureId": meta["fixtureId"],
                "file": os.path.basename(path),
                "round": fx["round"],
                "playerCount": fx["playerCount"],
                "handSize": meta["handSize"],
                "drafted": len(fx["draftedNames"]),
                "othersKnown": len(fx["othersDrafted"]),
                "returningRound": meta["returningRound"],
                "approximateOpponents": meta["approximateOpponents"],
                "valid": meta["valid"],
            })

    usable = [m for m in manifest if m["valid"]]
    excluded = [m for m in manifest if not m["valid"]]
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump({"fixtures": usable, "excluded": excluded}, f, indent=2)

    total = len(usable)
    print(f"\nwrote {len(manifest)} fixtures -> {args.out}")
    print(f"usable: {total}   quarantined: {len(excluded)}")
    if total:
        print("player count:", {f"{k}p": v for k, v in sorted(pc_counter.items())},
              f"({pc_counter[4] / total:.0%} 4p)")
    print("by round:", dict(sorted(round_counter.items())))

    if problems:
        print("\n!! quarantined drafts (excluded from the usable set):")
        for p in problems:
            print(f"  {p['draft'][-6:]}:")
            for msg in p["problems"]:
                print(f"      {msg}")
    if not problems:
        print("\nreconstruction check: OK — every hand size matches HAND_SIZE_BY_ROUND x2, "
              "every recorded pick was available in its hand")


if __name__ == "__main__":
    main()

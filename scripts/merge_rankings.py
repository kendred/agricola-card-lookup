#!/usr/bin/env python3
"""
Merge 3-player and 4-player ranking TSVs into agricola-cards.json.

Updates 4p stats at top level, adds stats_3p object.
Removes 'pwr' field (redundant with rank).
Derives play_rate from Plays/Drafted and value/value_when_played.

Source data: Lumin_S's BGA forum post (Jan-Jul 2025)
https://forum.boardgamearena.com/viewtopic.php?p=226327#p226327
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
CARDS_JSON = os.path.join(ROOT_DIR, 'data', 'agricola-cards.json')
API_CARDS_JSON = os.path.join(ROOT_DIR, 'api', 'data', 'agricola-cards.json')
TSV_4P = os.path.join(ROOT_DIR, 'data', 'agricola-4p-rankings.tsv')
TSV_3P = os.path.join(ROOT_DIR, 'data', 'agricola-3p-rankings.tsv')


# TSV rows identify cards by name only, so two cards printed with the same name
# (e.g. the C054 and B008 Market Stalls) can't be told apart by the matcher.
# List their card_ids in the order their rows appear in each TSV — i.e. by
# ascending rank — so each row lands on the right card. A duplicate name that
# isn't listed here aborts the merge rather than silently clobbering one card.
#
# Note the DB name may be disambiguated ("Market Stall (B008)") while the TSV
# still carries the printed name; matching happens on the normalized TSV name.
DUPLICATE_ROW_ORDER = {
    'marketstall': {'4p': ['C054', 'B008'], '3p': ['C054', 'B008']},
}


def exact_key(name: str) -> str:
    """Lowercase + collapse whitespace, but keep it otherwise intact.

    Preserves the distinction between genuinely different cards whose names
    only differ by spacing/punctuation (e.g. Greengrocer B142 vs Green Grocer
    C103), which normalize() below deliberately collapses.
    """
    return ' '.join(name.lower().split())


def normalize(name: str) -> str:
    """Lowercase, remove spaces, hyphens, apostrophes, periods, accents."""
    s = name.lower().strip()
    for ch in (" ", "-", "'", ".", "\u2019"):  # include smart apostrophe
        s = s.replace(ch, "")
    # Handle common accent variants
    s = s.replace("\u00e9", "e")  # e with accent
    return s


def parse_tsv(filepath):
    """Parse a rankings TSV file. Returns list of dicts."""
    rows = []
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Parse header
    header = lines[0].strip().split('\t')
    header = [h.strip() for h in header]

    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split('\t')
        parts = [p.strip() for p in parts]
        if len(parts) < len(header):
            continue
        row = {}
        for i, col in enumerate(header):
            row[col] = parts[i] if i < len(parts) else ''
        rows.append(row)

    return rows


def derive_stats(row):
    """Convert a TSV row to our stat fields."""
    rank = int(row.get('Rank', '0'))
    adp = row.get('ADP', '0')
    apr = row.get('APR', '0')
    elo_per_play = row.get('Elo/Play', '0')

    # Derive play_rate from Plays/Drafted
    drafted = int(row.get('Drafted', '0'))
    plays = int(row.get('Plays', '0'))
    if drafted > 0:
        play_rate_pct = round(100 * plays / drafted)
        play_rate = f"{play_rate_pct}%"
    else:
        play_rate = "0%"

    # Derive value = adp * elo_per_play
    try:
        adp_f = float(adp)
        epp_f = float(elo_per_play)
        value = round(adp_f * epp_f, 4)
    except (ValueError, ZeroDivisionError):
        value = 0

    # Derive value_when_played = elo_per_play / (play_rate_fraction)
    # This represents the elo impact adjusted for how often it's played
    try:
        epp_f = float(elo_per_play)
        pr_frac = plays / drafted if drafted > 0 else 0
        if pr_frac > 0:
            value_when_played = round(epp_f / pr_frac, 1)
        else:
            value_when_played = 0
    except (ValueError, ZeroDivisionError):
        value_when_played = 0

    return {
        'rank': rank,
        'adp': adp,
        'apr': apr,
        'play_rate': play_rate,
        'elo_per_play': elo_per_play,
        'value': str(value),
        'value_when_played': str(value_when_played),
    }


def main():
    # Load existing cards
    with open(CARDS_JSON, 'r', encoding='utf-8') as f:
        cards = json.load(f)
    print(f"Loaded {len(cards)} cards from JSON")

    # Name -> card indices (a name can cover >1 card), plus a card_id index
    exact_to_indices = {}
    norm_to_indices = {}
    id_to_idx = {}
    for i, card in enumerate(cards):
        exact_to_indices.setdefault(exact_key(card['name']), []).append(i)
        norm_to_indices.setdefault(normalize(card['name']), []).append(i)
        if card.get('card_id'):
            id_to_idx[card['card_id']] = i

    # Parse TSVs
    rows_4p = parse_tsv(TSV_4P)
    rows_3p = parse_tsv(TSV_3P)
    print(f"Parsed {len(rows_4p)} rows from 4p TSV")
    print(f"Parsed {len(rows_3p)} rows from 3p TSV")

    # Consumed one at a time as duplicate-named rows come up, in TSV order
    dup_queues = {
        tsv_key: {n: list(ids[tsv_key]) for n, ids in DUPLICATE_ROW_ORDER.items()}
        for tsv_key in ('4p', '3p')
    }
    ambiguous = []
    # card index -> TSV names that wrote to it, per TSV. Two names landing on
    # one card is the signature of the silent-clobber bug this guards against.
    written = {'4p': {}, '3p': {}}

    def resolve_index(n, name, tsv_key):
        """TSV row -> card index. None means unmatched; ambiguity is fatal.

        Order matters: hand-listed duplicates first (their DB names have been
        disambiguated, so an exact match would wrongly grab just one of them),
        then exact name, then the accent/punctuation-insensitive fallback.
        """
        if n in DUPLICATE_ROW_ORDER:
            queue = dup_queues[tsv_key][n]
            if not queue:
                ambiguous.append(
                    f"{name} ({tsv_key}): more TSV rows than card_ids listed in "
                    f"DUPLICATE_ROW_ORDER['{n}']")
                return None
            card_id = queue.pop(0)
            if card_id not in id_to_idx:
                ambiguous.append(
                    f"{name} ({tsv_key}): DUPLICATE_ROW_ORDER lists card_id "
                    f"{card_id}, which is not in the card database")
                return None
            print(f"  duplicate name '{name}' ({tsv_key}) -> {card_id}")
            return id_to_idx[card_id]
        exact = exact_to_indices.get(exact_key(name))
        if exact and len(exact) == 1:
            return exact[0]
        indices = norm_to_indices.get(n)
        if not indices:
            return None
        if len(indices) > 1:
            names = ', '.join(f"{cards[i]['name']} [{cards[i].get('card_id') or '?'}]"
                              for i in indices)
            ambiguous.append(
                f"{name} ({tsv_key}): matches {len(indices)} cards ({names}). Add "
                f"'{n}' to DUPLICATE_ROW_ORDER with their card_ids in TSV order")
            return None
        return indices[0]

    def record(idx, name, tsv_key):
        written[tsv_key].setdefault(idx, []).append(name)

    # --- Match and merge 4p data ---
    unmatched_4p = []
    matched_4p = 0
    for row in rows_4p:
        name = row.get('Card Name', '').strip()
        n = normalize(name)
        idx = resolve_index(n, name, '4p')
        if idx is not None:
            record(idx, name, '4p')
            stats = derive_stats(row)
            # Update top-level fields
            cards[idx]['rank'] = stats['rank']
            cards[idx]['adp'] = stats['adp']
            cards[idx]['apr'] = stats['apr']
            cards[idx]['play_rate'] = stats['play_rate']
            cards[idx]['elo_per_play'] = stats['elo_per_play']
            cards[idx]['value'] = stats['value']
            cards[idx]['value_when_played'] = stats['value_when_played']
            # Remove pwr if present
            cards[idx].pop('pwr', None)
            matched_4p += 1
        else:
            unmatched_4p.append(name)

    print(f"\n4p: {matched_4p} matched, {len(unmatched_4p)} unmatched")
    if unmatched_4p:
        print("  Unmatched 4p names:")
        for name in unmatched_4p:
            print(f"    - {name}")

    # --- Match and merge 3p data ---
    unmatched_3p = []
    matched_3p = 0
    # First, set all cards to stats_3p: null
    for card in cards:
        card['stats_3p'] = None

    new_3p_only = []
    for row in rows_3p:
        name = row.get('Card Name', '').strip()
        n = normalize(name)
        flagged = len(ambiguous)
        idx = resolve_index(n, name, '3p')
        if idx is not None:
            record(idx, name, '3p')
            stats = derive_stats(row)
            cards[idx]['stats_3p'] = stats
            matched_3p += 1
        elif len(ambiguous) > flagged:
            # Ambiguous, not new — the run aborts below; don't invent a card
            continue
        else:
            # 3p-only card (banned in 4p) — add as new entry
            stats = derive_stats(row)
            new_card = {
                'name': name,
                'rank': None,
                'adp': None,
                'apr': None,
                'play_rate': None,
                'elo_per_play': None,
                'value': None,
                'value_when_played': None,
                'description': '',
                'card_id': '',
                'type': '',
                'cost': '',
                'vps': '',
                'prerequisites': '',
                'passing': False,
                'tags': [],
                'banned_4p': True,
                'stats_3p': stats,
            }
            cards.append(new_card)
            new_3p_only.append(name)

    print(f"\n3p: {matched_3p} matched, {len(new_3p_only)} new 3p-only (banned in 4p)")
    if new_3p_only:
        print("  Added as new cards (banned_4p=true):")
        for name in new_3p_only:
            print(f"    - {name}")

    # Summary
    cards_with_3p = sum(1 for c in cards if c.get('stats_3p') is not None)
    cards_without_3p = sum(1 for c in cards if c.get('stats_3p') is None)
    banned_count = sum(1 for c in cards if c.get('banned_4p'))
    print(f"\nFinal: {len(cards)} total cards")
    print(f"  {cards_with_3p} with 3p data, {cards_without_3p} without")
    print(f"  {banned_count} banned-in-4p cards (3p only)")

    # --- Refuse to write on ambiguity ---
    leftover = [(tsv_key, n, q) for tsv_key, queues in dup_queues.items()
                for n, q in queues.items() if q]
    for tsv_key, n, q in leftover:
        ambiguous.append(
            f"{n} ({tsv_key}): DUPLICATE_ROW_ORDER lists {q} but the TSV had no "
            f"row(s) left for them — did a card drop out of the rankings?")

    if ambiguous:
        print("\nABORTED — ambiguous name matches, nothing written:")
        for msg in ambiguous:
            print(f"  - {msg}")
        return 1

    # --- Integrity checks (catch silent merge failures before they ship) ---
    problems = []

    # Two TSV rows landing on one card means one card's stats were overwritten
    # by another card's — the bug that gave both Market Stalls the same stats.
    for tsv_key in ('4p', '3p'):
        for idx, names in written[tsv_key].items():
            if len(names) > 1:
                problems.append(
                    f"{cards[idx]['name']} [{cards[idx].get('card_id') or 'no id'}]: "
                    f"{len(names)} {tsv_key} rows landed on it ({', '.join(names)})")

    # ...and the mirror image: a card claiming 4p stats that no row updated is
    # holding data from an earlier merge. Rankless cards (new intake, or banned
    # in 4p) are expected to have no row.
    for i, c in enumerate(cards):
        if c.get('rank') is not None and i not in written['4p']:
            problems.append(
                f"{c['name']} [{c.get('card_id') or 'no id'}]: has rank {c['rank']} "
                f"but no 4p TSV row matched it — stats are stale")

    for c in cards:
        label = f"{c['name']} [{c.get('card_id') or 'no id'}]"
        if c.get('pwr') is not None:
            problems.append(f"{label}: still has a 'pwr' field (never merged)")
        if c.get('rank') is not None and not c.get('apr'):
            problems.append(f"{label}: has rank {c['rank']} but no apr (stale entry)")

    seen_ids = {}
    for c in cards:
        cid = c.get('card_id')
        if not cid:
            continue
        if cid in seen_ids:
            problems.append(f"card_id {cid} used by both '{seen_ids[cid]}' and '{c['name']}'")
        seen_ids[cid] = c['name']

    seen_names = {}
    for c in cards:
        if c['name'] in seen_names:
            problems.append(
                f"duplicate name '{c['name']}' — name is the lookup key across the "
                f"app, so give one of them a disambiguated name (e.g. 'Name (ID)')")
        seen_names[c['name']] = True

    if problems:
        print(f"\nABORTED — {len(problems)} integrity problem(s), nothing written:")
        for msg in problems:
            print(f"  - {msg}")
        return 1

    # Write output (both copies must stay byte-identical)
    payload = json.dumps(cards, indent=2, ensure_ascii=False) + '\n'
    for path in [CARDS_JSON, API_CARDS_JSON]:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(payload)
        print(f"Wrote {path}")

    if unmatched_4p:
        print(f"\nWARNING: {len(unmatched_4p)} unmatched 4p names need manual review")
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

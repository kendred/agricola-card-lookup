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

    # Build normalized name -> card index map
    norm_to_idx = {}
    for i, card in enumerate(cards):
        n = normalize(card['name'])
        norm_to_idx[n] = i

    # Parse TSVs
    rows_4p = parse_tsv(TSV_4P)
    rows_3p = parse_tsv(TSV_3P)
    print(f"Parsed {len(rows_4p)} rows from 4p TSV")
    print(f"Parsed {len(rows_3p)} rows from 3p TSV")

    # --- Match and merge 4p data ---
    unmatched_4p = []
    matched_4p = 0
    for row in rows_4p:
        name = row.get('Card Name', '').strip()
        n = normalize(name)
        if n in norm_to_idx:
            idx = norm_to_idx[n]
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
        if n in norm_to_idx:
            idx = norm_to_idx[n]
            stats = derive_stats(row)
            cards[idx]['stats_3p'] = stats
            matched_3p += 1
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

    # Write output
    for path in [CARDS_JSON, API_CARDS_JSON]:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(cards, f, indent=2, ensure_ascii=False)
        print(f"Wrote {path}")

    if unmatched_4p:
        print(f"\nWARNING: {len(unmatched_4p)} unmatched 4p names need manual review")
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

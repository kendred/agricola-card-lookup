#!/usr/bin/env python3
"""
Fuzzy-match image filenames to Agricola card names, rename close matches,
then report the final match analysis.
"""

import json
import os
import unicodedata
from difflib import SequenceMatcher

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
CARDS_JSON = os.path.join(ROOT_DIR, 'data', 'agricola-cards.json')
IMAGES_DIR = os.path.join(ROOT_DIR, 'card-images') + '/'


def normalize(name: str) -> str:
    """Lowercase, strip accents, remove spaces/hyphens/apostrophes/periods."""
    # Strip accents via NFD decomposition
    nfkd = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    # Lowercase and remove certain characters
    stripped = stripped.lower()
    for ch in (" ", "-", "'", ".", "\u2019"):
        stripped = stripped.replace(ch, "")
    return stripped


def load_card_names() -> list[str]:
    with open(CARDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [card["name"] for card in data]


def load_image_files() -> list[str]:
    return sorted(
        f for f in os.listdir(IMAGES_DIR) if f.lower().endswith(".png")
    )


def compute_matches(card_names, image_files):
    """Return (matched_pairs, unmatched_cards, unmatched_images)."""
    # Build normalized -> card name mapping
    norm_to_card = {}
    for name in card_names:
        norm_to_card[normalize(name)] = name

    # Build normalized -> image filename mapping (strip .png before normalizing)
    norm_to_image = {}
    for img in image_files:
        base = img[:-4]  # remove .png
        norm_to_image[normalize(base)] = img

    matched_pairs = []
    matched_card_norms = set()
    matched_image_norms = set()

    for norm_img, img_file in norm_to_image.items():
        if norm_img in norm_to_card:
            matched_pairs.append((img_file, norm_to_card[norm_img]))
            matched_card_norms.add(norm_img)
            matched_image_norms.add(norm_img)

    unmatched_cards = [
        name for name in card_names if normalize(name) not in matched_card_norms
    ]
    unmatched_images = [
        img for img in image_files if normalize(img[:-4]) not in matched_image_norms
    ]

    return matched_pairs, unmatched_cards, unmatched_images


def main():
    card_names = load_card_names()
    image_files = load_image_files()

    print(f"Total cards in JSON: {len(card_names)}")
    print(f"Total .png images:   {len(image_files)}")
    print()

    # ── Phase 1: Find fuzzy matches among currently-unmatched images ──
    _, unmatched_cards, unmatched_images = compute_matches(card_names, image_files)

    print(f"Exact normalized matches (before fuzzy): {len(image_files) - len(unmatched_images)}")
    print(f"Unmatched images (before fuzzy):         {len(unmatched_images)}")
    print(f"Unmatched cards  (before fuzzy):         {len(unmatched_cards)}")
    print()

    # Build lookup for fuzzy matching
    norm_unmatched_cards = {normalize(c): c for c in unmatched_cards}

    renames = []  # (old_path, new_path, old_filename, new_filename, card_name, ratio)

    for img in unmatched_images:
        base = img[:-4]
        norm_img = normalize(base)
        best_ratio = 0.0
        best_card_norm = None

        for norm_card, card_name in norm_unmatched_cards.items():
            ratio = SequenceMatcher(None, norm_img, norm_card).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_card_norm = norm_card

        if best_ratio >= 0.85 and best_card_norm is not None:
            card_name = norm_unmatched_cards[best_card_norm]
            new_filename = card_name.lower() + ".png"
            if new_filename != img:
                renames.append((
                    os.path.join(IMAGES_DIR, img),
                    os.path.join(IMAGES_DIR, new_filename),
                    img,
                    new_filename,
                    card_name,
                    best_ratio,
                ))

    if not renames:
        print("No fuzzy matches found with ratio >= 0.85.")
    else:
        print(f"Found {len(renames)} fuzzy rename(s):\n")
        for old_path, new_path, old_fn, new_fn, card_name, ratio in renames:
            print(f'  "{old_fn}" -> "{new_fn}"  (card: "{card_name}", ratio: {ratio:.4f})')

        # ── Perform renames ──
        print("\nRenaming files...\n")
        for old_path, new_path, old_fn, new_fn, card_name, ratio in renames:
            os.rename(old_path, new_path)
            print(f'  RENAMED: "{old_fn}" -> "{new_fn}"')

    # ── Phase 2: Re-run full analysis after renames ──
    print("\n" + "=" * 70)
    print("POST-RENAME ANALYSIS")
    print("=" * 70 + "\n")

    image_files_after = load_image_files()
    matched_pairs, unmatched_cards, unmatched_images = compute_matches(
        card_names, image_files_after
    )

    print(f"Total cards:              {len(card_names)}")
    print(f"Total images:             {len(image_files_after)}")
    print(f"Normalized matches:       {len(matched_pairs)}")
    print(f"Unmatched cards:          {len(unmatched_cards)}")
    print(f"Unmatched images:         {len(unmatched_images)}")

    print(f"\n--- ALL Unmatched Cards ({len(unmatched_cards)}) ---")
    for i, name in enumerate(sorted(unmatched_cards), 1):
        print(f"  {i:3d}. {name}")

    print(f"\n--- ALL Unmatched Images ({len(unmatched_images)}) ---")
    for i, img in enumerate(sorted(unmatched_images), 1):
        print(f"  {i:3d}. {img}")

    print()


if __name__ == "__main__":
    main()

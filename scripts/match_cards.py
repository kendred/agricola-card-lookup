import json
import os

# --- Config ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
CARDS_JSON = os.path.join(ROOT_DIR, 'data', 'agricola-cards.json')
IMAGES_DIR = os.path.join(ROOT_DIR, 'card-images') + '/'

# --- Normalize function ---
def normalize(name: str) -> str:
    """Lowercase, remove spaces, hyphens, apostrophes, and periods."""
    s = name.lower()
    for ch in (" ", "-", "'", "."):
        s = s.replace(ch, "")
    return s

# --- Load card names ---
with open(CARDS_JSON, "r") as f:
    cards = json.load(f)
card_names = [c["name"] for c in cards]

# --- Load image filenames ---
image_files = sorted(
    f for f in os.listdir(IMAGES_DIR) if f.lower().endswith(".png")
)

# --- Build normalized lookup maps ---
# card normalized -> list of original card names
norm_to_cards: dict[str, list[str]] = {}
for name in card_names:
    n = normalize(name)
    norm_to_cards.setdefault(n, []).append(name)

# image normalized (without .png) -> list of original filenames
norm_to_images: dict[str, list[str]] = {}
for fname in image_files:
    base = fname[:-4]  # strip .png
    n = normalize(base)
    norm_to_images.setdefault(n, []).append(fname)

# --- Compute matches ---
all_card_norms = set(norm_to_cards.keys())
all_image_norms = set(norm_to_images.keys())

matched_norms = all_card_norms & all_image_norms
unmatched_card_norms = all_card_norms - all_image_norms
unmatched_image_norms = all_image_norms - all_card_norms

# Expand back to original names/filenames
unmatched_cards = []
for n in sorted(unmatched_card_norms):
    for name in norm_to_cards[n]:
        unmatched_cards.append(name)
unmatched_cards.sort(key=str.lower)

unmatched_images = []
for n in sorted(unmatched_image_norms):
    for fname in norm_to_images[n]:
        unmatched_images.append(fname)
unmatched_images.sort(key=str.lower)

# Count matched cards (a card is matched if its norm is in matched_norms)
matched_card_count = sum(
    len(norm_to_cards[n]) for n in matched_norms
)
matched_image_count = sum(
    len(norm_to_images[n]) for n in matched_norms
)

# --- Report ---
print("=" * 60)
print("AGRICOLA CARD-TO-IMAGE MATCHING REPORT")
print("=" * 60)
print()
print(f"Total cards in JSON:       {len(card_names)}")
print(f"Total images (.png):       {len(image_files)}")
print(f"Unique normalized cards:   {len(all_card_norms)}")
print(f"Unique normalized images:  {len(all_image_norms)}")
print()
print(f"Normalized matches:        {len(matched_norms)}")
print(f"  -> Cards matched:        {matched_card_count}")
print(f"  -> Images matched:       {matched_image_count}")
print()

print("-" * 60)
print(f"UNMATCHED CARDS ({len(unmatched_cards)} cards, no matching image):")
print("-" * 60)
for i, name in enumerate(unmatched_cards, 1):
    norm = normalize(name)
    print(f"  {i:>3}. {name}  [normalized: {norm}]")
print()

print("-" * 60)
print(f"UNMATCHED IMAGES ({len(unmatched_images)} images, no matching card):")
print("-" * 60)
for i, fname in enumerate(unmatched_images, 1):
    base = fname[:-4]
    norm = normalize(base)
    print(f"  {i:>3}. {fname}  [normalized: {norm}]")
print()
print("=" * 60)
print("DONE")
print("=" * 60)

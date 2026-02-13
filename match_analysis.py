import json, os, unicodedata

CARDS_JSON = "/Users/rileyoneill/Documents/agricola-card-lookup/agricola-cards.json"
IMAGES_DIR = "/Users/rileyoneill/Documents/agricola-card-lookup/card-images/"

def normalize(name):
    nfkd = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    stripped = stripped.lower()
    for ch in (" ", "-", "'", ".", "\u2019"):
        stripped = stripped.replace(ch, "")
    return stripped

with open(CARDS_JSON, "r", encoding="utf-8") as f:
    card_names = [card["name"] for card in json.load(f)]

image_files = sorted(f for f in os.listdir(IMAGES_DIR) if f.lower().endswith(".png"))

norm_cards = {normalize(n): n for n in card_names}
norm_images = {normalize(f[:-4]): f for f in image_files}

matched_norms = set(norm_cards.keys()) & set(norm_images.keys())
unmatched_cards = sorted([norm_cards[n] for n in set(norm_cards.keys()) - matched_norms])
unmatched_images = sorted([norm_images[n] for n in set(norm_images.keys()) - matched_norms])

print(f"Total cards:    {len(card_names)}")
print(f"Total images:   {len(image_files)}")
print(f"Matches:        {len(matched_norms)}")
print(f"Unmatched cards:  {len(unmatched_cards)}")
print(f"Unmatched images: {len(unmatched_images)}")

print(f"\n=== UNMATCHED CARDS ({len(unmatched_cards)}) ===")
for i, name in enumerate(unmatched_cards, 1):
    print(f"  {i:3d}. {name}")

print(f"\n=== UNMATCHED IMAGES ({len(unmatched_images)}) ===")
for i, img in enumerate(unmatched_images, 1):
    print(f"  {i:3d}. {img}")

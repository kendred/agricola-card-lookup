#!/usr/bin/env python3
"""Add strategy tags to agricola-cards.json based on reviewed assignments."""

import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
CARDS_JSON = os.path.join(ROOT_DIR, 'data', 'agricola-cards.json')

# Tag assignments: card name -> list of tags
# Built from the analysis, with user review applied:
# - Hardworking Man removed from DL and MM
# - Mantlepiece added to StH
# - Vegetable tag removed entirely

TAG_MAP = {
    # ── Small House (SmH) ──
    "Field Doctor": ["Small House"],
    "Small-scale Farmer": ["Small House"],
    "Priest": ["Small House"],
    "Established Person": ["Small House"],
    "Pastor": ["Small House"],
    "Freemason": ["Small House", "Stone House"],
    "Hardworking Man": ["Small House"],

    # ── Big House (BH) ──
    "House Artist": ["Big House", "Traveling Players"],
    "Furnisher": ["Big House"],
    "Wooden Hut Extender": ["Big House"],
    "Recreational Carpenter": ["Big House"],
    "Wood Barterer": ["Big House"],
    "Mason": ["Big House", "Stone House"],
    "Family Friendly Home": ["Big House"],
    "Carpenter's Parlor": ["Big House"],
    "Master Builder": ["Big House"],
    "Carpenter": ["Big House"],
    "Straw-Thatched Roof": ["Big House"],
    "Diligent Farmer": ["Big House"],
    "Cottager": ["Big House", "Day Laborer"],
    "Stonecutter": ["Big House"],
    "Clay Plasterer": ["Big House"],
    "Clay Supports": ["Big House"],
    "Baseboards": ["Big House"],
    "Henpecked Husband": ["Big House"],
    "Building Tycoon": ["Big House"],
    "Wood Saw": ["Big House"],
    "Riparian Builder": ["Big House"],
    "Wooden Shed": ["Big House", "Major/Minor"],
    "Hammer Crusher": ["Big House", "Stone House"],
    "Master Bricklayer": ["Big House", "Major/Minor"],
    "Renovation Preparer": ["Big House"],
    "Lumber Virtuoso": ["Big House"],
    # "Clay Room Builder" removed — not found in JSON
    "Resource Recycler": ["Big House"],
    # "Stone Rooms Cost Less" removed — not found in JSON
    "Stagehand": ["Big House", "Traveling Players"],
    "Den Builder": ["Big House", "Animal"],
    "Reader": ["Big House", "Lesson"],

    # ── Stone House (StH) ──
    # Mason and Freemason already have StH from above
    "Plow Driver": ["Stone House"],
    "Chimney Sweep": ["Stone House"],
    "Stone House Reconstruction": ["Stone House"],
    "Hawktower": ["Stone House"],
    "Half-Timbered House": ["Stone House"],
    "Scholar": ["Stone House", "Lesson"],
    "Trowel": ["Stone House"],
    "Wood Slide Hammer": ["Stone House"],
    "Conservator": ["Stone House"],
    # Hammer Crusher already has StH from above
    "Manservant": ["Stone House"],
    "Tax Collector": ["Stone House"],
    "Master Fencer": ["Stone House"],
    "Margrave": ["Stone House"],
    "Uncaring Parents": ["Stone House"],
    "Housebook Master": ["Stone House"],
    "Recycled Brick": ["Stone House"],
    "Journeyman Bricklayer": ["Stone House"],
    "Groom": ["Stone House", "Stable"],
    "Luxurious Hostel": ["Stone House"],
    "Timber Shingle Maker": ["Stone House"],
    "Skillful Renovator": ["Stone House"],
    "Roof Ladder": ["Stone House"],
    "Renovation Company": ["Stone House"],
    "Renovation Materials": ["Stone House"],
    "Retraining": ["Stone House"],
    # "Hearth Insulation" removed — not found in JSON
    "Plumber": ["Stone House", "Major/Minor"],
    "Mantlepiece": ["Stone House"],
    "Mining Hammer": ["Stone House", "Stable"],

    # ── Day Laborer (DL) ──
    "Job Contract": ["Day Laborer", "Lesson"],
    "Hardware Store": ["Day Laborer"],
    "Assistant Tiller": ["Day Laborer"],
    "Loam Pit": ["Day Laborer"],
    "Excavator": ["Day Laborer"],
    "Lazybones": ["Day Laborer", "Grain", "Stable"],
    "Junior Artist": ["Day Laborer", "Traveling Players", "Lesson"],
    "Animal Catcher": ["Day Laborer", "Animal"],
    "Profiteering": ["Day Laborer"],
    "Seasonal Worker": ["Day Laborer"],
    "Stew": ["Day Laborer"],
    "Trap Builder": ["Day Laborer"],
    "Animal Feeder": ["Day Laborer", "Animal"],
    "Comb and Cutter": ["Day Laborer", "Animal"],
    # Cottager already has DL from above
    "Bee Statue": ["Day Laborer"],
    "Heirloom": ["Day Laborer"],
    "Turnip Farmer": ["Day Laborer", "Grain"],

    # ── Grain (G) ──
    "Field Watchman": ["Grain"],
    "Private Teacher": ["Grain", "Lesson"],
    # Lazybones already has G from above
    "Seed Seller": ["Grain"],
    "Firewood Collector": ["Grain"],
    "Grain Bag": ["Grain"],
    "Seed Researcher": ["Grain", "Lesson"],
    "Seed Servant": ["Grain", "Sow"],
    "Clay Kneader": ["Grain"],
    "Market Crier": ["Grain"],
    "Greengrocer": ["Grain", "Animal"],
    "Corn Scoop": ["Grain"],
    "Hill Cultivator": ["Grain"],
    "Iron Hoe": ["Grain"],
    "Swagman": ["Grain"],
    "Miller": ["Grain"],
    "Flax Farmer": ["Grain"],
    "Pitchfork": ["Grain"],
    "Cattle Feeder": ["Grain", "Animal"],
    # Turnip Farmer already has G from above
    "Cooperative Plower": ["Grain"],

    # ── Major/Minor (MM) ──
    "Task Artisan": ["Major/Minor"],
    "Young Farmer": ["Major/Minor", "Sow"],
    "Sample Stable Maker": ["Major/Minor", "Stable"],
    "Plow Builder": ["Major/Minor"],
    "Wood Workshop": ["Major/Minor"],
    "Site Manager": ["Major/Minor"],
    "Vegetable Vendor": ["Major/Minor"],
    "Master Huntsman": ["Major/Minor"],
    "Wage": ["Major/Minor"],
    "Tree Farm Joiner": ["Major/Minor"],
    "Basket Weaver": ["Major/Minor"],
    "Saddler": ["Major/Minor"],
    "Elder Baker": ["Major/Minor"],
    "Artisan District": ["Major/Minor"],
    "Ambition": ["Major/Minor"],
    "Stone Company": ["Major/Minor"],
    "Housemaster": ["Major/Minor"],
    "Food Chest": ["Major/Minor"],
    # Plumber already has MM from above
    "Field Merchant": ["Major/Minor"],
    "Farm Building": ["Major/Minor"],
    "Roof Examiner": ["Major/Minor"],
    "Sower": ["Major/Minor", "Sow"],
    "Toolbox": ["Major/Minor", "Stable"],
    "Hollow Warden": ["Major/Minor"],
    "Angler": ["Major/Minor", "Fishing"],
    "Packaging Artist": ["Major/Minor"],
    "Carpenter's Yard": ["Major/Minor"],
    "Craftsmanship Promoter": ["Major/Minor"],
    "Merchant": ["Major/Minor"],
    "Small Trader": ["Major/Minor"],
    "Large-Scale Farmer": ["Major/Minor"],
    "Oven Site": ["Major/Minor"],
    "Piggy Bank": ["Major/Minor"],
    "Debt Security": ["Major/Minor"],
    "Remodeling": ["Major/Minor"],
    "Village Peasant": ["Major/Minor"],
    # Wooden Shed already has MM from above
    # Hardworking Man removed from MM per user review

    # ── Fishing (F) ──
    "Brewery Pond": ["Fishing"],
    "Supply Boat": ["Fishing"],
    "Rod Collection": ["Fishing"],
    "Water Worker": ["Fishing"],
    "Harpooner": ["Fishing"],
    "Stone Weir": ["Fishing"],
    "Swimming Class": ["Fishing"],
    "Forest Lake Hut": ["Fishing"],
    "Fish Farmer": ["Fishing"],
    "Canoe": ["Fishing"],
    "Fishing Net": ["Fishing"],
    "Trout Pool": ["Fishing"],
    "Kelp Gatherer": ["Fishing"],
    "Drift-Net Boat": ["Fishing"],
    "Oyster Eater": ["Fishing"],
    "Herring Pot": ["Fishing"],
    "Brewing Water": ["Fishing"],
    # Angler already has F from above
    "Whale Oil": ["Fishing", "Lesson"],
    "Brook": ["Fishing"],
    "Joiner of the Sea": ["Fishing"],
    "Mill Wheel": ["Fishing", "Grain"],
    "Canal Boatman": ["Fishing"],
    "Roastmaster": ["Fishing", "Traveling Players", "Animal"],
    "Studio Boat": ["Fishing", "Traveling Players"],
    "Fisherman's Friend": ["Fishing", "Traveling Players"],

    # ── Traveling Players (TP) ──
    # House Artist, Stagehand, Junior Artist, Studio Boat, Roastmaster, Fisherman's Friend already have TP
    "Market Master": ["Traveling Players", "Lesson"],
    "Art Teacher": ["Traveling Players", "Lesson"],
    "Conjurer": ["Traveling Players"],
    "Spin Doctor": ["Traveling Players"],
    "Puppeteer": ["Traveling Players", "Lesson"],
    "Lutenist": ["Traveling Players"],
    "Bargain Hunter": ["Traveling Players"],
    "Culinary Artist": ["Traveling Players"],

    # ── Sow ──
    # Young Farmer, Sower, Seed Servant already have Sow
    "Slurry": ["Sow"],
    "Cow Patty": ["Sow", "Animal"],
    "Apiary": ["Sow"],
    "Tumbrel": ["Sow", "Stable"],
    "Wood Field": ["Sow"],
    "Confidant": ["Sow"],
    "Drill Harrow": ["Sow"],
    "Crop Rotation Field": ["Sow"],
    "Cherry Orchard": ["Sow"],
    "Sundial": ["Sow"],
    "Seed Pellets": ["Sow"],
    "Wild Greens": ["Sow"],
    "Seaweed Fertilizer": ["Sow"],
    "Fern Seeds": ["Sow"],
    "Fodder Planter": ["Sow"],
    "Garden Hoe": ["Sow"],
    "Skimmer Plow": ["Sow"],
    "Field Spade": ["Sow"],
    "Changeover": ["Sow"],
    "Furrows": ["Sow"],
    "Lazy Sowman": ["Sow"],
    "Chief Forester": ["Sow"],
    "Tinsmith Master": ["Sow"],
    "Gritter": ["Sow"],
    "Sowing Director": ["Sow", "Grain"],
    "Agricultural Fertilizers": ["Sow"],
    "Sowing Master": ["Sow"],

    # ── Animal (Ani) — merged from Animal + Sheep + Cow ──
    # Animal Catcher, Animal Feeder, Comb and Cutter, Greengrocer,
    # Cattle Feeder, Den Builder, Roastmaster, Cow Patty already have Animal from other sections
    "Pet Lover": ["Animal"],
    "Animal Husbandry Worker": ["Animal"],
    "Champion Breeder": ["Animal"],
    "Feed Pellets": ["Animal"],
    "Stable Sergeant": ["Animal"],
    "Animal Tamer": ["Animal"],
    "Animal Dealer": ["Animal"],
    "Fodder Chamber": ["Animal"],
    "Livestock Feeder": ["Animal"],
    "Fir Cutter": ["Animal"],
    "Wildlife Reserve": ["Animal"],
    "Feedyard": ["Animal"],
    "Lasso": ["Animal"],
    "Livestock Expert": ["Animal"],
    "Pure Breeder": ["Animal"],
    "Omnifarmer": ["Animal"],
    "Pet Grower": ["Animal"],
    "Pig Stalker": ["Animal"],
    "Animal Tamer's Apprentice": ["Animal"],
    "Silage": ["Animal"],
    "Perennial Rye": ["Animal"],
    "Breeder Buyer": ["Animal", "Big House", "Stable"],
    "Pen Builder": ["Animal", "Stable"],
    "Muck Rake": ["Animal", "Stable"],
    "Drinking Trough": ["Animal"],
    # "Lawn Fertilizer" removed — not found in JSON
    "Animal Driver": ["Animal", "Stable"],
    "Dung Collector": ["Animal"],
    "Stockman": ["Animal", "Stable"],
    # Former Sheep cards:
    "Loom": ["Animal"],
    "Dolly's Mother": ["Animal"],
    "Breed Registry": ["Animal"],
    "Little Stick Knitter": ["Animal"],
    "Sheep Provider": ["Animal"],
    "Shepherd's Whistle": ["Animal", "Stable"],
    "Shepherd's Crook": ["Animal"],
    "Horse-Drawn Boat": ["Animal"],
    "Woolgrower": ["Animal"],
    "Sheep Rug": ["Animal"],
    "Hook Knife": ["Animal"],
    "Sheep Keeper": ["Animal"],
    "Sheep Agent": ["Animal"],
    "Sheep Whisperer": ["Animal"],
    "Sheep Well": ["Animal"],
    "Pet Broker": ["Animal"],
    "Domestician Expert": ["Animal"],
    "German Heath Keeper": ["Animal"],
    "Wood Worker": ["Animal"],
    "Claw Knife": ["Animal"],
    "Cheese Fondue": ["Animal"],
    "Butter Churn": ["Animal"],
    "Milking Parlor": ["Animal"],
    # Former Cow cards:
    "Milking Stool": ["Animal"],
    "Cow Prince": ["Animal"],
    "Ox Goad": ["Animal"],
    "Milk Jug": ["Animal"],
    "Haydryer": ["Animal"],
    "Cattle Farm": ["Animal"],
    "Early Cattle": ["Animal"],
    "Cattle Whisperer": ["Animal"],
    "Cattle Buyer": ["Animal"],
    "Stable Milker": ["Animal", "Stable"],
    "Wooden Whey Bucket": ["Animal", "Stable"],

    # ── Lesson (L) ──
    # Scholar, Job Contract, Junior Artist, Private Teacher, Seed Researcher, Whale Oil,
    # Market Master, Art Teacher, Puppeteer, Reader already have L
    "Bookcase": ["Lesson"],
    "Education Bonus": ["Lesson"],
    "Bookshelf": ["Lesson"],
    "Stallwright": ["Lesson", "Stable"],
    "Writing Desk": ["Lesson"],
    "Patron": ["Lesson"],
    "Animal Teacher": ["Lesson", "Animal"],
    "Paper Knife": ["Lesson"],
    "Furniture Maker": ["Lesson"],
    "Night-School Student": ["Lesson"],
    "Beneficiary": ["Lesson"],
    "Tutor": ["Lesson"],
    "Patroness": ["Lesson"],
    "Paper Maker": ["Lesson"],
    "Bread Paddle": ["Lesson"],
    "Moonshine": ["Lesson"],
    "Clay Puncher": ["Lesson"],
    "Bohemian": ["Lesson"],
    "Elder": ["Lesson"],
    "Forestry Studies": ["Lesson"],
    "Tasting": ["Lesson"],
    "Forest School": ["Lesson"],
    "Blighter": ["Lesson"],
    "Prodigy": ["Lesson"],
    "Usufructuary": ["Lesson"],
    "Cookery Lesson": ["Lesson"],
    "Scales": ["Lesson"],
    "Writing Boards": ["Lesson"],
    "Harvest House": ["Lesson"],

    # ── Stable (ST) ──
    # Groom, Mining Hammer, Sample Stable Maker, Toolbox, Tumbrel, Lazybones,
    # Shepherd's Whistle, Stockman, Animal Driver, Lawn Fertilizer, Pen Builder,
    # Muck Rake, Breeder Buyer, Stallwright, Stable Milker, Wooden Whey Bucket already have ST
    "Beer Stall": ["Stable"],
    "Shed Builder": ["Stable"],
    "Stable Planner": ["Stable"],
    "Carpenter's Axe": ["Stable"],
    "Feed Fence": ["Stable"],
    "Stable Cleaner": ["Stable"],
    "Chick Stable": ["Stable"],
    "Stable Tree": ["Stable"],
    "Stable": ["Stable"],
    "Animal Bedding": ["Stable"],
    "Shelter": ["Stable"],
    "Casual Worker": ["Stable"],
    "Stable Master": ["Stable"],
    "Barn Cats": ["Stable"],
    "Stablehand": ["Stable"],
    "Stable Architect": ["Stable"],
    "Stable Manure": ["Stable"],
    "Stall Holder": ["Stable"],
    "Stable Yard": ["Stable"],
    "Beaver Colony": ["Stable"],
    "Pasture Master": ["Stable"],
}


def main():
    with open(CARDS_JSON, 'r') as f:
        cards = json.load(f)

    # Build a merged tag map: some cards appear in multiple tag sections,
    # so we need to merge all their tags
    merged = {}
    for card_name, tags in TAG_MAP.items():
        if card_name in merged:
            # Merge, dedup, preserve order
            existing = merged[card_name]
            for t in tags:
                if t not in existing:
                    existing.append(t)
        else:
            merged[card_name] = list(tags)

    # Add tags to cards
    tagged_count = 0
    not_found = []
    card_names_in_json = {c['name'] for c in cards}

    for card in cards:
        if card['name'] in merged:
            card['tags'] = sorted(merged[card['name']])
            tagged_count += 1
        else:
            card['tags'] = []

    # Check for tag map entries that don't match any card
    for name in merged:
        if name not in card_names_in_json:
            not_found.append(name)

    with open(CARDS_JSON, 'w') as f:
        json.dump(cards, f, indent=2, ensure_ascii=False)

    # Stats
    print(f"Total cards: {len(cards)}")
    print(f"Tagged cards: {tagged_count}")
    print(f"Untagged cards: {len(cards) - tagged_count}")

    if not_found:
        print(f"\nWARNING: {len(not_found)} names in TAG_MAP not found in JSON:")
        for n in sorted(not_found):
            print(f"  - {n}")

    # Tag distribution
    tag_counts = {}
    for card in cards:
        for tag in card.get('tags', []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    print(f"\nTag distribution:")
    for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1]):
        print(f"  {tag}: {count}")

    # Validate all tag strings match known tags
    known_tags = {
        'Small House', 'Big House', 'Stone House', 'Day Laborer', 'Grain',
        'Major/Minor', 'Fishing', 'Traveling Players', 'Sow', 'Animal',
        'Lesson', 'Stable'
    }
    unknown = set()
    for card in cards:
        for tag in card.get('tags', []):
            if tag not in known_tags:
                unknown.add(tag)
    if unknown:
        print(f"\nERROR: Unknown tags found: {unknown}")
    else:
        print(f"\nAll tags valid!")


if __name__ == '__main__':
    main()

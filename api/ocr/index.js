// Azure Function: OCR proxy for Agricola card screenshot recognition
// Receives an image, calls Azure OpenAI GPT-4o Vision, returns card names.
// API key stays server-side; rate limiting protects against abuse.

// --- Rate limiting (in-memory, resets on cold start) ---
const rateLimitMap = new Map(); // IP -> [timestamps]
const RATE_LIMIT_MAX = 10;      // max calls per window
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms

function isRateLimited(ip) {
    const now = Date.now();
    const timestamps = rateLimitMap.get(ip) || [];
    // Remove expired entries
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (recent.length >= RATE_LIMIT_MAX) {
        rateLimitMap.set(ip, recent);
        return true;
    }
    recent.push(now);
    rateLimitMap.set(ip, recent);
    return false;
}

// --- All valid Agricola card names (for the system prompt) ---
const CARD_NAMES = ["Lover","Basket Carrier","Cesspit","Job Contract","Pioneer","Childless","Grocer","Harvest House","Brewery Pond","Forest Clearer","Melon Patch","Swing Plow","Full Farmer","Forest Reviewer","Field Fences","Hardware Store","Skillful Renovator","Furnisher","Pet Lover","Pavior","Animal Husbandry Worker","Milking Stool","Bookcase","Collector","Hewer","Assistant Tiller","House Artist","Cultivator","Grain Depot","Loom","Cow Prince","Ash Trees","Lynchet","Reap Hook","Education Bonus","Bookshelf","Slurry","Task Artisan","Claypit Owner","Young Farmer","Field Doctor","Wooden Hut Extender","Bonehead","Field Watchman","Recreational Carpenter","Muddy Waters","Cow Patty","Wood Workshop","Beer Stall","Stallwright","Wood Barterer","Wood Carrier","Canvas Sack","Crudit\u00e9","Mason","Shed Builder","Special Food","Carrot Museum","Trellis","Champion Breeder","Seed Almanac","Writing Boards","Briar Hedge","Rammed Clay","Kindling Gatherer","Mud Patch","Charcoal Burner","Cottar","Club House","Clay Supports","Ox Goad","Lord of the Manor","Hand Truck","Ceilings","Beer Keg","Wheel Plow","Dolly's Mother","Breed Registry","Feed Pellets","Market Master","Lettuce Patch","Plow Driver","Writing Desk","Waterlily Pond","Chain Float","Sample Stable Maker","Moldboard Plow","Wholesaler","Artichoke Field","Wolf","Mini Pasture","Art Teacher","Baseboards","Stable Sergeant","Hauberg","Constable","Steam Plow","Family Friendly Home","Apiary","Carpenter's Parlor","Barn Cats","Porter","Hod","Wood Collector","Newly-Plowed Field","Loam Pit","Food Basket","Plow Builder","Potter Ceramics","Carpenter's Axe","Stable Planner","Reed Pond","Mining Hammer","Dung Collector","Roof Ladder","Cordmaker","Wooden Whey Bucket","Food Distributor","Earth Oven","Scrap Collector","Wood Slide Hammer","Chimney Sweep","Wares Salesman","Overachiever","Winter Caretaker","Omnifarmer","Beer Table","Patron","Stone Axe","House Steward","Beanfield","Alchemists Lab","Turnwrest Plow","Beating Rod","Animal Reeve","Animal Activist","Tumbrel","Animal Teacher","Hedge Keeper","Excursion to the Quarry","Wood Field","Treegardener","Field Caretaker","Pig Owner","Wood Cart","Plow Maker","Tea House","Credit","Private Teacher","Sour Dough","Forest Plow","Confidant","Contraband","Bookmark","Gardening Head Official","Retail Dealer","Milk Jug","Shifting Cultivation","Blueprint","Feed Fence","Excavator","Pickler","Reclamation Plow","Handplow","Drill Harrow","Wood Rake","Sleeping Corner","Clay Supply","Paper Knife","Site Manager","Muddy Puddles","Vegetable Vendor","Master Huntsman","Twibil","Plowman","Furniture Maker","Barrow Pusher","Iron Oven","Sculpture Course","Nest Site","Barn Shed","Basketmaker's Wife","Crop Rotation Field","Pet Broker","Wage","Little Stick Knitter","Trowel","New Purchase","Lazybones","Stable Cleaner","Land Heir","Nail Basket","Small-scale Farmer","Stone House Reconstruction","Christianity","Haydryer","Forest Stone","Granary","Sheep Provider","Ranch Provost","Nave","Cherry Orchard","Maintenance Premium","Plow Hero","Chick Stable","Hutch","Value Assets","Tree Farm Joiner","Stockyard","Shepherd's Whistle","Animal Tamer","Cubbyhole","Agrarian Fences","Basket Weaver","Stone Sculptor","Dairy Crier","Saddler","Throwing Axe","Sleight of Hand","Water Gully","Clay Hut Builder","Open Air Farmer","Greening Plan","Acquirer","Scales","Bucksaw","Fir Cutter","Butter Churn","Trident","Oriental Fireplace","Adoptive Parents","Private Forest","Drudgery Reeve","Veggie Lover","Night-School Student","Mattock","Shoreforester","Overhaul","Reed-Hatted Toad","Hawktower","Homekeeper","Elder Baker","Mud Wallower","Pipe Smoker","Lumber Mill","Forest Well","Beneficiary","Junior Artist","Supply Boat","Mole Plow","Sundial","Wood Expert","Land Register","Stable Tree","Firewood","Storeroom","Upholstery","Animal Catcher","Priest","Game Catcher","Estate Worker","Seed Pellets","Wild Greens","Store of Experience","Den Builder","Bunk Beds","Buyer","Clay Warden","Pond Hut","Studio","Gift Basket","Sheep Rug","Hammer Crusher","Profiteering","Artisan District","Kettle","Raised Bed","Straw-Thatched Roof","Double-Turn Plow","Bricklayer","Conservator","Pole Barns","Bottles","Ebonist","Roman Pot","Seaweed Fertilizer","Fodder Beets","Retraining","Diligent Farmer","Bed in the Grain Field","Roof Ballaster","Rod Collection","Flail","Market Stall","Truffle Slicer","Village Peasant","Strawberry Patch","Claypipe","Work Permit","Clay Deliveryman","Potato Digger","Large Pottery","Stable","Seasonal Worker","Scythe","Shepherd's Crook","Fruit Ladder","Small Basket","Zigzag Harrow","Three-Field Rotation","Water Worker","Straw Hat","Wood Cutter","Mayor Candidate","Master Builder","Night Loot","Stew","Half-Timbered House","Junk Room","Established Person","Fellow Grazer","Fern Seeds","Small Greenhouse","Child's Toy","Trap Builder","Remodeling","Boar Spear","Dentist","Paintbrush","Baking Course","Harpooner","Piggy Bank","Foreign Aid","Conjurer","Farm Store","Lumber Pile","Tutor","Upscale Lifestyle","Patroness","Sack Cart","Organic Farmer","Collier","Stone Weir","Syrup Tap","Horse-Drawn Boat","Debt Security","Stock Protector","Chicken Coop","Stockman","Farmers Market","Fatstock Stretcher","Chairman","Swimming Class","Chophouse","Museum Caretaker","Simple Oven","Prophet","Ambition","Potato Harvester","Stone Company","Carpenter","Seducer","Seed Trader","Mineral Feeder","Beer Tap","Archway","Midwife","Animal Bedding","Scholar","Scythe Worker","Carter","Town Hall","Delivery Nurse","Sheep Well","Forest Lake Hut","Threshing Board","Thunderbolt","Stonecutter","Shelter","Brushwood Collector","Wildlife Reserve","Equipper","Master Bricklayer","Paper Maker","Portmonger","Reseller","Bale of Straw","Storehouse Keeper","Seed Seller","Rocky Terrain","Thresher","Bread Paddle","Thick Forest","Animal Dealer","Housebook Master","Housemaster","Moonshine","Cheese Fondue","Stork's Nest","Calcium Fertilizers","Final Scenario","Recycled Brick","Firewood Collector","Fish Farmer","Master Tanner","Casual Worker","Clay Puncher","Stable Master","Food Chest","Animal Feeder","Steam Machine","Stone Cart","Handcart","Pastor","Seed Researcher","Fodder Planter","Hunting Trophy","Comb and Cutter","Spice Trader","Reed Belt","Grain Bag","Acorns Basket","Manger","Cottager","Pumpernickel","Canoe","Potter's Yard","Fishing Net","Spin Doctor","Agricultural Labourer","Consultant","Bellfounder","Livestock Feeder","Shovel Bearer","Fodder Chamber","Godmother","Grange","Second Spouse","Plumber","Mountain Plowman","Hide Farmer","Forest Trader","Bee Statue","Wooden Shed","Renovation Company","Field Merchant","Moral Crusader","Large Greenhouse","Schnapps Distillery","Bohemian","Pattern Maker","Crack Weeder","Scullery","Seed Servant","Autumn Mother","New Market","Lodger","Hard Porcelain","Forest Owner","Elder","Patch Caregiver","Bartering Hut","Milking Parlor","Lasso","Lieutenant General","Lawn Fertilzer","Automatic Water Trough","Clay Carrier","Garden Hoe","Woodcraft","Skimmer Plow","Clay Kneader","Muck Rake","Trout Pool","Layabout","Herbal Garden","Hoof Caregiver","Clay Plasterer","Market Crier","Feeding Dish","Renovation Materials","Bed Maker","Baking Sheet","Hook Knife","Wood Pile","Kelp Gatherer","Field Cultivator","Studio Boat","Field Spade","Pottery Yard","Lumberjack","Puppeteer","Changeover","Greengrocer","Ropemaker","Entrepreneur","Schnapps Distiller","Brick Hammer","Pub Owner","Eternal Rye Cultivation","Hill Cultivator","Smuggler","Animal Driver","Stone Clearing","Baker","Drift-Net Boat","Soil Scientist","Forestry Studies","Heirloom","Farm Building","Market Stall","Party Organizer","Lantern House","Corn Scoop","Clay Firer","Asparagus Gift","Furrows","Journeyman Bricklayer","Fire Protection Pond","Roastmaster","Dwelling Plan","Stone Tongs","German Heath Keeper","Vegetable Slicer","Clearing Spade","Lutenist","Manservant","Oyster Eater","Shifting Cultivator","Straw Manure","Tree Cutter","Fisherman's Friend","Herring Pot","Domestician Expert","Grain Sieve","Game Trade","District Manager","Tax Collector","Asparagus Knife","Resource Recycler","Braid Maker","Master Fencer","Lazy Sowman","Stable Architect","Swagman","Roof Examiner","Churchyard","Gardener's Knife","Stone Buyer","Sower","Brewing Water","Home Brewer","Civic Facade","Potato Planter","Chief Forester","Mandoline","Young Animal Market","Sheep Keeper","Millwright","Beer Stein","Tinsmith Master","Emergency Seller","Tea Time","Margrave","Rustic","Farmyard Manure","Miller","Reader","Parvenu","Tasting","Toolbox","Old Miser","Green Grocer","Wood Harvester","Huntsman's Hat","Recount","Forest Inn","Salter","Petrified Wood","Pen Builder","Woolgrower","Stablehand","Uncaring Parents","Milking Place","Drinking Trough","Potato Ridger","Hollow Warden","Forest School","Blighter","Petting Zoo","Rock Beater","Angler","Stone Custodian","Emissary","Nutrition Expert","Iron Hoe","Pasture Master","Forest Guardian","Stable Yard","Flax Farmer","Pigswill","Sheep Agent","Feedyard","Misanthropy","Transactor","Pitchfork","Freemason","Stone Carver","Groom","Ale-Benches","Timber Shingle Maker","Pig Breeder","Plant Fertilizer","Geologist","Lumber Virtuoso","Gritter","Beer Tent Operator","Sculptor","Pellet Press","Gypsy's Crock","Storage Barn","Cowherd","Potters Market","Land Surveyor","Mantlepiece","Whale Oil","Truffle Searcher","Case Builder","Oven Firing Boy","Seatmate","Renovation Preparer","Almsbag","Outrider","Clay Embankment","Cube Cutter","Cattle Feeder","Grain Thief","Soldier","Building Expert","Storehouse Steward","Digging Spade","Blade Shears","Mushroom Collector","Mineralogist","Recluse","Early Cattle","Animal Tamer's Apprentice","Livestock Expert","Prodigy","Stable Manure","Barley Mill","Field Clay","Usufructuary","Earthenware Potter","Outskirts Director","Henpecked Husband","Patch Caretaker","Luxurious Hostel","Interim Storage","Trimmer","Corf","Clay Deposit","Master Workman","Pet Grower","Knapper","Pure Breeder","Game Provider","Wholesale Market","Brook","Beaver Colony","Ox Skull","Stall Holder","Sowing Director","Packaging Artist","Agricultural Fertilizers","Future Building Site","Rolling Pin","Carpenter's Yard","Loppers","Bargain Hunter","Cattle Buyer","Craftsmanship Promoter","Pan Baker","Cob","Frame Builder","Cattle Whisperer","Sheep Whisperer","Food Merchant","Inner Districts Director","Building Tycoon","Basket","Sowing Master","Silage","Abort Oriel","Corn Schnapps Distillery","Butler","Cookery Lesson","Stone Importer","Ravenous Hunger","Wall Builder","Material Deliveryman","Pioneering Spirit","Motivator","Godly Spouse","Trellises","Brotherly Love","Joiner of the Sea","Parrot Breeder","Facades Carving","Wood Saw","Grassland Harrow","Garden Claw","Silokeeper","Slurry Spreader","Elephantgrass Plant","Minstrel","Stagehand","Stable Milker","Dwelling Mound","Turnip Farmer","Riverine Shepherd","Master Renovator","Furniture Carpenter","Wool Blankets","Wood Worker","Cookery Outfitter","Social Benefits","Mill Wheel","Merchant","Lifting Machine","Telegram","Dutch Windmill","Visionary","Illusionist","Wealthy Man","Pig Stalker","Sculpture","Reed Roof Renovator","Culinary Artist","Full Peasant","Canal Boatman","Claw Knife","Mummy's Boy","Small Trader","Cattle Farm","Heart of Stone","Large-Scale Farmer","Forest Scientist","Clutterer","Oven Site","Blackberry Farmer","Bean Counter","Riparian Builder","Interior Decorator","Twin Researcher","Sugar Baker","Forest Tallyman","Small Animal Breeder","Hardworking Man","Sequestrator","Roughcaster","Paymaster","Forest Campaigner","Catcher","Resource Analyzer","Huntsman","Curator","Cooperative Plower","Tree Inspector","Growing Farm","Breeder Buyer","Perennial Rye","Loudmouth"];

const SYSTEM_PROMPT = `You are analyzing a screenshot from the board game Agricola on Board Game Arena (BGA).
Extract all card names visible in the screenshot. Cards may be Occupations or Minor Improvements.
Look for card title text on each card. BGA shows card names at the top of each card.

Return ONLY a JSON array of card name strings, exactly as they appear in the list below.
Do not include any explanation, markdown formatting, or text outside the JSON array.

Example output: ["Lover", "Basket Carrier", "Cesspit"]

Here are all valid card names:
${JSON.stringify(CARD_NAMES)}`;

module.exports = async function (context, req) {
    // --- CORS headers ---
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (req.method === 'OPTIONS') {
        context.res = { status: 204, headers, body: '' };
        return;
    }

    // --- Validate environment ---
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

    if (!endpoint || !apiKey) {
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: 'OCR service is not configured. Contact the site administrator.' }),
        };
        return;
    }

    // --- Rate limiting ---
    const clientIP = req.headers['x-forwarded-for']
        || req.headers['x-client-ip']
        || req.headers['client-ip']
        || 'unknown';

    if (isRateLimited(clientIP)) {
        context.res = {
            status: 429,
            headers,
            body: JSON.stringify({ error: 'Too many requests. Try again in a few minutes.' }),
        };
        return;
    }

    // --- Validate request body ---
    const body = req.body;
    if (!body || !Buffer.isBuffer(body)) {
        // Try to handle base64 JSON body as fallback
        if (body && typeof body === 'object' && body.image) {
            // Accept { image: "data:image/jpeg;base64,..." } format
            try {
                const base64Match = body.image.match(/^data:image\/\w+;base64,(.+)$/);
                if (!base64Match) {
                    context.res = {
                        status: 400,
                        headers,
                        body: JSON.stringify({ error: 'Invalid image data format.' }),
                    };
                    return;
                }
                const imageBase64 = base64Match[1];
                const mimeType = body.image.match(/^data:(image\/\w+);/)[1];
                return await processImage(context, headers, endpoint, apiKey, deployment, imageBase64, mimeType);
            } catch (e) {
                context.res = {
                    status: 400,
                    headers,
                    body: JSON.stringify({ error: 'Could not parse image data.' }),
                };
                return;
            }
        }

        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({ error: 'No image provided. Send an image as the request body.' }),
        };
        return;
    }

    // Raw binary body
    const contentType = req.headers['content-type'] || 'image/jpeg';
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (body.length > maxSize) {
        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({ error: 'Image too large. Maximum size is 5MB.' }),
        };
        return;
    }

    const imageBase64 = body.toString('base64');
    const mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : 'image/jpeg';
    return await processImage(context, headers, endpoint, apiKey, deployment, imageBase64, mimeType);
};

async function processImage(context, headers, endpoint, apiKey, deployment, imageBase64, mimeType) {
    // --- Call Azure OpenAI GPT-4o Vision ---
    // Azure OpenAI REST API format
    const apiVersion = '2024-08-01-preview';
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const requestBody = {
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${imageBase64}`,
                            detail: 'high',
                        },
                    },
                    {
                        type: 'text',
                        text: 'Extract all card names visible in this screenshot.',
                    },
                ],
            },
        ],
        max_tokens: 1000,
        temperature: 0.1,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            context.log.error(`Azure OpenAI error: ${response.status} ${errorText}`);
            context.res = {
                status: 502,
                headers,
                body: JSON.stringify({
                    error: 'OCR service returned an error. Please try again.',
                    detail: response.status,
                }),
            };
            return;
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || '';

        // Parse the response — expect a JSON array of card names
        let cardNames = [];
        try {
            // Try direct JSON parse first
            cardNames = JSON.parse(content);
        } catch (e) {
            // Try to extract JSON array from the response text
            const arrayMatch = content.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                try {
                    cardNames = JSON.parse(arrayMatch[0]);
                } catch (e2) {
                    // Last resort: split by lines and clean up
                    cardNames = content
                        .split('\n')
                        .map(line => line.replace(/^[\s\-\*\d.]+/, '').replace(/[",[\]]/g, '').trim())
                        .filter(line => line.length > 0);
                }
            }
        }

        // Ensure all entries are strings
        cardNames = cardNames
            .filter(name => typeof name === 'string' && name.trim().length > 0)
            .map(name => name.trim());

        context.res = {
            status: 200,
            headers,
            body: JSON.stringify({
                cardNames,
                raw: content,
            }),
        };
    } catch (err) {
        context.log.error(`Function error: ${err.message}`);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: 'Internal error processing the screenshot.' }),
        };
    }
}

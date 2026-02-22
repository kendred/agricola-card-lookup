// Azure Function: Strategy advisor proxy for Agricola draft tool
// Receives draft state, calls Azure OpenAI GPT-4o, returns strategic analysis.
// API key stays server-side; rate limiting protects against abuse.

const path = require('path');
const fs = require('fs');

// --- Load card database at module level (cold start only) ---
const CARDS = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'agricola-cards.json'), 'utf8')
);
const CARD_MAP = {};
CARDS.forEach(card => { CARD_MAP[card.name] = card; });

// --- Build compact card index for system prompt (name, rank, ADP, type) ---
const COMPACT_INDEX = JSON.stringify(
    CARDS.map(c => ({ name: c.name, rank: c.rank, adp: c.adp, type: c.type }))
);

// --- Rate limiting (in-memory, resets on cold start) ---
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes

function isRateLimited(ip) {
    const now = Date.now();
    const timestamps = rateLimitMap.get(ip) || [];
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (recent.length >= RATE_LIMIT_MAX) {
        rateLimitMap.set(ip, recent);
        return true;
    }
    recent.push(now);
    rateLimitMap.set(ip, recent);
    return false;
}

// --- Strategy guide (embedded verbatim) ---
const STRATEGY_GUIDE = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'agricola-strategy-guide.md'), 'utf8'
);

// --- System prompt (static — enables Azure OpenAI prompt caching) ---
const SYSTEM_PROMPT = `You are an expert Agricola (board game) draft strategy advisor for 4-player games. You analyze a player's draft state and provide strategic guidance.

You must respond with ONLY valid JSON matching this exact format — no markdown, no explanation, no text outside the JSON:

{
  "overall_analysis": "2-3 sentence narrative summarizing the draft state, strategy direction, and what to prioritize next.",
  "dimensions": {
    "food": "weak|adequate|strong",
    "growth": "weak|adequate|strong",
    "extra_actions": "weak|adequate|strong",
    "point_ceiling": "low|medium|high",
    "plow": "covered|not_covered"
  },
  "risks": "2-3 sentence risk assessment highlighting specific weaknesses, resource bottlenecks, or strategic vulnerabilities.",
  "suggestions": [
    { "card_name": "Exact Card Name", "rank_number": 1, "rationale": "1-2 sentence explanation of why this card is the best pick given the current draft state." },
    { "card_name": "Exact Card Name", "rank_number": 2, "rationale": "1-2 sentence explanation." },
    { "card_name": "Exact Card Name", "rank_number": 3, "rationale": "1-2 sentence explanation." }
  ]
}

Rules for suggestions:
- Suggest 2-3 cards from the current hand (occupations and minor improvements combined).
- rank_number is YOUR ranking (1 = best pick, 2 = second best, 3 = third best). NOT the card's database rank.
- card_name must exactly match a card name from the current hand.
- Consider: current drafted cards, strategic coverage gaps, card synergies, what opponents likely took, card rank/ADP/play rate, and game flow timing.
- Prefer cards that fill the biggest strategic gap. If food is weak, prioritize food. If growth is missing, prioritize growth enablers.
- Factor in whether a card is strategy-defining (requires commitment) vs complementary (enhances actions you'd take anyway).

STRATEGIC FRAMEWORK:

${STRATEGY_GUIDE}

COMPLETE CARD INDEX (773 cards — name, rank, ADP, type):

${COMPACT_INDEX}`;

// --- Enrich card names with full details for user message ---
function enrichCards(names) {
    return names
        .map(name => CARD_MAP[name])
        .filter(Boolean)
        .map(c => ({
            name: c.name,
            rank: c.rank,
            pwr: c.pwr,
            adp: c.adp,
            play_rate: c.play_rate,
            elo_per_play: c.elo_per_play,
            type: c.type,
            description: c.description,
            cost: c.cost,
            vps: c.vps,
            tags: c.tags,
        }));
}

// --- Build user message from draft state ---
function buildUserMessage(body) {
    const round = body.round || 1;
    const handCards = enrichCards(body.handNames || []);
    const draftedCards = enrichCards(body.draftedNames || []);
    const othersDrafted = body.othersDrafted || [];

    let msg = `CURRENT ROUND: ${round}\n\n`;

    msg += `CURRENT HAND (choose from these cards):\n${JSON.stringify(handCards, null, 1)}\n\n`;

    if (draftedCards.length > 0) {
        msg += `MY DRAFTED CARDS SO FAR:\n${JSON.stringify(draftedCards, null, 1)}\n\n`;
    }

    if (othersDrafted.length > 0) {
        msg += `CARDS TAKEN BY OPPONENTS (names only):\n${JSON.stringify(othersDrafted)}\n\n`;
    }

    msg += 'Analyze my draft state and suggest the best picks from my current hand.';
    return msg;
}

// --- Validate LLM response structure ---
function validateResponse(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (typeof obj.overall_analysis !== 'string') return false;
    if (!obj.dimensions || typeof obj.dimensions !== 'object') return false;
    const dims = obj.dimensions;
    if (!['weak', 'adequate', 'strong'].includes(dims.food)) return false;
    if (!['weak', 'adequate', 'strong'].includes(dims.growth)) return false;
    if (!['weak', 'adequate', 'strong'].includes(dims.extra_actions)) return false;
    if (!['low', 'medium', 'high'].includes(dims.point_ceiling)) return false;
    if (!['covered', 'not_covered'].includes(dims.plow)) return false;
    if (typeof obj.risks !== 'string') return false;
    if (!Array.isArray(obj.suggestions)) return false;
    for (const s of obj.suggestions) {
        if (typeof s.card_name !== 'string') return false;
        if (typeof s.rank_number !== 'number') return false;
        if (typeof s.rationale !== 'string') return false;
    }
    return true;
}

module.exports = async function (context, req) {
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

    // Validate environment
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';

    if (!endpoint || !apiKey) {
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: 'Strategy service is not configured.' }),
        };
        return;
    }

    // Rate limiting
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

    // Validate request body
    const body = req.body;
    if (!body || typeof body !== 'object') {
        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid request body.' }),
        };
        return;
    }

    if (!Array.isArray(body.handNames) || body.handNames.length === 0) {
        context.res = {
            status: 400,
            headers,
            body: JSON.stringify({ error: 'handNames is required and must be a non-empty array.' }),
        };
        return;
    }

    // Build messages
    const userMessage = buildUserMessage(body);

    // Call Azure OpenAI
    const apiVersion = '2024-08-01-preview';
    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const requestBody = {
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
        ],
        max_tokens: 1500,
        temperature: 0.3,
        response_format: { type: 'json_object' },
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
                    error: 'Strategy service returned an error. Please try again.',
                    detail: response.status,
                }),
            };
            return;
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || '';

        // Parse and validate response
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            context.log.error(`Failed to parse LLM response: ${content}`);
            context.res = {
                status: 502,
                headers,
                body: JSON.stringify({ error: 'Strategy service returned an invalid response.' }),
            };
            return;
        }

        if (!validateResponse(parsed)) {
            context.log.warn(`LLM response failed validation: ${content}`);
            // Return it anyway with a warning — partial results are better than nothing
            context.res = {
                status: 200,
                headers,
                body: JSON.stringify({
                    ...parsed,
                    _warning: 'Response structure did not fully validate.',
                }),
            };
            return;
        }

        // Token usage for monitoring
        const usage = result.usage || {};

        context.res = {
            status: 200,
            headers,
            body: JSON.stringify({
                ...parsed,
                _usage: {
                    prompt_tokens: usage.prompt_tokens,
                    completion_tokens: usage.completion_tokens,
                    total_tokens: usage.total_tokens,
                },
            }),
        };
    } catch (err) {
        context.log.error(`Function error: ${err.message}`);
        context.res = {
            status: 500,
            headers,
            body: JSON.stringify({ error: 'Internal error processing strategy request.' }),
        };
    }
};

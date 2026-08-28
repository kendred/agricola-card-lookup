// Azure Function v4: Strategy advisor with streaming pass-through.
// Bytes flow: Azure OpenAI SSE → this function → browser as text/event-stream.
// See STREAMING_PLAN.md for full architecture rationale.

const { app } = require('@azure/functions');
const path = require('path');
const fs = require('fs');

// --- Load card database at module level (cold start only) ---
const CARDS = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'agricola-cards.json'), 'utf8')
);
// Banned cards are name-only shells kept in the database for lookup, with no
// type, description, or stats. They are not legal in play, so they must never
// reach the model — an entry with a blank type and no text is worse than absent.
const CARD_MAP = {};
CARDS.forEach(card => { if (!card.banned) CARD_MAP[card.name] = card; });

// --- Compact card index for system prompt ---
function buildCompactIndex(playerCount) {
    return CARDS
        .filter(c => !c.banned)
        .map(c => {
            if (playerCount === 3) {
                if (!c.stats_3p) return null;
                return `${c.name}|${c.stats_3p.rank}|${c.stats_3p.adp}|${c.type === 'Occupation' ? 'O' : 'M'}`;
            }
            if (c.rank == null) return null;
            return `${c.name}|${c.rank}|${c.adp}|${c.type === 'Occupation' ? 'O' : 'M'}`;
        })
        .filter(Boolean)
        .join('\n');
}
const COMPACT_INDEX_4P = buildCompactIndex(4);
const COMPACT_INDEX_3P = buildCompactIndex(3);

// --- Analytical draft statistics ---
// Same module the browser uses (js/draft-stats.js), duplicated into api/lib/ because
// the Functions runtime cannot read outside api/. Computing server-side rather than
// trusting a client-supplied blob means eval fixtures and real requests take the
// identical path.
const draftStats = require('../lib/draft-stats.js');
draftStats.init(CARDS.filter(c => !c.banned));

// Cards of each type dealt per round; mirrors HAND_SIZE_BY_ROUND in draft.html.
const HAND_SIZE_BY_ROUND = { 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4 };

// Which physical hand appears in each round. Hand N is always first seen in
// round N, which is what makes HAND_SIZE_BY_ROUND[handNumber] the size that hand
// was originally dealt at.
const ROTATION = {
    3: { 1: 1, 2: 2, 3: 3, 4: 1, 5: 2, 6: 3, 7: 1 },
    4: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1, 6: 2, 7: 3 },
};

// --- Rate limiting (in-memory, resets on cold start) ---
const rateLimitMap = new Map();
// Overridable so eval runs can drive the endpoint hard locally. Unset in
// production, where it stays at 5 requests per 10 minutes per IP.
const RATE_LIMIT_MAX = Number(process.env.STRATEGY_RATE_LIMIT_MAX) || 5;
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

// --- Rules reference (embedded verbatim) ---
// Authoritative game mechanics. Must precede the strategy guide in the prompt: the
// guide assumes the rules as background, and without them the model fills the gaps
// from pretraining (which blurs Agricola with Caverna and the Family/revised editions).
const RULES_REFERENCE = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agricola-rules-reference.md'), 'utf8'
);

// --- Strategy guide (embedded verbatim) ---
const STRATEGY_GUIDE = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agricola-strategy-guide.md'), 'utf8'
);

// --- System prompt (static — enables Azure OpenAI prompt caching across all requests) ---
const SYSTEM_PROMPT_TEMPLATE = `You are an expert Agricola (board game) draft strategy advisor for 3- and 4-player games. You analyze a player's draft state and provide strategic guidance. The user message will tell you the exact PLAYER COUNT and round-to-hand rotation for this draft.

You must respond with ONLY valid JSON matching this exact format — no markdown, no explanation, no text outside the JSON:

{
  "reasoning": "3-5 sentences of internal analysis. Assess: (a) what strategy archetypes are forming based on drafted card tags, (b) specific synergies between cards in the current hand and already-drafted cards, (c) what opponents' picks signal about contested action spaces, (d) what the biggest strategic gap is right now.",
  "archetypes": ["Primary archetype", "Secondary archetype if applicable"],
  "overall_analysis": "2-3 sentence narrative summarizing the draft state and what to prioritize next.",
  "dimensions": {
    "food": { "rating": "weak|adequate|strong", "reason": "Brief justification for this rating" },
    "growth": { "rating": "weak|adequate|strong", "reason": "Brief justification" },
    "extra_actions": { "rating": "weak|adequate|strong", "reason": "Brief justification" },
    "point_ceiling": { "rating": "low|medium|high", "reason": "Brief justification" },
    "plow": { "rating": "covered|not_covered", "reason": "Brief justification" }
  },
  "risks": "2-3 sentences identifying specific weaknesses, contested action spaces based on opponent picks, and strategic vulnerabilities.",
  "suggestions": [
    { "card_name": "Best Occupation", "rank_number": 1, "rationale": "Explain: (1) how this card synergizes with already-drafted cards by name, (2) what strategic gap it fills, (3) why it's better than the next-best occupation in the hand." },
    { "card_name": "2nd Occupation", "rank_number": 2, "rationale": "Same structure." },
    { "card_name": "Best Minor Improvement", "rank_number": 1, "rationale": "Same structure." },
    { "card_name": "2nd Minor Improvement", "rank_number": 2, "rationale": "Same structure." }
  ]
}

Rules for reasoning:
- The "reasoning" field comes FIRST and must be filled with genuine analysis BEFORE producing the other fields. Think through the draft state carefully.
- For "archetypes", list the 1-2 most prominent strategy directions forming from drafted card tags. Use archetype names from the strategy guide: Day Laborer, Fishing, Traveling Players, Grain, Sow, Major/Minor, Lesson, Big House, Small House, Stone House, Stable. If no clear archetype has emerged (typically rounds 1-2), use ["Flexible"].

Rules for suggestions:
- You MUST return exactly 2 Occupation suggestions and exactly 2 Minor Improvement suggestions (4 total). Never return 3 of one type and 1 of the other — count the types in your suggestions array before responding. Only return fewer than 2 of a type if the current hand genuinely contains fewer than 2 cards of that type.
- rank_number is your ranking within each type: 1 = best pick, 2 = second best. NOT the card's database rank.
- card_name must exactly match a card name from the current hand.
- Consider: current drafted cards, strategic coverage gaps, card synergies, what opponents likely took, card rank/ADP/play rate, and game flow timing.
- Prefer cards that fill the biggest strategic gap. If food is weak, prioritize food. If growth is missing, prioritize growth enablers.
- Factor in whether a card is strategy-defining (requires commitment) vs complementary (enhances actions you'd take anyway).
- For rationale, go beyond generic statements. Name specific already-drafted cards that synergize and explain WHY the synergy matters in terms of action efficiency or scoring. Explain what makes this pick better than the alternative.

Draft stage awareness:
- Calibrate depth to draft progress. The user message includes CURRENT ROUND and the number of drafted cards.
- Rounds 1-2 (0-4 drafted cards): Keep analysis very brief. The strategy is still forming. Do NOT flag missing dimensions as risks — it is simply too early. Focus on what the current picks signal and what directions to watch for.
- Rounds 3-4 (4-8 drafted cards): Moderate analysis. Identify emerging patterns and note which dimensions are starting to take shape.
- Rounds 5-7 (8-14 drafted cards): Full analysis. Provide detailed gap assessment and specific synergy recommendations.

%%RULES_BLOCK%%STRATEGIC FRAMEWORK:
%%GUIDE_PREAMBLE%%
${STRATEGY_GUIDE}

COMPLETE CARD INDEX (format "name|rank|adp|type" where type is O=Occupation, M=Minor Improvement). Use this to reason about what cards may still appear in future hands and what the opponents could potentially draft. Fully-enriched details (description, tags, play rate, elo, cost, VPs) for the player's current hand and drafted cards are provided in the user message — rely on that for detailed analysis.
Rankings and stats differ between 3-player and 4-player games. The card index below matches the player count for this game.

`;

const RULES_BLOCK = `GAME RULES (AUTHORITATIVE):

The following is the definitive rules reference for this game, taken from the official
rulebook. It overrides any conflicting recollection you may have about Agricola. Base every
mechanical claim you make — costs, yields, capacities, timing, scoring thresholds, what an
action space does — on this text. If you are about to assert a mechanic that is not stated
here, do not assert it. Never invent card effects, action spaces, or rules that this
reference does not describe.

${RULES_REFERENCE}

`;

const GUIDE_PREAMBLE_WITH_RULES = `
The following is strategic interpretation, not rules. Where it summarizes a mechanic, the
rules reference above is authoritative.`;

// Prompt variants. 'current' is what production serves. 'baseline' reconstructs
// the pre-rules-reference prompt so the eval harness can measure what adding the
// rules actually bought — see docs/strategy-quality-plan.md, Stage 2. Without it
// Stage 1 stays an untested assumption.
function buildSystemPrompt(playerCount, variant) {
    const withRules = variant !== 'baseline';
    return SYSTEM_PROMPT_TEMPLATE
        .replace('%%RULES_BLOCK%%', withRules ? RULES_BLOCK : '')
        .replace('%%GUIDE_PREAMBLE%%', withRules ? GUIDE_PREAMBLE_WITH_RULES : '')
        + (playerCount === 3 ? COMPACT_INDEX_3P : COMPACT_INDEX_4P);
}

const PROMPTS = {
    current: { 3: buildSystemPrompt(3, 'current'), 4: buildSystemPrompt(4, 'current') },
    baseline: { 3: buildSystemPrompt(3, 'baseline'), 4: buildSystemPrompt(4, 'baseline') },
};

// --- Resolve stats based on player count ---
function getStats(card, playerCount) {
    if (playerCount === 3 && card.stats_3p) return card.stats_3p;
    return card;
}

// --- Enrich card names with full details for user message ---
function enrichCards(names, playerCount) {
    return names
        .map(name => CARD_MAP[name])
        .filter(Boolean)
        .map(c => {
            const s = getStats(c, playerCount);
            return {
                name: c.name, rank: s.rank, apr: s.apr, adp: s.adp,
                play_rate: s.play_rate, elo_per_play: s.elo_per_play,
                type: c.type, description: c.description,
                cost: c.cost, vps: c.vps, tags: c.tags,
            };
        });
}

// --- Light enrichment for opponent cards ---
function enrichOpponentCards(names, playerCount) {
    return names
        .map(name => CARD_MAP[name])
        .filter(Boolean)
        .map(c => {
            const s = getStats(c, playerCount);
            return { name: c.name, rank: s.rank, type: c.type, tags: c.tags };
        });
}

// --- Computed hand analysis ---
// Everything here is exact given the card database, so the model should read it
// rather than estimate it. The one modelled assumption is called out inline.
function buildAnalysisBlock(body, playerCount, round) {
    const handCards = (body.handNames || []).map(n => CARD_MAP[n]).filter(Boolean);
    if (!handCards.length) return '';

    // handSize is this round's deal; originalHandSize is the deal size of the round
    // this hand was FIRST seen in. On a returning hand those differ, and using the
    // current size for both grades a picked-over hand against a fresh-deal baseline.
    const handSize = HAND_SIZE_BY_ROUND[round] || 4;
    const handNumber = (ROTATION[playerCount] || ROTATION[4])[round] || round;
    const originalHandSize = HAND_SIZE_BY_ROUND[handNumber] || handSize;

    // Tag survival for a returning hand is resolved from the cards actually seen
    // before. Without that history the known-hand path finds no surviving tagged
    // card and reports 0%, which is confidently wrong rather than merely absent.
    const haveHistory = !!(body.seenHands && Object.keys(body.seenHands).length);

    let analysis;
    try {
        analysis = draftStats.analyzeHand(
            handCards,
            handSize,
            playerCount,
            round,
            body.seenHands || null,
            body.draftedByRound || null,
            originalHandSize
        );
    } catch (err) {
        return '';
    }
    if (!analysis) return '';

    const lines = [];
    lines.push('COMPUTED HAND ANALYSIS (calculated exactly from the card database — treat these');
    lines.push('as given. Do not re-derive them, estimate them, or contradict them.)');
    lines.push('');

    if (analysis.percentile != null) {
        const p = analysis.percentile;
        const suffix = (p % 100 >= 11 && p % 100 <= 13) ? 'th'
            : ({ 1: 'st', 2: 'nd', 3: 'rd' }[p % 10] || 'th');
        lines.push(`Hand strength: grade ${analysis.grade && analysis.grade.grade}, `
            + `${p}${suffix} percentile against hands dealt the same way at this stage.`);
    }

    // cardQualities is keyed by card name, not an array.
    const quality = Object.entries(analysis.cardQualities || {})
        .filter(([, q]) => q && (q.quality === 'strong' || q.quality === 'weak'));
    if (quality.length) {
        const better = quality.filter(([, q]) => q.quality === 'strong').map(([name]) => name);
        const worse = quality.filter(([, q]) => q.quality === 'weak').map(([name]) => name);
        if (better.length) lines.push(`Stronger than expected for their slot: ${better.join(', ')}.`);
        if (worse.length) lines.push(`Weaker than expected for their slot: ${worse.join(', ')}.`);
    }

    const tagStats = haveHistory ? (analysis.tagStats || {}) : {};
    const tags = Object.keys(tagStats);
    if (tags.length) {
        lines.push('');
        lines.push('Chance of drafting ADDITIONAL cards of each tag present in this hand, across all');
        lines.push('remaining rounds. NOTE: this assumes opponents draft strictly by card rank, which');
        lines.push('is a simplifying model, not observed behaviour — treat these as indicative.');
        for (const tag of tags) {
            const dist = tagStats[tag].distribution || [];
            const atLeastOne = dist.length > 1
                ? (1 - dist[0]) : 0;
            lines.push(`  ${tag}: ${tagStats[tag].count} in hand now, `
                + `P(at least 1 more) = ${(atLeastOne * 100).toFixed(0)}%`);
        }
    }

    return lines.join('\n') + '\n\n';
}

// --- Build user message from draft state ---
// `variant` is threaded through because the computed-analysis block lives in the
// USER message, not the system prompt. Without this, promptVariant:'baseline'
// would still receive the Stage 4 stats and the A/B would not isolate anything.
function buildUserMessage(body, variant) {
    const round = body.round || 1;
    const playerCount = body.playerCount === 3 ? 3 : 4;
    const handCards = enrichCards(body.handNames || [], playerCount);
    const draftedCards = enrichCards(body.draftedNames || [], playerCount);
    const othersDrafted = body.othersDrafted || [];
    const rotationNote = playerCount === 3
        ? '3-player draft: 3 distinct hands, each passes around 3 times. Rotation R1=H1, R2=H2, R3=H3, R4=H1, R5=H2, R6=H3, R7=H1. Returning rounds start at R4. H1 is seen 3 times, H2/H3 twice.'
        : '4-player draft: 4 distinct hands. Rotation R1=H1, R2=H2, R3=H3, R4=H4, R5=H1, R6=H2, R7=H3. Returning rounds start at R5. H4 is seen only once.';
    let msg = `PLAYER COUNT: ${playerCount}\nGAME FORMAT: ${rotationNote}\nCURRENT ROUND: ${round}\n\n`;

    msg += `CURRENT HAND (choose from these cards):\n${JSON.stringify(handCards, null, 1)}\n\n`;
    if (draftedCards.length > 0) {
        msg += `MY DRAFTED CARDS SO FAR:\n${JSON.stringify(draftedCards, null, 1)}\n\n`;
    }
    if (othersDrafted.length > 0) {
        const enrichedOpponents = enrichOpponentCards(othersDrafted, playerCount);
        msg += `CARDS TAKEN BY OPPONENTS (with type, rank, and strategy tags):\n${JSON.stringify(enrichedOpponents, null, 1)}\n\n`;
    }
    if (variant !== 'baseline') {
        msg += buildAnalysisBlock(body, playerCount, round);
    }
    msg += 'Analyze my draft state and suggest the best picks from my current hand.';
    return msg;
}

// --- Recover fields the model nested inside "dimensions" ---
// The model intermittently fails to close the "dimensions" object before
// emitting the remaining top-level fields, so "risks" and "suggestions" end up
// as siblings of "plow". The JSON still parses, so the response reaches the
// client looking merely incomplete -- a blank dashboard. The content is correct
// and only misplaced: 11 of 11 incomplete responses across the Aug 19 2026 eval
// (7 current, 4 baseline) had exactly this shape. Hoist rather than discard.
// Only these move. Hoisting *any* unrecognised key would promote the model's
// hallucinated dimensions (observed: "plow?", "raw_materials") to the top level
// and hide them from the Tier 2 dimension checks, which should still flag them.
const HOISTABLE_KEYS = ['reasoning', 'archetypes', 'overall_analysis', 'risks', 'suggestions'];

function hoistMisnestedFields(parsed) {
    const dims = parsed && parsed.dimensions;
    if (!dims || typeof dims !== 'object' || Array.isArray(dims)) return;
    for (const key of HOISTABLE_KEYS) {
        if (!(key in dims)) continue;
        // Never clobber a value the model did put at the root.
        if (parsed[key] === undefined) parsed[key] = dims[key];
        delete dims[key];
    }
}

// --- Normalize suggestions to at most 2 occupations + 2 minor improvements ---
function normalizeSuggestions(parsed, handNames, context) {
    if (!parsed || !Array.isArray(parsed.suggestions)) return;
    const occs = [];
    const mins = [];
    const unknown = [];
    for (const s of parsed.suggestions) {
        const card = CARD_MAP[s.card_name];
        if (card && card.type === 'Occupation') occs.push(s);
        else if (card && card.type === 'Minor Improvement') mins.push(s);
        else unknown.push(s);
    }
    const trimmedOccs = occs.slice(0, 2).map((s, i) => ({ ...s, rank_number: i + 1 }));
    const trimmedMins = mins.slice(0, 2).map((s, i) => ({ ...s, rank_number: i + 1 }));
    if (occs.length > 2 || mins.length > 2) {
        try { context.warn(`normalizeSuggestions trimmed: occs=${occs.length}->2, mins=${mins.length}->2`); } catch {}
    }
    parsed.suggestions = [...trimmedOccs, ...trimmedMins, ...unknown];
}

// --- v4 handler registration ---
app.http('strategy', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'strategy',
    handler: async (request, context) => {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Preflight
        if (request.method === 'OPTIONS') {
            return { status: 204, headers: corsHeaders, body: '' };
        }

        // Validate environment
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = process.env.AZURE_OPENAI_KEY;
        const deployment = process.env.AZURE_OPENAI_STRATEGY_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT || 'o3';

        if (!endpoint || !apiKey) {
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                body: JSON.stringify({ error: 'Strategy service is not configured.' }),
            };
        }

        // Rate limit — checked before starting any stream so concurrent slow
        // streams can't sneak past the cap during a long reasoning phase.
        const clientIP = request.headers.get('x-forwarded-for')
            || request.headers.get('x-client-ip')
            || request.headers.get('client-ip')
            || 'unknown';

        if (isRateLimited(clientIP)) {
            return {
                status: 429,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                body: JSON.stringify({ error: 'Too many requests. Try again in a few minutes.' }),
            };
        }

        // Parse body
        let body;
        try {
            body = await request.json();
        } catch {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                body: JSON.stringify({ error: 'Invalid request body.' }),
            };
        }

        if (!body || typeof body !== 'object') {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                body: JSON.stringify({ error: 'Invalid request body.' }),
            };
        }

        // Health probe — empty body or explicit probe flag → answer immediately (non-streaming)
        if (Object.keys(body).length === 0 || body.probe === true) {
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                body: JSON.stringify({ available: true }),
            };
        }

        if (!Array.isArray(body.handNames) || body.handNames.length === 0) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
                body: JSON.stringify({ error: 'handNames is required and must be a non-empty array.' }),
            };
        }

        // Build OpenAI request
        const playerCount = body.playerCount === 3 ? 3 : 4;
        const promptVariant = body.promptVariant === 'baseline' ? 'baseline' : 'current';
        const userMessage = buildUserMessage(body, promptVariant);
        const apiVersion = '2025-04-01-preview';
        const openAIUrl = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

        const openAIRequestBody = {
            messages: [
                { role: 'system', content: (PROMPTS[promptVariant] || PROMPTS.current)[playerCount] },
                { role: 'user', content: userMessage },
            ],
            max_completion_tokens: 16000,
            response_format: { type: 'json_object' },
            stream: true,
            // Final chunk carries exact token counts, including the reasoning
            // tokens that dominate cost on o-series models and are otherwise
            // invisible. Its `choices` array is empty, which the delta parse
            // below already tolerates via optional chaining.
            stream_options: { include_usage: true },
        };

        // Use ReadableStream with start(controller) — same pattern as probe-stream.
        // Azure Functions starts forwarding to the client as soon as it reads the
        // first enqueued chunk, so we enqueue an immediate keepalive before any
        // await to guarantee data flows before the SWA 45s edge timeout fires.
        const encoder = new TextEncoder();
        const reqBody = body;

        const stream = new ReadableStream({
            async start(controller) {
                const send = (line) => controller.enqueue(encoder.encode(line));

                // Immediate keepalive — ensures Azure Functions sees data right away
                // and begins forwarding the stream rather than buffering it.
                send(': keepalive\n\n');

                // Subsequent heartbeats every 3s during the model's reasoning phase.
                const heartbeat = setInterval(() => send(': keepalive\n\n'), 3000);
                let firstToken = true;

                const ac = new AbortController();
                if (request.signal) {
                    request.signal.addEventListener('abort', () => ac.abort());
                }
                const timeoutId = setTimeout(() => ac.abort(), 180000);

                try {
                    const upstreamResponse = await fetch(openAIUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
                        body: JSON.stringify(openAIRequestBody),
                        signal: ac.signal,
                    });

                    if (!upstreamResponse.ok) {
                        const errText = await upstreamResponse.text();
                        context.error(`Azure OpenAI error: ${upstreamResponse.status} ${errText}`);
                        send(`event: error\ndata: ${JSON.stringify({ message: 'Strategy service returned an error. Please try again.' })}\n\n`);
                        return;
                    }

                    // Parse the OpenAI SSE stream and forward tokens
                    const reader = upstreamResponse.body.getReader();
                    const decoder = new TextDecoder();
                    let lineBuffer = '';
                    let accumulated = '';

                    outer: while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        lineBuffer += decoder.decode(value, { stream: true });

                        let newlineIdx;
                        while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
                            const line = lineBuffer.slice(0, newlineIdx).trimEnd();
                            lineBuffer = lineBuffer.slice(newlineIdx + 1);

                            if (!line || line.startsWith(':')) continue;
                            if (!line.startsWith('data: ')) continue;

                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                // Emit normalized final state as the canonical client snapshot.
                                let parsed;
                                try { parsed = JSON.parse(accumulated); } catch { /* pass */ }
                                if (!parsed) {
                                    const m = accumulated.match(/```(?:json)?\s*([\s\S]*?)```/);
                                    if (m) { try { parsed = JSON.parse(m[1].trim()); } catch { /* pass */ } }
                                }
                                if (parsed) {
                                    hoistMisnestedFields(parsed);
                                    normalizeSuggestions(parsed, reqBody.handNames, context);
                                    send(`event: normalized\ndata: ${JSON.stringify(parsed)}\n\n`);
                                }
                                send('event: done\ndata: {}\n\n');
                                break outer;
                            }

                            let chunk;
                            try { chunk = JSON.parse(data); } catch { continue; }

                            if (chunk.usage) {
                                send(`event: usage\ndata: ${JSON.stringify(chunk.usage)}\n\n`);
                            }

                            const delta = chunk.choices?.[0]?.delta?.content;
                            if (delta != null && delta !== '') {
                                if (firstToken) {
                                    clearInterval(heartbeat);
                                    firstToken = false;
                                }
                                accumulated += delta;
                                send(`event: token\ndata: ${JSON.stringify(delta)}\n\n`);
                            }
                        }
                    }

                } catch (err) {
                    const isAbort = err.name === 'AbortError';
                    context.error(`Strategy stream error: ${err.name}: ${err.message}`);
                    if (!isAbort) {
                        send(`event: error\ndata: ${JSON.stringify({ message: 'Internal error processing strategy request.' })}\n\n`);
                    }
                } finally {
                    clearTimeout(timeoutId);
                    clearInterval(heartbeat);
                    controller.close();
                }
            },
        });

        return {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                ...corsHeaders,
            },
            body: stream,
        };
    },
});

// Exposed for the eval harness: lets a prompt-variant check verify what is
// actually being sent without issuing a billed request.
module.exports = { PROMPTS, buildUserMessage, hoistMisnestedFields };

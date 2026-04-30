// Azure Function: Card submission pipeline for Agricola draft tool
// Validates user-submitted card data, deduplicates, and creates a GitHub Issue
// as a moderation queue. Admin reviews issues and adds approved cards to the DB.

const path = require('path');

// --- Rate limiting (in-memory, resets on cold start) ---
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

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

// --- Card database (loaded once on cold start) ---
const cardData = require(path.join(__dirname, '..', 'data', 'agricola-cards.json'));
const existingCardNames = new Set(cardData.map(c => c.name.toLowerCase()));

// --- Validation constants ---
const NAME_PATTERN = /^[\p{L}\p{N}\s'\-.,!&()]+$/u;
const VALID_TYPES = ['Occupation', 'Minor Improvement'];
const PASSING_PHRASE = 'pass it to the player on your left';
const LIMITS = { name: 100, description: 1000, cost: 50, prerequisites: 150, vps: 20 };

module.exports = async function (context, req) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
        context.res = { status: 204, headers, body: '' };
        return;
    }

    // --- Environment ---
    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO || 'kendred/agricola-card-lookup';

    if (!githubToken) {
        context.res = {
            status: 500, headers,
            body: JSON.stringify({ error: 'Card submission service is not configured. Contact the site administrator.' }),
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
            status: 429, headers,
            body: JSON.stringify({ error: 'Too many requests. Try again in a few minutes.' }),
        };
        return;
    }

    // --- Parse body ---
    const body = req.body || {};
    const name = (body.name || '').trim();
    const type = body.type;
    const description = (body.description || '').trim();
    const cost = (body.cost || '').trim();
    // Occupations never have prerequisites or printed VPs; player-count badges ("3+", "A", etc.) are not prereqs/VPs.
    const prerequisites = type === 'Occupation' ? '' : (body.prerequisites || '').trim();
    const vps = type === 'Occupation' ? '' : (body.vps || '').trim();

    // --- Validation ---
    if (!name) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: 'Card name is required.' }) };
        return;
    }
    if (name.length > LIMITS.name) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: `Card name must be ${LIMITS.name} characters or less.` }) };
        return;
    }
    if (!NAME_PATTERN.test(name)) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: 'Card name contains invalid characters.' }) };
        return;
    }
    if (!type || !VALID_TYPES.includes(type)) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: 'Type must be "Occupation" or "Minor Improvement".' }) };
        return;
    }
    if (description.length > LIMITS.description) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: `Description must be ${LIMITS.description} characters or less.` }) };
        return;
    }
    if (cost.length > LIMITS.cost) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: `Cost must be ${LIMITS.cost} characters or less.` }) };
        return;
    }
    if (prerequisites.length > LIMITS.prerequisites) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: `Prerequisites must be ${LIMITS.prerequisites} characters or less.` }) };
        return;
    }
    if (vps.length > LIMITS.vps) {
        context.res = { status: 400, headers, body: JSON.stringify({ error: `Victory points must be ${LIMITS.vps} characters or less.` }) };
        return;
    }

    // --- Auto-derive passing flag ---
    const passing = description.toLowerCase().includes(PASSING_PHRASE);

    // --- Local dedup: check against card database ---
    if (existingCardNames.has(name.toLowerCase())) {
        context.res = {
            status: 409, headers,
            body: JSON.stringify({ error: 'This card already exists in the database.' }),
        };
        return;
    }

    // --- GitHub dedup: check for existing open issues ---
    const ghHeaders = {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'agricola-card-lookup',
    };

    try {
        const searchQuery = encodeURIComponent(`repo:${githubRepo} is:issue is:open label:card-submission "${name}" in:title`);
        const searchRes = await fetch(`https://api.github.com/search/issues?q=${searchQuery}`, { headers: ghHeaders });

        if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.total_count > 0) {
                context.res = {
                    status: 200, headers,
                    body: JSON.stringify({
                        message: 'This card has already been submitted for review.',
                        existingIssue: searchData.items[0].html_url,
                    }),
                };
                return;
            }
        }
        // If search fails, proceed anyway — better a duplicate issue than a lost submission
    } catch (err) {
        context.log.warn('GitHub search failed, proceeding with issue creation:', err.message);
    }

    // --- Build issue body ---
    const cardJson = JSON.stringify({ name, type, description, cost, prerequisites, vps, passing, card_id: null, tags: [] }, null, 2);

    const issueBody = `## Submitted Card

| Field | Value |
|-------|-------|
| **Name** | ${name} |
| **Type** | ${type} |
| **Cost** | ${cost || '—'} |
| **Prerequisites** | ${prerequisites || '—'} |
| **Victory Points** | ${vps || '—'} |
| **Passing** | ${passing ? 'Yes' : 'No'} |
| **Description** | ${description || '—'} |

<details>
<summary>Machine-readable JSON (for batch-approve script)</summary>

\`\`\`json
${cardJson}
\`\`\`

</details>`;

    // --- Create GitHub Issue ---
    try {
        const issueRes = await fetch(`https://api.github.com/repos/${githubRepo}/issues`, {
            method: 'POST',
            headers: { ...ghHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: `[Card Submission] ${name}`,
                body: issueBody,
                labels: ['card-submission'],
            }),
        });

        if (!issueRes.ok) {
            const errText = await issueRes.text();
            context.log.error('GitHub issue creation failed:', issueRes.status, errText);
            context.res = {
                status: 502, headers,
                body: JSON.stringify({ error: 'Failed to submit card. Please try again later.' }),
            };
            return;
        }

        const issue = await issueRes.json();
        context.res = {
            status: 201, headers,
            body: JSON.stringify({ message: 'Card submitted for review.', issueUrl: issue.html_url }),
        };
    } catch (err) {
        context.log.error('GitHub API error:', err.message);
        context.res = {
            status: 502, headers,
            body: JSON.stringify({ error: 'Failed to submit card. Please try again later.' }),
        };
    }
};

#!/usr/bin/env node
/**
 * Tier 1 — rules-comprehension scoring.
 *
 * Asks a model to find mechanical claims in a response that contradict
 * docs/agricola-rules-reference.md. Deliberately narrow: it judges whether
 * statements about the GAME are true, not whether the picks were good. Pick
 * quality is subjective and there is no outcome data to ground it, so trying
 * to score it here would produce a confident number that means nothing.
 *
 * Narrow scope is also what makes the judge trustworthy — it is checking
 * claims against a supplied document rather than exercising taste.
 *
 *   AZURE_OPENAI_KEY=... node evals/judge.mjs evals/reports/<run-dir>
 *
 * Credentials come from the environment, or from api/local.settings.json
 * (which is gitignored). Pull them with:
 *   az functionapp config appsettings list -g rg-agricola -n agricola-api
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const RULES = readFileSync('docs/agricola-rules-reference.md', 'utf8');

function credentials() {
  let endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  let key = process.env.AZURE_OPENAI_KEY;
  let deployment = process.env.AZURE_OPENAI_JUDGE_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT;

  const local = 'api/local.settings.json';
  if ((!endpoint || !key) && existsSync(local)) {
    const vals = JSON.parse(readFileSync(local, 'utf8')).Values || {};
    endpoint = endpoint || vals.AZURE_OPENAI_ENDPOINT;
    key = key || vals.AZURE_OPENAI_KEY;
    deployment = deployment || vals.AZURE_OPENAI_DEPLOYMENT;
  }
  if (!endpoint || !key) {
    console.error('Missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY.');
    console.error('Set them in the environment or api/local.settings.json.');
    process.exit(1);
  }
  return { endpoint, key, deployment: deployment || 'gpt-4o' };
}

const SYSTEM = `You are auditing an Agricola strategy assistant for MECHANICAL correctness only.

You will be given the authoritative rules reference, the draft state the assistant was
responding to, and the assistant's response. Identify statements in the response that
contradict the rules reference.

Report ONLY factual errors about how the game works. Examples of what counts:
- wrong resource cost, yield, or conversion rate
- wrong capacity (pasture, stable, room, farmyard)
- wrong timing (when a phase, harvest, or action space occurs)
- wrong scoring threshold
- referring to an action space that does not exist, or does not exist at this player count
- attributing an effect to a card type that cannot have it (e.g. an Occupation with a
  resource cost, printed VP, or the passing flag)
- describing a rule that the reference explicitly lists as false

What does NOT count, and must not be reported:
- disagreeing with the assistant's strategic judgement or card preferences
- vagueness, hedging, or generic advice
- claims about a specific card's text, unless that text is quoted in the draft state
- anything the rules reference simply does not address

Be conservative. If the rules reference does not clearly settle it, do not report it.

Respond with ONLY valid JSON:
{
  "violations": [
    {
      "quote": "the exact sentence or clause from the response",
      "rule": "what the rules reference actually says",
      "severity": "major | minor"
    }
  ]
}
"major" means the error would lead a player to a materially wrong decision. "minor" means
it is wrong but unlikely to change play. An empty array is the expected result for a
correct response.`;

async function judge(cfg, record) {
  const r = record.result?.normalized;
  if (!r) return { skipped: 'no normalized payload' };

  const prose = {
    reasoning: r.reasoning,
    overall_analysis: r.overall_analysis,
    risks: r.risks,
    dimensions: Object.fromEntries(
      Object.entries(r.dimensions || {}).map(([k, v]) => [k, v?.reason])),
    suggestions: (r.suggestions || []).map((s) => ({ card: s.card_name, rationale: s.rationale })),
  };

  const user = `RULES REFERENCE:
${RULES}

DRAFT STATE:
player count: ${record.request.playerCount}
round: ${record.request.round} of 7
cards in hand: ${record.request.handNames.length}

ASSISTANT RESPONSE TO AUDIT:
${JSON.stringify(prose, null, 1)}`;

  const url = `${cfg.endpoint.replace(/\/$/, '')}/openai/deployments/${cfg.deployment}`
    + '/chat/completions?api-version=2025-04-01-preview';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': cfg.key },
    body: JSON.stringify({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });

  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { error: 'judge returned unparseable JSON' };
  }
}

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node evals/judge.mjs <run-dir> [--json out.json]'); process.exit(1); }
  const jsonAt = process.argv.indexOf('--json');
  const jsonOut = jsonAt !== -1 ? process.argv[jsonAt + 1] : null;

  const cfg = credentials();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  console.log(`judging ${files.length} responses with ${cfg.deployment}\n`);

  const rows = [];
  for (const [i, f] of files.entries()) {
    const record = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const verdict = await judge(cfg, record);
    const violations = verdict.violations || [];
    const major = violations.filter((v) => v.severity === 'major').length;
    rows.push({
      fixtureId: record.fixtureId, run: record.run, round: record.round,
      variant: record.variant || 'current', violations, error: verdict.error || verdict.skipped,
    });
    const tag = verdict.error || verdict.skipped
      ? `SKIP (${verdict.error || verdict.skipped})`
      : `${violations.length} violation(s)${major ? `, ${major} major` : ''}`;
    console.log(`[${i + 1}/${files.length}] ${record.fixtureId} ${record.variant || ''} — ${tag}`);
  }

  // ── summary by variant ────────────────────────────────────────────────
  const byVariant = new Map();
  for (const row of rows) {
    if (!byVariant.has(row.variant)) byVariant.set(row.variant, []);
    byVariant.get(row.variant).push(row);
  }

  console.log('\n── rules violations by variant ──');
  for (const [variant, group] of byVariant) {
    const scored = group.filter((r) => !r.error);
    if (!scored.length) { console.log(`${variant}: all skipped`); continue; }
    const total = scored.reduce((s, r) => s + r.violations.length, 0);
    const major = scored.reduce((s, r) => s + r.violations.filter((v) => v.severity === 'major').length, 0);
    const clean = scored.filter((r) => !r.violations.length).length;
    console.log(`${variant}: ${(total / scored.length).toFixed(2)} violations/response`
      + ` (${major} major across ${scored.length}), ${clean}/${scored.length} fully clean`);
  }

  const all = rows.flatMap((r) => r.violations.map((v) => ({ ...v, variant: r.variant })));
  if (all.length) {
    console.log('\nmost common:');
    for (const v of all.filter((x) => x.severity === 'major').slice(0, 6)) {
      console.log(`  [${v.variant}] "${v.quote.slice(0, 90)}"`);
      console.log(`      -> ${v.rule.slice(0, 110)}`);
    }
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ dir, rows }, null, 2));
    console.log(`\nfull report -> ${jsonOut}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Tier 2 grounding checks — pure assertions against the card database.
 *
 * These need no model and no judgement: a card either exists or it doesn't, a
 * suggestion is either in the hand or it isn't. They catch the failure mode
 * that motivated this work (invented cards and effects) without an LLM in the
 * loop. Rules-comprehension scoring is Tier 1 and lives in judge.mjs.
 *
 *   node evals/check.mjs evals/reports/<run-dir>
 *   node evals/check.mjs evals/reports/<run-dir> --json report.json
 *
 * Every check is labelled strict or heuristic. Strict checks are safe to gate
 * on; heuristic ones flag things for a human to read and will have false
 * positives.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const CARDS = JSON.parse(readFileSync('data/agricola-cards.json', 'utf8'));
const BY_NAME = new Map(CARDS.map((c) => [c.name, c]));

const VALID_ARCHETYPES = new Set([
  'Small House', 'Big House', 'Stone House', 'Day Laborer', 'Grain',
  'Major/Minor', 'Fishing', 'Traveling Players', 'Sow', 'Lesson', 'Stable',
  'Flexible',
]);
const VALID_RATINGS = new Set(['weak', 'adequate', 'strong', 'low', 'medium', 'high']);
const VALID_PLOW = new Set(['covered', 'not_covered']);
const REQUIRED_FIELDS = ['reasoning', 'archetypes', 'overall_analysis', 'dimensions', 'risks', 'suggestions'];

/** Card names long enough to be unambiguous when scanned for in prose. */
const SCANNABLE = CARDS
  .map((c) => c.name)
  .filter((n) => n.length >= 6 && /\s/.test(n))
  .sort((a, b) => b.length - a.length);

const finding = (check, severity, detail) => ({ check, severity, detail });

function checkOne(record) {
  const { result, request } = record;
  const out = [];
  if (!result?.ok || !result.normalized) {
    out.push(finding('response-usable', 'strict', result?.error || 'no normalized payload'));
    return out;
  }

  const r = result.normalized;
  const hand = new Set(request.handNames);
  const handCards = request.handNames.map((n) => BY_NAME.get(n)).filter(Boolean);

  // ── schema ────────────────────────────────────────────────────────────
  for (const f of REQUIRED_FIELDS) {
    if (r[f] === undefined || r[f] === null || r[f] === '') {
      out.push(finding('schema-complete', 'strict', `missing field: ${f}`));
    }
  }

  // ── archetypes ────────────────────────────────────────────────────────
  for (const a of r.archetypes || []) {
    if (!VALID_ARCHETYPES.has(a)) {
      out.push(finding('archetype-valid', 'strict', `unknown archetype: "${a}"`));
    }
  }
  // Traveling Players has no action space at 3 players — recommending it as a
  // direction there is a rules error, not a taste difference.
  if (request.playerCount === 3 && (r.archetypes || []).includes('Traveling Players')) {
    out.push(finding('3p-traveling-players', 'strict',
      'named Traveling Players as an archetype in a 3-player game, where the space does not exist'));
  }

  // ── dimensions ────────────────────────────────────────────────────────
  for (const [dim, val] of Object.entries(r.dimensions || {})) {
    const rating = val?.rating;
    const ok = dim === 'plow' ? VALID_PLOW.has(rating) : VALID_RATINGS.has(rating);
    if (!ok) out.push(finding('dimension-rating-valid', 'strict', `${dim}: "${rating}"`));
  }

  // ── suggestions ───────────────────────────────────────────────────────
  const sugg = Array.isArray(r.suggestions) ? r.suggestions : [];
  const byType = { Occupation: [], 'Minor Improvement': [], unknown: [] };
  for (const s of sugg) {
    const card = BY_NAME.get(s.card_name);
    if (!card) {
      // The sharpest signal available: a suggested card that does not exist.
      out.push(finding('suggested-card-exists', 'strict', `no such card: "${s.card_name}"`));
      byType.unknown.push(s);
      continue;
    }
    if (!hand.has(s.card_name)) {
      out.push(finding('suggested-card-in-hand', 'strict',
        `"${s.card_name}" is a real card but was not in the hand`));
    }
    (byType[card.type] || byType.unknown).push(s);
  }

  // Only demand two of a type when the hand actually offers two.
  for (const type of ['Occupation', 'Minor Improvement']) {
    const available = handCards.filter((c) => c.type === type).length;
    const expected = Math.min(2, available);
    if (byType[type].length !== expected) {
      out.push(finding('suggestion-type-balance', 'strict',
        `${byType[type].length} ${type} suggestions, expected ${expected} (hand has ${available})`));
    }
    const ranks = byType[type].map((s) => s.rank_number).sort();
    const wanted = Array.from({ length: expected }, (_, i) => i + 1);
    if (expected && JSON.stringify(ranks) !== JSON.stringify(wanted)) {
      out.push(finding('suggestion-rank-numbers', 'strict',
        `${type} rank_numbers ${JSON.stringify(ranks)}, expected ${JSON.stringify(wanted)}`));
    }
  }

  const seen = new Set();
  for (const s of sugg) {
    if (seen.has(s.card_name)) {
      out.push(finding('suggestion-unique', 'strict', `duplicate suggestion: "${s.card_name}"`));
    }
    seen.add(s.card_name);
  }

  // ── prose grounding ───────────────────────────────────────────────────
  const prose = [r.reasoning, r.overall_analysis, r.risks,
    ...sugg.map((s) => s.rationale),
    ...Object.values(r.dimensions || {}).map((d) => d?.reason)]
    .filter(Boolean).join('\n');

  // Cards discussed by name that were never on the table. Not automatically
  // wrong — the prompt does ask it to reason about the wider pool — but a card
  // that is neither in hand, nor drafted, nor taken by an opponent is usually
  // the model wandering.
  const context = new Set([...request.handNames, ...request.draftedNames, ...request.othersDrafted]);
  const strayed = SCANNABLE.filter((n) => !context.has(n) && prose.includes(n));
  if (strayed.length) {
    out.push(finding('prose-card-in-context', 'heuristic',
      `discusses cards outside the draft state: ${strayed.slice(0, 5).join(', ')}`));
  }

  // Explicit rank claims must match the database.
  for (const m of prose.matchAll(/([A-Z][A-Za-z''-]+(?:\s+[A-Z][A-Za-z''-]+){0,3})\s*\((?:is\s+)?[Rr]ank\s+(\d+)\)/g)) {
    const [, name, claimed] = m;
    const card = BY_NAME.get(name.trim());
    if (!card) continue;                        // name-matching is fuzzy; skip
    const actual = request.playerCount === 3 && card.stats_3p ? card.stats_3p.rank : card.rank;
    if (actual != null && Number(claimed) !== actual) {
      out.push(finding('rank-claim-accurate', 'strict',
        `claims ${name} is rank ${claimed}, database says ${actual}`));
    }
  }

  return out;
}

function main() {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir) { console.error('usage: node evals/check.mjs <run-dir> [--json out.json]'); process.exit(1); }
  const jsonAt = rest.indexOf('--json');
  const jsonOut = jsonAt !== -1 ? rest[jsonAt + 1] : null;

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const records = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  if (!records.length) { console.error('no results in ' + dir); process.exit(1); }

  const rows = records.map((rec) => ({
    fixtureId: rec.fixtureId,
    run: rec.run,
    round: rec.round,
    playerCount: rec.playerCount,
    variant: rec.variant || rec.request?.promptVariant || 'current',
    usage: rec.result?.usage || null,
    findings: checkOne(rec),
  }));

  // ── aggregate ─────────────────────────────────────────────────────────
  const byVariant = new Map();
  for (const row of rows) {
    if (!byVariant.has(row.variant)) byVariant.set(row.variant, []);
    byVariant.get(row.variant).push(row);
  }

  console.log(`checked ${rows.length} responses from ${dir}\n`);

  for (const [variant, group] of byVariant) {
    const clean = group.filter((r) => !r.findings.some((f) => f.severity === 'strict')).length;
    console.log(`── ${variant} (${group.length} responses) ──`);
    console.log(`   clean on strict checks: ${clean}/${group.length} (${(clean / group.length * 100).toFixed(0)}%)`);

    const tally = new Map();
    for (const row of group) {
      for (const f of row.findings) {
        const key = `${f.severity}:${f.check}`;
        tally.set(key, (tally.get(key) || 0) + 1);
      }
    }
    for (const [key, n] of [...tally].sort((a, b) => b[1] - a[1])) {
      const [sev, check] = key.split(':');
      console.log(`   ${sev === 'strict' ? '!' : '?'} ${check}: ${n}`);
    }

    const withUsage = group.filter((r) => r.usage);
    if (withUsage.length) {
      const avg = (f) => withUsage.reduce((s, r) => s + (f(r.usage) || 0), 0) / withUsage.length;
      const reasoning = avg((u) => u.completion_tokens_details?.reasoning_tokens);
      console.log(`   tokens/call: in ${avg((u) => u.prompt_tokens).toFixed(0)}` +
        `  out ${avg((u) => u.completion_tokens).toFixed(0)}` +
        (reasoning ? ` (reasoning ${reasoning.toFixed(0)})` : ''));
    }
    console.log();
  }

  // ── variance: do repeat runs of the same fixture agree? ───────────────
  const byFixture = new Map();
  for (const row of rows) {
    const key = `${row.variant}/${row.fixtureId}`;
    if (!byFixture.has(key)) byFixture.set(key, []);
    byFixture.get(key).push(row);
  }
  const multi = [...byFixture.values()].filter((g) => g.length > 1);
  if (multi.length) {
    const unstable = multi.filter((g) => {
      const counts = new Set(g.map((r) => r.findings.filter((f) => f.severity === 'strict').length));
      return counts.size > 1;
    });
    console.log(`variance: ${unstable.length}/${multi.length} fixtures gave a different strict-failure`
      + ` count across runs`);
    if (unstable.length) {
      console.log('  (treat any delta smaller than this as noise, not a regression)');
    }
  } else {
    console.log('variance: only one run per fixture — cannot separate signal from noise.');
    console.log('  re-run with --runs 3 before trusting any comparison.');
  }

  // ── worst offenders ───────────────────────────────────────────────────
  const failing = rows.filter((r) => r.findings.some((f) => f.severity === 'strict'))
    .sort((a, b) => b.findings.length - a.findings.length).slice(0, 5);
  if (failing.length) {
    console.log('\nmost findings:');
    for (const row of failing) {
      console.log(`  ${row.variant}/${row.fixtureId} run${row.run} (r${row.round}):`);
      for (const f of row.findings.slice(0, 4)) console.log(`      [${f.severity}] ${f.check} — ${f.detail}`);
    }
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ dir, rows }, null, 2));
    console.log(`\nfull report -> ${jsonOut}`);
  }
}

main();

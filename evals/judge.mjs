#!/usr/bin/env node
/**
 * Tier 1 — rules-comprehension scoring.
 *
 * Finds claims in a response that contradict the game's actual mechanics.
 * Deliberately narrow: it judges whether statements about the GAME are true,
 * not whether the picks were good. There is no outcome data to ground pick
 * quality against, so scoring it would produce a confident meaningless number.
 *
 * IMPORTANT — the judge is given the CARD TEXT, not just the rules reference.
 * A manual pass over 49 baseline responses found that judging against the rules
 * alone yields ~35% false positives: most claims are card-specific and the
 * rulebook cannot adjudicate them. Cards like Adoptive Parents ("you can take an
 * action with offspring in the same round you get it") legitimately override
 * general rules, and a rules-only judge flags them as errors.
 *
 *   node evals/judge.mjs evals/reports/<run-dir>
 *   node evals/judge.mjs evals/reports/<run-dir> --sample 49 --concurrency 6
 *   node evals/judge.mjs evals/reports/<run-dir> --calibrate evals/judgments/baseline-tier1.json
 *
 * Credentials: AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY in the environment.
 * Pull them without persisting to disk:
 *   export AZURE_OPENAI_KEY=$(az functionapp config appsettings list \
 *     -g rg-agricola -n agricola-api --query "[?name=='AZURE_OPENAI_KEY'].value" -o tsv)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const RULES = readFileSync('docs/agricola-rules-reference.md', 'utf8');
const CARDS = JSON.parse(readFileSync('data/agricola-cards.json', 'utf8'));
const BY_NAME = new Map(CARDS.filter(c => !c.banned).map(c => [c.name, c]));

const DEFAULTS = {
  concurrency: 3,
  sample: 0,            // 0 == every response in the directory
  // o4-mini, not gpt-4o. Validated against 4 known-positive responses: o4-mini
  // returned ~3-4 true positives of 4, gpt-4o returned 1 of 4 and rated three
  // accurate paraphrases of card text as major violations. This task is careful
  // text comparison, which the reasoning model does markedly better.
  deployment: process.env.AZURE_OPENAI_JUDGE_DEPLOYMENT || 'o4-mini',
  out: null,
  calibrate: null,
  only: null,
  runs: 0,              // 0 == all runs; 1 == one run per fixture
};

function parseArgs() {
  const cfg = { ...DEFAULTS, dir: process.argv[2] };
  const argv = process.argv.slice(3);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!(k in cfg)) throw new Error(`unknown flag: ${argv[i]}`);
    const raw = argv[++i];
    cfg[k] = typeof DEFAULTS[k] === 'number' ? Number(raw) : raw;
  }
  if (!cfg.dir) { console.error('usage: node evals/judge.mjs <run-dir> [flags]'); process.exit(1); }
  return cfg;
}

function credentials() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  if (!endpoint || !key) {
    console.error('Missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY in the environment.');
    console.error('See the header of this file for how to export them without writing to disk.');
    process.exit(1);
  }
  return { endpoint, key };
}

const SYSTEM = `You are auditing an Agricola strategy assistant for MECHANICAL correctness.

You get the rules reference, the text of every card in this draft state, and the response.

Work in two steps, and do the first step properly — it is what makes the audit reliable.

STEP 1 — Extract every checkable mechanical claim the response makes. A mechanical claim is
any statement about how the game or a specific card works: what something costs, what it
yields, when it happens, how much it holds, what it scores, what an action space does, what
a named card does. Ignore strategic opinion entirely. Expect to find between 5 and 20 such
claims in a typical response.

STEP 2 — For each extracted claim, mark it:
  SUPPORTED    — the card text or rules reference confirms it
  CONTRADICTED — the card text or rules reference says otherwise
  UNVERIFIABLE — the supplied material does not settle it

AUTHORITY ORDER:
1. A card's own text governs what THAT card does, and overrides the general rules. If the
   response describes a card in a way its text supports, the claim is SUPPORTED even where
   the general rule differs. Example shape: a card may explicitly let a newborn act in the
   round it is born, even though the general rule forbids it.
2. The rules reference governs everything else — spaces, costs, timing, capacities, scoring.
3. The card pool uses newer action-space names (Farmland, Quarry, Grain Seeds, Lessons,
   Pig Market, Sheep Market, Resource Market, Farm Expansion, Grain Utilization). These are
   listed in the rules reference mapping table and are CORRECT. Never flag them.

Then report only the CONTRADICTED claims.

Things that are genuinely wrong and should be reported when you find them: describing a
Major Improvement's effect incorrectly; treating Major Improvements as belonging to one
player's deck rather than the shared board; naming an action space that appears nowhere in
the rules reference; inventing a scoring bonus; stating a resource cost for something that
costs only an action; describing a conditional card effect as guaranteed; confusing two
different action spaces with each other; misstating a capacity or a conversion rate.

Do not report strategic disagreement, vagueness, or anything the supplied material does not
settle.

Respond with ONLY valid JSON:
{"claims_checked": <integer>,
 "violations":[{"quote":"exact clause from the response","rule":"what the card text or rules actually say","severity":"major|minor"}]}

"major" means it would lead a player to a materially wrong decision. Set claims_checked to
how many mechanical claims you extracted in step 1.`;

function cardContext(request) {
  const names = new Set([
    ...(request.handNames || []),
    ...(request.draftedNames || []),
    ...(request.othersDrafted || []),
  ]);
  const lines = [];
  for (const n of names) {
    const c = BY_NAME.get(n);
    if (!c) continue;
    const bits = [c.type];
    if (c.cost) bits.push(`cost ${c.cost}`);
    if (c.vps) bits.push(`${c.vps} VP`);
    if (c.prerequisites) bits.push(`needs ${c.prerequisites}`);
    lines.push(`${c.name} [${bits.join(', ')}]: ${c.description || '(no text)'}`);
  }
  return lines.join('\n');
}

async function judgeOne(cfg, creds, record) {
  const r = record.result?.normalized;
  if (!r) return { skipped: 'no normalized payload' };

  const dims = {};
  for (const [k, v] of Object.entries(r.dimensions || {})) {
    dims[k] = typeof v === 'object' && v ? v.reason : v;
  }
  const prose = {
    reasoning: r.reasoning,
    overall_analysis: r.overall_analysis,
    risks: r.risks,
    dimensions: dims,
    suggestions: (r.suggestions || [])
      .filter(s => s && typeof s === 'object')
      .map(s => ({ card: s.card_name, rationale: s.rationale })),
  };

  const user = `RULES REFERENCE:
${RULES}

CARD TEXT for every card in this draft state (authoritative for what these cards do):
${cardContext(record.request || {})}

DRAFT STATE: ${record.request?.playerCount}-player, round ${record.request?.round} of 7.

ASSISTANT RESPONSE TO AUDIT:
${JSON.stringify(prose, null, 1)}`;

  const url = `${creds.endpoint.replace(/\/$/, '')}/openai/deployments/${cfg.deployment}`
    + '/chat/completions?api-version=2025-04-01-preview';

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': creds.key },
      body: JSON.stringify({
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
        // o-series reasoning deployments reject an explicit temperature.
        ...(/^o\d/.test(cfg.deployment) ? {} : { temperature: 0 }),
      }),
    });
    if (res.status === 429) {
      await new Promise(r2 => setTimeout(r2, 15000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
    const data = await res.json();
    try {
      const parsed = JSON.parse(data.choices[0].message.content);
      return { violations: parsed.violations || [], claimsChecked: parsed.claims_checked, usage: data.usage };
    } catch {
      return { error: 'judge returned unparseable JSON' };
    }
  }
  return { error: 'rate limited after retries' };
}

/** Compare automated output against a manual judgment file, per fixture. */
function calibrate(rows, manualPath) {
  const manual = JSON.parse(readFileSync(manualPath, 'utf8'));
  const manualByFixture = new Map();
  for (const v of manual.violations) {
    manualByFixture.set(v.fixture, (manualByFixture.get(v.fixture) || 0) + 1);
  }
  const scope = new Set(manual.sample.map(s => `${s.fixtureId}__run${s.run}`));
  const judged = rows.filter(r => scope.has(`${r.fixtureId}__run${r.run}`));

  let agree = 0, over = 0, under = 0;
  for (const r of judged) {
    const m = manualByFixture.get(r.fixtureId) || 0;
    const a = (r.violations || []).length;
    if (a === m) agree++; else if (a > m) over++; else under++;
  }
  const manualTotal = manual.violations.length;
  const autoTotal = judged.reduce((s, r) => s + (r.violations || []).length, 0);

  console.log('\n── calibration against manual judgment ──');
  console.log(`  scope: ${judged.length} responses also judged by hand`);
  console.log(`  manual found ${manualTotal} violations, automated found ${autoTotal}`);
  console.log(`  exact per-fixture agreement: ${agree}/${judged.length}`);
  console.log(`  automated over-reported on ${over}, under-reported on ${under}`);
  if (autoTotal > manualTotal * 1.5) {
    console.log('  !! automated is over-reporting substantially — check for false positives');
    console.log('     on card-specific claims before trusting the full run.');
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const cfg = parseArgs();
  const creds = credentials();

  let files = readdirSync(cfg.dir).filter(f => f.endsWith('.json'));
  let records = files.map(f => ({ file: f, ...JSON.parse(readFileSync(join(cfg.dir, f), 'utf8')) }));
  records = records.filter(r => r.result?.normalized);

  // With --calibrate, judge exactly the responses the manual pass judged —
  // same fixture AND same run — so the comparison is like-for-like. Violations
  // vary between runs of the same fixture, so matching on fixture alone would
  // muddy the agreement figure.
  if (cfg.calibrate) {
    const manual = JSON.parse(readFileSync(cfg.calibrate, 'utf8'));
    const want = new Set(manual.sample.map(s => `${s.fixtureId}__run${s.run}`));
    records = records.filter(r => want.has(`${r.fixtureId}__run${r.run}`));
  }
  if (cfg.runs === 1) {
    const seen = new Set();
    records = records.filter(r => !seen.has(r.fixtureId) && seen.add(r.fixtureId));
  }
  if (cfg.only) {
    const want = new Set(cfg.only.split(','));
    records = records.filter(r => want.has(r.fixtureId));
  }
  if (cfg.sample > 0) records = records.slice(0, cfg.sample);

  const outDir = cfg.out || join('evals/judgments', basename(cfg.dir) + '-tier1-auto');
  mkdirSync(outDir, { recursive: true });
  const done = new Set(readdirSync(outDir).map(f => basename(f, '.json')));
  const queue = records.filter(r => !done.has(`${r.fixtureId}__run${r.run}`));

  console.log(`judging ${records.length} responses with ${cfg.deployment}`);
  console.log(`pending: ${queue.length}   concurrency: ${cfg.concurrency}   output: ${outDir}\n`);

  const total = queue.length;
  let n = 0, errors = 0;
  const rows = [];
  async function worker() {
    for (;;) {
      const rec = queue.shift();
      if (!rec) return;
      const verdict = await judgeOne(cfg, creds, rec);
      const row = {
        fixtureId: rec.fixtureId, run: rec.run, round: rec.round,
        variant: rec.variant || 'current',
        violations: verdict.violations || [], claimsChecked: verdict.claimsChecked,
        error: verdict.error || verdict.skipped,
        usage: verdict.usage,
      };
      rows.push(row);
      writeFileSync(join(outDir, `${rec.fixtureId}__run${rec.run}.json`), JSON.stringify(row, null, 1));
      n++;
      if (row.error) errors++;
      const maj = row.violations.filter(v => v.severity === 'major').length;
      console.log(`[${n}/${total}] ${rec.fixtureId} r${rec.round} — `
        + (row.error ? `ERROR ${row.error}` : `${row.violations.length} violation(s)${maj ? `, ${maj} major` : ''}`));
    }
  }
  await Promise.all(Array.from({ length: cfg.concurrency }, worker));

  // include anything judged in a previous interrupted run
  for (const f of readdirSync(outDir)) {
    const row = JSON.parse(readFileSync(join(outDir, f), 'utf8'));
    if (!rows.find(r => r.fixtureId === row.fixtureId && r.run === row.run)) rows.push(row);
  }

  const byVariant = new Map();
  for (const r of rows) {
    if (!byVariant.has(r.variant)) byVariant.set(r.variant, []);
    byVariant.get(r.variant).push(r);
  }
  console.log('\n── rules violations by variant ──');
  for (const [variant, group] of byVariant) {
    const ok = group.filter(r => !r.error);
    if (!ok.length) { console.log(`${variant}: all errored`); continue; }
    const total = ok.reduce((s, r) => s + r.violations.length, 0);
    const major = ok.reduce((s, r) => s + r.violations.filter(v => v.severity === 'major').length, 0);
    const clean = ok.filter(r => !r.violations.length).length;
    console.log(`${variant}: ${(total / ok.length).toFixed(2)} per response `
      + `(${total} total, ${major} major) — ${clean}/${ok.length} clean`);
    const byRound = {};
    for (const r of ok) byRound[r.round] = (byRound[r.round] || 0) + r.violations.length;
    console.log(`   by round: ${JSON.stringify(byRound)}`);
  }
  if (errors) console.log(`\n${errors} responses errored`);
  if (cfg.calibrate) calibrate(rows.filter(r => !r.error), cfg.calibrate);

  writeFileSync(join(outDir, '_summary.json'), JSON.stringify({ dir: cfg.dir, rows }, null, 1));
  console.log(`\nfull output -> ${outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });

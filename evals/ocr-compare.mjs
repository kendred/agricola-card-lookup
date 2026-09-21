#!/usr/bin/env node
/**
 * OCR model A/B — run the fixture screenshots through several Azure OpenAI
 * vision deployments and score name extraction against the answer keys.
 *
 * The prompt comes from api/ocr/index.js, so every model gets byte-identical
 * input to what the live endpoint sends. Build the fixtures first:
 *
 *   node evals/ocr-fixtures/build.mjs
 *   node evals/ocr-compare.mjs --deployments gpt-4o,gpt-5.6-luna,gpt-5.6-terra
 *
 * Metrics, per model:
 *   recall     — share of cards actually on screen that the model found.
 *                This is the one that matters. A miss means the user has to
 *                type the card in by hand.
 *   precision  — share of returned names that were really on screen.
 *   exactSet   — share of screenshots where the returned set matched the
 *                answer key exactly. The user-visible "it just worked" rate.
 *   invented   — names returned that are not in the card database at all.
 *                Distinct from a precision miss, which is a real card read off
 *                the wrong screenshot; this is the model making something up.
 *   truncated  — responses cut off by the token cap rather than finished.
 *
 * Credentials come from the environment, same as the other harnesses:
 *   export AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_KEY=...
 *
 * Results land in evals/reports/ocr-<deployment>/ and a roll-up at
 * evals/reports/ocr-compare-summary.json. Re-running resumes.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const ocr = require('../api/ocr/index.js');
const SYSTEM_PROMPT = ocr.SYSTEM_PROMPT;

const DEFAULTS = {
  deployments: 'gpt-4o,gpt-5.6-luna,gpt-5.6-terra',
  fixtures: join(HERE, 'ocr-fixtures'),
  outRoot: join(HERE, 'reports'),
  runs: 2,
  only: null,
  concurrency: 3,
  timeout: 300000,
  apiVersion: '2025-04-01-preview',
  // The live endpoint sends max_tokens: 1000, which is ample for a name list
  // but would be spent on reasoning alone by a reasoning model. A shared,
  // generous cap keeps the comparison about extraction rather than budget.
  maxTokens: 4000,
};

/** USD per 1M tokens, East US 2 / GlobalStandard, standard tier. */
const PRICES = {
  'gpt-4o':        { in: 2.50, out: 10.00 },
  'gpt-4o-mini':   { in: 0.15, out: 0.60 },
  'gpt-5.6-sol':   { in: 4.00, out: 20.00 },
  'gpt-5.6-terra': { in: 2.00, out: 12.00 },
  'gpt-5.6-luna':  { in: 0.20, out: 1.20 },
  'gpt-5.4-mini':  { in: 0.75, out: 4.50 },
  'gpt-5.4-nano':  { in: 0.20, out: 1.25 },
};

function parseArgs() {
  const cfg = { ...DEFAULTS };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in cfg)) throw new Error(`unknown flag: ${argv[i]}`);
    const raw = argv[++i];
    cfg[key] = typeof DEFAULTS[key] === 'number' ? Number(raw) : raw;
  }
  return cfg;
}

function credentials() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  if (!endpoint || !key) {
    console.error('Missing AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY.');
    process.exit(1);
  }
  return { endpoint: endpoint.replace(/\/$/, ''), key };
}

/** Same normalization the image resolver uses — tolerate case/punctuation drift. */
const norm = (s) => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[\s\-'.]/g, '');

function parseNameArray(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  let parsed;
  try { parsed = JSON.parse(t); } catch { /* try to salvage a bare array */ }
  if (!parsed) {
    const m = t.match(/\[[\s\S]*\]/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { return null; } }
  }
  if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
  // Some models wrap the array in an object despite the instruction.
  if (parsed && typeof parsed === 'object') {
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
    }
  }
  return null;
}

/**
 * Reasoning models reject `temperature` and want `max_completion_tokens`;
 * gpt-4o wants `max_tokens`. Rather than hardcode which is which, send the
 * legacy shape and retry on the specific 400 that names the offending
 * parameter. The retry path is logged in the record, because "this model
 * needed different parameters" is itself a migration finding.
 */
async function callVision(cfg, creds, deployment, dataUrl) {
  const url = `${creds.endpoint}/openai/deployments/${deployment}`
    + `/chat/completions?api-version=${cfg.apiVersion}`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        { type: 'text', text: 'Extract all card names visible in this screenshot.' },
      ],
    },
  ];

  const attempts = [
    { label: 'legacy', body: { messages, max_tokens: cfg.maxTokens, temperature: 0.1 } },
    { label: 'reasoning', body: { messages, max_completion_tokens: cfg.maxTokens } },
  ];

  let lastErr = null;
  let attemptIdx = 0;
  let throttleRetries = 0;
  while (attemptIdx < attempts.length) {
    const attempt = attempts[attemptIdx];
    const started = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeout);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': creds.key },
        body: JSON.stringify(attempt.body),
        signal: ac.signal,
      });

      // The gpt-4o deployment is provisioned Standard with a lower token
      // budget than the GlobalStandard ones, so a concurrency that is fine for
      // the others throttles it. Back off and retry rather than recording a
      // 429 as if the model had failed the fixture.
      if (res.status === 429) {
        clearTimeout(timer);
        if (throttleRetries >= 6) {
          return { ok: false, status: 429, error: 'rate limited after 6 retries',
                   elapsedMs: Date.now() - started };
        }
        const wait = Number(res.headers.get('retry-after')) * 1000
          || Math.min(60000, 5000 * 2 ** throttleRetries);
        throttleRetries++;
        await new Promise((r) => setTimeout(r, wait));
        continue;   // re-send the same parameter shape
      }

      if (res.status === 400) {
        const text = await res.text();
        if (/max_tokens|temperature|max_completion_tokens|unsupported/i.test(text)) {
          lastErr = text.slice(0, 300);
          attemptIdx++;   // try the other parameter shape
          continue;
        }
        return { ok: false, status: 400, error: text.slice(0, 300),
                 elapsedMs: Date.now() - started };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, error: (await res.text()).slice(0, 300),
                 elapsedMs: Date.now() - started };
      }

      const json = await res.json();
      const text = json.choices?.[0]?.message?.content ?? '';
      const names = parseNameArray(text);
      return {
        ok: names != null,
        names,
        rawText: text,
        paramStyle: attempt.label,
        usage: json.usage ?? null,
        finishReason: json.choices?.[0]?.finish_reason ?? null,
        elapsedMs: Date.now() - started,
        error: names ? undefined : 'response was not a parseable name array',
      };
    } catch (err) {
      return { ok: false, elapsedMs: Date.now() - started,
               error: err.name === 'AbortError' ? 'timeout' : err.message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: `all parameter shapes rejected: ${lastErr}` };
}

function score(names, answerCards, validNames) {
  const expected = new Set(answerCards.map((c) => norm(c.name)));
  const got = new Set((names || []).map(norm));

  let hit = 0;
  for (const n of got) if (expected.has(n)) hit++;

  const invented = [...got].filter((n) => !validNames.has(n));
  const missed = answerCards.filter((c) => !got.has(norm(c.name))).map((c) => c.name);
  const extra = (names || []).filter((n) => !expected.has(norm(n)));

  const recall = expected.size ? hit / expected.size : 0;
  const precision = got.size ? hit / got.size : 0;
  return {
    recall, precision,
    f1: recall + precision ? (2 * recall * precision) / (recall + precision) : 0,
    exactSet: hit === expected.size && got.size === expected.size,
    inventedCount: invented.length,
    invented, missed, extra,
    expectedCount: expected.size, returnedCount: got.size,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const fmtUsd = (n) => (n == null ? '-' : `$${n.toFixed(4)}`);

async function main() {
  const cfg = parseArgs();
  const creds = credentials();
  const deployments = cfg.deployments.split(',').map((s) => s.trim()).filter(Boolean);

  const manifestPath = join(cfg.fixtures, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`No fixtures at ${cfg.fixtures}. Run: node evals/ocr-fixtures/build.mjs`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let fixtures = manifest.fixtures;
  if (cfg.only) fixtures = fixtures.filter((f) => f.fixtureId.includes(cfg.only));

  const cards = JSON.parse(readFileSync(join(ROOT, 'data', 'agricola-cards.json'), 'utf8'));
  const validNames = new Set(cards.map((c) => norm(c.name)));

  // Load each image once; all models see the identical bytes.
  const images = new Map();
  for (const f of fixtures) {
    const buf = readFileSync(join(cfg.fixtures, f.image));
    images.set(f.fixtureId, `data:image/png;base64,${buf.toString('base64')}`);
  }

  console.log(`deployments: ${deployments.join(', ')}`);
  console.log(`fixtures: ${fixtures.length}  runs each: ${cfg.runs}\n`);

  const summaries = [];

  for (const deployment of deployments) {
    const outDir = join(cfg.outRoot, `ocr-${deployment}`);
    mkdirSync(outDir, { recursive: true });
    const done = new Set(readdirSync(outDir).map((f) => basename(f, '.json')));

    const jobs = [];
    for (const f of fixtures) {
      for (let run = 1; run <= cfg.runs; run++) {
        const id = `${f.fixtureId}__run${run}`;
        if (!done.has(id)) jobs.push({ f, run, id });
      }
    }

    console.log(`── ${deployment} ── ${jobs.length} pending -> ${outDir}`);
    const queue = jobs.slice();
    let completed = 0;

    async function worker() {
      for (;;) {
        const job = queue.shift();
        if (!job) return;

        const answer = JSON.parse(readFileSync(join(cfg.fixtures, job.f.answer), 'utf8'));
        const result = await callVision(cfg, creds, deployment, images.get(job.f.fixtureId));
        const scored = result.ok ? score(result.names, answer.cards, validNames) : null;

        writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify({
          fixtureId: job.f.fixtureId, run: job.run, deployment,
          handSize: job.f.handSize, scale: job.f.scale, source: job.f.source,
          expected: answer.cards.map((c) => c.name),
          result, scored,
        }, null, 2));

        completed++;
        const tag = result.ok ? `recall ${pct(scored.recall)}` : `FAIL ${result.error}`;
        console.log(`  [${completed}/${jobs.length}] ${job.id}  ${tag}`);
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, worker));

    const records = readdirSync(outDir).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')));
    const usable = records.filter((r) => r.scored);
    const avg = (fn) => (usable.length ? usable.reduce((a, r) => a + fn(r), 0) / usable.length : 0);
    const price = PRICES[deployment];
    let inTok = 0, outTok = 0;
    for (const r of records) {
      inTok += r.result?.usage?.prompt_tokens || 0;
      outTok += r.result?.usage?.completion_tokens || 0;
    }
    const cost = price ? (inTok / 1e6) * price.in + (outTok / 1e6) * price.out : null;
    const lat = usable.map((r) => r.result.elapsedMs).sort((a, b) => a - b);

    // Recall split by rendered card size is the question the scale variants
    // exist to answer: is a model's weakness resolution, or comprehension?
    // Below 1.0 the cards are smaller than the source art, which is what a
    // whole-window screenshot looks like.
    const dense = usable.filter((r) => r.scale < 1.0);
    const large = usable.filter((r) => r.scale >= 1.0);
    const avgOf = (rows, fn) => (rows.length ? rows.reduce((a, r) => a + fn(r), 0) / rows.length : null);

    const s = {
      deployment,
      calls: records.length,
      usable: usable.length,
      failed: records.length - usable.length,
      recall: avg((r) => r.scored.recall),
      precision: avg((r) => r.scored.precision),
      f1: avg((r) => r.scored.f1),
      exactSetRate: avg((r) => (r.scored.exactSet ? 1 : 0)),
      invented: usable.reduce((a, r) => a + r.scored.inventedCount, 0),
      truncated: records.filter((r) => r.result?.finishReason === 'length').length,
      paramStyle: records.find((r) => r.result?.paramStyle)?.result.paramStyle ?? null,
      recallSmall: avgOf(dense, (r) => r.scored.recall),
      recallNative: avgOf(large, (r) => r.scored.recall),
      medianLatencyMs: lat.length ? lat[Math.floor(lat.length / 2)] : null,
      promptTokens: inTok, completionTokens: outTok,
      usdTotal: cost,
      usdPerCall: cost != null && records.length ? cost / records.length : null,
    };
    summaries.push(s);
    console.log(`  recall ${pct(s.recall)}  precision ${pct(s.precision)}  `
      + `exact ${pct(s.exactSetRate)}  cost ${fmtUsd(s.usdTotal)}\n`);
  }

  console.log('=== OCR extraction accuracy ===');
  const head = ['deployment', 'n', 'recall', 'precis', 'exact set', 'small', 'native+',
                'invented', 'trunc', 'med lat', '$ / call'];
  const rows = summaries.map((s) => [
    s.deployment, String(s.usable), pct(s.recall), pct(s.precision), pct(s.exactSetRate),
    s.recallSmall == null ? '-' : pct(s.recallSmall),
    s.recallNative == null ? '-' : pct(s.recallNative),
    String(s.invented), String(s.truncated),
    s.medianLatencyMs != null ? `${(s.medianLatencyMs / 1000).toFixed(1)}s` : '-',
    fmtUsd(s.usdPerCall),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (c) => c.map((x, i) => x.padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));

  writeFileSync(join(cfg.outRoot, 'ocr-compare-summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), config: cfg, summaries }, null, 2));
  console.log(`\nsummary -> ${join(cfg.outRoot, 'ocr-compare-summary.json')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

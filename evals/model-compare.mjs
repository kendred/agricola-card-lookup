#!/usr/bin/env node
/**
 * Strategy model A/B — run the SAME fixtures through several Azure OpenAI
 * deployments and write results the existing scorers already understand.
 *
 * Why this exists separately from run.mjs: run.mjs posts at /api/strategy, so
 * the model under test is whatever AZURE_OPENAI_STRATEGY_DEPLOYMENT happens to
 * be. Comparing models that way would mean mutating a production app setting
 * between runs. This harness calls Azure OpenAI directly instead, so nothing
 * about the live site changes while a comparison is in flight.
 *
 * It imports PROMPTS / buildUserMessage / hoistMisnestedFields /
 * normalizeSuggestions straight out of api/strategy/index.js, so the prompt and
 * the post-processing are the production ones rather than a drifted copy. The
 * one deliberate difference from the live path is stream:false — SSE delivery
 * is an transport concern and does not change what the model writes.
 *
 * Output goes to evals/reports/model-<deployment>/ in run.mjs's record shape,
 * so check.mjs and judge.mjs run against it unchanged:
 *
 *   node evals/model-compare.mjs --deployments o4-mini,gpt-5.6-terra --sample 12
 *   node evals/check.mjs evals/reports/model-o4-mini
 *   node evals/judge.mjs evals/reports/model-gpt-5.6-terra
 *
 * Credentials come from the environment and are never written to disk:
 *   export AZURE_OPENAI_ENDPOINT=$(az cognitiveservices account show \
 *     --name agricola-resource --resource-group rg-agricola \
 *     --query properties.endpoint -o tsv)
 *   export AZURE_OPENAI_KEY=$(az cognitiveservices account keys list \
 *     --name agricola-resource --resource-group rg-agricola --query key1 -o tsv)
 *
 * Re-running skips results already on disk, so an interrupted run resumes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const strategy = require('../api/strategy/index.js');
const { PROMPTS, buildUserMessage, hoistMisnestedFields, normalizeSuggestions } = strategy;

const DEFAULTS = {
  deployments: 'o4-mini,gpt-5.6-terra,gpt-5.6-luna',
  fixtures: 'evals/fixtures',
  outRoot: 'evals/reports',
  runs: 2,
  sample: 12,          // 0 == every fixture
  only: null,          // substring filter on fixtureId
  variant: 'current',  // matches run.mjs: 'current' | 'baseline'
  concurrency: 4,
  timeout: 600000,
  apiVersion: '2025-04-01-preview',
  maxTokens: 16000,
  reasoningEffort: null,  // e.g. 'low' | 'medium' | 'high'; omitted when null
};

/**
 * Published Azure list prices, USD per 1M tokens, East US 2 / GlobalStandard,
 * standard (non-priority) tier, short-context rate where the model is tiered.
 * Used only to report what a comparison run cost and to project a monthly bill
 * — nothing downstream depends on these being current. Refresh from:
 *   https://prices.azure.com/api/retail/prices
 */
const PRICES = {
  'o4-mini':       { in: 1.10, out: 4.40 },
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
    console.error('See the header of this file for how to export them without writing to disk.');
    process.exit(1);
  }
  return { endpoint: endpoint.replace(/\/$/, ''), key };
}

/** Parse the model's text the way the live handler does, fenced JSON included. */
function parseModelText(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* fall through to fence */ }
  if (!parsed) {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) { try { parsed = JSON.parse(m[1].trim()); } catch { /* unparseable */ } }
  }
  return parsed;
}

async function callModel(cfg, creds, deployment, body, throttleRetries = 0) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeout);

  const playerCount = body.playerCount === 3 ? 3 : 4;
  const variant = cfg.variant === 'baseline' ? 'baseline' : 'current';

  const requestBody = {
    messages: [
      { role: 'system', content: (PROMPTS[variant] || PROMPTS.current)[playerCount] },
      { role: 'user', content: buildUserMessage(body, variant) },
    ],
    max_completion_tokens: cfg.maxTokens,
    response_format: { type: 'json_object' },
    stream: false,
  };
  if (cfg.reasoningEffort) requestBody.reasoning_effort = cfg.reasoningEffort;

  const url = `${creds.endpoint}/openai/deployments/${deployment}`
    + `/chat/completions?api-version=${cfg.apiVersion}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': creds.key },
      body: JSON.stringify(requestBody),
      signal: ac.signal,
    });

    // A 429 says nothing about the model's answer, so retry it rather than
    // recording a quality failure. Without this, whichever deployment happens
    // to be busiest looks worst.
    if (res.status === 429) {
      clearTimeout(timer);
      if (throttleRetries >= 6) {
        return { ok: false, status: 429, error: 'rate limited after 6 retries',
                 elapsedMs: Date.now() - started };
      }
      const wait = Number(res.headers.get('retry-after')) * 1000
        || Math.min(120000, 10000 * 2 ** throttleRetries);
      await new Promise((r) => setTimeout(r, wait));
      return callModel(cfg, creds, deployment, body, throttleRetries + 1);
    }

    if (!res.ok) {
      return { ok: false, status: res.status, error: (await res.text()).slice(0, 400),
               elapsedMs: Date.now() - started };
    }

    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseModelText(text);

    if (parsed) {
      hoistMisnestedFields(parsed);
      // The live handler passes the Functions context purely for context.warn;
      // a stub keeps trimming behaviour identical without a logger.
      normalizeSuggestions(parsed, body.handNames, { warn: () => {} });
    }

    return {
      ok: parsed != null,
      normalized: parsed ?? null,
      usage: json.usage ?? null,
      rawText: text,
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      elapsedMs: Date.now() - started,
      error: parsed ? undefined : 'response was not parseable JSON',
    };
  } catch (err) {
    return { ok: false, elapsedMs: Date.now() - started,
             error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Spread the sample across rounds — the first N fixtures would be all round 1-2. */
function pickSample(entries, n) {
  if (n <= 0 || n >= entries.length) return entries;
  const byRound = new Map();
  for (const e of entries) {
    if (!byRound.has(e.round)) byRound.set(e.round, []);
    byRound.get(e.round).push(e);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const picked = [];
  for (let i = 0; picked.length < n; i++) {
    let added = false;
    for (const r of rounds) {
      const list = byRound.get(r);
      if (i < list.length && picked.length < n) { picked.push(list[i]); added = true; }
    }
    if (!added) break;
  }
  return picked;
}

function summarize(deployment, records) {
  const ok = records.filter((r) => r.result.ok);
  const price = PRICES[deployment];
  let inTok = 0, outTok = 0, reasoningTok = 0;
  for (const r of records) {
    const u = r.result.usage;
    if (!u) continue;
    inTok += u.prompt_tokens || 0;
    outTok += u.completion_tokens || 0;
    reasoningTok += u.completion_tokens_details?.reasoning_tokens || 0;
  }
  const latencies = ok.map((r) => r.result.elapsedMs).sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;
  const cost = price ? (inTok / 1e6) * price.in + (outTok / 1e6) * price.out : null;
  return {
    deployment,
    calls: records.length,
    ok: ok.length,
    failed: records.length - ok.length,
    promptTokens: inTok,
    completionTokens: outTok,
    reasoningTokens: reasoningTok,
    medianLatencyMs: median,
    usdTotal: cost,
    usdPerCall: cost != null && records.length ? cost / records.length : null,
  };
}

const fmtUsd = (n) => (n == null ? '-' : `$${n.toFixed(4)}`);

async function main() {
  const cfg = parseArgs();
  const creds = credentials();
  const deployments = cfg.deployments.split(',').map((s) => s.trim()).filter(Boolean);

  const manifest = JSON.parse(readFileSync(join(cfg.fixtures, 'manifest.json'), 'utf8'));
  let entries = manifest.fixtures;
  if (cfg.only) entries = entries.filter((e) => e.fixtureId.includes(cfg.only));
  entries = pickSample(entries, cfg.sample);

  console.log(`deployments: ${deployments.join(', ')}`);
  console.log(`fixtures: ${entries.length}  runs each: ${cfg.runs}  `
    + `variant: ${cfg.variant}  api-version: ${cfg.apiVersion}`);
  if (cfg.reasoningEffort) console.log(`reasoning_effort: ${cfg.reasoningEffort}`);
  console.log('');

  const summaries = [];

  for (const deployment of deployments) {
    const outDir = join(cfg.outRoot, `model-${deployment}`);
    mkdirSync(outDir, { recursive: true });
    const done = new Set(readdirSync(outDir).map((f) => basename(f, '.json')));

    const jobs = [];
    for (const entry of entries) {
      for (let run = 1; run <= cfg.runs; run++) {
        const id = `${entry.fixtureId}__${cfg.variant}__run${run}`;
        if (!done.has(id)) jobs.push({ entry, run, id });
      }
    }

    console.log(`── ${deployment} ── ${jobs.length} pending `
      + `(${done.size} already on disk) -> ${outDir}`);

    let completed = 0, ok = 0, failed = 0;
    const started = Date.now();
    const queue = jobs.slice();

    async function worker() {
      for (;;) {
        const job = queue.shift();
        if (!job) return;

        const fixture = JSON.parse(readFileSync(join(cfg.fixtures, job.entry.file), 'utf8'));
        const { _meta, ...base } = fixture;
        const body = { ...base, promptVariant: cfg.variant };

        const result = await callModel(cfg, creds, deployment, body);

        writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify({
          fixtureId: job.entry.fixtureId,
          run: job.run,
          variant: cfg.variant,
          deployment,
          round: job.entry.round,
          playerCount: job.entry.playerCount,
          request: body,
          expectedUserPicks: _meta?.userPicks,
          result,
        }, null, 2));

        completed++;
        if (result.ok) ok++; else failed++;
        const secs = `${(result.elapsedMs / 1000).toFixed(1)}s`;
        const rate = completed / ((Date.now() - started) / 60000);
        const eta = (jobs.length - completed) / Math.max(rate, 0.01);
        console.log(`  [${completed}/${jobs.length}] ${result.ok ? 'ok  ' : 'FAIL'} `
          + `${job.id}  ${secs}  eta ${eta.toFixed(0)}m`
          + (result.ok ? '' : `  (${result.error})`));
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, worker));

    const records = readdirSync(outDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')));
    const s = summarize(deployment, records);
    summaries.push(s);
    console.log(`  ok ${ok}  failed ${failed}  run cost ${fmtUsd(s.usdTotal)}\n`);
  }

  console.log('\n=== cost & latency (all records on disk, not just this run) ===');
  const head = ['deployment', 'calls', 'ok', 'in tok', 'out tok', 'reason tok',
                'med lat', '$ total', '$ / call'];
  const rows = summaries.map((s) => [
    s.deployment, String(s.calls), String(s.ok),
    s.promptTokens.toLocaleString(), s.completionTokens.toLocaleString(),
    s.reasoningTokens.toLocaleString(),
    s.medianLatencyMs != null ? `${(s.medianLatencyMs / 1000).toFixed(1)}s` : '-',
    fmtUsd(s.usdTotal), fmtUsd(s.usdPerCall),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));

  writeFileSync(join(cfg.outRoot, 'model-compare-summary.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), config: cfg, summaries }, null, 2));
  console.log(`\nsummary -> ${join(cfg.outRoot, 'model-compare-summary.json')}`);
  console.log('score quality next:');
  for (const s of summaries) {
    console.log(`  node evals/check.mjs ${join(cfg.outRoot, `model-${s.deployment}`)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

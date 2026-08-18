#!/usr/bin/env node
/**
 * Post eval fixtures at /api/strategy and capture the canonical response.
 *
 * The endpoint streams SSE: `token` deltas while the model writes, then a
 * `normalized` event carrying the parsed final state, then `done`. We keep the
 * normalized payload -- that is what the dashboard actually renders.
 *
 * Responses are non-deterministic, so run each fixture more than once
 * (--runs) and let the checker report variance. A single run per fixture will
 * produce phantom regressions.
 *
 *   node evals/run.mjs --runs 3
 *   node evals/run.mjs --endpoint http://localhost:7071/api/strategy --runs 5
 *   node evals/run.mjs --sample 10 --runs 1        # quick smoke
 *
 * Re-running skips work already on disk, so an interrupted run resumes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const DEFAULTS = {
  endpoint: 'https://draft.grics.site/api/strategy',
  fixtures: 'evals/fixtures',
  out: null,          // defaults to evals/reports/<timestamp>
  runs: 3,
  sample: 0,          // 0 == all
  delay: 0,           // ms between requests
  only: null,         // substring filter on fixtureId
  variant: 'current', // 'current' | 'baseline' | 'both'
  timeout: 300000,
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

/** Consume the SSE stream, returning the normalized payload plus timing. */
async function callStrategy(endpoint, body, timeoutMs) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });

    if (res.status === 429) return { ok: false, rateLimited: true, status: 429 };
    if (!res.ok) {
      return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let normalized = null;
    let usage = null;
    let rawText = '';
    let firstTokenAt = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!block.trim() || block.startsWith(':')) continue;  // keepalive

        let type = null;
        const dataLines = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) type = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
        }
        const data = dataLines.join('\n');

        if (type === 'token') {
          if (firstTokenAt === null) firstTokenAt = Date.now() - started;
          try { rawText += JSON.parse(data); } catch { /* partial */ }
        } else if (type === 'usage') {
          try { usage = JSON.parse(data); } catch { /* keep null */ }
        } else if (type === 'normalized') {
          try { normalized = JSON.parse(data); } catch { /* keep null */ }
        } else if (type === 'error') {
          let msg = data;
          try { msg = JSON.parse(data).message; } catch {}
          return { ok: false, error: msg, elapsedMs: Date.now() - started };
        }
      }
    }

    return {
      ok: normalized !== null,
      normalized,
      usage,
      rawText,
      firstTokenMs: firstTokenAt,
      elapsedMs: Date.now() - started,
      error: normalized === null ? 'stream ended without a normalized event' : undefined,
    };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = parseArgs();
  const manifest = JSON.parse(readFileSync(join(cfg.fixtures, 'manifest.json'), 'utf8'));

  let entries = manifest.fixtures;   // already excludes quarantined drafts
  if (cfg.only) entries = entries.filter((e) => e.fixtureId.includes(cfg.only));
  if (cfg.sample > 0) {
    // Spread the sample across rounds rather than taking the first N, which
    // would be all round 1-2 and tell us nothing about late-draft analysis.
    const byRound = new Map();
    for (const e of entries) {
      if (!byRound.has(e.round)) byRound.set(e.round, []);
      byRound.get(e.round).push(e);
    }
    const picked = [];
    let i = 0;
    while (picked.length < cfg.sample) {
      let added = false;
      for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
        const list = byRound.get(round);
        if (i < list.length && picked.length < cfg.sample) { picked.push(list[i]); added = true; }
      }
      if (!added) break;
      i++;
    }
    entries = picked;
  }

  const outDir = cfg.out || join('evals/reports', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });

  const done = new Set(existsSync(outDir) ? readdirSync(outDir).map((f) => basename(f, '.json')) : []);
  const variants = cfg.variant === 'both' ? ['current', 'baseline'] : [cfg.variant];
  const jobs = [];
  for (const entry of entries) {
    for (const variant of variants) {
      for (let run = 1; run <= cfg.runs; run++) {
        const id = `${entry.fixtureId}__${variant}__run${run}`;
        if (!done.has(id)) jobs.push({ entry, run, id, variant });
      }
    }
  }

  console.log(`endpoint: ${cfg.endpoint}`);
  console.log(`fixtures: ${entries.length}  variant(s): ${variants.join(', ')}  `
    + `runs each: ${cfg.runs}  pending: ${jobs.length}`);
  console.log(`output:   ${outDir}\n`);
  if (!jobs.length) return console.log('nothing to do (all results already on disk)');

  let ok = 0, failed = 0, limited = 0;
  for (const [n, job] of jobs.entries()) {
    const fixture = JSON.parse(readFileSync(join(cfg.fixtures, job.entry.file), 'utf8'));
    const { _meta, ...base } = fixture;
    const body = { ...base, promptVariant: job.variant };

    let result = await callStrategy(cfg.endpoint, body, cfg.timeout);

    // The endpoint allows 5 requests per 10 minutes per IP. Back off rather
    // than burning through fixtures on 429s.
    let backoff = 60000;
    while (result.rateLimited) {
      limited++;
      process.stdout.write(`  rate limited, waiting ${backoff / 1000}s...\n`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 600000);
      result = await callStrategy(cfg.endpoint, body, cfg.timeout);
    }

    writeFileSync(join(outDir, `${job.id}.json`), JSON.stringify({
      fixtureId: job.entry.fixtureId,
      run: job.run,
      variant: job.variant,
      round: job.entry.round,
      playerCount: job.entry.playerCount,
      request: body,
      expectedUserPicks: _meta.userPicks,
      result,
    }, null, 2));

    if (result.ok) ok++; else failed++;
    const tag = result.ok ? 'ok ' : 'FAIL';
    const secs = result.elapsedMs ? `${(result.elapsedMs / 1000).toFixed(1)}s` : '-';
    console.log(`[${n + 1}/${jobs.length}] ${tag} ${job.id}  ${secs}` +
      (result.ok ? '' : `  (${result.error})`));

    if (cfg.delay) await sleep(cfg.delay);
  }

  console.log(`\nok: ${ok}   failed: ${failed}   rate-limit waits: ${limited}`);
  console.log(`results -> ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

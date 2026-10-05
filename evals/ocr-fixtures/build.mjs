#!/usr/bin/env node
/**
 * Build OCR fixtures: synthetic "hand view" screenshots with exact ground truth.
 *
 * The OCR endpoint reads a Board Game Arena screenshot and returns card names.
 * Scoring that needs images whose correct answer is known exactly. Real BGA
 * screenshots would have to be collected and hand-labelled, and a mislabelled
 * fixture silently penalises whichever model is actually right. So instead we
 * compose the card art already in card-images/ into a grid: we chose the cards,
 * so the answer key is generated, not transcribed.
 *
 * What this does NOT reproduce: BGA's own chrome, overlapping/fanned cards,
 * JPEG artefacts, and the scaling a real browser screenshot applies. Treat the
 * scores as a relative ranking between models on the same input, not as an
 * absolute prediction of live accuracy. Real screenshots can be dropped into
 * this directory alongside a hand-written <id>.json answer key and the scorer
 * will pick them up with no changes.
 *
 * Rendering goes through headless Chrome, which every Mac with Chrome already
 * has, rather than a native image library that would need building.
 *
 *   node evals/ocr-fixtures/build.mjs              # default set
 *   node evals/ocr-fixtures/build.mjs --seed 7 --perSize 3
 *
 * Output, in this directory: <id>.png (the image), <id>.json (the answer key),
 * and manifest.json listing them.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import vm from 'vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DEFAULTS = {
  seed: 42,
  perSize: 2,        // fixtures per (handSize, scale) combination
  out: HERE,
};

/**
 * Hand sizes mirror getHandSize() in draft.html for the standard 7-of-10 format (10 down to 4), so the
 * fixtures cover the range of screenshots a user actually uploads.
 *
 * `scale` multiplies the card art's native 183px width. 1.0 is the small,
 * dense view where the documented OCR failures (dropped icons, misread
 * numbers) are worst; the larger scales show whether a model's errors are
 * really about resolution or about reading comprehension.
 */
const LAYOUTS = [
  // Zoomed out below native size. A user screenshotting a whole browser window
  // gets cards smaller than the source art, and these are where title text
  // starts to break down. Every model scored 100% on the >=1.0 scales, so
  // these are the rows that actually separate them.
  { handSize: 20, scale: 0.6, cols: 7 },
  { handSize: 20, scale: 0.8, cols: 7 },
  { handSize: 10, scale: 0.6, cols: 5 },
  { handSize: 10, scale: 0.8, cols: 5 },
  // Round-1 sized hand at native scale.
  { handSize: 20, scale: 1.0, cols: 7 },
  // Native and larger: the easy end of the range, kept so a regression that
  // only shows up on clean input still gets caught.
  { handSize: 10, scale: 1.0, cols: 5 },
  { handSize: 10, scale: 1.6, cols: 5 },
  { handSize: 7,  scale: 1.0, cols: 4 },
  { handSize: 4,  scale: 1.0, cols: 4 },
  { handSize: 4,  scale: 2.2, cols: 4 },
];

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

/** mulberry32 — small seeded PRNG so a given --seed always builds the same set. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Load the project's own image list rather than reading the directory, so
 * fixtures resolve art exactly the way draft.html does, overrides included.
 */
function loadImageList() {
  const src = readFileSync(join(ROOT, 'js', 'card-image-list.js'), 'utf8');
  const ctx = { };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { list: ctx.CARD_IMAGE_LIST, overrides: ctx.CARD_IMAGE_OVERRIDES };
}

const normalizeForMatch = (str) => str.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[\s\-'.]/g, '');

function buildResolver() {
  const { list, overrides } = loadImageList();
  const byNormalized = new Map();
  for (const filename of list) {
    byNormalized.set(normalizeForMatch(filename.replace(/\.png$/, '')), filename);
  }
  return (cardName, cardId) => {
    if (cardId && Object.prototype.hasOwnProperty.call(overrides, cardId)) {
      return overrides[cardId];   // may be null: "no art exists"
    }
    return byNormalized.get(normalizeForMatch(cardName)) ?? null;
  };
}

function html(cards, scale, cols) {
  const w = Math.round(183 * scale);
  const tiles = cards.map((c) => {
    const src = `file://${join(ROOT, 'card-images', c.file).replace(/ /g, '%20')}`;
    return `<img src="${src}" width="${w}">`;
  }).join('\n');

  // A dark tabletop with the cards in a tight grid: close enough to a BGA hand
  // view that the model faces the same job (small title text, many cards at
  // once) without pretending to be a pixel-accurate reproduction.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#25301f;}
  .wrap{display:grid;grid-template-columns:repeat(${cols},max-content);
        gap:${Math.round(10 * scale)}px;padding:${Math.round(18 * scale)}px;
        width:max-content;}
  img{display:block;border-radius:${Math.round(6 * scale)}px;
      box-shadow:0 2px 6px rgba(0,0,0,.55);}
  </style></head><body><div class="wrap">${tiles}</div></body></html>`;
}

function shoot(htmlPath, pngPath, width, height) {
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    '--allow-file-access-from-files',
    `--screenshot=${pngPath}`,
    `--window-size=${width},${height}`,
    '--virtual-time-budget=8000',
    htmlPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function main() {
  const cfg = parseArgs();
  const cards = JSON.parse(readFileSync(join(ROOT, 'data', 'agricola-cards.json'), 'utf8'));
  const resolve = buildResolver();

  // Only draftable cards with real art can appear. Banned cards are name-only
  // shells and never reach a hand, so they must not reach a fixture either.
  const pool = cards
    .filter((c) => !c.banned && (c.type === 'Occupation' || c.type === 'Minor Improvement'))
    .map((c) => ({ name: c.name, type: c.type, file: resolve(c.name, c.card_id) }))
    .filter((c) => c.file && existsSync(join(ROOT, 'card-images', c.file)));

  console.log(`card pool with art: ${pool.length}`);
  if (pool.length < 40) throw new Error('not enough card art to build fixtures');

  mkdirSync(cfg.out, { recursive: true });
  for (const f of readdirSync(cfg.out)) {
    if (/\.(png|html)$/.test(f)) unlinkSync(join(cfg.out, f));
  }

  const rand = rng(cfg.seed);
  const manifest = [];

  for (const layout of LAYOUTS) {
    for (let n = 1; n <= cfg.perSize; n++) {
      // Sample without replacement: a duplicate name in one image would make
      // precision/recall ambiguous.
      const picked = [];
      const used = new Set();
      while (picked.length < layout.handSize) {
        const c = pool[Math.floor(rand() * pool.length)];
        if (used.has(c.name)) continue;
        used.add(c.name);
        picked.push(c);
      }

      const id = `h${layout.handSize}_s${String(layout.scale).replace('.', '')}_${n}`;
      const htmlPath = join(cfg.out, `${id}.html`);
      const pngPath = join(cfg.out, `${id}.png`);

      const cardW = Math.round(183 * layout.scale);
      const cardH = Math.round(286 * layout.scale);
      const gap = Math.round(10 * layout.scale);
      const pad = Math.round(18 * layout.scale);
      const rows = Math.ceil(layout.handSize / layout.cols);
      const width = layout.cols * cardW + (layout.cols - 1) * gap + pad * 2;
      const height = rows * cardH + (rows - 1) * gap + pad * 2;

      writeFileSync(htmlPath, html(picked, layout.scale, layout.cols));
      shoot(htmlPath, pngPath, width, height);
      unlinkSync(htmlPath);

      const answer = {
        fixtureId: id,
        handSize: layout.handSize,
        scale: layout.scale,
        imageWidth: width,
        imageHeight: height,
        cardWidthPx: cardW,
        source: 'synthetic',
        cards: picked.map((c) => ({ name: c.name, type: c.type })),
      };
      writeFileSync(join(cfg.out, `${id}.json`), JSON.stringify(answer, null, 2));
      manifest.push({ fixtureId: id, image: `${id}.png`, answer: `${id}.json`,
                      handSize: layout.handSize, scale: layout.scale,
                      width, height, source: 'synthetic' });
      console.log(`  ${id}  ${layout.handSize} cards  ${width}x${height}`);
    }
  }

  writeFileSync(join(cfg.out, 'manifest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    seed: cfg.seed,
    note: 'Synthetic composites of real card art. See build.mjs header for what '
        + 'they do and do not reproduce. Drop real screenshots here with a '
        + 'matching <id>.json to have them scored alongside.',
    fixtures: manifest,
  }, null, 2));

  console.log(`\n${manifest.length} fixtures -> ${cfg.out}`);
}

main();

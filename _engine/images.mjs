// images.mjs — turn harvested originals into responsive, optimised web assets.
//
// Output per source: AVIF + WebP + JPEG fallback at several widths, EXIF stripped.
// AVIF first (smallest), WebP as the broad fallback, JPEG as the floor.

import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = process.argv[2] || 'maadanina';
// Originals live outside sites/<slug>/ so Cloudflare Pages never publishes them.
const SRC = path.join(ROOT, '_incoming', SITE);
const OUT = path.join(ROOT, 'sites', SITE, 'assets', 'img');

const WIDTHS = [480, 800, 1280, 1920];

/**
 * Curated selection. `focus` steers the crop so the subject survives a tall
 * mobile viewport — this is the recurring "head is cropped" failure otherwise.
 */
const SELECTION = [
  // --- hero: the storefront at night, sign glowing cyan ---
  { id: 'hero-night', src: 'google/g14.jpg', focus: 'attention', widths: [640, 1080, 1440, 1920] },
  // A portrait phone crops this frame by WIDTH (the frame is wider than the
  // viewport is, relatively), so an aggressive vertical crop only forces more
  // of the wide sign out of shot. Trim a sliver off the top and let the hero
  // vignette swallow the neighbouring shops instead.
  {
    id: 'hero-night-portrait',
    src: 'google/g14.jpg',
    widths: [480, 780, 1080],
    crop: { left: 0.0, top: 0.085, width: 1.0, height: 0.915 },
  },
  // --- the counter ---
  { id: 'counter', src: 'google/g06.jpg', focus: 'attention' },
  { id: 'counter-detail', src: 'google/g08.jpg', focus: 'attention' },
  // --- real food ---
  { id: 'plate', src: 'google/g02.jpg', focus: 'attention' },
  { id: 'platter', src: 'google/g10.jpg', focus: 'attention' },
  // --- the shop by day ---
  { id: 'storefront-day', src: 'google/g00.jpg', focus: 'attention' },
  { id: 'shop-interior', src: 'google/g04.jpg', focus: 'attention' },
];

/** Product cutouts from the delivery listing — small, light-background cards. */
const PRODUCT_WIDTHS = [240, 480];

/** Sandwich photography from the 10bis listing — properly styled, so it gets
 *  bigger sizes than the catalogue cutouts. The bottom strip carries that
 *  platform's watermark and is cropped away. */
const SANDWICH_WIDTHS = [400, 700, 1000];
const SANDWICH_CROP = { left: 0, top: 0, width: 1, height: 0.89 };

/** The delivery platform leaves its own formatting in the descriptions:
 *  an empty "₪0 / 0 גר׳" price tail, stray separators, doubled spaces. */
const tidyDesc = (s = '') =>
  s
    .replace(/[₪\s]*0\s*\/\s*0\s*(גר|גרם)['׳"״]?\.?/g, '')
    .replace(/,\s*-\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/[\s,.]+$/, '')
    .trim();

async function emit(input, id, widths, focus, { square = false, crop = null } = {}) {
  const results = {};
  const base = sharp(input, { failOn: 'none' }).rotate(); // honour EXIF, then strip
  const full = await base.metadata();

  // `crop` is fractional {left, top, width, height} of the original, applied
  // before any resize — this is art direction, not a convenience.
  const region = crop && {
    left: Math.round(full.width * crop.left),
    top: Math.round(full.height * crop.top),
    width: Math.round(full.width * crop.width),
    height: Math.round(full.height * crop.height),
  };
  const meta = region ? { width: region.width, height: region.height } : full;

  for (const w of widths) {
    if (w > meta.width * 1.6) continue; // never upscale much
    const pipe = () => {
      let p = sharp(input, { failOn: 'none' }).rotate();
      if (region) p = p.extract(region);
      if (square) {
        p = p.resize(w, w, { fit: 'cover', position: focus || 'attention' });
      } else {
        p = p.resize({ width: w, withoutEnlargement: true });
      }
      return p;
    };
    await pipe().avif({ quality: 52, effort: 7 }).toFile(path.join(OUT, `${id}-${w}.avif`));
    await pipe().webp({ quality: 76, effort: 5 }).toFile(path.join(OUT, `${id}-${w}.webp`));
    await pipe().jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(OUT, `${id}-${w}.jpg`));
    results[w] = true;
  }

  // A tiny blurred placeholder, inlined as a data URI for instant first paint.
  let lqipPipe = sharp(input, { failOn: 'none' }).rotate();
  if (region) lqipPipe = lqipPipe.extract(region);
  const lqipBuf = await lqipPipe
    .resize(20, 20, { fit: 'inside' })
    .blur(1.2)
    .webp({ quality: 40 })
    .toBuffer();

  return {
    id,
    widths: Object.keys(results).map(Number),
    aspect: +(meta.width / meta.height).toFixed(4),
    lqip: `data:image/webp;base64,${lqipBuf.toString('base64')}`,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const out = { photos: {}, products: {} };

  console.log('→ processing photographs');
  for (const item of SELECTION) {
    const input = path.join(SRC, item.src);
    try {
      const info = await emit(input, item.id, item.widths || WIDTHS, item.focus, { crop: item.crop });
      out.photos[item.id] = info;
      console.log(`  ✓ ${item.id}  ${info.widths.join('/')}  aspect ${info.aspect}`);
    } catch (err) {
      console.error(`  ! ${item.id}: ${err.message}`);
    }
  }

  // Products from the delivery listing, squared for uniform cards.
  const manifestPath = path.join(SRC, 'wolt', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const products = manifest.items.filter(
    (i) => i.file && i.price && i.name && !/^אין כרגע$/.test(i.name)
  );

  console.log(`→ processing ${products.length} product cutouts`);
  for (const p of products) {
    const input = path.join(ROOT, p.file);
    try {
      const info = await emit(input, `p-${p.id.slice(-8)}`, PRODUCT_WIDTHS, 'attention', {
        square: true,
      });
      out.products[p.id] = { ...info, name: p.name, price: p.price, category: p.category };
    } catch (err) {
      console.error(`  ! ${p.id}: ${err.message}`);
    }
  }
  console.log(`  ✓ ${Object.keys(out.products).length} products`);

  // Sandwiches: the shop's own prepared-food photography.
  const tbPath = path.join(SRC, 'tenbis', 'manifest.json');
  try {
    const tb = JSON.parse(await readFile(tbPath, 'utf8'));
    const sandwiches = tb.items.filter(
      (i) => i.file && /^כריכ/.test(i.category || '') && i.name
    );
    console.log(`→ processing ${sandwiches.length} sandwiches`);
    out.sandwiches = {};
    for (const s of sandwiches) {
      const id = 's-' + path.basename(s.file, '.jpg');
      const info = await emit(path.join(ROOT, s.file), id, SANDWICH_WIDTHS, 'attention', {
        crop: SANDWICH_CROP,
      });
      out.sandwiches[id] = { ...info, name: s.name, price: s.price, desc: tidyDesc(s.desc), category: s.category };
    }
    console.log(`  ✓ ${Object.keys(out.sandwiches).length} sandwiches`);
  } catch (err) {
    console.log(`  (no sandwich manifest: ${err.message})`);
  }

  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✓ assets → ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

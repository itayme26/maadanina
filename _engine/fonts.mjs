// fonts.mjs — self-host the Hebrew webfonts so the site makes zero external
// requests and can never break when a CDN changes. OFL licensed, free.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = process.argv[2] || 'maadanina';
const OUT = path.join(ROOT, 'sites', SITE, 'assets', 'fonts');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const FAMILIES = [
  { css: 'Frank+Ruhl+Libre:wght@300;400;500;700', slug: 'frankruhl' },
  { css: 'Assistant:wght@300;400;600;700', slug: 'assistant' },
];

await mkdir(OUT, { recursive: true });
const faces = [];

for (const fam of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${fam.css}&display=swap`;
  const css = await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.text());

  // Split into @font-face blocks and keep only the Hebrew + basic-latin subsets.
  const blocks = css.split('@font-face').slice(1);
  for (const b of blocks) {
    const family = b.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = b.match(/font-weight:\s*(\d+)/)?.[1];
    const src = b.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
    const range = b.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!src || !range) continue;

    const isHebrew = /U\+0[58]/i.test(range);
    const isLatin = /U\+0000-00FF/i.test(range);

    // The page is Hebrew. The only Latin on it is a few brand names and the
    // digits in prices and opening hours — which is not worth 170KB of Latin
    // outlines. Keep one Latin weight of the UI face for numerals; Hebrew
    // faces cover the rest, and system fonts cover anything left over.
    const keepLatin = isLatin && fam.slug === 'assistant' && ['400', '600'].includes(weight);
    if (!isHebrew && !keepLatin) continue;

    const name = `${fam.slug}-${weight}-${isHebrew ? 'he' : 'latin'}.woff2`;
    const buf = Buffer.from(await fetch(src, { headers: { 'User-Agent': UA } }).then((r) => r.arrayBuffer()));
    await writeFile(path.join(OUT, name), buf);
    faces.push({ family, weight, file: name, range, bytes: buf.length });
    console.log(`  ✓ ${name.padEnd(28)} ${(buf.length / 1024).toFixed(1)}KB  ${range.slice(0, 50)}`);
  }
}

// Emit the @font-face CSS the site will use.
const css = faces
  .map(
    (f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};
font-display:swap;src:url('/assets/fonts/${f.file}') format('woff2');unicode-range:${f.range};}`
  )
  .join('\n');
await writeFile(path.join(OUT, 'fonts.css'), css, 'utf8');
console.log(`\n✓ ${faces.length} faces, ${(faces.reduce((a, f) => a + f.bytes, 0) / 1024).toFixed(0)}KB total`);

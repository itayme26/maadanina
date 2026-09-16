// harvest.mjs — pull real content + imagery from a venue's public delivery page.
//
// The venue landing page is only a category index; each category lives at its own
// /items/menucategory-N URL. So we read the index, then walk every category page.
//
// Everything here is public, unauthenticated and free. No API keys, no paid calls.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const SITE = process.argv[2] || 'maadanina';
const VENUE = 'https://wolt.com/he/isr/petah-tikva/venue/maadanina-petach-tikva';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, '_incoming', SITE, 'wolt');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Wolt's image proxy takes a ?w= param; 1920 is the largest they serve.
const full = (url) => url.split('?')[0] + '?w=1920';

/** Read every menu item on the current page, pairing each image with its card text. */
const readItems = (category) =>
  // eslint-disable-next-line no-undef
  ({ category }) => {
    const out = [];
    const seen = new Set();
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || '';
      const id = src.match(/imageproxy\.wolt\.com\/assets\/([a-f0-9]{24})/)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);

      // Walk up to the card wrapping this image, then read its text block.
      let node = img;
      for (let d = 0; d < 7 && node.parentElement; d++) {
        node = node.parentElement;
        if ((node.innerText || '').trim().length > 3) break;
      }
      const lines = (node.innerText || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const price = lines.find((l) => /₪/.test(l)) || '';
      const name = lines.find((l) => !/₪/.test(l) && /[֐-׿]/.test(l)) || img.alt || '';
      const desc =
        lines.find((l) => l !== name && !/₪/.test(l) && l.length > name.length) || '';

      out.push({ id, src, category, name, desc, price, alt: (img.alt || '').trim() });
    }
    return out;
  };

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    locale: 'he-IL',
    userAgent: UA,
  });
  const page = await ctx.newPage();

  console.log('→ opening venue index');
  await page.goto(VENUE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(4000);

  // Decline non-essential cookies.
  const reject = page.getByRole('button', { name: /Cookies חיוניים בלבד|חיוניים בלבד/ }).first();
  if (await reject.count().catch(() => 0)) await reject.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(800);

  // Venue-level metadata + the bestsellers rail that appears on the index.
  const venue = await page.evaluate(() => {
    const txt = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
    const heads = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.innerText.trim());
    return {
      title: document.title,
      ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
      description: document.querySelector('meta[name="description"]')?.content || '',
      h1: txt('h1'),
      headings: heads,
      bodyText: document.body.innerText.slice(0, 6000),
    };
  });

  // Category links, in menu order, paired with their visible names.
  const cats = await page.evaluate(() => {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/items/menucategory-"]')) {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      out.push({
        href: new URL(href, location.origin).toString(),
        name: (a.innerText || '').trim().split('\n')[0] || '',
      });
    }
    return out;
  });
  console.log(`→ ${cats.length} category pages found`);

  // Harvest the index page itself (bestsellers live here).
  const all = await page.evaluate(readItems(), { category: 'המוזמנים ביותר' });

  // Walk every category page.
  for (const [i, cat] of cats.entries()) {
    process.stdout.write(`  [${i + 1}/${cats.length}] ${cat.name || cat.href} … `);
    try {
      await page.goto(cat.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(2200);

      // Scroll through so every lazy image loads.
      for (let s = 0; s < 25; s++) {
        await page.mouse.wheel(0, 1400);
        await page.waitForTimeout(280);
        const atBottom = await page.evaluate(
          () => window.scrollY + window.innerHeight >= document.body.scrollHeight - 60
        );
        if (atBottom) break;
      }
      await page.waitForTimeout(900);

      const name =
        cat.name ||
        (await page.evaluate(() => document.querySelector('h1,h2')?.innerText?.trim() || ''));
      const items = await page.evaluate(readItems(), { category: name });
      all.push(...items);
      console.log(`${items.length} items`);
    } catch (err) {
      console.log(`failed (${err.message.slice(0, 60)})`);
    }
  }

  await browser.close();

  // De-duplicate by image id, keeping the first (most specific) category seen.
  const byId = new Map();
  for (const it of all) if (!byId.has(it.id)) byId.set(it.id, it);
  const items = [...byId.values()];

  console.log(`\n→ downloading ${items.length} unique images`);
  let ok = 0;
  for (const item of items) {
    const file = path.join(OUT, `${item.id}.jpg`);
    try {
      const res = await fetch(full(item.src));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(res.body, createWriteStream(file));
      item.file = path.relative(ROOT, file).replaceAll('\\', '/');
      ok++;
    } catch (err) {
      item.error = String(err.message || err);
      console.warn(`  ! ${item.id}: ${item.error}`);
    }
  }

  const manifest = {
    harvestedAt: new Date().toISOString(),
    source: VENUE,
    note:
      "These are the business's own product photographs, taken from its public delivery " +
      'listing. Kept with their source URLs so provenance stays visible.',
    venue,
    categories: cats.map((c) => c.name).filter(Boolean),
    items,
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`\n✓ ${ok}/${items.length} images downloaded → ${path.relative(ROOT, OUT)}`);
  console.log(`✓ ${manifest.categories.length} categories`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// og.mjs — render the WhatsApp/Facebook preview card locally.
// 1200x630 is what every platform crops toward. Rendered from the site's own
// fonts and photography so the card and the page look like one thing.

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = process.argv[2] || 'maadanina';
const DIR = path.join(ROOT, 'sites', SITE);

const site = JSON.parse(await readFile(path.join(DIR, 'content', 'site.json'), 'utf8'));
const fontCss = await readFile(path.join(DIR, 'assets', 'fonts', 'fonts.css'), 'utf8');

// Inline the photo and fonts as data URIs so the card renders from file://
// with no server and no network.
const b64 = async (p, mime) =>
  `data:${mime};base64,${(await readFile(path.join(DIR, p))).toString('base64')}`;

// The storefront photo already contains the name in the shop's own signage, so
// setting the wordmark over it prints the name twice. The counter does the same
// job — unmistakably a delicatessen — and leaves clean ground for type.
const bg = await b64('assets/img/counter-1920.jpg', 'image/jpeg');
const fontFiles = ['frankruhl-300-he', 'assistant-400-he', 'assistant-600-he'];
let css = fontCss;
for (const f of fontFiles) {
  css = css.replaceAll(`/assets/fonts/${f}.woff2`, await b64(`assets/fonts/${f}.woff2`, 'font/woff2'));
}
// Drop any face we did not inline, so nothing tries to hit the network.
css = css
  .split('@font-face')
  .filter((b) => !b.includes('/assets/fonts/'))
  .join('@font-face');

const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
${css}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;background:#070f15;
  font-family:'Assistant',sans-serif;position:relative}
.bg{position:absolute;inset:0}
.bg img{width:100%;height:100%;object-fit:cover;object-position:50% 46%}
.grade{position:absolute;inset:0;background:
  linear-gradient(to bottom,rgba(7,15,21,.88) 0%,rgba(7,15,21,.66) 32%,rgba(7,15,21,.82) 72%,#070f15 100%),
  radial-gradient(105% 85% at 50% 45%,rgba(4,10,14,.35) 30%,rgba(4,10,14,.85) 100%)}
.inner{position:relative;height:100%;display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;padding:0 80px;gap:22px}
.badge{font-size:23px;letter-spacing:.3em;color:#6ad2f5;border:1px solid rgba(106,210,245,.45);
  border-radius:100px;padding:9px 30px 12px;background:rgba(10,92,131,.2)}
.name{font-family:'Frank Ruhl Libre',serif;font-weight:300;font-size:118px;color:#fff;
  line-height:1.34;text-shadow:0 0 70px rgba(35,161,221,.4)}
.tag{font-size:30px;letter-spacing:.24em;color:#6ad2f5;font-weight:300}
.meta{position:absolute;bottom:44px;inset-inline:0;text-align:center;
  font-size:24px;color:#b9b1a3;letter-spacing:.05em}
</style></head><body>
<div class="bg"><img src="${bg}" alt=""></div>
<div class="grade"></div>
<div class="inner">
  <div class="badge">${site.hero.eyebrow}</div>
  <div class="name">${site.brand.nameVocalized}</div>
  <div class="tag">${site.brand.tagline}</div>
</div>
<div class="meta">${site.visit.addressLine} &nbsp;·&nbsp; ${site.contact.phone}</div>
</body></html>`;

const tmp = path.join(DIR, 'assets', '.og.html');
await writeFile(tmp, html, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp.replaceAll('\\', '/'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
const png = await page.screenshot({ type: 'png' });
await browser.close();

// Ship JPEG: WhatsApp is happier with it and it is a third of the size.
await sharp(png).resize(1200, 630).jpeg({ quality: 88, mozjpeg: true }).toFile(path.join(DIR, 'assets', 'og.jpg'));

const { size } = await import('node:fs').then((fs) => fs.promises.stat(path.join(DIR, 'assets', 'og.jpg')));
await import('node:fs').then((fs) => fs.promises.unlink(tmp));
console.log(`✓ assets/og.jpg  1200x630  ${(size / 1024).toFixed(0)}KB`);

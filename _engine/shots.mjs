// shots.mjs — the real-user visual pass.
// Screenshots every section at each device, and asserts the things that
// actually break on a Hebrew, mobile-first site: overflow, tap targets,
// console errors, failed requests, and reveals that never fired.

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.argv[2] || 'http://localhost:4321/';
const OUT = process.argv[3] || '_engine/.tmp/shots';
await mkdir(OUT, { recursive: true });

const PROFILES = [
  { name: 'mobile', ...devices['iPhone 13'], deviceScaleFactor: 1 },
  { name: 'tablet', ...devices['iPad Pro 11'], deviceScaleFactor: 1 },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];

// Headless Chromium draws a classic scrollbar, which in RTL sits on the left
// and offsets every section by its width — a phantom "overflow" that no real
// phone (overlay scrollbars) ever shows. Hide it so the check means something.
const browser = await chromium.launch({ args: ['--hide-scrollbars'] });
const problems = [];

for (const p of PROFILES) {
  const ctx = await browser.newContext({ ...p, locale: 'he-IL' });
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push(`JS: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4200); // let the hero animation settle
  await page.screenshot({ path: `${OUT}/${p.name}-01-hero.png` });

  const vh = p.viewport.height;
  const h = await page.evaluate(() => document.body.scrollHeight);
  const steps = Math.ceil(h / (vh * 0.9)); // walk the whole page, not a capped prefix
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), i * vh * 0.9);
    await page.waitForTimeout(1100); // reveals + their stagger
    if (i % 2 === 1 || i === steps) {
      await page.screenshot({ path: `${OUT}/${p.name}-${String(i + 1).padStart(2, '0')}.png` });
    }
  }

  const audit = await page.evaluate(() => {
    const de = document.documentElement;

    // Horizontal overflow, measured without mutating any styles — toggling
    // overflow introduces a scrollbar which, in RTL, shifts the whole document
    // and produces phantom offenders. Instead: flag any element wider than the
    // viewport that is not inside a deliberately-clipping ancestor. Elements
    // inside .hero / .marquee / .counter bleed on purpose and are excluded;
    // anything else that is too wide is a real bug, clipped or not.
    const vw = de.clientWidth;
    const deliberatelyClipped = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (/clip|hidden|auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    };
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const w = el.offsetWidth;
      if (!w || w <= vw + 1) continue;
      if (deliberatelyClipped(el)) continue;
      culprits.push(`${el.tagName}.${(el.className || '').toString().split(' ')[0]} width ${w} > viewport ${vw}`);
    }
    const overflowPx = culprits.length
      ? Math.max(...culprits.map((c) => +c.match(/width (\d+)/)[1])) - vw
      : 0;

    // Anything that was asked to reveal but never did.
    const stuck = [...document.querySelectorAll('[data-reveal]')]
      .filter((e) => !e.classList.contains('is-in'))
      .map((e) => `${e.tagName}.${(e.className || '').toString().split(' ')[0]}`);

    // Touch targets below the 44px guideline.
    const small = [...document.querySelectorAll('a,button')]
      .map((el) => ({ t: el.textContent.trim().slice(0, 22), r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44))
      .map((x) => `${x.t || '(icon)'} ${x.r.width.toFixed(0)}x${x.r.height.toFixed(0)}`);

    // Images that resolved to nothing.
    const brokenImgs = [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => i.currentSrc || i.src);

    return { overflowPx, culprits: [...new Set(culprits)].slice(0, 10), stuck, small, brokenImgs, h: de.scrollHeight };
  });

  const tag = (c) => problems.push(`${p.name}:${c}`);
  console.log(`\n=== ${p.name} (${p.viewport.width}x${p.viewport.height}) — ${steps + 1} shots, page ${audit.h}px`);
  if (errors.length) { console.log('  console/JS errors:'); [...new Set(errors)].slice(0, 6).forEach((e) => console.log('   !', e.slice(0, 130))); tag('console'); }
  if (failed.length) { console.log('  failed requests:'); [...new Set(failed)].slice(0, 6).forEach((e) => console.log('   !', e.slice(0, 130))); tag('net'); }
  if (audit.overflowPx > 0) { console.log(`  TOO WIDE FOR VIEWPORT by ${audit.overflowPx}px:`); audit.culprits.forEach((c) => console.log('   !', c)); tag('overflow'); }
  if (audit.stuck.length) { console.log('  reveals that never fired:'); audit.stuck.forEach((s) => console.log('   !', s)); tag('stuck-reveal'); }
  if (audit.brokenImgs.length) { console.log('  broken images:'); audit.brokenImgs.slice(0, 6).forEach((s) => console.log('   !', s)); tag('img'); }
  if (audit.small.length) { console.log('  tap targets under 44px:'); audit.small.slice(0, 8).forEach((s) => console.log('   !', s)); tag('tap'); }
  if (!problems.some((x) => x.startsWith(p.name))) console.log('  clean');

  await ctx.close();
}

await browser.close();
console.log('\n' + (problems.length ? 'PROBLEMS: ' + [...new Set(problems)].join(', ') : '*** ALL PROFILES CLEAN ***'));
process.exit(problems.length ? 1 : 0);

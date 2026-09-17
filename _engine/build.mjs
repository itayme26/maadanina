// build.mjs — render a site from content/site.json + the processed asset index.
// No framework, no bundler. Reads JSON, writes one self-contained index.html.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = process.argv[2] || 'maadanina';
const DIR = path.join(ROOT, 'sites', SITE);

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------- <picture> -- */

/**
 * Responsive picture element. AVIF → WebP → JPEG, with an inline blurred
 * placeholder so there is never a blank box while the photo arrives.
 */
function picture(asset, { alt, sizes, eager = false, className = '', portrait = null, portraitMedia = '(max-width: 48rem)', lean = false }) {
  if (!asset) return '';

  // The owner can replace any photo from the visual editor, and an image they
  // upload has none of the generated size variants. Render it plainly rather
  // than emitting srcsets that point at files which do not exist.
  if (typeof asset === 'string') {
    return `<picture${className ? ` class="${className}"` : ''}><img src="${esc(asset)}" alt="${esc(alt)}"
       ${eager ? 'fetchpriority="high" decoding="sync"' : 'loading="lazy" decoding="async"'}></picture>`;
  }

  const { id, widths, lqip, aspect = 1 } = asset;
  const wRef = widths[widths.length - 1];
  const dim = { w: wRef, h: Math.round(wRef / aspect) };
  const set = (ext, a = asset) => a.widths.map((w) => `/assets/img/${a.id}-${w}.${ext} ${w}w`).join(', ');
  const fallback = `/assets/img/${id}-${widths[Math.min(1, widths.length - 1)]}.jpg`;

  // Art-directed variant first: a narrow screen crops a wide frame by width, so
  // a separately-cropped file is the only way to control what stays in shot.
  const portraitSources = portrait
    ? `<source media="${portraitMedia}" type="image/avif" srcset="${set('avif', portrait)}" sizes="${sizes}">
  <source media="${portraitMedia}" type="image/webp" srcset="${set('webp', portrait)}" sizes="${sizes}">
  <source media="${portraitMedia}" type="image/jpeg" srcset="${set('jpg', portrait)}" sizes="${sizes}">
  `
    : '';

  return `<picture${className ? ` class="${className}"` : ''}>
  ${portraitSources}<source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">
  ${lean ? '' : `<source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">`}
  <img src="${fallback}" srcset="${set('jpg')}" sizes="${sizes}" alt="${esc(alt)}"
       width="${dim.w}" height="${dim.h}"
       ${eager ? 'fetchpriority="high" decoding="sync"' : 'loading="lazy" decoding="async"'}
       style="background-image:url('${lqip}');background-size:cover;background-position:center">
</picture>`;
}

/* ------------------------------------------------------------------ icons -- */

const ICONS = {
  phone: '<path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2z"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  bag: '<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
};

const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

/* --------------------------------------------------------------- ornament -- */

const ornament = `<div class="rule" aria-hidden="true">
  <svg viewBox="0 0 200 24" style="--len:220">
    <line x1="0" y1="12" x2="78" y2="12"/>
    <path d="M88 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9-9-4-9-9z" style="--len:60"/>
    <circle cx="97" cy="12" r="2.2" style="--len:16"/>
    <line x1="116" y1="12" x2="200" y2="12"/>
  </svg>
</div>`;

/* ------------------------------------------------------------------ build -- */

async function main() {
  const site = JSON.parse(await readFile(path.join(DIR, 'content', 'site.json'), 'utf8'));
  const assets = JSON.parse(await readFile(path.join(DIR, 'assets', 'img', 'index.json'), 'utf8'));
  const cssRaw = await readFile(path.join(DIR, 'assets', 'css', 'site.css'), 'utf8');
  const fontCss = await readFile(path.join(DIR, 'assets', 'fonts', 'fonts.css'), 'utf8');

  // This CSS is inlined and therefore render-blocking, so strip what the
  // browser does not need. Comments and redundant whitespace only.
  const css = cssRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .trim();

  const P = assets.photos;

  // Resolve an image reference from content: either the id of a curated,
  // pre-processed asset, or a path to a file the owner uploaded in the editor.
  const photo = (ref) => {
    if (!ref) return null;
    if (P[ref]) return P[ref];
    return typeof ref === 'string' && ref.startsWith('/') ? ref : null;
  };
  // Names, prices and descriptions come from the content file so the owner can
  // change them in the editor; only the image variants come from the generated
  // asset index. An item whose photo is missing still renders, without one.
  const byAssetId = (group) =>
    Object.fromEntries(Object.values(group || {}).map((a) => [a.id, a]));
  const productAssets = byAssetId(assets.products);
  const sandwichAssets = byAssetId(assets.sandwiches);

  const products = (site.shelf.items || []).map((i) => ({ ...i, asset: productAssets[i.img] }));
  const sandwiches = (site.sandwiches.items || []).map((i) => ({ ...i, asset: sandwichAssets[i.img] }));

  // Per-letter spans for the hero wordmark. Niqqud are combining marks, so we
  // split by grapheme — otherwise a vowel point gets orphaned into its own span.
  const graphemes = [...new Intl.Segmenter('he', { granularity: 'grapheme' }).segment(site.hero.headline)]
    .map((s) => s.segment);
  const heroName = graphemes
    .map((g, i) => `<span style="--n:${i}" aria-hidden="true">${esc(g)}</span>`)
    .join('');

  const waze = `https://waze.com/ul?ll=${site.visit.lat},${site.visit.lng}&navigate=yes`;
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    site.visit.addressLine
  )}`;
  const orderUrl = site.order.links[0]?.url || '#';

  /* ---- structured data: helps Google show hours, phone and rating ---- */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: site.brand.name,
    alternateName: site.brand.nameLatin,
    description: site.seo.description,
    telephone: site.contact.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.visit.addressLine,
      addressLocality: 'פתח תקווה',
      postalCode: site.visit.postcode,
      addressCountry: 'IL',
    },
    geo: { '@type': 'GeoCoordinates', latitude: site.visit.lat, longitude: site.visit.lng },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: site.intro.ratingValue,
      reviewCount: site.intro.ratingCount,
    },
    sameAs: site.social.map((s) => s.url),
  };

  const html = `<!doctype html>
<html lang="${site.lang}" dir="${site.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(site.seo.title)}</title>
<meta name="description" content="${esc(site.seo.description)}">
<meta name="theme-color" content="#070f15">

<meta property="og:type" content="website">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="${esc(site.seo.title)}">
<meta property="og:description" content="${esc(site.seo.description)}">
<meta property="og:image" content="${site.seo.ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">

<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">

<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/frankruhl-300-he.woff2" crossorigin>
<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/assistant-400-he.woff2" crossorigin>

<style>${fontCss}\n${css}</style>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>

<a class="skip" href="#main">דילוג לתוכן</a>

<!-- ================================================================ HERO -->
<header class="hero">
  <div class="hero__media" data-parallax>
    ${picture(photo(site.hero.image), {
      alt: `חזית החנות של ${site.brand.name} בערב, השלט מואר`,
      sizes: '100vw',
      eager: true,
      portrait: site.hero.image === 'hero-night' ? P['hero-night-portrait'] : null,
    })}
  </div>
  <div class="hero__grade"></div>

  <!-- The shop's own illuminated sign is the wordmark here; setting the name
       again in type beside it would just be the same thing said twice. The
       typeset wordmark gets its own title card once the photograph cuts away. -->
  <h1 class="sr-only">${esc(site.brand.name)} — ${esc(site.hero.eyebrow)}</h1>
  <div class="hero__inner" data-parallax>
    <p class="hero__badge">${esc(site.hero.eyebrow)}</p>
  </div>

  <div class="hero__cue" aria-hidden="true">
    <i></i>
    <span>${esc(site.hero.scrollCue)}</span>
  </div>
</header>

<main id="main">

<!-- =============================================================== INTRO -->
<section class="titlecard">
  <div class="wrap">
    <p class="titlecard__name" data-letters><span class="sr-only">${esc(site.brand.name)}</span>${heroName}</p>
    <p class="titlecard__tagline" data-reveal style="--i:4">${esc(site.hero.tagline)}</p>
  </div>
</section>

<section class="intro section-pad">
  <div class="wrap">
    <h2 class="intro__statement" data-split="word">${esc(site.intro.statement)}</h2>
    <div class="intro__grid">
      <p class="intro__body" data-reveal style="--i:1">${esc(site.intro.body)}</p>
      <div data-reveal style="--i:2">
        <div class="rating">
          <span class="rating__score">${esc(site.intro.ratingValue)}</span>
          <span class="rating__stars" aria-hidden="true">★★★★★</span>
          <span class="rating__meta">${esc(site.intro.ratingCount)} ביקורות ${esc(site.intro.ratingLabel)}</span>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============================================================= COUNTER -->
<section class="counter section-pad">
  <div class="wrap">
    <div class="counter__frame" data-parallax data-reveal="wipe">
      ${picture(photo(site.counter.image), { alt: 'ויטרינת הגבינות בחנות', sizes: '(min-width: 78rem) 78rem, calc(100vw - 2.5rem)' })}
    </div>

    <div class="counter__layout">
      <div data-reveal>
        <p class="eyebrow">${esc(site.counter.title)}</p>
        <h2 class="h-section">${esc(site.counter.body.split('.')[0])}.</h2>
        <p class="body-dim">${esc(site.counter.body.split('.').slice(1).join('.').trim())}</p>
      </div>
      <div>
        <div class="counter__detail" data-parallax data-reveal style="--i:1">
          ${picture(photo(site.counter.detailImage), {
            alt: 'גבינה כחולה בחיתוך, עם שלט מחיר בכתב יד',
            sizes: '(min-width: 52rem) 38rem, calc(100vw - 2.5rem)',
          })}
        </div>
        <p class="caption" data-reveal style="--i:2">${esc(site.counter.detailCaption)}</p>
      </div>
    </div>
  </div>
</section>

<!-- ========================================================== CATEGORIES -->
<section class="cats">
  <div class="wrap cats__head" data-reveal>
    <p class="eyebrow">הקטגוריות שלנו</p>
    <h2 class="h-section" style="margin:0">${site.categories.length} מחלקות בחנות</h2>
  </div>
  ${[0, 1]
    .map((row) => {
      const half = Math.ceil(site.categories.length / 2);
      const list = row === 0 ? site.categories.slice(0, half) : site.categories.slice(half);
      const chips = list.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
      return `<div class="marquee">
    <div class="marquee__track" style="--dur:${row === 0 ? 52 : 46}s;--dir:${row === 0 ? 'normal' : 'reverse'}">
      ${chips}${chips}
    </div>
  </div>`;
    })
    .join('\n  ')}
</section>

<!-- ========================================================= BESTSELLERS -->
<section class="best section-pad">
  <div class="wrap wrap--narrow">
    <div data-reveal>
      <p class="eyebrow">${esc(site.bestsellers.note)}</p>
      <h2 class="h-section">${esc(site.bestsellers.title)}</h2>
    </div>
    <ol class="best__list">
      ${site.bestsellers.items
        .map(
          (it, i) => `<li class="best__item" data-reveal style="--i:${i}">
        <span class="best__n">${String(i + 1).padStart(2, '0')}</span>
        <span class="best__name">${esc(it.name)}</span>
        <span class="best__unit">${esc(it.unit)}</span>
      </li>`
        )
        .join('\n      ')}
    </ol>
  </div>
</section>

<!-- =============================================================== TABLE -->
<section class="table-sec section-pad">
  <div class="wrap">
    <div data-reveal>
      <p class="eyebrow">${esc(site.table.title)}</p>
      <h2 class="h-section">${esc(site.table.body)}</h2>
    </div>
    <div class="collage">
      <figure class="collage__a" data-reveal="wipe">
        ${picture(photo(site.table.images[0]), { alt: 'מגש אירוח עם כריכים, סלטים וזיתים', sizes: '(min-width: 46rem) 44rem, calc(100vw - 2.5rem)' })}
      </figure>
      <figure class="collage__b" data-parallax data-reveal style="--i:1">
        ${picture(photo(site.table.images[1]), { alt: 'צלחת עם עלי גפן ממולאים, כריך וסלטים', sizes: '(min-width: 46rem) 30rem, calc(100vw - 2.5rem)' })}
      </figure>
    </div>
  </div>
</section>

<!-- ========================================================== SANDWICHES -->
<section class="subs section-pad">
  <div class="wrap">
    <div data-reveal>
      <p class="eyebrow">${esc(site.sandwiches.note)}</p>
      <h2 class="h-section">${esc(site.sandwiches.title)}</h2>
      <p class="body-dim">${esc(site.sandwiches.body)}</p>
    </div>
    <ul class="subs__grid">
      ${sandwiches
        .map(
          (s, i) => `<li class="sub" data-reveal style="--i:${i % 2}">
        <div class="sub__img">${picture(s.asset, {
          alt: s.name,
          sizes: '(min-width: 62rem) 26rem, (min-width: 40rem) 45vw, calc(100vw - 2.5rem)',
          lean: true,
        })}</div>
        <div class="sub__body">
          <div class="sub__head">
            <h3 class="sub__name">${esc(s.name)}</h3>
            <span class="sub__price">${esc(s.price)}</span>
          </div>
          <p class="sub__desc">${esc(s.desc)}</p>
        </div>
      </li>`
        )
        .join('\n      ')}
    </ul>
    <p class="shelf__note" data-reveal>${esc(site.sandwiches.priceNote)}</p>
  </div>
</section>

${ornament}

<!-- =============================================================== SHELF -->
<section class="shelf section-pad">
  <div class="wrap">
    <div data-reveal>
      <p class="eyebrow">${esc(site.shelf.title)}</p>
      <h2 class="h-section">${products.length} מוצרים מהמדפים</h2>
      <p class="shelf__note">${esc(site.shelf.note)}</p>
    </div>
    <ul class="shelf__grid">
      ${products
        .map(
          (p, i) => `<li class="product" data-reveal style="--i:${i % 6}">
        <div class="product__img">${picture(p.asset, {
          alt: p.name,
          sizes: '(min-width: 40rem) 11rem, 44vw',
          lean: true,
        })}</div>
        <div class="product__body">
          <span class="product__cat">${esc(p.category)}</span>
          <span class="product__name">${esc(p.name)}</span>
          <span class="product__price">${esc(p.price)}</span>
        </div>
      </li>`
        )
        .join('\n      ')}
    </ul>
  </div>
</section>

<!-- =============================================================== VISIT -->
<section class="visit section-pad" id="visit">
  <div class="wrap">
    <div data-reveal>
      <p class="eyebrow">${esc(site.brand.kosher)} · ${esc(site.brand.kosherNote)}</p>
      <h2 class="h-section">${esc(site.visit.title)}</h2>
    </div>

    <div class="visit__grid">
      <div class="visit__photo" data-parallax data-reveal="wipe">
        ${picture(photo(site.visit.image), { alt: 'חזית החנות ביום', sizes: '(min-width: 52rem) 38rem, calc(100vw - 2.5rem)' })}
      </div>

      <div data-reveal style="--i:1">
        <div class="addr">
          <p class="addr__line">${esc(site.visit.addressLine)}</p>
          <p class="addr__note">${esc(site.visit.addressNote)}</p>
        </div>

        <ul class="hours">
          ${site.visit.hours
            .map(
              (h) => `<li><span class="hours__days">${esc(h.days)}</span><span class="hours__time">${esc(h.time)}</span></li>`
            )
            .join('\n          ')}
        </ul>
        <p class="caption" style="margin-block:-1.25rem 2rem">${esc(site.visit.hoursNote)}</p>

        <div class="btn-row">
          <a class="btn btn--primary" href="tel:${esc(site.contact.phoneIntl)}">${icon('phone')} ${esc(site.contact.phone)}</a>
          <a class="btn" href="${waze}" target="_blank" rel="noopener">${icon('pin')} Waze</a>
          <a class="btn" href="${gmaps}" target="_blank" rel="noopener">${icon('pin')} Google Maps</a>
        </div>

        <p class="eyebrow" style="margin-block-start:2.5rem">${esc(site.order.title)}</p>
        <div class="btn-row">
          ${site.order.links
            .map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener">${icon('bag')} ${esc(l.label)}</a>`)
            .join('\n          ')}
        </div>

        <ul class="link-list" style="margin-block-start:2rem">
          ${site.social
            .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`)
            .join('\n          ')}
        </ul>
      </div>
    </div>
  </div>
</section>

</main>

<footer class="footer">
  <p class="footer__mark">${esc(site.brand.nameVocalized)}</p>
  <p>${esc(site.brand.tagline)}</p>
  <p style="margin-block-start:1rem">${esc(site.visit.addressLine)} · ${esc(site.contact.phone)}</p>
  <p class="footer__fine">© <span id="y"></span> ${esc(site.brand.name)} · ${esc(site.footer.rightsNote)}</p>
</footer>

<nav class="actionbar" aria-label="פעולות מהירות">
  <a href="tel:${esc(site.contact.phoneIntl)}">${icon('phone')}<span>${esc(site.actions.call)}</span></a>
  <a href="${waze}" target="_blank" rel="noopener">${icon('pin')}<span>${esc(site.actions.navigate)}</span></a>
  <a href="${orderUrl}" target="_blank" rel="noopener">${icon('bag')}<span>${esc(site.actions.order)}</span></a>
</nav>

<script>document.getElementById('y').textContent=new Date().getFullYear()</script>
<script src="/assets/js/site.js" defer></script>
</body>
</html>`;

  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, 'index.html'), html, 'utf8');

  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`✓ index.html  ${kb}KB  (${products.length} products, ${site.categories.length} categories)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

# gift-sites

Personal project: hand-built static websites, one per person, given as a gift.

Each site lives in `sites/<slug>/` and is rendered from a single content file by
a dependency-free Node script. No framework, no bundler, no build toolchain to
rot. Hosting is Cloudflare Pages on the free tier; total running cost is zero,
for everyone, permanently.

## Layout

    _engine/            build + asset pipeline, shared by every site
      harvest.mjs       pull public content/imagery for a venue
      images.mjs        originals -> responsive AVIF/WebP/JPEG
      fonts.mjs         self-host the Hebrew webfonts
      build.mjs         content/site.json -> index.html   (zero dependencies)
      og.mjs            render the WhatsApp/social card
      serve.mjs         local server that mirrors production headers
      shots.mjs         real-user visual + accessibility pass
    _incoming/<slug>/   original photography, deliberately NOT published
    sites/<slug>/       what Cloudflare Pages publishes
      content/site.json every word and image on the site
      assets/           images, fonts, css, js
      index.html        generated — edit content/site.json, not this
    .pages.yml          the visual editor's form definition

## Working on a site

    npm run build           # regenerate index.html from content/site.json
    npm run serve           # http://localhost:4321
    npm run verify          # screenshots + a11y/overflow/console audit

`index.html` is generated. Editing it by hand is pointless — the next build
overwrites it. Change `sites/<slug>/content/site.json` instead, or use the
visual editor.

## Deployment

Cloudflare Pages, connected to this repo:

- Build command:      `node _engine/build.mjs <slug>`
- Build output dir:   `sites/<slug>`
- Root directory:     `/`

The build command needs no `npm install` — `build.mjs` imports nothing outside
Node's standard library. Only the asset pipeline (`images.mjs`, `harvest.mjs`,
`og.mjs`) needs `sharp`/`playwright`, and that runs locally, not on deploy.

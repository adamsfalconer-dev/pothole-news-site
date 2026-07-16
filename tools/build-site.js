#!/usr/bin/env node
'use strict';
/* ============================================================================
   POTHOLE NEWS - build-site.js  (production static site generator, FREE path)
   Matured from tools/render.js. Consumes a content/ directory of markdown posts
   (clean public content model + `draft:` flag) and static pages, and emits the
   complete site to dist/: the feed, 43 city + 6 region channels, story pages,
   /tips/ /corrections/ /meetings/, About/Ethics/Privacy, plus RSS, sitemap.xml,
   robots.txt, per-page og/meta, and a 404. Drafts are excluded from the output
   AND from RSS/sitemap. Reuses the frozen signal-theme tokens/CSS/JS pixel-for-
   pixel. Zero runtime deps (Cloudflare Pages builds it with `npm ci && npm run build`).

   Usage:
     node tools/build-site.js [--content DIR] [--out DIR] [--assets DIR]
                              [--pages DIR] [--base-url URL] [--drafts]
   Layout auto-detects: a public-repo checkout (a sibling theme/ dir) vs the dev
   tree (signal-theme/ + page-content/). Flags/env (SITE_URL, CF_PAGES_URL) override.
   ============================================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { splitFrontmatter } = require('./lib/frontmatter');
const md = require('./lib/markdown');
const M = require('./lib/content-model');

const esc = md.escapeHtml;
const escA = md.escapeAttr;

/* ---- config / layout resolution ------------------------------------------- */
function parseArgs(argv) {
  const a = { drafts: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--drafts') a.drafts = true;
    else if (k.startsWith('--')) a[k.slice(2)] = argv[++i];
  }
  return a;
}
const args = parseArgs(process.argv);
const HERE = __dirname;                              // .../tools
const ROOT = path.resolve(HERE, '..');               // the base dir (site/ or public-repo/)

function firstExisting(cands) { return cands.find(p => p && fs.existsSync(p)); }

const CONTENT_DIR = path.resolve(args.content ||
  firstExisting([path.join(ROOT, 'content'), path.join(ROOT, '..', 'content')]) ||
  path.join(ROOT, 'content'));
const ASSETS_DIR = path.resolve(args.assets ||
  firstExisting([path.join(ROOT, 'theme', 'assets'), path.join(ROOT, 'signal-theme', 'assets')]) ||
  path.join(ROOT, 'theme', 'assets'));
const PAGES_DIR = path.resolve(args.pages ||
  firstExisting([path.join(CONTENT_DIR, 'pages'), path.join(ROOT, 'page-content')]) ||
  path.join(CONTENT_DIR, 'pages'));
const OUT_DIR = path.resolve(args.out || path.join(ROOT, 'dist'));
// Canonical base URL resolution (single source of truth for the domain):
//   1. --base-url flag   2. SITE_URL env   3. CF_PAGES_URL env
//   4. site.config.json {"siteUrl": …} committed at the repo root — the ONE
//      configurable place the desk edits. A domain transfer (see
//      PLACEHOLDERS-FOR-TJ.md) is a one-line edit to that file + redirects.
//   5. a last-resort hardcoded fallback, kept only so a build never crashes if
//      the config file is missing — the live domain is NOT re-hardcoded here.
function readSiteConfigUrl() {
  try {
    const p = path.join(ROOT, 'site.config.json');
    if (fs.existsSync(p)) {
      const u = JSON.parse(fs.readFileSync(p, 'utf8')).siteUrl;
      if (u && /^https?:\/\//i.test(u)) return u;
    }
  } catch (e) { /* malformed config → fall through to the fallback */ }
  return null;
}
const BASE_URL = String(args['base-url'] || process.env.SITE_URL || process.env.CF_PAGES_URL ||
  readSiteConfigUrl() || 'https://potholenews.pages.dev').replace(/\/+$/, '');
const INCLUDE_DRAFTS = !!args.drafts;
// Optional Cloudflare Web Analytics (cookieless). Off unless the Pages build env
// sets CF_ANALYTICS_TOKEN; Cloudflare's "automatic" dashboard mode injects its own
// beacon at the edge instead (no snippet needed). CSP already allows the domains.
const CF_ANALYTICS = String(process.env.CF_ANALYTICS_TOKEN || '').trim();

const SITE_NAME = 'Pothole News';
const SITE_TAGLINE = 'Local government, covered.';

/* ---- load content --------------------------------------------------------- */
function loadPost(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = splitFrontmatter(raw);
  const slug = data.slug || path.basename(file, '.md');
  const place = data.place
    ? { slug: data.place, name: data.place_name || (M.placeBySlug[data.place] && M.placeBySlug[data.place].name) || data.place }
    : (data.place_name ? { slug: null, name: data.place_name } : null);
  // region: explicit frontmatter wins (agent stories set it); otherwise derive
  // it from the chosen place's region, so a CMS-authored story needs only a city.
  let region = null;
  if (data.region) {
    region = { slug: data.region, name: data.region_name || M.regionName(data.region) };
  } else if (place && place.slug && M.placeBySlug[place.slug]) {
    const r = M.regionById[M.placeBySlug[place.slug].region];
    if (r) region = { slug: r.slug, name: data.region_name || M.regionName(r.slug) };
  } else if (data.region_name) {
    region = { slug: null, name: data.region_name };
  }
  const sources = normalizeSources(data.sources);
  return {
    file, slug,
    title: String(data.title || ''),
    titleClean: M.stripStars(data.title || ''),
    date: data.date || '',
    place, region,
    type: String(data.type || 'news').toLowerCase(),
    typeDisplay: M.typeDisplay(data.type),
    thread: data.thread || null,
    excerpt: M.stripStars(data.excerpt || ''),
    breaking: !!data.breaking,
    corrected: !!data.corrected,
    card: data.card || null,             // 'number' | 'quote' | null
    band: data.band || null,
    readTime: data.read_time || null,
    whatsNext: data.whats_next || null,
    sources,
    correctionNote: data.correction_note || null,
    draft: !!data.draft,
    body: String(body || '').trim(),
    isThisWeek: slug === 'this-week',
  };
}
function normalizeSources(src) {
  if (!Array.isArray(src)) return [];
  return src.map(s => {
    if (s && typeof s === 'object') return { text: s.text || s.what || '', url: s.url || null };
    return { text: String(s), url: null };
  }).filter(s => s.text);
}

function loadAllPosts() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs.readdirSync(CONTENT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      try { return loadPost(path.join(CONTENT_DIR, f)); }
      catch (e) { console.warn(`  ! skipped ${f}: ${e.message}`); return null; }
    })
    .filter(Boolean);
}

/* newest-first, stable secondary sort by slug */
function byDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.slug < b.slug ? -1 : 1;
}

/* ---- head + shell (theme-faithful; real JS, per-page meta) ---------------- */
function head(opts) {
  const title = opts.title;
  const desc = (opts.description || SITE_TAGLINE).replace(/\s+/g, ' ').trim();
  const canonical = BASE_URL + opts.pathUrl;
  const ogType = opts.ogType || 'website';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${escA(desc)}">
<link rel="canonical" href="${escA(canonical)}">
<meta property="og:type" content="${escA(ogType)}">
<meta property="og:site_name" content="${escA(SITE_NAME)}">
<meta property="og:title" content="${escA(opts.ogTitle || title)}">
<meta property="og:description" content="${escA(desc)}">
<meta property="og:url" content="${escA(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escA(opts.ogTitle || title)}">
<meta name="twitter:description" content="${escA(desc)}">
<link rel="alternate" type="application/rss+xml" title="${escA(SITE_NAME)}" href="${escA(BASE_URL)}/rss.xml">
${opts.inlineHead || ''}
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/screen.css">
<script defer src="/assets/js/places.js"></script>
<script defer src="/assets/js/editions.js"></script>
<script defer src="/assets/js/signup.js"></script>
${(opts.footScripts || [])
  .map(s => `<script defer src="${escA(s)}"></script>`).join('\n')}
${CF_ANALYTICS ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${escA(CF_ANALYTICS)}"}'></script>` : ''}
</head>`;
}

function masthead() {
  return `<header class="masthead" role="banner">
    <div class="masthead__row">
      <a class="wordmark" href="/"><b>POTHOLE</b><em class="wordmark__news"> news</em><span class="u-visually-hidden"> — home</span></a>
      <div class="masthead__actions"><a class="btn btn--newsletter" href="#request">Newsletter</a></div>
    </div>
    <nav class="eds" aria-label="Your editions" data-editions>
      <a class="ed is-on" href="/">ALL</a>
      <a class="ed ed--plus" href="#atlas" aria-label="Add a city">&#65291;</a>
    </nav>
    <div class="edbar" aria-hidden="true"><span class="edslider" data-ed-slider></span></div>
  </header>`;
}

function atlas() {
  const cols = M.places.regions.map(r => {
    const links = M.places.cities.filter(c => c.region === r.id)
      .map(c => `<li><a href="/${c.slug}/">${esc(c.name)}</a></li>`).join('');
    return `<div class="atlas__col"><h3 class="atlas__region"><a href="/${r.slug}/">${esc(r.label)}</a></h3><ul class="atlas__list">${links}</ul></div>`;
  }).join('');
  return `<nav class="atlas" aria-label="All cities and communities">
    <h2 class="atlas__title">The whole valley &mdash; 43 places, two counties</h2>
    <div class="atlas__grid">${cols}</div></nav>`;
}

function footer() {
  return `<footer class="site-footer" id="atlas" role="contentinfo">
    <div class="site-footer__inner">
      ${atlas()}
      <div class="site-footer__bar">
        <a class="wordmark wordmark--reverse" href="/"><b>POTHOLE</b><em class="wordmark__news"> news</em></a>
        <nav class="site-footer__links" aria-label="About this site">
          <a href="/about/">About</a><a href="/ethics/">Ethics</a><a href="/tips/">Tips</a><a href="/corrections/">Corrections</a><a href="/privacy/">Privacy</a>
        </nav>
      </div>
      <p class="site-footer__meta">${esc(SITE_TAGLINE)} Six cities we watch daily &middot; 43 places, two counties. &copy; 2026 ${esc(SITE_NAME)}.</p>
    </div>
  </footer>`;
}

function shell(opts) {
  return `${head(opts)}
<body class="${escA(opts.bodyClass || '')}">
  ${masthead()}
  <main id="site-main" class="site-main" role="main">${opts.body}</main>
  ${footer()}
</body>
</html>`;
}

/* ---- cards + modules ------------------------------------------------------ */
function card(p) {
  const cls = ['c'];
  if (p.breaking) cls.push('c--breaking');
  if (p.card === 'number') cls.push('c--number');
  if (p.card === 'quote') cls.push('c--quote');
  if (p.corrected) cls.push('c--corrected');
  const band = p.breaking ? `<span class="c__band">${esc(p.band || 'Breaking')}</span>` : '';
  const placeName = p.place ? p.place.name : (p.region ? p.region.name : 'The valley');
  const kicker = `${esc(placeName)} &middot; ${esc(p.typeDisplay)}`;
  const src = `${esc(M.displayDate(p.date))} &middot; ${SITE_NAME} Staff` +
    (p.corrected ? ` &middot; <a href="/corrections/">corrected</a>` : '');
  return `<article class="${cls.join(' ')}">
    ${band}
    <span class="c__kicker">${kicker}</span>
    <h2 class="c__headline"><a href="/${esc(p.slug)}/" data-emphasize>${esc(p.title)}</a></h2>
    <p class="c__dek">${esc(p.excerpt)}</p>
    <p class="c__source">${src}</p>
  </article>`;
}

function moduleWeek(weekPost) {
  if (weekPost) {
    return `<aside class="module module--week" aria-label="Your week in local government">
      <div class="module--week__banner">Your week in local government</div>
      <div class="module--week__body gh-content">${md.toHtml(weekPost.body)}</div>
      <p class="module--week__foot"><a href="/meetings/">The full week ahead &rarr;</a></p>
    </aside>`;
  }
  return `<aside class="module module--week" aria-label="Your week in local government">
    <div class="module--week__banner">Your week in local government</div>
    <p class="module--week__foot"><a href="/meetings/">See the week ahead &rarr;</a> &middot; refreshed every Sunday</p>
  </aside>`;
}

function moduleRequest() {
  return `<aside class="module module--request" id="request">
    <span class="req__stamp" aria-hidden="true">Request&nbsp;filed&nbsp;&#10003;</span>
    <h2 class="req__label">Public records request &#8470; YOU</h2>
    <p class="req__big">Requesting: <em class="sig">the morning packet, read for you</em></p>
    <dl class="req__rows">
      <div class="req__row"><dt>Records sought</dt><dd>the whole valley, weekly</dd></div>
      <div class="req__row"><dt>Delivery</dt><dd>your inbox &middot; free</dd></div>
      <div class="req__row"><dt>Statutory fee</dt><dd>$0.00 &mdash; forever</dd></div>
    </dl>
    <form class="req__form" data-signup>
      <label class="u-visually-hidden" for="req-email">Your email address</label>
      <input class="req__email" id="req-email" type="email" required autocomplete="email" placeholder="you@email.com">
      <button class="req__file" type="submit">File it</button>
    </form>
    <p class="req__success" role="status">Filed. We&rsquo;ll be in touch when the roundup opens.</p>
    <noscript><p class="req__meta">Or email <a href="mailto:assignmentdesk26@gmail.com?subject=Newsletter%20signup%20-%20Pothole%20News">assignmentdesk26@gmail.com</a> to be added to the free weekly roundup.</p></noscript>
  </aside>`;
}

/* First-visit onboarding card (P1), server-rendered into the home slot so it
   paints with the page (no CLS). editions.js wires this exact markup; a pre-paint
   inline head script hides it for returning visitors. */
function onboardingCard() {
  const groups = M.places.regions.map(r => {
    const chips = M.places.cities.filter(c => c.region === r.id)
      .map(c => `<button class="cchip" type="button" aria-pressed="false" data-onb="${escA(c.slug)}">${esc(c.name)}</button>`).join('');
    return `<div class="onb__region">${esc(r.label)}</div><div class="onb__chips">${chips}</div>`;
  }).join('');
  return `<div class="onb">` +
    `<h2 class="onb__title">Where do you live? <em>Pick up to three.</em></h2>` +
    `<p class="onb__sub">We cover 43 cities and communities across the San Gabriel &amp; Pomona Valleys. Choose yours &mdash; the feed remembers.</p>` +
    groups +
    `<div><button class="onb__go" type="button" data-onb-go>BUILD MY FEED &rarr;</button>` +
    `<span class="onb__count" data-onb-count></span></div></div>`;
}
/* pre-paint: hide the onboarding card for visitors who already onboarded.
   ONBOARD_SCRIPT is the exact inline-script body the CSP hashes (see _headers);
   keep the two in lock-step by deriving the hash from this constant at build. */
const ONBOARD_SCRIPT = `try{if(localStorage.getItem('pothole:onboarded'))document.documentElement.className+=' pn-onboarded';}catch(e){}`;
const ONBOARD_INLINE = `<script>${ONBOARD_SCRIPT}</script>`;

/* feed with the inline modules (week after post 3, request every 4th) */
function feed(posts, weekPost) {
  let out = '<div class="feed" data-feed>';
  posts.forEach((p, i) => {
    const n = i + 1;
    out += card(p);
    if (n === 3) out += moduleWeek(weekPost);
    if (n % 4 === 0) out += moduleRequest();
  });
  if (posts.length < 4) out += moduleRequest();
  out += '</div>';
  return out;
}

function emptyState(city, allPosts) {
  const region = M.regionById[city.region];
  const regionSlug = region.slug;
  const regionDisp = M.regionName(regionSlug);
  const nearby = allPosts.filter(p => p.region && p.region.slug === regionSlug).slice(0, 3);
  let html = `<section class="empty">
    <p class="empty__lead">Nothing from <em class="sig">${esc(city.name)}</em> in the last few days &mdash; we&rsquo;re watching its agendas. Coverage is growing.</p>`;
  if (nearby.length) {
    html += `<p class="empty__nearby-label">Nearby, in ${esc(regionDisp)}:</p><div class="feed">${nearby.map(card).join('')}</div>`;
  }
  html += `<p class="empty__region-link"><a href="/${esc(regionSlug)}/">See all ${esc(regionDisp)} coverage &rarr;</a></p></section>`;
  return html + moduleRequest();
}

/* ---- story view ----------------------------------------------------------- */
function sourcesBlock(p) {
  if (!p.sources.length) return '';
  const items = p.sources.map(s =>
    s.url ? `<a href="${escA(s.url)}" rel="noopener">${esc(s.text)}</a>` : esc(s.text)
  ).join(' &middot; ');
  return `<section class="sources">${items}</section>`;
}
function storyPage(p, threadCount) {
  const band = p.breaking ? `<span class="c__band">${esc(p.band || 'Breaking')}</span>` : '';
  const threadLink = p.place ? `/${esc(p.place.slug)}/` : (p.region ? `/${esc(p.region.slug)}/` : '/');
  const threadLine = threadCount > 1
    ? `<span class="story__endline-item"><b>Thread:</b> <a href="${threadLink}">${threadCount} stories &rarr;</a></span><span class="story__endline-sep" aria-hidden="true">&middot;</span>`
    : '';
  const corr = p.corrected ? '<a href="/corrections/">logged &mdash; see below</a>' : 'none';
  const whats = p.whatsNext ? `<aside class="whats-next"><b>What&rsquo;s next:</b> ${md.inline(p.whatsNext)}</aside>` : '';
  const placeName = p.place ? p.place.name : (p.region ? p.region.name : 'The valley');
  const metaBits = [M.displayDate(p.date)];
  if (p.readTime) metaBits.push(p.readTime);
  const metaLine = metaBits.map(esc).join(' &middot; ');
  const article = `<article class="story${p.corrected ? ' story--corrected' : ''}">
    ${band}
    <p class="story__kickerline"><span class="story__kicker">${esc(placeName)} &middot; ${esc(p.typeDisplay)}</span> <span class="story__meta">&middot; ${metaLine}</span></p>
    <h1 class="story__headline" data-emphasize>${esc(p.title)}</h1>
    <p class="story__dek">${esc(p.excerpt)}</p>
    <div class="story__rule" aria-hidden="true"></div>
    <div class="story__body gh-content">${md.toHtml(p.body)}${whats}${sourcesBlock(p)}</div>
    <footer class="story__endline">${threadLine}<span class="story__endline-item"><b>Corrections:</b> ${corr}</span></footer>
  </article>${moduleRequest()}`;
  return shell({
    body: `<div class="feed-wrap">${article}</div>`,
    bodyClass: 'post-template',
    title: `${p.titleClean} — ${SITE_NAME}`,
    ogTitle: p.titleClean,
    description: p.excerpt,
    ogType: 'article',
    pathUrl: `/${p.slug}/`,
  });
}

/* ---- listing/section pages ------------------------------------------------ */
function listingHead(title, note, emphasize) {
  return `<header class="listing-head">
    <h1 class="listing-head__title"${emphasize ? ' data-emphasize' : ''}>${esc(title)}</h1>
    <p class="listing-head__note">${note}</p>
  </header>`;
}

function correctionsPage(posts) {
  const items = posts.filter(p => p.corrected).sort(byDateDesc);
  const list = items.map(p =>
    `<li class="corrections__item"><span class="corrections__date">${esc(M.displayDate(p.date))}</span>` +
    `<a class="corrections__headline" href="/${esc(p.slug)}/" data-emphasize>${esc(p.title)}</a>` +
    `<span class="corrections__place">${esc(p.place ? p.place.name : (p.region ? p.region.name : ''))}</span>` +
    (p.correctionNote ? `<span class="corrections__note">${esc(p.correctionNote)}</span>` : '') +
    `</li>`).join('');
  const body = `<div class="feed-wrap">
    ${listingHead('Corrections', 'We log every correction &mdash; publicly, on the same page as the story. When we get something wrong, we mark the change and record it here. We do not silently edit.', false)}
    ${items.length ? `<ol class="corrections">${list}</ol>` : '<p class="empty__lead">No corrections on the record yet — and we&rsquo;d rather keep it that way.</p>'}
    <p class="corrections__policy">Spot an error? Email <a href="mailto:corrections@pothole.news">corrections@pothole.news</a>. Every correction is made in every edition the story ran in.</p>
  </div>`;
  return shell({ body, bodyClass: 'page-template', title: `Corrections — ${SITE_NAME}`,
    description: 'The Pothole News corrections log — every correction, publicly recorded.', pathUrl: '/corrections/' });
}

function meetingsPage(weekPost) {
  let inner;
  if (weekPost) {
    inner = `<div class="meetings gh-content">${md.toHtml(weekPost.body)}</div>
      <p class="meetings__foot">Refreshed every Sunday.</p>`;
  } else {
    inner = `${moduleWeek(null)}
      <p class="placeholder-note">The live week-ahead post (slug <code>this-week</code>) hasn&rsquo;t been published yet &mdash; the calendar refreshes every Sunday.</p>`;
  }
  const body = `<div class="feed-wrap">
    ${listingHead('The week ahead', 'Every agenda, meeting, and deadline across the valley &mdash; one pinned post, refreshed each Sunday.', false)}
    ${inner}
  </div>`;
  return shell({ body, bodyClass: 'page-template', title: `The week ahead — ${SITE_NAME}`,
    description: 'Every agenda, meeting, and deadline across the Pomona Valley — refreshed weekly.', pathUrl: '/meetings/' });
}

function tipCityButtons() {
  return M.places.cities.map(c =>
    `<button class="tip__opt" type="button" data-tip-pick="${escA(c.name)}">${esc(c.name)}</button>`).join('') +
    '<button class="tip__opt" type="button" data-tip-pick="A school district">A school district</button>' +
    '<button class="tip__opt" type="button" data-tip-pick="Not sure / elsewhere in the valley">Not sure</button>';
}
function tipsPage() {
  const body = `<div class="feed-wrap">
    <header class="listing-head">
      <h1 class="listing-head__title" data-emphasize>Report a Pothole *— the tip line*</h1>
      <p class="listing-head__note">Something broken where you live? Tips, documents, meeting whispers. Confidential by default &mdash; no CAPTCHA, no account, a hunch is enough.</p>
    </header>
    <form class="tip" data-tip novalidate>
      <ol class="tip__steps" aria-hidden="true">
        <li class="tip__seg is-on" data-tip-seg="1"></li><li class="tip__seg" data-tip-seg="2"></li><li class="tip__seg" data-tip-seg="3"></li>
      </ol>
      <input type="hidden" name="city" data-tip-city value="">
      <input type="hidden" name="severity" data-tip-severity value="">
      <fieldset class="tip__step is-on" data-tip-step="1">
        <legend class="tip__q">Where&rsquo;s the pothole? <em class="sig">(the civic kind)</em></legend>
        <div class="tip__opts" data-tip-cities role="group" aria-label="Choose a place">${tipCityButtons()}</div>
      </fieldset>
      <fieldset class="tip__step" data-tip-step="2" hidden>
        <legend class="tip__q">How deep does it go?</legend>
        <div class="tip__opts tip__opts--sev" role="group" aria-label="Choose a severity">
          <button class="tip__opt tip__sev" type="button" data-tip-sev="surface crack"><span class="tip__ico" aria-hidden="true">&#12316;</span><span class="tip__sev-t">Surface crack</span><span class="tip__sev-s">something looks off &mdash; worth a look</span></button>
          <button class="tip__opt tip__sev" type="button" data-tip-sev="pothole"><span class="tip__ico" aria-hidden="true">&#128371;&#65039;</span><span class="tip__sev-t">Pothole</span><span class="tip__sev-s">I&rsquo;ve seen or heard something specific</span></button>
          <button class="tip__opt tip__sev" type="button" data-tip-sev="sinkhole"><span class="tip__ico" aria-hidden="true">&#9888;&#65039;</span><span class="tip__sev-t">Sinkhole</span><span class="tip__sev-s">I have documents / I was in the room</span></button>
        </div>
        <div class="tip__nav"><button class="tip__back" type="button" data-tip-back="1">&larr; Back</button></div>
      </fieldset>
      <fieldset class="tip__step" data-tip-step="3" hidden>
        <legend class="tip__q">Tell us what you know. <em class="sig">We read everything.</em></legend>
        <textarea class="tip__textarea" id="tip-details" name="details" required placeholder="What happened, who was involved, when. Paste links. Attach documents after submitting — we'll send a secure upload link."></textarea>
        <input class="tip__contact" id="tip-contact" name="contact" type="text" autocomplete="off" placeholder="Email or phone (optional — for follow-up only)">
        <p class="tip__meta">&#128274; Confidential by default. We never name a source without permission. No CAPTCHA, no account, no minimum &mdash; a hunch is enough. If it&rsquo;s urgent, write URGENT and we triage same-day.</p>
        <p class="tip__error" data-tip-error role="alert" hidden></p>
        <div class="tip__nav"><button class="tip__back" type="button" data-tip-back="2">&larr; Back</button><button class="tip__send" type="submit" data-tip-send>Send the tip &rarr;</button></div>
      </fieldset>
      <div class="tip__done" data-tip-done hidden role="status">
        <div class="tip__done-ico" aria-hidden="true">&#128679;</div>
        <p class="tip__done-big" data-emphasize>Got it. *Crew dispatched.*</p>
        <p class="tip__meta tip__done-note">Your tip is in the assignment desk&rsquo;s queue. If you left contact info, a human replies within a day &mdash; even if it&rsquo;s just &ldquo;we&rsquo;re digging.&rdquo;</p>
      </div>
    </form>
  </div>`;
  return shell({ body, bodyClass: 'page-template', title: `Report a Pothole — ${SITE_NAME}`,
    description: 'Report a pothole — the Pothole News tip line. Confidential, no account, no CAPTCHA.',
    pathUrl: '/tips/', footScripts: ['/assets/js/tips.js'] });
}

function staticPage(slug, title, bodyHtml) {
  const body = `<div class="feed-wrap page">
    <header class="listing-head"><h1 class="listing-head__title">${esc(title)}</h1></header>
    <div class="page__body gh-content">${bodyHtml}</div>
  </div>`;
  return shell({ body, bodyClass: 'page-template', title: `${title} — ${SITE_NAME}`,
    description: `${title} — ${SITE_NAME}.`, pathUrl: `/${slug}/` });
}

function notFoundPage() {
  const body = `<div class="feed-wrap">
    <section class="empty">
      <p class="empty__lead">That page isn&rsquo;t here &mdash; but the whole valley is.</p>
      <p class="empty__region-link"><a href="/">Back to the feed &rarr;</a> &middot; <a href="#atlas">browse all 43 places</a></p>
    </section>
  </div>`;
  return shell({ body, bodyClass: 'error-template', title: `Not found — ${SITE_NAME}`,
    description: 'Page not found.', pathUrl: '/404.html' });
}

/* ---- feed pages (home / city / region) ------------------------------------ */
function homePage(posts, weekPost) {
  const body = `<div class="feed-wrap"><div data-onboarding-slot>${onboardingCard()}</div>${feed(posts, weekPost)}</div>`;
  return shell({ body, bodyClass: 'home-template', title: `${SITE_NAME} — the valley feed`,
    ogTitle: SITE_NAME, description: 'Local government across the Pomona Valley — six cities, two counties, covered daily.',
    pathUrl: '/', inlineHead: ONBOARD_INLINE });
}
function cityPage(city, posts, weekPost, allPosts) {
  const region = M.regionById[city.region];
  let body;
  if (posts.length) body = `<div class="feed-wrap"><div data-onboarding-slot></div>${feed(posts, weekPost)}</div>`;
  else body = `<div class="feed-wrap"><div data-onboarding-slot></div>${emptyState(city, allPosts)}</div>`;
  return shell({ body, bodyClass: 'tag-template', title: `${city.name} — ${SITE_NAME}`,
    description: `${city.name} local government coverage — agendas, votes, money, and meetings, from ${SITE_NAME}.`,
    pathUrl: `/${city.slug}/` });
}
function regionPage(region, posts, weekPost) {
  const disp = M.regionName(region.slug);
  let inner;
  if (posts.length) inner = feed(posts, weekPost);
  else inner = `<section class="empty"><p class="empty__lead">No coverage in <em class="sig">${esc(disp)}</em> in the last few days &mdash; coverage is growing across the valley.</p></section>${moduleRequest()}`;
  const body = `<div class="feed-wrap"><div data-onboarding-slot></div>${inner}</div>`;
  return shell({ body, bodyClass: 'tag-template', title: `${disp} — ${SITE_NAME}`,
    description: `${disp} local government coverage from ${SITE_NAME}.`, pathUrl: `/${region.slug}/` });
}

/* ---- feeds: RSS / sitemap / robots ---------------------------------------- */
function rssXml(posts) {
  const items = posts.slice(0, 30).map(p => {
    const link = `${BASE_URL}/${p.slug}/`;
    const cats = [p.place && p.place.name, p.typeDisplay].filter(Boolean)
      .map(c => `      <category>${esc(c)}</category>`).join('\n');
    return `    <item>
      <title>${esc(p.titleClean)}</title>
      <link>${escA(link)}</link>
      <guid isPermaLink="true">${escA(link)}</guid>
      <pubDate>${M.rfc822(p.date)}</pubDate>
      <description>${esc(p.excerpt)}</description>
${cats}
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)}</title>
    <link>${escA(BASE_URL)}/</link>
    <atom:link href="${escA(BASE_URL)}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Local government across the Pomona Valley — six cities, two counties.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
}
function sitemapXml(urls) {
  const body = urls.map(u =>
    `  <url><loc>${escA(BASE_URL + u.path)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}
function robotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`;
}

/* ---- writing -------------------------------------------------------------- */
function rmrf(dir) { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); }
function writePage(urlPath, html) {
  // '/foo/' -> dist/foo/index.html ; '/404.html' -> dist/404.html
  let rel;
  if (urlPath.endsWith('.html')) rel = urlPath.replace(/^\//, '');
  else if (urlPath.endsWith('/')) rel = urlPath.replace(/^\//, '') + 'index.html';
  else rel = urlPath.replace(/^\//, '') + '/index.html';
  const dest = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
}
function writeFile(rel, content) {
  const dest = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/* strip the leading H1/comment header from an imported page markdown body */
function pageBodyHtml(raw) {
  const { body } = splitFrontmatter(raw);
  // drop a leading HTML comment (import header) and any leading H1
  let text = String(body || raw).replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  text = text.replace(/^\s*#\s+.*\n/, '');
  return md.toHtml(text.trim());
}
const PAGE_TITLES = { about: 'About Pothole News', ethics: 'Ethics & Standards', privacy: 'Privacy' };

/* ---- hardening: _headers (CSP + security + caching) and _redirects -------- */
/* CSP source hash for a given inline-script body (browsers hash the exact text
   between <script> and </script>). Recomputed each build → never drifts. */
function cspHash(scriptBody) {
  return "'sha256-" + crypto.createHash('sha256').update(scriptBody, 'utf8').digest('base64') + "'";
}
function headersFile() {
  // one long CSP line (no newlines allowed inside a header value).
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "font-src 'self'",
    // 'self' for the frozen theme JS + a hash for the inline pre-paint script;
    // static.cloudflareinsights.com is pre-authorized for opt-in Web Analytics.
    `script-src 'self' ${cspHash(ONBOARD_SCRIPT)} https://static.cloudflareinsights.com`,
    // Web3Forms for the tip line + newsletter card; cloudflareinsights for the
    // analytics beacon (both no-ops until configured).
    "connect-src 'self' https://api.web3forms.com https://cloudflareinsights.com",
    "upgrade-insecure-requests",
  ].join('; ');
  return `# Cloudflare Pages headers — generated by build-site.js (do not hand-edit the CSP hash).
# The script-src sha256 covers the inline pre-paint onboarding script, kept inline
# for CLS 0; it is recomputed from that script every build so it never drifts.
/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), microphone=(), camera=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin

# Long cache for static theme assets. Filenames are NOT content-hashed, so this
# is a day, not 'immutable' — a CSS/JS change propagates within 24h.
/assets/*
  Cache-Control: public, max-age=86400

# Feeds revalidate quickly (content changes on publish).
/rss.xml
  Cache-Control: public, max-age=1800
`;
}
function redirectsFile() {
  return `# Cloudflare Pages redirects:  from  to  status
# Pages canonicalizes trailing slashes automatically. Add rules as needed.
/feed    /rss.xml    301
/rss     /rss.xml    301
`;
}

/* ---- build ---------------------------------------------------------------- */
function build() {
  const t0 = Date.now();
  const all = loadAllPosts();
  const drafts = all.filter(p => p.draft);
  const live = all.filter(p => (INCLUDE_DRAFTS || !p.draft));
  // this-week is structural (the /meetings/ source), not a feed article
  const weekPost = live.find(p => p.isThisWeek) || null;
  const articles = live.filter(p => !p.isThisWeek).sort(byDateDesc);

  // thread counts (across live articles)
  const threadCounts = {};
  articles.forEach(p => { if (p.thread) threadCounts[p.thread] = (threadCounts[p.thread] || 0) + 1; });

  rmrf(OUT_DIR);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sitemap = [];
  const add = (p, lastmod) => sitemap.push({ path: p, lastmod: lastmod || '' });

  // home
  writePage('/', homePage(articles, weekPost));
  add('/', M.isoDate(articles[0] && articles[0].date));

  // stories
  articles.forEach(p => {
    writePage(`/${p.slug}/`, storyPage(p, p.thread ? threadCounts[p.thread] : 0));
    add(`/${p.slug}/`, M.isoDate(p.date));
  });

  // 43 city channels
  M.places.cities.forEach(city => {
    const cityPosts = articles.filter(p => p.place && p.place.slug === city.slug);
    writePage(`/${city.slug}/`, cityPage(city, cityPosts, weekPost, articles));
    add(`/${city.slug}/`);
  });

  // 6 region channels
  M.places.regions.forEach(region => {
    const rPosts = articles.filter(p => p.region && p.region.slug === region.slug);
    writePage(`/${region.slug}/`, regionPage(region, rPosts, weekPost));
    add(`/${region.slug}/`);
  });

  // sections
  writePage('/tips/', tipsPage()); add('/tips/');
  writePage('/corrections/', correctionsPage(articles)); add('/corrections/');
  writePage('/meetings/', meetingsPage(weekPost)); add('/meetings/');

  // static pages
  ['about', 'ethics', 'privacy'].forEach(slug => {
    const f = path.join(PAGES_DIR, `${slug}.md`);
    if (fs.existsSync(f)) {
      writePage(`/${slug}/`, staticPage(slug, PAGE_TITLES[slug], pageBodyHtml(fs.readFileSync(f, 'utf8'))));
      add(`/${slug}/`);
    } else {
      console.warn(`  ! page missing: ${slug}.md`);
    }
  });

  // 404
  writePage('/404.html', notFoundPage());

  // feeds
  writeFile('rss.xml', rssXml(articles));
  writeFile('sitemap.xml', sitemapXml(sitemap));
  writeFile('robots.txt', robotsTxt());

  // hardening (Cloudflare Pages reads these from the build output dir)
  writeFile('_headers', headersFile());
  writeFile('_redirects', redirectsFile());

  // assets (real theme CSS/JS, pixel-for-pixel)
  copyDir(ASSETS_DIR, path.join(OUT_DIR, 'assets'));

  const ms = Date.now() - t0;
  console.log(`✓ built ${SITE_NAME} → ${path.relative(process.cwd(), OUT_DIR)} in ${ms}ms`);
  console.log(`  articles: ${articles.length} live${INCLUDE_DRAFTS ? '' : ` · ${drafts.length} drafts excluded`}` +
    ` · week post: ${weekPost ? 'yes' : 'none'}`);
  console.log(`  pages: home + ${articles.length} stories + ${M.places.cities.length} cities + ${M.places.regions.length} regions + tips/corrections/meetings + 3 static + 404`);
  console.log(`  feeds: rss.xml (${Math.min(articles.length, 30)} items) · sitemap.xml (${sitemap.length} urls) · robots.txt`);
  console.log(`  hardening: _headers (CSP + security + caching) · _redirects`);
  console.log(`  base url: ${BASE_URL}`);
}

if (require.main === module) build();
module.exports = { build, loadAllPosts, loadPost };

'use strict';
/* ============================================================================
   content-model.js - the shared vocabulary of the Pothole News content model
   (WEBSITE-MASTER-BUILD-PLAN §2): places, regions, story types, and the small
   formatting helpers both the generator (content -> HTML) and the publish bridge
   (published -> content) depend on. One source of truth so tags never drift.
   Zero runtime deps (safe for the Cloudflare Pages build).
   ============================================================================ */
const fs = require('fs');
const path = require('path');

const places = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'places.json'), 'utf8'));

const placeBySlug = {};
places.cities.forEach(c => { placeBySlug[c.slug] = c; });
const regionById = {};
places.regions.forEach(r => { regionById[r.id] = r; });
const regionBySlug = {};
places.regions.forEach(r => { regionBySlug[r.slug] = r; });

/* Friendly region display names (from the frozen MyCities seed), keyed by tag
   slug. places.json `label` is the ALL-CAPS masthead form; these read as prose. */
const REGION_DISPLAY = {
  'region-west-sgv': 'West SGV',
  'region-foothills': 'Pasadena & Foothills',
  'region-central-sgv': 'Central SGV',
  'region-east-sgv': 'East SGV',
  'region-pomona-valley': 'Pomona Valley',
  'region-chino-valley': 'Chino / West Valley',
};

/* Story types (§2). Display = Title Case; slug = lower. */
const TYPES = ['news', 'watchdog', 'explainer', 'meeting', 'money', 'elections', 'schools'];
function typeDisplay(t) {
  const s = String(t || 'news').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* jurisdiction (published frontmatter) -> a place descriptor for the content
   model. Cities resolve via places.json. `county-regional` and any other
   non-city jurisdiction resolve to a display label with no city channel and no
   region tag (it still appears in the main feed and gets its own story page). */
function jurisdictionToPlace(jurisdiction) {
  const slug = String(jurisdiction || '').trim().toLowerCase();
  const city = placeBySlug[slug];
  if (city) {
    const region = regionById[city.region];
    return {
      place: city.slug,
      place_name: city.name,
      region: region ? region.slug : null,
      region_name: region ? (REGION_DISPLAY[region.slug] || region.label) : null,
    };
  }
  // non-city jurisdiction (e.g. county-regional): honest label, no city/region tag
  const label = slug === 'county-regional' ? 'County & Regional'
    : slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { place: null, place_name: label, region: null, region_name: null };
}

/* Region display name from a region tag slug. */
function regionName(slug) {
  if (!slug) return null;
  return REGION_DISPLAY[slug] || (regionBySlug[slug] && regionBySlug[slug].label) || slug;
}

/* ---- text + date helpers -------------------------------------------------- */
function stripStars(s) { return String(s == null ? '' : s).replace(/\*([^*]+)\*/g, '$1'); }
function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/['".,:;!?()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Parse a YYYY-MM-DD (or ISO) date string into {y,m,d} without timezone drift. */
function ymd(dateStr) {
  const m = String(dateStr || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3] };
}
function displayDate(dateStr) {
  const p = ymd(dateStr);
  if (!p) return String(dateStr || '');
  return `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}`;
}
/* RFC-822 for RSS pubDate; UTC, midday to avoid any edge rounding. */
function rfc822(dateStr) {
  const p = ymd(dateStr);
  if (!p) return '';
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d, 12, 0, 0));
  const pad = n => String(n).padStart(2, '0');
  return `${DOW[dt.getUTCDay()]}, ${pad(p.d)} ${MON3[p.mo - 1]} ${p.y} 12:00:00 GMT`;
}
/* ISO date (YYYY-MM-DD) for sitemap lastmod. */
function isoDate(dateStr) {
  const p = ymd(dateStr);
  if (!p) return '';
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

module.exports = {
  places, placeBySlug, regionById, regionBySlug, REGION_DISPLAY, TYPES,
  typeDisplay, jurisdictionToPlace, regionName,
  stripStars, slugify, displayDate, rfc822, isoDate, ymd,
};

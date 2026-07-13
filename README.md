# pothole-news-site

The public static site for **Pothole News** — local government across the Pomona Valley.
This repo contains ONLY publishable content + theme assets. It builds to a static site
with a zero-dependency Node generator and deploys free on **Cloudflare Pages**.

> Internal newsroom material never lives here. `tools/verify-clean.js` runs before every
> build and fails the deploy if any internal artifact — internal working files, gated
> decision packages, internal run state or secrets, internal editorial frontmatter, or
> internal honesty labels — appears anywhere in the tree.

## Layout

    content/            markdown stories (frontmatter + draft flag) + pages/ (about, ethics, privacy)
    theme/assets/       the frozen signal-theme CSS + JS (tokens, screen, editions, tips, signup, places)
    tools/build-site.js the generator (content/ -> dist/)
    tools/verify-clean.js  the pre-build hygiene guard
    tools/lib/          frontmatter + markdown + content-model helpers (no runtime deps)

## Build

    npm run build       # verify-clean, then generate dist/
    npm run serve       # preview dist/ locally at http://localhost:4322/

The generator needs no dependencies (`npm ci` installs none). Drafts (`draft: true`)
are excluded from the output, RSS, and sitemap.

## Cloudflare Pages settings (free tier)

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | **20** (set env `NODE_VERSION=20`, or the `.nvmrc`) |
| Environment variable (optional) | `SITE_URL` = your final URL (e.g. `https://potholenews.pages.dev`) for canonical/RSS/sitemap links; Pages also exposes `CF_PAGES_URL` automatically |

Until a domain is attached, the site lives at `https://<project>.pages.dev`.

## How content arrives

Stories are written here by the newsroom's publish bridge (`newsroom/tools/publish_web.js`)
as `draft: true`; the Publisher flips a story live (`draft: false`) from the CMS or by
replying `publish {slug}` to the daily recap. The bridge never force-pushes and skips any
file a human edited upstream. See the newsroom's `agents/W2-web-desk.md`.

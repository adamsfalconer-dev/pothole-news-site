#!/usr/bin/env node
'use strict';
/* ============================================================================
   verify-clean.js - PUBLIC REPO HYGIENE GUARD (pre-push)
   The public pothole-news-site repo must contain ONLY publishable content +
   theme assets. This fails (exit 1) if anything matching an internal-newsroom
   pattern appears anywhere in the repo tree - by PATH (internal folders/files)
   or by CONTENT (internal frontmatter fields, gate/decision markers, honesty
   tags, internal repo paths). Wired into publish_web.js before every push, and
   runnable as a repo pre-commit/CI check.

   Usage:  node tools/verify-clean.js [repo-dir]        (default: cwd)
           exit 0 = clean · exit 1 = violations (printed)
   ============================================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());

/* directories never walked (build output + deps + git internals) */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.wrangler', '.cache']);

/* PATH rules - fail if a repo-relative path matches. These are the internal
   newsroom artifacts that must never live in the public repo. */
const PATH_RULES = [
  { re: /(^|\/)briefs\//i, label: 'briefs/ (internal daily briefs)' },
  { re: /(^|\/)registers\//i, label: 'registers/ (internal intake registers)' },
  { re: /(^|\/)state\//i, label: 'state/ (internal run state / secrets)' },
  { re: /(^|\/)outbox\//i, label: 'outbox/ (internal outbound queue)' },
  { re: /(^|\/)pipeline\//i, label: 'pipeline/ (internal leads pipeline)' },
  { re: /(^|\/)archive\//i, label: 'archive/ (internal archive)' },
  { re: /HANDOFF/i, label: 'HANDOFF (internal session handoff)' },
  { re: /MASTER-CONTEXT/i, label: 'MASTER-CONTEXT (internal research pack)' },
  { re: /ledger/i, label: 'ledger (internal feedback ledger)' },
  { re: /(^|\/)leads\.(csv|md|json)$/i, label: 'leads.* (internal leads list)' },
];

/* CONTENT rules - fail if a text file contains the pattern. Targeted at real
   internal markers so ordinary prose ("investigate", "the council will") passes. */
const CONTENT_RULES = [
  { re: /^\s*gate:\s*true/mi, label: 'gate: true (a gated decision package leaked)' },
  { re: /^\s*gate:\s*(false|true)/mi, label: 'gate: frontmatter field (internal)' },
  { re: /^\s*(audit|decision_points|comment_targets|edit_note|byline_desk|edited_by|tier|alert_sent|status):/mi,
    label: 'internal STORY-TEMPLATE frontmatter field' },
  { re: />\s*\*\*GATE\b|(^|\s)GATE\s+[—-]\s+internal/m, label: 'GATE decision block (internal)' },
  { re: /#gate\b|hash-gate/i, label: '#gate tag (internal)' },
  { re: /\[(V|NV|SR)\]/, label: '[V]/[NV]/[SR] honesty tags (internal labeling)' },
  { re: /\*{4,}/, label: 'stray **** run (honesty tag stripped from bold — a conversion artifact)' },
  { re: /newsroom\/(state|briefs|registers|archive|outbox|pipeline|agents|standards)/i,
    label: 'internal newsroom/ path reference' },
  { re: /feedback-ledger|MASTER-CONTEXT|orchestrator-recap/i, label: 'internal filename reference' },
  { re: /github-token|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/i, label: 'a token / secret' },
];

const TEXT_EXT = new Set(['.md', '.markdown', '.html', '.htm', '.js', '.mjs', '.json', '.css',
  '.txt', '.xml', '.yml', '.yaml', '.csv', '.svg']);

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else if (e.isFile()) {
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`verify-clean: path not found: ${ROOT}`);
    process.exit(2);
  }
  const files = walk(ROOT, []);
  const violations = [];

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    for (const rule of PATH_RULES) {
      if (rule.re.test(rel)) violations.push({ file: rel, kind: 'path', label: rule.label });
    }
    // the guard itself defines these trigger strings as patterns; don't scan it.
    const isSelf = path.basename(abs) === 'verify-clean.js';
    if (!isSelf && TEXT_EXT.has(path.extname(abs).toLowerCase())) {
      let text;
      try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }
      for (const rule of CONTENT_RULES) {
        if (rule.re.test(text)) violations.push({ file: rel, kind: 'content', label: rule.label });
      }
    }
  }

  if (violations.length) {
    console.error(`\n✗ verify-clean FAILED — ${violations.length} internal-material violation(s) in ${ROOT}:\n`);
    for (const v of violations) {
      console.error(`  [${v.kind}] ${v.file}\n         → ${v.label}`);
    }
    console.error('\nThe public repo must contain ONLY publishable content + theme assets. Aborting.\n');
    process.exit(1);
  }
  console.log(`✓ verify-clean: ${files.length} files scanned, no internal material found.`);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { PATH_RULES, CONTENT_RULES };

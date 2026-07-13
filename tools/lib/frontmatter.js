'use strict';
/* ============================================================================
   frontmatter.js — a tiny, dependency-free YAML-subset parser for the
   Pothole News content pipeline. Handles exactly the shapes our frontmatter
   uses (both the internal STORY-TEMPLATE frontmatter and the clean public
   content frontmatter): scalars, block lists of scalars, block lists of maps,
   and one level of nested maps. NOT a general YAML parser — no anchors, flow
   collections, or block scalars (`|`/`>`); those are not used in our files.

   Shared by build-site.js (content → HTML) and publish_web.js (published → content)
   so both read frontmatter identically. Zero runtime deps — safe for the public
   repo's Cloudflare Pages build.
   ============================================================================ */

/* Split a markdown file into { data, body }. Frontmatter is the block between
   the first `---` and the next `---` on their own lines. */
function splitFrontmatter(raw) {
  const text = String(raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  return { data: parseBlock(m[1]), body: m[2] || '' };
}

/* Coerce a scalar token to a JS value. */
function scalar(v) {
  if (v == null) return null;
  let s = v.trim();
  if (s === '') return '';
  // strip a trailing inline comment only when unquoted (quotes may contain '#')
  if (s[0] !== '"' && s[0] !== "'") {
    const h = s.indexOf(' #');
    if (h !== -1) s = s.slice(0, h).trim();
  }
  if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'"))) {
    s = s.slice(1, -1);
    if (v.trim()[0] === '"') s = s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    return s;
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (s === '[]') return [];
  if (s === '{}') return {};
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/* Strip an unquoted YAML inline/whole-line comment from a value token, so a key
   with only a trailing `# comment` (and no real value) is correctly seen as an
   empty value (→ a nested block follows), not as a scalar whose value is the
   comment. Quoted values are left for scalar() (they may legitimately hold '#').
   Mirrors scalar()'s existing ' #' handling and adds the leading-'#' case. */
function commentless(s) {
  if (!s) return s;
  if (s[0] === '"' || s[0] === "'") return s;   // quoted → scalar() handles it
  if (s[0] === '#') return '';                   // value is entirely a comment
  const h = s.indexOf(' #');
  return h === -1 ? s : s.slice(0, h).trim();
}

/* Parse a block of `key: value` / list lines into an object. Recursive on
   indentation. Lines are pre-split; we consume by tracking indent depth. */
function parseBlock(block) {
  const lines = block.split('\n');
  // strip blank + comment-only lines but keep indentation of content lines
  const rows = [];
  for (const ln of lines) {
    if (/^\s*$/.test(ln)) continue;
    if (/^\s*#/.test(ln)) continue;
    rows.push({ indent: ln.match(/^\s*/)[0].length, text: ln.trim(), raw: ln });
  }
  const [val] = parseNode(rows, 0, rows.length > 0 ? rows[0].indent : 0);
  return val || {};
}

/* Parse the run of rows [i..end) that sit at >= `indent`. Returns [value, nextIndex].
   A run is a list if its first row starts with "- ", else a map. */
function parseNode(rows, i, indent) {
  if (i >= rows.length) return [null, i];
  const isList = rows[i].text.startsWith('- ');
  if (isList) return parseList(rows, i, indent);
  return parseMap(rows, i, indent);
}

function parseMap(rows, i, indent) {
  const obj = {};
  while (i < rows.length && rows[i].indent === indent && !rows[i].text.startsWith('- ')) {
    const row = rows[i];
    const c = row.text.indexOf(':');
    if (c === -1) { i++; continue; }
    const key = row.text.slice(0, c).trim();
    const rest = commentless(row.text.slice(c + 1).trim());
    if (rest !== '') {
      obj[key] = scalar(rest);
      i++;
    } else {
      // nested block: children are the rows deeper than this key
      const childStart = i + 1;
      if (childStart < rows.length && rows[childStart].indent > indent) {
        const childIndent = rows[childStart].indent;
        const [val, next] = parseNode(rows, childStart, childIndent);
        obj[key] = val;
        i = next;
      } else {
        obj[key] = null;
        i++;
      }
    }
  }
  return [obj, i];
}

function parseList(rows, i, indent) {
  const arr = [];
  while (i < rows.length && rows[i].indent === indent && rows[i].text.startsWith('- ')) {
    const row = rows[i];
    const after = row.text.slice(2); // drop "- "
    const c = firstColon(after);
    if (c !== -1) {
      // list item is a map: reconstruct the first key on this line, then any
      // deeper-indented sibling keys belong to the same item.
      const item = {};
      const key = after.slice(0, c).trim();
      const rest = commentless(after.slice(c + 1).trim());
      const itemKeyIndent = indent + 2;
      if (rest !== '') item[key] = scalar(rest);
      else {
        // value is a nested block under this key
        const cs = i + 1;
        if (cs < rows.length && rows[cs].indent > itemKeyIndent) {
          const [v, n] = parseNode(rows, cs, rows[cs].indent);
          item[key] = v; i = n - 1;
        } else item[key] = null;
      }
      i++;
      // absorb following keys at itemKeyIndent (same map item)
      while (i < rows.length && rows[i].indent === itemKeyIndent && !rows[i].text.startsWith('- ')) {
        const r2 = rows[i];
        const c2 = r2.text.indexOf(':');
        if (c2 === -1) { i++; continue; }
        const k2 = r2.text.slice(0, c2).trim();
        const v2 = commentless(r2.text.slice(c2 + 1).trim());
        if (v2 !== '') { item[k2] = scalar(v2); i++; }
        else {
          const cs2 = i + 1;
          if (cs2 < rows.length && rows[cs2].indent > itemKeyIndent) {
            const [v, n] = parseNode(rows, cs2, rows[cs2].indent);
            item[k2] = v; i = n;
          } else { item[k2] = null; i++; }
        }
      }
      arr.push(item);
    } else {
      // list item is a scalar
      arr.push(scalar(after));
      i++;
    }
  }
  return [arr, i];
}

/* index of the first ':' that acts as a key separator (followed by space or EOL),
   ignoring ':' inside a quoted span or inside '://' (URLs). */
function firstColon(s) {
  let q = null;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === ':') {
      const nxt = s[k + 1];
      if (nxt === undefined || nxt === ' ') {
        if (s.slice(k, k + 3) === '://') continue; // URL, not a key sep
        return k;
      }
    }
  }
  return -1;
}

/* Serialize a JS object to our frontmatter YAML subset (for publish_web.js). */
function stringify(data) {
  const out = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out.push(emit(k, v, 0));
  }
  return out.join('\n') + '\n';
}

function emit(key, val, depth) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(val)) {
    if (val.length === 0) return `${pad}${key}: []`;
    const lines = [`${pad}${key}:`];
    for (const item of val) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item).filter(([, vv]) => vv !== undefined);
        entries.forEach(([ik, iv], idx) => {
          const prefix = idx === 0 ? `${pad}  - ` : `${pad}    `;
          lines.push(`${prefix}${ik}: ${fmtScalar(iv)}`);
        });
      } else {
        lines.push(`${pad}  - ${fmtScalar(item)}`);
      }
    }
    return lines.join('\n');
  }
  if (val && typeof val === 'object') {
    const lines = [`${pad}${key}:`];
    for (const [ik, iv] of Object.entries(val)) {
      if (iv === undefined) continue;
      lines.push(emit(ik, iv, depth + 1));
    }
    return lines.join('\n');
  }
  return `${pad}${key}: ${fmtScalar(val)}`;
}

function fmtScalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return '""';
  // quote when the scalar could be misread (has ':', '#', leading special, quotes, etc.)
  if (/[:#]|^[\s>&*!|%@`"'-]|[\n"]/.test(s) || /^(true|false|null|~)$/.test(s) || /^-?\d/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  }
  return s;
}

module.exports = { splitFrontmatter, parseBlock, stringify, scalar };

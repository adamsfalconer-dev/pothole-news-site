'use strict';
/* ============================================================================
   markdown.js - a tiny, dependency-free Markdown to HTML converter scoped to the
   prose our story bodies use: paragraphs, ##/### subheads, **bold**, *italic*,
   [links](url), `code`, > blockquotes, - / 1. lists, and --- rules. Not CommonMark;
   deliberately small and auditable for the public repo's zero-dep Pages build.
   All text is HTML-escaped before inline formatting is applied, so post content
   can never inject markup.
   ============================================================================ */

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SENT = '\u0000'; // collision-proof placeholder delimiter for code spans

/* Inline formatting on an already-block-split line (raw markdown text). */
function inline(text) {
  // 1. protect + render inline code spans first (no formatting inside them)
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push('<code>' + escapeHtml(c) + '</code>');
    return SENT + (codes.length - 1) + SENT;
  });
  // 2. escape the rest
  s = escapeHtml(s);
  // 3. links [text](url) - url attribute-escaped; only http(s), mailto, /, # allowed
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
    if (!/^(https?:\/\/|mailto:|\/|#)/.test(url)) return m;
    const ext = /^https?:\/\//.test(url);
    return '<a href="' + escapeAttr(url) + '"' + (ext ? ' rel="noopener"' : '') + '>' + txt + '</a>';
  });
  // 4. bold then italic (bold first so ** is not eaten by *)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  // 5. restore code spans
  s = s.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (_, i) => codes[+i]);
  return s;
}

function toHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
  };

  while (i < lines.length) {
    const t = lines[i].trim();

    if (t === '') { flushPara(); i++; continue; }

    // horizontal rule
    if (/^([-*_])\1{2,}$/.test(t)) { flushPara(); out.push('<hr>'); i++; continue; }

    // heading  #..###### -> clamp to h2..h4 (the page owns the single h1)
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const lvl = Math.min(4, Math.max(2, h[1].length + 1));
      out.push(`<h${lvl}>` + inline(h[2].trim()) + `</h${lvl}>`);
      i++; continue;
    }

    // blockquote (consecutive `>` lines)
    if (/^>\s?/.test(t)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }

    // unordered list
    if (/^[-*+]\s+/.test(t)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(t)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ol>' + items.join('') + '</ol>');
      continue;
    }

    // paragraph line
    para.push(t);
    i++;
  }
  flushPara();
  return out.join('\n');
}

module.exports = { toHtml, inline, escapeHtml, escapeAttr };

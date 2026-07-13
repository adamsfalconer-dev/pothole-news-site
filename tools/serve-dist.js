'use strict';
/* Tiny static file server for a built dist/ (dev aid: local preview + Lighthouse).
     node tools/serve-dist.js [dir] [port]     default: ./dist on :4322
   Clean URLs: '/foo/' -> foo/index.html ; unknown paths -> 404.html (status 404). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
const PORT = Number(process.argv[3] || process.env.PORT || 4322);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(DIR, url);
  if (url.endsWith('/')) file = path.join(DIR, url, 'index.html');
  if (!path.extname(file) && !url.endsWith('/')) file = path.join(DIR, url, 'index.html');
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  const nf = path.join(DIR, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
}).listen(PORT, () => console.log(`dist → http://localhost:${PORT}/  (serving ${DIR})`));

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createStaticFileServer({ root, mimeTypes }) {
  const publicRoot = path.resolve(root);

  return function serveFile(req, res, pathname) {
    const cleanPath = pathname === '/' ? '/index.html' : (pathname === '/admin' ? '/admin.html' : pathname);
    const filePath = path.resolve(publicRoot, cleanPath.replace(/^\/+/, ''));
    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const etag = `"${data.length}-${crypto.createHash('md5').update(data).digest('hex').slice(0, 8)}"`;
      const headers = {
        'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'ETag': etag,
      };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': data.length });
      res.end(data);
    });
  };
}

module.exports = { createStaticFileServer };

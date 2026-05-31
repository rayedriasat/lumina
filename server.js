/**
 * Lumina One-Time Local Server
 * Zero dependencies. Just Node.js.
 * Run: node server.js
 * Then open http://localhost:3321 in Chrome/Edge.
 * Install the PWA, then you can stop this server.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3321;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.vtt': 'text/vtt',
  '.srt': 'text/plain'
};

const server = http.createServer((req, res) => {
  let filePath = '.' + decodeURIComponent(req.url);
  if (filePath === './') filePath = './index.html';

  const ext = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        // SPA fallback for client-side routing
        if (req.url.indexOf('.') === -1) {
          fs.readFile('./index.html', (e2, c2) => {
            if (e2) {
              res.writeHead(500); res.end('Server Error');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(c2, 'utf-8');
            }
          });
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Sorry, server error: ' + error.code + ' ..\n');
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n✨ Lumina is running at http://localhost:${PORT}/`);
  console.log('👉 Open that URL in Chrome or Edge.');
  console.log('📲 Click the install icon in the browser’s address bar to add it as a standalone app.');
  console.log('🛑 After installing, you can stop this server with Ctrl+C.');
  console.log('   The installed PWA will continue to work offline thanks to the Service Worker.\n');
});

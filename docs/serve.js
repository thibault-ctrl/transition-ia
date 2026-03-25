const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 8080;
const dir = __dirname;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(dir, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType };
    if (ext === '.mp3') {
      headers['Accept-Ranges'] = 'bytes';
      headers['Content-Length'] = data.length;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}).listen(port, () => {
  console.log(`Serving on http://localhost:${port}`);
});

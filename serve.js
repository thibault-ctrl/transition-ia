const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8081;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function proxyRequest(targetUrl, res) {
  const parsed = new URL(targetUrl);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    // Follow redirects
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      return proxyRequest(proxyRes.headers.location, res);
    }
    let data = [];
    proxyRes.on('data', chunk => data.push(chunk));
    proxyRes.on('end', () => {
      const body = Buffer.concat(data);
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    });
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

  proxyReq.end();
}

http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // PROXY: /proxy/pidf?q=...  → Shopify search
  if (pathname === '/proxy/pidf/search') {
    const q = parsedUrl.query.q || '';
    const targetUrl = `https://les-plantes-ile-de-france.com/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`;
    return proxyRequest(targetUrl, res);
  }

  // PROXY: /proxy/pidf/product?handle=...  → Shopify product JSON
  if (pathname === '/proxy/pidf/product') {
    const handle = parsedUrl.query.handle || '';
    const targetUrl = `https://les-plantes-ile-de-france.com/products/${encodeURIComponent(handle)}.json`;
    return proxyRequest(targetUrl, res);
  }

  // PROXY: /proxy/pidf/page?handle=...  → Shopify product HTML page (to extract pot sizes)
  if (pathname === '/proxy/pidf/page') {
    const handle = parsedUrl.query.handle || '';
    const targetUrl = `https://les-plantes-ile-de-france.com/products/${encodeURIComponent(handle)}`;
    return proxyRequest(targetUrl, res);
  }

  // PROXY: /proxy/fleur?q=...  → Fleur Pro search
  if (pathname === '/proxy/fleur') {
    const q = parsedUrl.query.q || '';
    const targetUrl = `https://www.fleurproshop.com/fr/recherche/?search=${encodeURIComponent(q)}`;
    return proxyRequest(targetUrl, res);
  }

  // STATIC FILES
  let filePath = pathname;
  if (filePath === '/') filePath = '/pepiniquote.html';
  if (!path.extname(filePath)) filePath += '.html';
  let fullPath = path.join(DIR, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      fullPath = path.join(DIR, pathname);
      return fs.readFile(fullPath, (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(fullPath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data2);
      });
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(data);
  });
}).listen(PORT, () => console.log('Server running on http://localhost:' + PORT));

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8081;
const DIR = __dirname;

// Load .env file for API key
let ANTHROPIC_API_KEY = '';
try {
  const envContent = fs.readFileSync(path.join(DIR, '.env'), 'utf8');
  const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/);
  if (match) ANTHROPIC_API_KEY = match[1].trim();
} catch(e) {}

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

  // CONFIG: return API key from .env
  if (pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ apiKey: ANTHROPIC_API_KEY }));
    return;
  }

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

  // PROXY: /proxy/pidf/live-search?q=...  → Real-time search in PIDF products
  if (pathname === '/proxy/pidf/live-search') {
    const q = (parsedUrl.query.q || '').toLowerCase();
    const terms = q.split(/\s+/).filter(t => t.length > 2);
    if (!terms.length) { res.writeHead(400); res.end('{}'); return; }

    // Fetch all products from Shopify JSON API (not blocked by Cloudflare)
    (async () => {
      try {
        const results = [];
        let page = 1;
        while (page <= 2) { // max 2 pages = 500 products
          const resp = await fetch(`https://les-plantes-ile-de-france.com/products.json?limit=250&page=${page}`);
          const data = await resp.json();
          if (!data.products || !data.products.length) break;

          for (const p of data.products) {
            const titleLower = p.title.toLowerCase();
            // Check if any search term matches the product title
            const matches = terms.filter(t => titleLower.includes(t));
            if (matches.length === 0) continue;

            for (const v of p.variants) {
              results.push({
                name: p.title,
                handle: p.handle,
                variant: v.title,
                price: parseFloat(v.price),
                variantId: v.id,
                available: v.available,
                score: matches.length / terms.length
              });
            }
          }
          page++;
          if (data.products.length < 250) break;
        }

        // Sort by score desc, price asc
        results.sort((a, b) => b.score - a.score || a.price - b.price);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify({ products: results.slice(0, 30) }));
      } catch (err) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: err.message }));
      }
    })();
    return;
  }

  // PROXY: /proxy/fleur?q=...  → Fleur Pro search (with auth)
  if (pathname === '/proxy/fleur') {
    const q = parsedUrl.query.q || '';
    (async () => {
      try {
        // Step 1: Login to get session cookie
        if (!global._fleurCookies) {
          // Get login page for session cookie
          const loginPage = await fetch('https://www.fleurproshop.com/fr/connexion/');
          const cookies = loginPage.headers.getSetCookie ? loginPage.headers.getSetCookie() : [];
          const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');

          // Submit login with correct field names
          const authResp = await fetch('https://www.fleurproshop.com/fr/connexion/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Cookie': sessionCookie
            },
            body: 'login%5Bemail%5D=planteidf%40gmail.com&login%5Bpassword%5D=D2690',
            redirect: 'manual'
          });
          const authCookies = authResp.headers.getSetCookie ? authResp.headers.getSetCookie() : [];
          global._fleurCookies = [sessionCookie, ...authCookies.map(c => c.split(';')[0])].join('; ');
          console.log('Fleur Pro login:', authResp.status, 'cookies:', authCookies.length);
        }

        // Step 2: Search (correct URL is /fr/assortiment/?s=)
        const searchUrl = 'https://www.fleurproshop.com/fr/assortiment/?s=' + encodeURIComponent(q);
        const searchResp = await fetch(searchUrl, {
          headers: { 'Cookie': global._fleurCookies }
        });
        const html = await searchResp.text();
        console.log('Fleur HTML size:', html.length, 'has C 5L:', html.includes('C 5L'));

        // Step 3: Parse results from HTML
        const products = [];
        // Extract product names
        const prodNames = [...html.matchAll(/>([A-Z][a-z]+[^<]{5,80}(?:fraseri|japonica|sinensis|europaea|varieta|banksiae|officinalis|lamarckii|palmatum)[^<]*)<\//gi)];
        let currentName = '';

        // Extract sizes and prices using the table structure
        const sizeMatches = [...html.matchAll(/>(C\s*\d+[^<]{0,20}L?|P\d+)[^<]*<\/td>/gi)];
        const priceMatches = [...html.matchAll(/€\s*([\d,]+)\s*<sup>(\d+)<\/sup>/g)];

        // Simpler approach: find all product blocks
        const text = html.replace(/<\/?\w[^>]*>/g, '\n').replace(/&euro;/gi, '€').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#\d+;/g, ' ').replace(/&\w+;/g, ' ');
        const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);

        for (let i = 0; i < lines.length; i++) {
          // Product name
          if (lines[i].match(/^[A-Z][a-z]/) && lines[i].length > 10 && lines[i].length < 120 && !lines[i].match(/^(Taille|Photo|Prix|Quantit|Votre|Nom|Hauteur|Dispo|Plus d|STARTPRIJS|zt\d|Recherche|Afficher|Liste|Trier|Actions|Description|Jardinerie|Jeunes|Garden|Produit|Cacher)/)) {
            currentName = lines[i].trim();
          }
          // Size pattern: C 5L, P27, C 40CM DT
          if (lines[i].match(/^C\s*\d|^P\d/i) && lines[i].length < 30 && currentName) {
            const taille = lines[i].trim();
            // Find price in next few lines
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
              const priceMatch = lines[j].match(/['>€\s]([\d]+[,.][\d]+)/);
              if (priceMatch && parseFloat(priceMatch[1].replace(',', '.')) > 1) {
                const price = parseFloat(priceMatch[1].replace(',', '.'));
                const potMatch = taille.match(/(\d+)\s*L/i);
                const potSize = potMatch ? potMatch[1] : '';
                const heightMatch = taille.match(/(\d{2,3}\/[\d+]+)/);
                const formeMatch = taille.match(/\b(DT|TIGE)\b/i);
                products.push({
                  name: currentName + ' ' + taille,
                  price, potSize,
                  potSizeNum: potSize ? parseInt(potSize) : 0,
                  height: heightMatch ? heightMatch[1] : '',
                  forme: formeMatch ? formeMatch[1] : ''
                });
                break;
              }
            }
          }
        }

        console.log('Fleur parsed:', products.length, 'products');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ products: products.slice(0, 30) }));
      } catch (err) {
        res.writeHead(502);
        res.end(JSON.stringify({ error: err.message }));
      }
    })();
    return;
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

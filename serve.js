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
  const gmailMatch = envContent.match(/GMAIL_APP_PASSWORD=(.+)/);
  if (gmailMatch) process.env.GMAIL_APP_PASSWORD = gmailMatch[1].trim();
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

  // FEEDBACK: send email with improvement idea
  if (pathname === '/api/feedback' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message } = JSON.parse(body);
        if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: 'Message vide' })); return; }

        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: 'planteidf@gmail.com', pass: process.env.GMAIL_APP_PASSWORD || '' }
        });

        await transporter.sendMail({
          from: 'PepiniQuote <planteidf@gmail.com>',
          to: 'thibault@planteidf.fr',
          subject: '💡 Idée d\'amélioration PepiniQuote',
          text: 'Nouvelle suggestion :\n\n' + message + '\n\n---\nEnvoyé depuis PepiniQuote',
          html: '<h3>💡 Nouvelle idée d\'amélioration</h3><p>' + message.replace(/\n/g, '<br>') + '</p><hr><small>Envoyé depuis PepiniQuote</small>'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Feedback email error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
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
        { // Login fresh each time
          const loginPage = await fetch('https://www.fleurproshop.com/fr/connexion/');
          const c1 = loginPage.headers.getSetCookie().map(c => c.split(';')[0]);
          const authResp = await fetch('https://www.fleurproshop.com/fr/connexion/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': c1.join('; ') },
            body: 'login%5Bemail%5D=planteidf%40gmail.com&login%5Bpassword%5D=D2690',
            redirect: 'manual'
          });
          global._fleurCookies = authResp.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
          console.log('Fleur login:', authResp.status);
        }

        // Step 2: Search (correct URL is /fr/assortiment/?s=)
        const searchUrl = 'https://www.fleurproshop.com/fr/assortiment/?s=' + encodeURIComponent(q);
        const searchResp = await fetch(searchUrl, {
          headers: { 'Cookie': global._fleurCookies }
        });
        const html = await searchResp.text();
        // Step 3: Parse - convert to text then find patterns
        const products = [];
        const text = html.replace(/<\/?\w[^>]*>/g, '\n').replace(/&euro;/gi, '€').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#\d+;/g, ' ').replace(/&\w+;/g, ' ');
        const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

        let currentName = '';
        const sizeLines = lines.filter(l => /^(C|P)\s*[\d,]/i.test(l) && l.length < 35);
        const nameLines = lines.filter(l => /^[A-Z][a-z]+\s+(x?[a-z]|'[A-Z])/.test(l) && l.length > 8 && l.length < 100);
        console.log('Fleur lines:', lines.length, 'sizes:', sizeLines.length, 'names:', nameLines.length);
        if (nameLines.length > 0) console.log('  First name:', nameLines[0]);
        if (sizeLines.length > 0) console.log('  First size:', sizeLines[0]);
        const priceLines = lines.filter(l => l.match(/'>[\d]+,[\d]+/));
        console.log('  Price lines:', priceLines.length);
        if (priceLines.length > 0) console.log('  First price:', priceLines[0].substring(0, 40));
        for (let i = 0; i < lines.length; i++) {
          // Track product names (from product-name td content)
          // Product names are Latin binomials like "Lavandula stoechas"
          if (/^[A-Z][a-z]{3,}\s+(x?[a-z]{3,}|'[A-Z])/.test(lines[i]) && lines[i].length > 8 && lines[i].length < 100 && !/^(Des |Pour |Vous |Votre |Recherche|Afficher|Toutes|Jardinerie|Conditions|Service|Livraison|Copyright|Website|Newsletter)/.test(lines[i])) {
            currentName = lines[i].trim();
          }
          // Size line: starts with C or P followed by digit
          if (/^(C|P)\s*[\d,]/i.test(lines[i]) && lines[i].length < 35 && currentName) {
            const taille = lines[i].trim();
            // Search forward for price pattern '>X,XX
            for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
              const m = lines[j].match(/'>(\d+,\d+)/);
              if (m) {
                const price = parseFloat(m[1].replace(',', '.'));
                if (price > 0.5) {
                  const potMatch = taille.match(/(\d+)\s*L/i);
                  const potSize = potMatch ? potMatch[1] : '';
                  const heightMatch = taille.match(/(\d{2,3}\/[\d+]+)/);
                  const formeMatch = taille.match(/\b(DT|TIGE|BOULE|CONE|ARC|PYRAMIDE|CHAMPIGNON)\b/i);
                  products.push({
                    name: currentName + ' ' + taille,
                    price, potSize,
                    potSizeNum: potSize ? parseInt(potSize) : 0,
                    height: heightMatch ? heightMatch[1] : '',
                    forme: formeMatch ? formeMatch[1] : ''
                  });
                }
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

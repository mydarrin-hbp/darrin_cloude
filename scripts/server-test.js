// scripts/server-test.js — server local pentru testele din browser (pasul 11-A, 17 oct. 2026)
//
// Servește fișierele site-ului (cu cleanUrls: /cum-platesc → cum-platesc.html)
// și răspunde la câteva API-uri publice cu date simulate, ca paginile să se
// poată verifica fără `vercel dev` și fără acces la producție:
//   /api/public/reguli-platforma  → REGULI_SIMULATE (sau 503 cu REGULI=off)
//   /api/public/tari-active       → aceleași țări
//   orice alt /api/...            → 503 (paginile trebuie să se randeze și așa)
// Datele simulate urmează auditul live din 16 oct. 2026 (checkout activ în
// RO, AT, BG, GR, GB, MD) și deciziile LM din 17 oct. (24 h, 6 zile); nu sunt
// citite din baza de date.
//
// Utilizare:
//   node scripts/server-test.js [--port 3000]       (Ctrl+C oprește serverul)
//   const { porneste } = require('./server-test'); const srv = await porneste(0);

const http = require('http');
const fs = require('fs');
const path = require('path');

const RADACINA = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

const TARI = [
  ['AT', 'Austria', 'EUR', null], ['BG', 'Bulgaria', 'EUR', null], ['GB', 'Marea Britanie', 'GBP', null],
  ['GR', 'Grecia', 'EUR', null], ['MD', 'Moldova', 'MDL', null], ['RO', 'România', 'RON', 100],
];
const REGULI_SIMULATE = {
  ok: true,
  tari: TARI.map(([tara_cod, tara_nume, moneda, prag]) => ({ tara_cod, tara_nume, moneda, prag_minim_comanda: prag, metode_plata: ['card'], termen_plata_partener_zile: 6 })),
  metode_plata: ['card'],
  confirmare_tacita_ore: 24,
  termen_plata_partener_zile: 6,
  entitati: [{ denumire: 'Home Best Pal SRL', tara_cod: 'RO' }],
};

function json(res, cod, corp) {
  res.writeHead(cod, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corp));
}

function cerere(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    if (p === '/api/public/reguli-platforma') {
      return process.env.REGULI === 'off' ? json(res, 503, { error: 'indisponibil' }) : json(res, 200, REGULI_SIMULATE);
    }
    if (p === '/api/public/tari-active') {
      return json(res, 200, { ok: true, active: TARI.map((t) => t[0]), tari: TARI.map(([tara_cod, tara_nume]) => ({ tara_cod, tara_nume })), tva: { RO: 21 } });
    }
    // Mesajul e în engleză: paginile îl pot afișa ca eroare de server, iar
    // detectorul de română (modul EN) nu trebuie să-l numere ca text al paginii.
    return json(res, 503, { error: 'API unavailable on the test server' });
  }
  let f = path.join(RADACINA, p === '/' ? 'index.html' : p);
  if (!f.startsWith(RADACINA)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

function porneste(port) {
  return new Promise((ok) => { const s = http.createServer(cerere).listen(port, () => ok(s)); });
}

module.exports = { porneste, REGULI_SIMULATE };

if (require.main === module) {
  const i = process.argv.indexOf('--port');
  const port = i !== -1 ? Number(process.argv[i + 1]) : 3000;
  porneste(port).then((s) => console.log(`server de test: http://localhost:${s.address().port}`));
}

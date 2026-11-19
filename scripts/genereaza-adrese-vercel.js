// scripts/genereaza-adrese-vercel.js — rewrites și redirects din vercel.json (pasul 12-U1)
//
// Scrie în vercel.json regulile adreselor curate din lib/adrese-curate.js
// (sursa unică). Regulile fixe de mai jos (pagina de start, coșul,
// mydarrin-v3, domeniile admin./api.) rămân neschimbate.
//
// De ce nu există reguli pentru „/x.html”: cu cleanUrls, Vercel trimite
// singur /x.html → /x (308) ÎNAINTEA redirecturilor din vercel.json și a
// middleware-ului (verificat în producție, 19 nov. 2026), deci o regulă pe
// /x.html n-ar fi folosită niciodată.
//
// Utilizare: node scripts/genereaza-adrese-vercel.js [--verifica]
//   --verifica → nu scrie nimic; iese cu 1 dacă vercel.json nu e la zi.

const fs = require('fs');
const path = require('path');
const A = require('../lib/adrese-curate');

const FISIER = path.join(__dirname, '..', 'vercel.json');

const REWRITES_FIXE = [
  { source: '/', destination: '/index.html' },
  { source: '/index', destination: '/index.html' },
  { source: '/home', destination: '/index.html' },
  { source: '/cos', destination: '/mydarrin-checkout.html' },
];

const REDIRECTS_FIXE = [
  { source: '/mydarrin-v3.html', destination: '/', permanent: true },
  { source: '/mydarrin-v3', destination: '/', permanent: true },
  { source: '/mydarrin-v3/', destination: '/', permanent: true },
  { source: '/', has: [{ type: 'host', value: 'admin.mydarrin.homebestpal.com' }], destination: '/mydarrin-superadmin.html', permanent: false },
  { source: '/', has: [{ type: 'host', value: 'api.mydarrin.homebestpal.com' }], destination: '/api/health', permanent: false },
];

// Adresele vechi ale pasului 11-C4 cu parametru în cale (fără tipul produsului,
// care trebuie normalizat — /catalog/:tip/:categorie/:slug e tratat în middleware.js).
const REDIRECTS_PARAMETRU = [
  { source: '/catalog/servicii/:categorie', destination: '/servicii?subcategorie=:categorie', statusCode: 301 },
  { source: '/catalog/materiale/:categorie', destination: '/materiale?subcategorie=:categorie', statusCode: 301 },
  { source: '/catalog/inchirieri/:categorie', destination: '/inchirieri?subcategorie=:categorie', statusCode: 301 },
  { source: '/inchiriere/:slug', destination: '/inchirieri?subcategorie=:slug', statusCode: 301 },
];

function reguli() {
  const r = A.reguliVercel();
  return {
    rewrites: REWRITES_FIXE.concat(r.rewrites),
    redirects: r.redirects.concat(REDIRECTS_PARAMETRU, REDIRECTS_FIXE),
  };
}

function genereaza(text) {
  const cfg = JSON.parse(text);
  const r = reguli();
  cfg.rewrites = r.rewrites;
  cfg.redirects = r.redirects;
  return JSON.stringify(cfg, null, 2) + '\n';
}

module.exports = { reguli, genereaza, REDIRECTS_PARAMETRU };

if (require.main === module) {
  const vechi = fs.readFileSync(FISIER, 'utf8');
  const nou = genereaza(vechi);
  if (process.argv.includes('--verifica')) {
    const egal = JSON.stringify(JSON.parse(vechi)) === JSON.stringify(JSON.parse(nou));
    console.log(egal ? 'vercel.json e la zi' : 'vercel.json NU e la zi: rulează node scripts/genereaza-adrese-vercel.js');
    process.exit(egal ? 0 : 1);
  }
  fs.writeFileSync(FISIER, nou);
  const r = reguli();
  console.log(`vercel.json: ${r.rewrites.length} rewrites, ${r.redirects.length} redirects`);
}

// scripts/genereaza-slug-uri-categorii.js — regenerează scripts/date-test/slug-uri-categorii.json (pasul 12-U1b)
//
// Citește categoriile din API-ul public (/api/public/categorii, doar GET) și scrie
// lista de slug-uri pe filă, folosită de scripts/test-linkuri-interne.js.
// Testul în sine nu se conectează la nimic; acest script se rulează doar la cerere:
//   node scripts/genereaza-slug-uri-categorii.js https://<adresa-site-ului>
// Dacă API-ul întoarce o listă goală pentru o filă, scriptul nu scrie nimic.

const fs = require('fs');
const path = require('path');

const baza = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(baza)) {
  console.error('Dă adresa site-ului: node scripts/genereaza-slug-uri-categorii.js https://…');
  process.exit(2);
}
const FISIER = path.join(__dirname, 'date-test', 'slug-uri-categorii.json');

(async () => {
  const out = { generat: new Date().toISOString().slice(0, 10), sursa: baza + '/api/public/categorii' };
  for (const tip of ['servicii', 'materiale', 'inchirieri']) {
    const r = await fetch(`${baza}/api/public/categorii?tip=${tip}&lang=ro`);
    if (!r.ok) { console.error(`${tip}: HTTP ${r.status}`); process.exit(1); }
    const j = await r.json();
    out[tip] = (j.categorii || []).map((c) => c.slug).sort();
    if (!out[tip].length) { console.error(`${tip}: lista e goală, nu scriu nimic`); process.exit(1); }
  }
  fs.writeFileSync(FISIER, JSON.stringify(out, null, 2) + '\n');
  console.log('Scris ' + FISIER);
})();

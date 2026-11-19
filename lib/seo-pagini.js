// lib/seo-pagini.js
// G22 — sursă unică a listei de pagini publice statice, stabile, eligibile
// pentru sitemap.xml și pentru panoul „SEO" din mydarrin-superadmin.html.
// Folosită de api/public/sitemap.xml.js și api/admin/seo.js — ține-le în
// sincron aici, nu în fiecare fișier separat.
//
// Pasul 12-U1 (19 nov. 2026): căile sunt adresele curate (lib/adrese-curate.js);
// datele SEO salvate pe adresele vechi se mută prin migrarea
// docs/migrations-propuse/2026-11-19_adrese-curate-seo.sql.
//
// Exclus deliberat: pagini individuale de serviciu/produs
// (/servicii/<serviciu> etc.) — nu au încă o listă stabilă pentru sitemap.
// Excluse și paginile tranzacționale/gated (/cont/*, checkout,
// reset-password, acces-temporar, confirmare-livrare, acord-confidentialitate).

const adrese = require('./adrese-curate');

const PAGINI = [
  { cale: '/', titlu: 'Homepage' },
  { cale: '/catalog', titlu: 'Catalog' },
  { cale: '/servicii', titlu: 'Catalog — Servicii' },
  { cale: '/materiale', titlu: 'Catalog — Materiale' },
  { cale: '/inchirieri', titlu: 'Catalog — Închirieri' },
  { cale: '/mydarrin-marketplace', titlu: 'Marketplace' },
  { cale: '/despre', titlu: 'Despre noi' },
  { cale: '/afla-ce-facem', titlu: 'Află ce facem' },
  { cale: '/ajutor', titlu: 'Cum funcționează' },
  { cale: '/parteneri', titlu: 'Devino partener' },
  { cale: '/parteneri/inscriere', titlu: 'Parteneri — Înscriere' },
  { cale: '/parteneri/servicii', titlu: 'Parteneri — Furnizor de servicii' },
  { cale: '/parteneri/materiale', titlu: 'Parteneri — Furnizor de materiale' },
  { cale: '/parteneri/inchirieri', titlu: 'Parteneri — Operator de închirieri' },
  { cale: '/parteneri/curieri', titlu: 'Parteneri — Curier de cartier' },
  { cale: '/parteneri/asigurari', titlu: 'Parteneri — Ghidul asigurătorului' },
  { cale: '/parteneri/intrebari', titlu: 'Parteneri — Întrebări frecvente' },
  { cale: '/investitori', titlu: 'Investitori' },
  { cale: '/ajutor/cum-comand', titlu: 'Cum comanzi' },
  { cale: '/ajutor/cum-platesc', titlu: 'Cum plătesc' },
  { cale: '/ajutor/livrare', titlu: 'Cum prestăm/livrăm' },
  { cale: '/ajutor/programare', titlu: 'Cum programez un serviciu' },
  { cale: '/urgente', titlu: 'Servicii urgente' },
  { cale: '/garantii', titlu: 'Garanții & Asigurări' },
  { cale: '/intrebari', titlu: 'Întrebări Frecvente — Clienți' },
  { cale: '/reclamatii', titlu: 'Reclamații' },
  { cale: '/deviz', titlu: 'Creează deviz' },
  { cale: '/termeni', titlu: 'Termeni & Condiții' },
  { cale: '/confidentialitate', titlu: 'Politica de Confidențialitate' },
  { cale: '/mydarrin-app-mobile', titlu: 'Aplicația Mobilă' },
  { cale: '/contact', titlu: 'Contact' },
];

module.exports = { PAGINI };

// ── Pasul 11-S (23 oct. 2026): SEO pe limbă ─────────────────────────────
// Limba unei suprascrieri: 'ro' → RO; orice altă limbă din selector
// (en, bg, de, el, fr, tr) → EN — aceeași regulă ca la pitch deck.
function limbaSeo(l) {
  return String(l || '').toLowerCase().slice(0, 2) === 'ro' ? 'ro' : 'en';
}

// Căile vechi și fișierele servite → adresa curată pe care e salvată
// suprascrierea (ex. /cum-devii-curier-de-cartier, /curier-cartier → /parteneri/curieri).
const ALIASURI = { '/index': '/', '/home': '/' };
adrese.PAGINI.forEach((p) => {
  p.vechi.forEach((v) => { ALIASURI[v] = p.nou; });
  const f = '/' + p.fisier;
  if (!ALIASURI[f] && f !== p.nou) ALIASURI[f] = p.nou;
});

// Calea din URL → page_path din seo_config ('/despre-noi.html' → '/despre').
function caleSeo(pathname) {
  let c = String(pathname || '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  return ALIASURI[c] || c;
}

function esteCunoscuta(cale) {
  return PAGINI.some((p) => p.cale === cale);
}

module.exports.limbaSeo = limbaSeo;
module.exports.ALIASURI = ALIASURI;
module.exports.caleSeo = caleSeo;
module.exports.esteCunoscuta = esteCunoscuta;

// lib/seo-pagini.js
// G22 — sursă unică a listei de pagini publice statice, stabile, eligibile
// pentru sitemap.xml și pentru panoul „SEO" din mydarrin-superadmin.html.
// Folosită de api/public/sitemap.xml.js și api/admin/seo.js — ține-le în
// sincron aici, nu în fiecare fișier separat.
//
// Exclus deliberat: pagini individuale de serviciu/produs
// (mydarrin-produs.html) — nu au un identificator stabil în DB azi
// (catalog_servicii nu are coloană slug; produs.html se bazează pe
// PRODUCTS_DB, un obiect JS static — vezi G14). Excluse și paginile
// tranzacționale/gated (dashboard-uri, checkout, reset-password,
// acces-temporar, confirmare-livrare, acord-confidentialitate).

const PAGINI = [
  { cale: '/', titlu: 'Homepage' },
  { cale: '/mydarrin-catalog', titlu: 'Catalog' },
  { cale: '/mydarrin-marketplace', titlu: 'Marketplace' },
  { cale: '/despre-noi', titlu: 'Despre noi' },
  { cale: '/afla-ce-facem', titlu: 'Află ce facem' },
  { cale: '/mydarrin-cum-functioneaza', titlu: 'Cum funcționează' },
  { cale: '/partener', titlu: 'Devino Partener' },
  { cale: '/investitor', titlu: 'Investitori' },
  { cale: '/mydarrin-categorie-servicii', titlu: 'Categorie: Servicii' },
  { cale: '/mydarrin-categorie-materiale', titlu: 'Categorie: Materiale' },
  { cale: '/mydarrin-categorie-inchirieri', titlu: 'Categorie: Închirieri' },
  { cale: '/cum-comanzi', titlu: 'Cum comanzi' },
  { cale: '/cum-platesc', titlu: 'Cum plătesc' },
  { cale: '/cum-prestam-livram', titlu: 'Cum prestăm/livrăm' },
  { cale: '/cum-programez-serviciu', titlu: 'Cum programez un serviciu' },
  { cale: '/servicii-urgente', titlu: 'Servicii urgente' },
  { cale: '/curier-cartier', titlu: 'Devino Curier de Cartier' },
  { cale: '/cum-devii-furnizor-materiale', titlu: 'Devino Furnizor de Materiale' },
  { cale: '/cum-devii-operator-inchirieri', titlu: 'Devino Operator de Închirieri' },
  { cale: '/cum-devii-partenerul-nostru', titlu: 'Devino Partenerul Nostru' },
  { cale: '/garantii-si-asigurari', titlu: 'Garanții & Asigurări' },
  { cale: '/asigurator', titlu: 'Ghidul Asigurătorului' },
  { cale: '/intrebari-frecvente-clienti', titlu: 'Întrebări Frecvente — Clienți' },
  { cale: '/intrebari-frecvente-parteneri', titlu: 'Întrebări Frecvente — Parteneri' },
  { cale: '/reclamatii', titlu: 'Reclamații' },
  { cale: '/mydarrin-termeni', titlu: 'Termeni & Condiții' },
  { cale: '/mydarrin-politica-confidentialitate', titlu: 'Politica de Confidențialitate' },
  { cale: '/mydarrin-app-mobile', titlu: 'Aplicația Mobilă' },
  { cale: '/mydarrin-contact', titlu: 'Contact' },
  { cale: '/mydarrin-serviciu', titlu: 'Pagină Serviciu (generică)' },
];

module.exports = { PAGINI };

// ── Pasul 11-S (23 oct. 2026): SEO pe limbă ─────────────────────────────
// Limba unei suprascrieri: 'ro' → RO; orice altă limbă din selector
// (en, bg, de, el, fr, tr) → EN — aceeași regulă ca la pitch deck.
function limbaSeo(l) {
  return String(l || '').toLowerCase().slice(0, 2) === 'ro' ? 'ro' : 'en';
}

// Fișierele fizice ale scurtăturilor din lista de mai sus (middleware.js,
// PAGINA_STATICA): suprascrierea e salvată pe scurtătură.
const ALIASURI = {
  '/index': '/', '/home': '/',
  '/mydarrin-devino-partener': '/partener',
  '/mydarrin-investitori': '/investitor',
  '/cum-devii-curier-de-cartier': '/curier-cartier',
  '/ghidul-asiguratorului': '/asigurator',
};

// Calea din URL → page_path din seo_config ('/despre-noi.html' → '/despre-noi').
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

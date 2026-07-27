// /api/public/sitemap.xml.js
// G22 — sitemap real, generat live, DOAR pentru paginile publice statice
// stabile (marketing/ghiduri/legal/hub-uri de catalog).
//
// Exclus deliberat, onest: pagini individuale de serviciu/produs
// (mydarrin-produs.html) — nu au un identificator stabil în DB azi
// (catalog_servicii nu are coloană slug; produs.html se bazează pe
// PRODUCTS_DB, un obiect JS static, nu pe catalog_servicii — vezi G14).
// Adăugarea lor reală necesită mai întâi o coloană slug + o sursă unică
// de adevăr pentru catalog (gap separat, semnalat în Document de Lucru v2).
// Excluse și paginile tranzacționale/gated (dashboard-uri, checkout,
// reset-password, acces-temporar, confirmare-livrare,
// acord-confidentialitate) — fără valoare de indexare.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { PAGINI: PAGINI_BAZA } = require('../../lib/seo-pagini');

const BASE_URL = 'https://mydarrin.homebestpal.com';

// Prioritate SEO relativă per pagină (1.0 = homepage, scade pentru pagini
// mai puțin centrale) — listă separată de lib/seo-pagini.js (acolo e sursa
// unică pentru CARE pagini există; aici doar cât de „importantă" e fiecare).
const PRIORITATE = {
  '/': '1.0',
  '/mydarrin-catalog': '0.9',
  '/mydarrin-marketplace': '0.8',
  '/partener': '0.8',
  '/despre-noi': '0.7',
  '/afla-ce-facem': '0.7',
  '/mydarrin-cum-functioneaza': '0.7',
  '/mydarrin-categorie-servicii': '0.7',
  '/mydarrin-categorie-materiale': '0.7',
  '/mydarrin-categorie-inchirieri': '0.7',
  '/investitor': '0.6',
  '/cum-comanzi': '0.6',
  '/cum-platesc': '0.6',
  '/cum-prestam-livram': '0.6',
  '/cum-programez-serviciu': '0.6',
  '/servicii-urgente': '0.6',
  '/curier-cartier': '0.6',
  '/cum-devii-furnizor-materiale': '0.6',
  '/cum-devii-operator-inchirieri': '0.6',
  '/cum-devii-partenerul-nostru': '0.6',
  '/asigurator': '0.6',
  '/mydarrin-app-mobile': '0.5',
  '/mydarrin-contact': '0.5',
  '/garantii-si-asigurari': '0.5',
  '/intrebari-frecvente-clienti': '0.5',
  '/intrebari-frecvente-parteneri': '0.5',
  '/mydarrin-serviciu': '0.4',
  '/reclamatii': '0.3',
  '/mydarrin-termeni': '0.2',
  '/mydarrin-politica-confidentialitate': '0.2',
};

const PAGINI = PAGINI_BAZA.map((p) => ({ cale: p.cale, prioritate: PRIORITATE[p.cale] || '0.5' }));

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  let overrideuri = {};
  try {
    const { data } = await supabaseAdmin.from('seo_config').select('page_path, canonical_url').not('canonical_url', 'is', null);
    (data || []).forEach((r) => { overrideuri[r.page_path] = r.canonical_url; });
  } catch (e) {
    // Fără override-uri, folosim URL-urile implicite — nu blocăm sitemap-ul.
  }

  const urlsXml = PAGINI.map((p) => {
    const url = overrideuri[p.cale] || (BASE_URL + p.cale);
    return '  <url>\n    <loc>' + escapeXml(url) + '</loc>\n    <priority>' + p.prioritate + '</priority>\n  </url>';
  }).join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urlsXml + '\n' +
    '</urlset>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(xml);
};

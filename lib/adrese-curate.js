// lib/adrese-curate.js — adresele curate ale site-ului (pasul 12-U1, 19 nov. 2026)
//
// Sursa unică a adreselor publice, decise de LM (auditul 11-A2, „Denumirea
// linkurilor și a adreselor”). Fișierele HTML NU se redenumesc: fiecare adresă
// nouă servește fișierul de azi, iar fiecare adresă veche face 301 spre cea
// nouă, cu parametrii păstrați (?lang=, ?profesie=, UTM, fbclid…).
//
// Cine o folosește:
//   - scripts/genereaza-adrese-vercel.js → rewrites + redirects din vercel.json
//     (testul scripts/test-adrese-curate.js pică dacă vercel.json nu e la zi);
//   - middleware.js → rescrierile adreselor noi și redirecționările care depind
//     de parametri (/mydarrin-catalog?categorie=…, /mydarrin-produs?slug=…);
//   - paginile (window.MYD_ADRESE, <script src="/lib/adrese-curate.js">):
//     catalogul și pagina de produs își citesc filtrul / produsul din adresă
//     și construiesc linkurile spre produse;
//   - lib/seo-pagini.js, sitemap-ul și testele.
//
// Fișier fără dependențe, în forma UMD: rulează în Node (require), în Edge
// (import din middleware.js) și în browser (window.MYD_ADRESE).

(function (radacina, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else radacina.MYD_ADRESE = m;
})(typeof self !== 'undefined' ? self : this, function () {
  // [adresa nouă, fișierul servit (fără .html), adresele vechi (fără .html) → 301]
  // Adresele vechi sunt căi exacte; forma cu .html o redirecționează întâi
  // Vercel însuși (cleanUrls: 308 /x.html → /x), apoi regula de aici (301).
  const PAGINI = [
    ['/catalog', 'mydarrin-catalog', ['/mydarrin-serviciu']],
    ['/servicii', 'mydarrin-catalog', ['/mydarrin-categorie-servicii']],
    ['/materiale', 'mydarrin-catalog', ['/mydarrin-categorie-materiale']],
    ['/inchirieri', 'mydarrin-catalog', ['/mydarrin-categorie-inchirieri']],
    ['/parteneri', 'cum-devii-partenerul-nostru', ['/partener', '/cum-devii-partenerul-nostru', '/mydarrin-devino-partener']],
    ['/parteneri/servicii', 'cum-devii-furnizor-servicii', ['/cum-devii-furnizor-servicii']],
    ['/parteneri/materiale', 'cum-devii-furnizor-materiale', ['/cum-devii-furnizor-materiale']],
    ['/parteneri/inchirieri', 'cum-devii-operator-inchirieri', ['/cum-devii-operator-inchirieri']],
    ['/parteneri/curieri', 'cum-devii-curier-de-cartier', ['/cum-devii-curier-de-cartier', '/curier-cartier']],
    ['/parteneri/asigurari', 'ghidul-asiguratorului', ['/ghidul-asiguratorului', '/asigurator']],
    ['/parteneri/inscriere', 'mydarrin-inscriere-partener', []],
    ['/parteneri/intrebari', 'intrebari-frecvente-parteneri', ['/intrebari-frecvente-parteneri']],
    ['/investitori', 'mydarrin-investitori', ['/investitor', '/mydarrin-investitori']],
    ['/ajutor', 'mydarrin-cum-functioneaza', ['/mydarrin-cum-functioneaza']],
    ['/ajutor/cum-comand', 'cum-comanzi', ['/cum-comanzi']],
    ['/ajutor/cum-platesc', 'cum-platesc', ['/cum-platesc']],
    ['/ajutor/programare', 'cum-programez-serviciu', ['/cum-programez-serviciu']],
    ['/ajutor/livrare', 'cum-prestam-livram', ['/cum-prestam-livram']],
    ['/garantii', 'garantii-si-asigurari', ['/garantii-si-asigurari']],
    ['/urgente', 'servicii-urgente', ['/servicii-urgente']],
    // Adresa de azi e deja curată: rămâne (doar /reclamatii.html → 308, de la Vercel).
    ['/reclamatii', 'reclamatii', []],
    ['/intrebari', 'intrebari-frecvente-clienti', ['/intrebari-frecvente-clienti']],
    ['/despre', 'despre-noi', ['/despre-noi']],
    ['/contact', 'mydarrin-contact', ['/mydarrin-contact']],
    ['/termeni', 'mydarrin-termeni', ['/mydarrin-termeni']],
    ['/confidentialitate', 'mydarrin-politica-confidentialitate', ['/mydarrin-politica-confidentialitate']],
    ['/cont/comenzi', 'mydarrin-dashboard-client', ['/mydarrin-dashboard-client']],
    ['/cont/partener', 'mydarrin-dashboard-partener', ['/mydarrin-dashboard-partener']],
    ['/cont/investitor', 'mydarrin-panou-investitor', ['/mydarrin-panou-investitor']],
    ['/cont/roluri', 'mydarrin-rolurile-mele', ['/mydarrin-rolurile-mele']],
    ['/deviz', 'mydarrin-creeaza-deviz', ['/mydarrin-creeaza-deviz']],
  ].map(([nou, fisier, vechi]) => ({ nou, fisier, vechi }));

  // Catalogul: adresa nouă a fiecărei file (categorie din adresa veche → adresă).
  const CATEGORII = { servicii: '/servicii', materiale: '/materiale', inchirieri: '/inchirieri' };
  // Tipul produsului, în toate formele întâlnite în linkurile vechi → segmentul adresei.
  const TIP_SEGMENT = {
    serviciu: 'servicii', servicii: 'servicii',
    material: 'materiale', materiale: 'materiale',
    inchiriere: 'inchirieri', inchirieri: 'inchirieri', echipament: 'inchirieri', echipamente: 'inchirieri',
  };
  // Segmentul adresei → ?type= citit de mydarrin-produs.html.
  const SEGMENT_TIP = { servicii: 'serviciu', materiale: 'material', inchirieri: 'inchiriere' };

  const PE_NOU = Object.create(null);
  const PE_VECHI = Object.create(null);
  PAGINI.forEach((p) => {
    PE_NOU[p.nou] = p;
    p.vechi.forEach((v) => { PE_VECHI[v] = p; });
  });
  // Și numele fișierului, scris direct (ex. /mydarrin-cum-functioneaza), e o adresă veche —
  // cu excepția celor care au funcții proprii pe adresa veche (catalogul, produsul).
  const FISIER_PAGINA = Object.create(null);
  PAGINI.forEach((p) => { if (!FISIER_PAGINA['/' + p.fisier]) FISIER_PAGINA['/' + p.fisier] = p; });

  function curata(cale) {
    let c = String(cale || '/');
    if (c.length > 1) c = c.replace(/\/+$/, '');
    return c.replace(/\.html$/, '') || '/';
  }
  function slugValid(s) { return typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/.test(s); }

  function adresaProdus(slug, tip) {
    const seg = TIP_SEGMENT[String(tip || '').toLowerCase()] || 'servicii';
    return '/' + seg + '/' + encodeURIComponent(String(slug || ''));
  }

  function adresaCatalog(categorie, subcategorie) {
    const baza = CATEGORII[TIP_SEGMENT[String(categorie || '').toLowerCase()] || ''] || '/catalog';
    return subcategorie ? baza + '?subcategorie=' + encodeURIComponent(subcategorie) : baza;
  }

  // Rescrierea unei adrese noi: { fisier, parametri } sau null.
  // parametri = ce ar fi fost în adresa veche (folosit de pagini prin parametriPagina).
  function rescriere(cale) {
    const c = curata(cale);
    if (PE_NOU[c]) {
      const p = PE_NOU[c];
      const cat = Object.keys(CATEGORII).find((k) => CATEGORII[k] === c);
      return { fisier: p.fisier, parametri: cat ? { categorie: cat } : {} };
    }
    const m = c.match(/^\/(servicii|materiale|inchirieri)\/([^/]+)$/);
    if (m) {
      let slug;
      try { slug = decodeURIComponent(m[2]); } catch (e) { return null; }
      if (!slugValid(slug)) return null;
      return { fisier: 'mydarrin-produs', parametri: { slug, type: SEGMENT_TIP[m[1]] } };
    }
    return null;
  }

  // Parametrii paginii curente: cei din adresă (?…) plus cei pe care îi spune
  // calea curată (/servicii → categorie=servicii; /servicii/x → slug=x&type=serviciu).
  // Calea are întâietate pentru slug și type; ?categorie= din adresă rămâne a ei.
  function parametriPagina(pathname, search) {
    const p = new URLSearchParams(search || '');
    const r = rescriere(pathname);
    if (r) {
      Object.keys(r.parametri).forEach((k) => {
        if (k === 'categorie' && p.has('categorie')) return;
        p.set(k, r.parametri[k]);
      });
    }
    return p;
  }

  function cuParametri(cale, parametri) {
    const s = parametri.toString();
    return cale + (s ? (cale.includes('?') ? '&' : '?') + s : '');
  }

  // Redirecționarea unei adrese vechi: calea nouă (cu parametrii păstrați) sau null.
  // `search` = partea „?…” a cererii.
  function redirect(cale, search) {
    const c = curata(cale);
    const p = new URLSearchParams(search || '');
    if (PE_VECHI[c]) return cuParametri(PE_VECHI[c].nou, p);

    // Catalogul vechi: fila din ?categorie=, filtrul din ?subcategorie= (sau ?cat=).
    if (c === '/mydarrin-catalog') {
      // ?cat=servicii (linkurile vechi din meniu) e fila, nu o subcategorie.
      const catFila = TIP_SEGMENT[String(p.get('cat') || '').toLowerCase()];
      const seg = TIP_SEGMENT[String(p.get('categorie') || '').toLowerCase()] || catFila;
      const tinta = (seg && CATEGORII[seg]) || '/catalog';
      p.delete('categorie');
      if (catFila) p.delete('cat');
      if (p.has('cat') && !p.has('subcategorie')) p.set('subcategorie', p.get('cat'));
      p.delete('cat');
      return cuParametri(tinta, p);
    }
    // Adresele stricte de bug-ul din 12-U1 (pasul 12-U1b): „/catalogservicii&subcategorie=x”
    // (lipsea „?”). Restul de după „&” e parametrii adevărați; tab-ul vine din cale.
    const rupt = c.match(/^\/catalog(servicii|materiale|inchirieri)(?:&(.*))?$/);
    if (rupt) {
      const q = new URLSearchParams(rupt[2] || '');
      p.forEach((v, k) => { if (!q.has(k)) q.append(k, v); });
      return cuParametri(CATEGORII[rupt[1]], q);
    }
    // Pagina de produs veche: /mydarrin-produs?slug=…&type=… → /servicii/<slug>.
    if (c === '/mydarrin-produs') {
      const slug = p.get('slug');
      if (!slugValid(slug)) return null;
      const tinta = adresaProdus(slug, p.get('type'));
      p.delete('slug'); p.delete('type'); p.delete('cat');
      return cuParametri(tinta, p);
    }
    // Adresele vechi ale pasului 11-C4.
    let m = c.match(/^\/catalog\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (m && slugValid(m[3])) {
      p.delete('slug'); p.delete('type'); p.delete('cat');
      return cuParametri(adresaProdus(m[3], m[1]), p);
    }
    m = c.match(/^\/catalog\/(servicii|materiale|inchirieri)\/([^/]+)$/) || c.match(/^\/(inchiriere)\/([^/]+)$/);
    if (m) {
      p.set('subcategorie', m[2]);
      return cuParametri(CATEGORII[TIP_SEGMENT[m[1]]], p);
    }
    return null;
  }

  // Un link intern (href relativ: „/cum-comanzi”, „cum-comanzi.html?x=1#y”)
  // → forma lui nouă; null dacă nu e o adresă veche. Păstrează parametrii și
  // #ancora. Adresele absolute (https://…) nu sunt tratate aici.
  function linkNou(href) {
    const s = String(href || '');
    const mm = s.match(/^(\/?)([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!mm) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(mm[2]) || mm[2].startsWith('/')) return null;
    const cale = '/' + mm[2];
    if (/\/(api|lib|i18n|assets)\//.test(cale + '/') && !/\.html$/.test(cale)) return null;
    let nou = redirect(cale, mm[3] || '');
    if (nou === null && FISIER_PAGINA[curata(cale)]) {
      nou = cuParametri(FISIER_PAGINA[curata(cale)].nou, new URLSearchParams(mm[3] || ''));
    }
    // index.html → /
    if (nou === null && /^\/index(\.html)?$/.test(cale)) nou = cuParametri('/', new URLSearchParams(mm[3] || ''));
    if (nou === null) return null;
    nou += (mm[4] || '');
    // Adresa nouă, scrisă deja corect: nimic de schimbat.
    return nou === s ? null : nou;
  }

  // Regulile din vercel.json (generate; vezi scripts/genereaza-adrese-vercel.js).
  // Redirecturile depind doar de cale (cele cu parametri sunt în middleware.js).
  function reguliVercel() {
    const redirects = [];
    PAGINI.forEach((p) => p.vechi.forEach((v) => redirects.push({ source: v, destination: p.nou, statusCode: 301 })));
    const rewrites = PAGINI.map((p) => ({ source: p.nou, destination: '/' + p.fisier }));
    ['servicii', 'materiale', 'inchirieri'].forEach((seg) => rewrites.push({ source: '/' + seg + '/:slug', destination: '/mydarrin-produs?slug=:slug&type=' + SEGMENT_TIP[seg] }));
    return { redirects, rewrites };
  }

  // Fișierul paginii curente în browser (pentru dicționare, măsurare, roluri):
  // <script src="/i18n-loader.js" data-pagina="…">, altfel ultimul segment al căii.
  function paginaCurenta() {
    try {
      const s = document.querySelector('script[src*="i18n-loader"][data-pagina]');
      if (s) return s.getAttribute('data-pagina');
      const r = rescriere(location.pathname);
      if (r) return r.fisier;
      return (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
    } catch (e) {
      return 'index';
    }
  }

  return {
    PAGINI, CATEGORII, TIP_SEGMENT, SEGMENT_TIP,
    curata, rescriere, redirect, parametriPagina, adresaProdus, adresaCatalog, linkNou, reguliVercel, paginaCurenta,
    adresaNoua: (fisier) => (FISIER_PAGINA[curata('/' + String(fisier || '').replace(/^\//, ''))] || {}).nou || null,
  };
});

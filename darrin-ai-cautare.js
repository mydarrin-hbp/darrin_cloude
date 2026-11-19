/* darrin-ai-cautare.js — pasul 12-D1 (18 nov. 2026, regula LM din 17 nov.)
   Căutarea din widget-ul flotant „Darrin AI” (colțul din dreapta-jos), comun
   tuturor paginilor publice care îl au.

   Înainte, fiecare pagină avea propria funcție daiRespond(): potrivea câteva
   cuvinte-cheie cu o listă de răspunsuri scrise în cod (de ex. „avem 6 servicii
   electrice”), fără legătură cu catalogul real. Lista fixă s-a scos: acum
   căutarea se face în catalogul real, prin API-ul public existent
   /api/public/catalog (doar produse publicate, prețul „de la” calculat de
   server). Darrin AI nu inventează servicii, cifre sau prețuri: arată doar ce
   găsește în catalog; fără rezultat, trimite spre Darrin AI din catalog /
   Consultanța Darrin.

   Rămân două legături de navigare, fără conținut de catalog: „Cum funcționează”
   și „Devino partener” (butoanele rapide ale widget-ului).

   Textele sunt în română (limba sursă) și se traduc prin window.t, cu
   dicționarul comun i18n/en.json (_texte).
*/
(function () {
  'use strict';

  var MAX_REZULTATE = 3;
  var catalogPromis = null;
  var CUVINTE_IGNORATE = ['vreau', 'pentru', 'care', 'este', 'sunt', 'cum', 'ce', 'fac', 'imi', 'mea', 'meu', 'mei', 'mele', 'am', 'are', 'avem', 'un', 'una', 'unei', 'unui', 'niste', 'din', 'cu', 'si', 'sau', 'la', 'de', 'pe', 'in', 'ma', 'te', 'ne', 'va', 'nu', 'da', 'ajuta', 'ajutor', 'nevoie', 'caut', 'acasa',
    'the', 'and', 'for', 'with', 'need', 'want', 'have', 'has', 'how', 'what', 'can', 'you', 'my', 'is', 'are', 'help', 'please', 'looking', 'some', 'get', 'do', 'does', 'home'];

  function limba() { return (window.MYD_I18N && window.MYD_I18N.lang === 'ro') ? 'ro' : 'en'; }
  function T(ro, param) {
    if (typeof window.t === 'function') return window.t(null, ro, param);
    return ro.replace(/\{(\w+)\}/g, function (m, x) { return param && param[x] != null ? param[x] : m; });
  }
  function tara() {
    return (window.MYD_GEO_LAST && window.MYD_GEO_LAST.cc) || (window.MYD_GEO && window.MYD_GEO.data && window.MYD_GEO.data.cc) || 'RO';
  }
  function normalizeaza(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function cuvinte(s) {
    return normalizeaza(s).split(' ').filter(function (w) { return w.length >= 3 && CUVINTE_IGNORATE.indexOf(w) === -1; });
  }
  // Potrivire cu rădăcina cuvântului (calorifer / calorifere / caloriferul).
  function sePotriveste(a, b) {
    var n = Math.max(4, Math.min(a.length, b.length) - 2);
    if (a.length < 4 || b.length < 4) return a === b;
    return a.slice(0, n) === b.slice(0, n);
  }

  function incarcaCatalog() {
    if (!catalogPromis) {
      catalogPromis = fetch('/api/public/catalog?tara=' + encodeURIComponent(tara()) + '&lang=' + limba())
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok) throw new Error('catalog indisponibil');
          var tip = { servicii: 'serviciu', materiale: 'material', inchirieri: 'inchiriere' };
          var lista = [];
          ['servicii', 'materiale', 'inchirieri'].forEach(function (cheie) {
            (d[cheie] || []).forEach(function (p) {
              var en = p.traduceri && p.traduceri.en;
              var titlu = (limba() === 'en' && en && en.titlu) || p.titlu;
              lista.push({
                id_serviciu: p.id_serviciu, tip: tip[cheie], titlu: titlu,
                cuvinteTitlu: cuvinte(p.titlu + ' ' + ((en && en.titlu) || '')),
                cuvinteDomeniu: cuvinte(p.domeniu + ' ' + ((en && en.domeniu) || '')),
                pret_de_la: p.pret_de_la,
              });
            });
          });
          return lista;
        })
        .catch(function (e) { catalogPromis = null; throw e; });
    }
    return catalogPromis;
  }

  function cauta(lista, intrebare) {
    var q = cuvinte(intrebare);
    if (!q.length) return [];
    return lista.map(function (p) {
      var scor = 0;
      q.forEach(function (w) {
        if (p.cuvinteTitlu.some(function (x) { return sePotriveste(w, x); })) scor += 2;
        else if (p.cuvinteDomeniu.some(function (x) { return sePotriveste(w, x); })) scor += 1;
      });
      return { p: p, scor: scor };
    }).filter(function (x) { return x.scor > 0 && x.p.id_serviciu; })
      .sort(function (a, b) { return b.scor - a.scor || ((b.p.tip === 'serviciu') - (a.p.tip === 'serviciu')); })
      .slice(0, MAX_REZULTATE)
      .map(function (x) { return x.p; });
  }

  function pret(p) {
    if (!(Number(p.pret_de_la) > 0)) return '';
    var suma = typeof window.formatCurrency === 'function'
      ? window.formatCurrency(Number(p.pret_de_la))
      : Number(p.pret_de_la).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Lei';
    return T('De la') + ' ' + suma;
  }

  function mesaj(text) {
    if (typeof window.daiAddMessage === 'function') window.daiAddMessage(text, false);
  }
  function legaturi(lista) {
    var msgs = document.getElementById('dai-chat-messages');
    if (!msgs) return;
    var wrap = document.createElement('div');
    wrap.setAttribute('data-dai-rezultate', '1');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-left:26px';
    lista.forEach(function (l) {
      var a = document.createElement('a');
      a.href = l.href;
      a.style.cssText = 'display:block;background:#FF8C00;color:#fff;text-decoration:none;border-radius:10px;padding:9px 14px;font-size:12px;font-weight:700';
      a.textContent = l.text;
      if (l.pret) {
        var s = document.createElement('span');
        s.style.cssText = 'display:block;font-weight:500;font-size:11px;opacity:.9';
        s.setAttribute('data-pret-server', '1');
        s.textContent = l.pret;
        a.appendChild(s);
      }
      wrap.appendChild(a);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  var NAVIGARE = [
    { re: /(functioneaz|how (does it|it) work)/, text: 'Află pas cu pas cum comanzi un serviciu și cum funcționează plata prin escrow.', eticheta: 'Cum funcționează →', href: '/ajutor' },
    { re: /(partener|partner)/, text: 'Înregistrarea ca partener e gratuită: alegi tipul (Servicii, Materiale sau Închirieri) și completezi datele firmei.', eticheta: 'Devino partener →', href: '/parteneri/inscriere' },
  ];

  function daiRespond(intrebare) {
    var qn = normalizeaza(intrebare);
    var nav = NAVIGARE.filter(function (n) { return n.re.test(qn); })[0];
    if (nav) {
      setTimeout(function () { mesaj(T(nav.text)); legaturi([{ href: nav.href, text: T(nav.eticheta) }]); }, 300);
      return Promise.resolve('navigare');
    }
    return incarcaCatalog().then(function (lista) {
      var gasite = cauta(lista, intrebare);
      var aiUrl = '/catalog?openAI=true&q=' + encodeURIComponent(intrebare);
      if (gasite.length) {
        mesaj(T('Am găsit în catalogul My Darrin:'));
        legaturi(gasite.map(function (p) {
          return { href: '/' + (({ serviciu: 'servicii', servicii: 'servicii', material: 'materiale', materiale: 'materiale', inchiriere: 'inchirieri', inchirieri: 'inchirieri' }[p.tip] || 'servicii')) + '/' + encodeURIComponent(p.id_serviciu), text: p.titlu + ' →', pret: pret(p) };
        }));
        return 'catalog';
      }
      mesaj(T('Nu am găsit în catalogul My Darrin un serviciu pentru această descriere. Descrie problema în Darrin AI din catalog sau cere o Consultanță Darrin.'));
      legaturi([{ href: aiUrl, text: T('Descrie problema în Darrin AI →') }]);
      return 'fara_rezultat';
    }).catch(function () {
      mesaj(T('Nu am putut încărca catalogul acum. Încearcă din nou peste câteva momente.'));
      return 'eroare';
    });
  }

  window.daiRespond = daiRespond;
  window.MYD_DARRIN_CAUTARE = { cauta: cauta, cuvinte: cuvinte, incarcaCatalog: incarcaCatalog };
})();

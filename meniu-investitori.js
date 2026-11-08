/* ════════════════════════════════════════════════════════════════
   MY DARRIN — meniu-investitori.js, pasul 11-R3h (decizia LM, 3 nov. 2026)

   „Investitori” nu mai e în antet (desktop). Rămâne în meniul vertical (☰),
   pe toate dimensiunile de ecran, și în footer, ca grup cu 5 intrări,
   generate doar de aici (copiile din pagini s-au șters). Paginile păstrează
   doar locul gol:

     <div data-meniu-investitori="lateral"></div>   în meniul ☰
     <div data-meniu-investitori="footer"></div>    coloană în .ftr-r2

   Intrările, în ordine: Cum devii investitor (#cum-functioneaza), Runda
   curentă (#runda), Pitch deck (#pitch-deck), Panoul meu (#panou — doar
   pentru un cont cu rolul `investor`, citit din profilul de pe server, ca
   azi: /api/cont/profil, prin MYD_CONT din ui-comun.js), Contact investitori
   (#contact).

   Meniul lateral luat din index.html (ui-comun.js) se completează prin
   MYD_MENIU_INVESTITORI.completeaza().
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_MENIU_INVESTITORI) return;

  var PAGINA = 'mydarrin-investitori.html';
  var INTRARI = [
    { ancora: 'cum-functioneaza', ico: 'book-open', titlu: 'Cum devii investitor' },
    { ancora: 'runda', ico: 'briefcase', titlu: 'Runda curentă' },
    { ancora: 'pitch-deck', ico: 'file-text', titlu: 'Pitch deck' },
    { ancora: 'panou', ico: 'layout-dashboard', titlu: 'Panoul meu', doarInvestitor: true },
    { ancora: 'contact', ico: 'mail', titlu: 'Contact investitori' },
  ];

  function tr(ro) { return typeof window.t === 'function' ? window.t(null, ro) : ro; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ico(nume) { return '<i data-lucide="' + nume + '" style="width:16px;height:16px;display:inline-block;vertical-align:middle"></i>'; }
  function href(x) { return PAGINA + '#' + x.ancora; }
  function atributeInvestitor(x) { return x.doarInvestitor ? ' data-doar-investitor hidden' : ''; }

  function stil() {
    if (document.getElementById('mmi-stil')) return;
    var s = document.createElement('style');
    s.id = 'mmi-stil';
    s.textContent =
      '.mmi-cap{width:100%;border:0;background:transparent;text-align:left;font:inherit;cursor:pointer}' +
      '.mmi-cap .mmi-sageata{margin-left:auto;transition:transform .2s;color:#9CA3AF}' +
      '.mmi-cap[aria-expanded="true"] .mmi-sageata{transform:rotate(180deg)}' +
      '.mmi-lista{padding:0 12px 6px 56px}' +
      '.mmi-lista a{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;border-radius:10px;font-size:13px;font-weight:600;color:#2D2D2D;text-decoration:none;box-sizing:border-box}' +
      '.mmi-lista a:hover,.mmi-lista a:focus-visible{background:#E0F5F4;color:#0B7A76}' +
      '.mmi-lista a[hidden]{display:none}' +
      '.ftr-ul li[hidden]{display:none}' +
      // Footer: 5 coloane pe ecran mare (cele 4 de până acum + „Investitori”).
      '@media (min-width:901px){.ftr-r2.mmi-5{grid-template-columns:1.2fr 1fr 1fr 1fr 1.1fr}}';
    (document.head || document.documentElement).appendChild(s);
  }

  var nrLateral = 0;
  function htmlLateral() {
    var id = 'sb-inv' + (nrLateral++ ? '-' + nrLateral : '');
    return '<button type="button" class="sb-item mmi-cap" aria-expanded="false" aria-controls="' + id + '" data-mmi-cap>' +
        '<div class="sb-ico">' + ico('trending-up') + '</div><span class="flex-1">' + esc(tr('Investitori')) + '</span>' +
        '<span class="mmi-sageata" aria-hidden="true">' + ico('chevron-down') + '</span></button>' +
      '<div id="' + id + '" class="mmi-lista" hidden>' + INTRARI.map(function (x, i) {
        return '<a href="' + href(x) + '" data-mmi-intrare="' + (i + 1) + '"' + atributeInvestitor(x) +
          ' onclick="if(typeof closeSidebar===\'function\')closeSidebar()">' + ico(x.ico) + '<span>' + esc(tr(x.titlu)) + '</span></a>';
      }).join('') + '</div>';
  }

  function htmlFooter() {
    return '<span class="ftr-nh">' + esc(tr('Investitori')) + '</span><ul class="ftr-ul">' + INTRARI.map(function (x, i) {
      return '<li' + atributeInvestitor(x) + '><a href="' + href(x) + '" data-mmi-intrare="' + (i + 1) + '">' + esc(tr(x.titlu)) + '</a></li>';
    }).join('') + '</ul>';
  }

  function leagaCap(loc) {
    var b = loc.querySelector('[data-mmi-cap]');
    var l = b && document.getElementById(b.getAttribute('aria-controls'));
    if (!b || !l) return;
    b.addEventListener('click', function () {
      var deschis = l.hidden;
      l.hidden = !deschis;
      b.setAttribute('aria-expanded', String(deschis));
    });
  }

  // „Panoul meu”: doar cu rolul `investor` pe cont (profilul de pe server).
  var promRol = null;
  function asteapta(cond, ms) {
    return new Promise(function (ok) {
      var pana = Date.now() + ms;
      (function v() { if (cond()) return ok(true); if (Date.now() > pana) return ok(false); setTimeout(v, 100); })();
    });
  }
  function esteInvestitor() {
    if (promRol) return promRol;
    promRol = asteapta(function () { return !!(window.MYD_CONT && window.MYD_CONT.profil); }, 6000).then(function (are) {
      if (!are) return false;
      return window.MYD_CONT.profil().then(function (p) {
        return !!(p && Array.isArray(p.roles) && p.roles.indexOf('investor') !== -1);
      });
    }).catch(function () { return false; });
    return promRol;
  }
  function aplicaRol() {
    esteInvestitor().then(function (da) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-meniu-investitori] [data-doar-investitor]'), function (x) { x.hidden = !da; });
    });
  }

  function icone() { try { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (e) {} }

  function completeaza(radacina) {
    var r = radacina || document;
    var locuri = r.querySelectorAll('[data-meniu-investitori]');
    if (!locuri.length) return 0;
    stil();
    var n = 0;
    Array.prototype.forEach.call(locuri, function (loc) {
      if (loc.getAttribute('data-meniu-gata') === '1') return;
      var tip = loc.getAttribute('data-meniu-investitori');
      if (tip === 'lateral') { loc.innerHTML = htmlLateral(); leagaCap(loc); }
      else if (tip === 'footer') {
        loc.innerHTML = htmlFooter();
        var grila = loc.closest('.ftr-r2');
        if (grila) grila.classList.add('mmi-5');
      } else return;
      loc.setAttribute('data-meniu-gata', '1');
      n++;
    });
    if (n) { icone(); aplicaRol(); }
    return n;
  }

  window.MYD_MENIU_INVESTITORI = { INTRARI: INTRARI, completeaza: completeaza, esteInvestitor: esteInvestitor };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { completeaza(); });
  else completeaza();
})();

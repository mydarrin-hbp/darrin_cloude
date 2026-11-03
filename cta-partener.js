/* ════════════════════════════════════════════════════════════════
   MY DARRIN — cta-partener.js, pasul 11-R3b (decizia LM, 2 nov. 2026)

   Butoanele de înscriere ca partener („Devino partener”, „Cum devii
   partener”, ghidurile) arată textul și fac acțiunea potrivite stării
   contului. Starea vine de pe server (/api/cont/profil: roles,
   rol_solicitat, activare, eligibilitatea din lib/eligibilitate-partener.js),
   nu din browser.

     vizitator  „Creează-ți contul de partener”     → fereastra de cont, „Creare cont”,
                                                       cu „Partener” ales și grila deschisă
     client     „Devino partener pe contul tău”      → alegerea tipului (fereastra de cont),
                                                       salvată prin /api/cont/rol-solicitat,
                                                       apoi dashboard-ul tipului (modul activare)
     activare   „Finalizează-ți contul ca să primești comenzi” → dashboard-ul, la pasul rămas
     verificare „Contul tău e în verificare”         → dashboard-ul
     activ      „Mergi la dashboard-ul tău”           → dashboard-ul

   Pasul 11-R3f: același buton e și în meniul „Devino Partener” al tuturor
   paginilor (meniu-partener.js), cu data-cta-scurt.

   Folosire: orice element <a> cu data-cta-partener="<tip>" (servicii,
   materiale, inchirieri, curier, asigurari; gol = tipul din ?type= sau
   niciunul). În element, [data-cta-text] primește textul, iar
   [data-cta-badge] („0 LEI”) apare doar cât înscrierea e încă de făcut; fără
   [data-cta-text], textul înlocuiește conținutul (păstrând „→”). Cât se
   încarcă starea, butonul își păstrează locul, dar nu se vede.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_CTA_PARTENER) return;

  var TIPURI = ['servicii', 'materiale', 'inchirieri', 'curier', 'asigurari'];
  var TEXT = {
    vizitator: 'Creează-ți contul de partener',
    client: 'Devino partener pe contul tău',
    activare: 'Finalizează-ți contul ca să primești comenzi',
    verificare: 'Contul tău e în verificare',
    activ: 'Mergi la dashboard-ul tău',
  };
  // Pasul 11-R3f: butonul din meniul „Devino Partener” (meniu-partener.js) are
  // loc puțin: cu data-cta-scurt, activarea neterminată e „Finalizează-ți contul”.
  var TEXT_SCURT = { activare: 'Finalizează-ți contul' };
  var SELECTOR = '[data-cta-partener]';

  function tr(ro) { return typeof window.t === 'function' ? window.t(null, ro) : ro; }
  function tipDin(v) {
    v = String(v || '').toLowerCase();
    if (v === 'asigurator') v = 'asigurari';
    return TIPURI.indexOf(v) !== -1 ? v : null;
  }
  function tipButon(el) {
    return tipDin(el.getAttribute('data-cta-partener')) || tipDin(new URLSearchParams(location.search).get('type'));
  }

  // Butonul își păstrează locul cât se încarcă starea (fără text greșit).
  var st = document.createElement('style');
  st.textContent = '[data-cta-partener][data-cta-stare="incarca"]{visibility:hidden}';
  (document.head || document.documentElement).appendChild(st);
  function butoane() { return Array.prototype.slice.call(document.querySelectorAll(SELECTOR)); }
  function marcheazaIncarcare() { butoane().forEach(function (b) { if (!b.getAttribute('data-cta-stare')) b.setAttribute('data-cta-stare', 'incarca'); }); }

  function asteapta(cond, ms) {
    return new Promise(function (ok) {
      var pana = Date.now() + ms;
      (function v() { if (cond()) return ok(true); if (Date.now() > pana) return ok(false); setTimeout(v, 80); })();
    });
  }
  // Paginile informative nu au toate clientul Supabase: îl încarcăm aici.
  function clientSupabase() {
    if (!window.supabaseClient && !document.querySelector('script[src$="supabaseClient.js"]')) {
      var s = document.createElement('script');
      s.type = 'module'; s.src = '/lib/supabaseClient.js';
      document.head.appendChild(s);
    }
    return asteapta(function () { return !!window.supabaseClient; }, 4000);
  }

  // { stare, destinatie } din profilul de pe server.
  function stareCont() {
    return clientSupabase().then(function (gata) {
      if (!gata) return { stare: 'vizitator' };
      return window.supabaseClient.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        if (!s) return { stare: 'vizitator' };
        return fetch('/api/cont/profil', { headers: { Authorization: 'Bearer ' + s.access_token }, cache: 'no-store' })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (p) {
            if (!p) return { stare: 'client' };
            var act = p.activare;
            var dr = window.MYD_DESTINATIE_ROL;
            var dash = act && dr ? dr.dashboardPentruRol(act.rol) : p.destinatie;
            if ((act && act.activ) || (p.partener && p.partener.poate_vinde)) return { stare: 'activ', destinatie: dash || p.destinatie };
            if (act && act.complet) return { stare: 'verificare', destinatie: dash };
            if (act) return { stare: 'activare', destinatie: dash };
            return { stare: 'client' };
          });
      });
    }).catch(function () { return { stare: 'vizitator' }; });
  }

  function cuFereastra(fn) {
    if (window.MDCont) { fn(window.MDCont); return; }
    if (!document.querySelector('script[src$="cont-fereastra.js"]')) {
      var s = document.createElement('script'); s.src = '/cont-fereastra.js'; document.head.appendChild(s);
    }
    asteapta(function () { return !!window.MDCont; }, 5000).then(function (ok) { if (ok) fn(window.MDCont); });
  }

  function aplica(el, r) {
    var tip = tipButon(el);
    var text = tr((el.hasAttribute('data-cta-scurt') && TEXT_SCURT[r.stare]) || TEXT[r.stare]);
    var tinta = el.querySelector('[data-cta-text]');
    if (tinta) tinta.textContent = text;
    else el.textContent = text + (/→\s*$/.test(el.getAttribute('data-cta-original') || '') ? ' →' : '');
    Array.prototype.forEach.call(el.querySelectorAll('[data-cta-badge]'), function (b) {
      b.style.display = r.stare === 'vizitator' || r.stare === 'client' ? '' : 'none';
    });
    el.setAttribute('data-cta-stare', r.stare);
    if (r.destinatie && (r.stare === 'activare' || r.stare === 'verificare' || r.stare === 'activ')) {
      el.setAttribute('href', r.destinatie);
      el.onclick = null;
      return;
    }
    el.setAttribute('href', '#');
    el.onclick = function (e) {
      e.preventDefault();
      var rol = tip ? 'partener_' + tip : null;
      if (r.stare === 'client') cuFereastra(function (c) { c.alegeTipPartener({ rol: rol }); });
      else cuFereastra(function (c) { c.deschide(rol ? { tab: 'register', rol: rol } : { tab: 'register', partener: true }); });
    };
  }

  var promStare = null;
  function porneste() {
    var lista = butoane();
    if (!lista.length) return;
    lista.forEach(function (b) { if (!b.hasAttribute('data-cta-original')) b.setAttribute('data-cta-original', b.textContent.trim()); });
    marcheazaIncarcare();
    if (!promStare) promStare = stareCont();
    // Cel mult 6 s fără răspuns: starea de vizitator (butonul nu rămâne ascuns).
    Promise.race([promStare, new Promise(function (ok) { setTimeout(function () { ok({ stare: 'vizitator' }); }, 6000); })])
      .then(function (r) { butoane().forEach(function (b) { aplica(b, r); }); });
  }

  window.MYD_CTA_PARTENER = { porneste: porneste, stareCont: function () { return promStare || (promStare = stareCont()); } };
  marcheazaIncarcare();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();

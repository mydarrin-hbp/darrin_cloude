/* ════════════════════════════════════════════════════════════════
   MY DARRIN — cta-partener.js, pasul 11-R3b (decizia LM, 2 nov. 2026), 11-R3g

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

   Pasul 11-R3f: același buton e și în meniul „Devino partener” al tuturor
   paginilor (meniu-partener.js), cu data-cta-scurt.

   Folosire: orice element <a> cu data-cta-partener="<tip>" (servicii,
   materiale, inchirieri, curier, asigurari sau asigurator; gol = tipul din
   ?type= sau niciunul). În element, [data-cta-text] primește textul, iar
   [data-cta-badge] (insigna „GRATUIT”) apare doar cât înscrierea e încă de
   făcut; fără [data-cta-text], textul înlocuiește conținutul (păstrând „→”).
   Cât se încarcă starea, butonul își păstrează locul, dar nu se vede.

   Pasul 11-R3g (3 nov. 2026): pe ruta „Devino partener” (ruta-partener.css):
     data-cta-vizitator="Creează-ți cont de furnizor de materiale" — textul
       pentru vizitator pe paginile de tip (celelalte stări rămân cele comune);
     data-cta-card — butonul „Creează cont” de pe cardurile tipurilor din hub,
       cu texte scurte (TEXT_CARD).
   Costul se scrie doar „GRATUIT” / „FREE” (decizia LM, 3 nov. 2026).

   Pasul 12-P1 (17 nov. 2026): vizitatorul merge la pre-înscrierea în 60 de
   secunde, /parteneri/inscriere?categorie=<tip> (link real, nu fereastra de
   cont). Clientul conectat păstrează alegerea tipului pe contul lui.

   Pasul 12-L1 (19 nov. 2026; auditul: butonul devenea link abia după sesiune):
     - butonul nu se mai ascunde cât se încarcă starea și nu se mai blochează;
     - destinația e scrisă în HTML (paginile de destinație: /parteneri/inscriere
       ?categorie=<tip> + profesie, lang, UTM) și NU se mai schimbă pentru
       vizitator (nici spre #tipuri, nici altfel); textul rămâne cel din pagină;
     - după încărcarea sesiunii se schimbă textul și destinația DOAR pentru cine
       are deja cont de partener (activare, verificare, activ) → dashboard-ul;
       cu data-cta-panou (butonul principal al paginilor de destinație) textul
       e „Mergi în panoul tău”;
     - clientul conectat fără rol de partener: linkul rămâne, iar clicul
       păstrează alegerea tipului pe contul lui (fereastra de cont), ca să nu
       își facă un al doilea cont.
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
  // Pasul 11-R3f: butonul din meniul „Devino partener” (meniu-partener.js) are
  // loc puțin: cu data-cta-scurt, activarea neterminată e „Finalizează-ți contul”.
  var TEXT_SCURT = { activare: 'Finalizează-ți contul' };
  // Pasul 11-R3g: cardurile tipurilor din hub (loc puțin, câte un buton pe tip).
  var TEXT_CARD = {
    vizitator: 'Creează cont',
    client: 'Alege acest tip',
    activare: 'Finalizează-ți contul',
    verificare: 'Contul e în verificare',
    activ: 'Mergi la dashboard',
  };
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

  // Pasul 12-L1: fără ascundere cât se încarcă starea — butonul e utilizabil din prima secundă.
  function butoane() { return Array.prototype.slice.call(document.querySelectorAll(SELECTOR)); }
  var TEXT_PANOU = 'Mergi în panoul tău';

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
    return clientGata(4000);
  }
  // Pasul 11-I3: clientul Supabase anunță că e gata (lib/supabaseClient.js:
  // evenimentul myd:supabase-gata), fără interogare la fiecare 100 ms.
  function clientGata(ms) {
    if (window.supabaseClient) return Promise.resolve(true);
    return new Promise(function (ok) {
      var gata = false, ceas;
      function fin() {
        if (gata) return;
        gata = true; clearTimeout(ceas); window.removeEventListener('myd:supabase-gata', fin);
        ok(!!window.supabaseClient);
      }
      ceas = setTimeout(fin, ms);
      window.addEventListener('myd:supabase-gata', fin);
    });
  }

  // { stare, destinatie } din profilul de pe server.
  function stareCont() {
    return clientSupabase().then(function (gata) {
      if (!gata) return { stare: 'vizitator' };
      return window.supabaseClient.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        if (!s) return { stare: 'vizitator' };
        // Pasul 11-I3: cache-ul comun al paginii (lib/supabaseClient.js).
        return (window.MYD_PROFIL
          ? window.MYD_PROFIL.cere(s.access_token).then(function (r) { return r.ok ? r.corp : null; })
          : fetch('/api/cont/profil', { headers: { Authorization: 'Bearer ' + s.access_token }, cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }))
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

  function textPentru(el, stare) {
    if (el.hasAttribute('data-cta-card')) return TEXT_CARD[stare];
    if (stare === 'vizitator' && el.getAttribute('data-cta-vizitator')) return el.getAttribute('data-cta-vizitator');
    return (el.hasAttribute('data-cta-scurt') && TEXT_SCURT[stare]) || TEXT[stare];
  }

  function aplica(el, r) {
    var tip = tipButon(el);
    el.setAttribute('data-cta-stare', r.stare);
    // Cont de partener: textul și destinația spre dashboard (singura schimbare după sesiune).
    if (r.destinatie && (r.stare === 'activare' || r.stare === 'verificare' || r.stare === 'activ')) {
      var text = tr(el.hasAttribute('data-cta-panou') ? TEXT_PANOU : textPentru(el, r.stare));
      var tinta = el.querySelector('[data-cta-text]');
      if (tinta) tinta.textContent = text;
      else el.textContent = text + (/→\s*$/.test(el.getAttribute('data-cta-original') || '') ? ' →' : '');
      Array.prototype.forEach.call(el.querySelectorAll('[data-cta-badge]'), function (b) { b.style.display = 'none'; });
      el.setAttribute('href', r.destinatie);
      el.onclick = null;
      return;
    }
    // Clientul conectat: linkul din pagină rămâne; clicul alege tipul pe contul existent.
    if (r.stare === 'client') {
      el.onclick = function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        cuFereastra(function (c) { c.alegeTipPartener({ rol: tip ? 'partener_' + tip : null }); });
      };
    }
    // Vizitatorul: nimic de schimbat — destinația și textul sunt cele din HTML.
  }

  var promStare = null;
  function porneste() {
    var lista = butoane();
    if (!lista.length) return;
    lista.forEach(function (b) { if (!b.hasAttribute('data-cta-original')) b.setAttribute('data-cta-original', b.textContent.trim()); });
    if (!promStare) promStare = stareCont();
    // Cel mult 6 s fără răspuns: starea de vizitator (nimic de schimbat).
    Promise.race([promStare, new Promise(function (ok) { setTimeout(function () { ok({ stare: 'vizitator' }); }, 6000); })])
      .then(function (r) { butoane().forEach(function (b) { aplica(b, r); }); });
  }

  window.MYD_CTA_PARTENER = { porneste: porneste, stareCont: function () { return promStare || (promStare = stareCont()); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();

// statistici-publice.js
// Cifre reale pentru elementele comune ale paginilor publice (8 oct. 2026),
// în locul celor scrise direct în pagini („1.840+ parteneri activi”,
// „12.4K clienți activi”, „384K Lei în Escrow”):
//  - [data-stat="parteneri-verificati"] (meniul „Devino partener”):
//    /api/public/statistici-homepage, același endpoint ca pe index;
//  - [data-kpi-bloc] cu [data-kpi="<cheie>"] (modalul pentru investitori):
//    RPC-ul public get_live_investor_kpis, același ca pe mydarrin-investitori.html.
//  - [data-stat="servicii-active"] (meniul „Servicii”, 9 oct. 2026): numărul
//    serviciilor publice (catalog_servicii, status_public, categorie servicii);
//  - [data-stat="catalog-public"] / [data-stat="tari-active"] (hero-ul din
//    catalog): toate produsele publice / țările din /api/public/tari-active;
//  - [data-kpi-text] (text cu cifre, investitori): aceeași sursă ca [data-kpi];
//  - [data-contact="telefon"|"email"] (pagina de contact): backoffice_config,
//    secțiunea contact, cheile contact_telefon / contact_email.
// Regula LM: o cifră egală cu 0 nu se afișează; un bloc fără nicio cifră
// rămâne ascuns. Elementul de afișat e cel mai apropiat [data-stat-celula].
(function () {
  var SUPA_URL = (window.__ENV__ && window.__ENV__.SUPABASE_URL) || 'https://aacojyvujhywanaulvuu.supabase.co';
  var SUPA_ANON = (window.__ENV__ && window.__ENV__.SUPABASE_ANON_KEY) || '';

  function numar(n) { return Math.round(Number(n)).toLocaleString('ro-RO'); }

  function parteneri() {
    var els = document.querySelectorAll('[data-stat="parteneri-verificati"]');
    var numere = document.querySelectorAll('[data-stat="parteneri-numar"]');
    if (!els.length && !numere.length) return;
    fetch('/api/public/statistici-homepage')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var n = Number(d && d.parteneri_verificati) || 0;
        if (n <= 0) return;
        var text = n === 1 ? '1 partener verificat pe platformă' : numar(n) + ' parteneri verificați pe platformă';
        els.forEach(function (el) { el.textContent = text; el.style.display = ''; });
        // Doar numărul, într-o celulă care rămâne ascunsă cât timp e 0.
        numere.forEach(function (el) {
          el.textContent = numar(n);
          var celula = el.closest('[data-stat-celula]');
          if (celula) celula.style.display = '';
        });
      })
      .catch(function () {});
  }

  function arata(el) {
    var celula = el.closest('[data-stat-celula]') || el;
    celula.style.display = '';
  }

  function numaraCatalog(filtru) {
    return fetch(SUPA_URL + '/rest/v1/catalog_servicii?select=id&status_public=eq.true' + filtru + '&limit=1', {
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, Prefer: 'count=exact' },
    }).then(function (r) {
      var total = r.ok && (r.headers.get('content-range') || '').split('/')[1];
      return Number(total) || 0;
    });
  }

  function servicii() {
    var meniu = document.querySelectorAll('[data-stat="servicii-active"]');
    var catalog = document.querySelectorAll('[data-stat="catalog-public"]');
    var tari = document.querySelectorAll('[data-stat="tari-active"]');
    if (SUPA_ANON && meniu.length) {
      numaraCatalog('&categorie=eq.servicii').then(function (n) {
        if (n <= 0) return;
        meniu.forEach(function (el) { el.textContent = n === 1 ? '1 serviciu activ' : numar(n) + ' servicii active'; arata(el); });
      }).catch(function () {});
    }
    if (SUPA_ANON && catalog.length) {
      numaraCatalog('').then(function (n) {
        if (n <= 0) return;
        catalog.forEach(function (el) { el.textContent = numar(n); arata(el); });
      }).catch(function () {});
    }
    if (tari.length) {
      fetch('/api/public/tari-active')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var n = (d && Array.isArray(d.active)) ? d.active.length : 0;
          if (n <= 0) return;
          tari.forEach(function (el) { el.textContent = numar(n); arata(el); });
        })
        .catch(function () {});
    }
  }

  function contact() {
    var els = document.querySelectorAll('[data-contact]');
    if (!els.length || !SUPA_ANON) return;
    fetch(SUPA_URL + '/rest/v1/backoffice_config?sectiune=eq.contact&cheie=in.(contact_telefon,contact_email)&select=cheie,valoare,tara_cod', {
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON },
    })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        // Rândul țării vizitatorului, apoi ALL, apoi oricare.
        var tara = (window.MYD_GEO && window.MYD_GEO.data && window.MYD_GEO.data.country) || 'RO';
        function valoare(cheie) {
          var r = rows.filter(function (x) { return x.cheie === cheie && x.valoare; });
          var ales = r.find(function (x) { return x.tara_cod === tara; }) || r.find(function (x) { return x.tara_cod === 'ALL'; }) || r[0];
          return ales ? String(ales.valoare).trim() : '';
        }
        els.forEach(function (el) {
          var tip = el.getAttribute('data-contact');
          var v = valoare(tip === 'telefon' ? 'contact_telefon' : 'contact_email');
          if (!v) return;
          el.textContent = v;
          el.href = tip === 'telefon' ? 'tel:' + v.replace(/[^0-9+]/g, '') : 'mailto:' + v;
          arata(el);
        });
      })
      .catch(function () {});
  }

  function investitoriText() {
    var els = document.querySelectorAll('[data-kpi-text]');
    if (!els.length || !SUPA_ANON) return;
    fetch(SUPA_URL + '/rest/v1/rpc/get_live_investor_kpis', {
      method: 'POST',
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var k = d && d.kpis;
        if (!k) return;
        els.forEach(function (el) {
          var v = Number(k[el.getAttribute('data-kpi-text')]) || 0;
          if (v <= 0) return;
          el.textContent = (v === 1 ? '1 ' + el.getAttribute('data-singular') : numar(v) + ' ' + el.getAttribute('data-plural')) + '. ';
          el.style.display = '';
        });
      })
      .catch(function () {});
  }

  function investitori() {
    var blocuri = document.querySelectorAll('[data-kpi-bloc]');
    if (!blocuri.length || !SUPA_ANON) return;
    fetch(SUPA_URL + '/rest/v1/rpc/get_live_investor_kpis', {
      method: 'POST',
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var k = d && d.kpis;
        if (!k) return;
        blocuri.forEach(function (bloc) {
          var vizibile = 0;
          bloc.querySelectorAll('[data-kpi]').forEach(function (cel) {
            var v = Number(k[cel.getAttribute('data-kpi')]) || 0;
            var val = cel.querySelector('[data-kpi-valoare]');
            if (v > 0 && val) { val.textContent = numar(v); cel.style.display = ''; vizibile++; }
            else cel.style.display = 'none';
          });
          if (vizibile) {
            bloc.style.gridTemplateColumns = 'repeat(' + vizibile + ',minmax(0,1fr))';
            bloc.style.display = '';
          }
        });
      })
      .catch(function () {});
  }

  function porneste() { parteneri(); investitori(); servicii(); contact(); investitoriText(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();

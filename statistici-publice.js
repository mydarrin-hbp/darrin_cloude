// statistici-publice.js
// Cifre reale pentru elementele comune ale paginilor publice (8 oct. 2026),
// în locul celor scrise direct în pagini („1.840+ parteneri activi”,
// „12.4K clienți activi”, „384K Lei în Escrow”):
//  - [data-stat="parteneri-verificati"] (meniul „Devino partener”):
//    /api/public/statistici-homepage, același endpoint ca pe index;
//  - [data-kpi-bloc] cu [data-kpi="<cheie>"] (modalul pentru investitori):
//    RPC-ul public get_live_investor_kpis, același ca pe mydarrin-investitori.html.
// Regula LM: o cifră egală cu 0 nu se afișează; un bloc fără nicio cifră
// rămâne ascuns.
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

  function porneste() { parteneri(); investitori(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();

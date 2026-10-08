// cos-indicator.js
// Numărul real de servicii din coș (cos_multi_itemi, prin /api/client/cos-multi)
// pe insigna din antet — elementele marcate cu `data-cos-numar`. La 0, insigna
// se ascunde. Înlocuiește „3”-ul scris direct în pagină (8 oct. 2026).
//
// Identitatea: sesiunea Supabase, dacă există; altfel tokenul de vizitator
// (localStorage `myd_guest_token`, același ca în mydarrin-produs.html).
// Fără niciuna, coșul e gol și nu se face nicio cerere.
(function () {
  function afiseaza(n) {
    document.querySelectorAll('[data-cos-numar]').forEach(function (el) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.style.display = n > 0 ? '' : 'none';
    });
  }

  function tokenVizitator() {
    try { return localStorage.getItem('myd_guest_token'); } catch (e) { return null; }
  }

  function sesiune() {
    // account-system.js creează clientul Supabase asincron; îi lăsăm o secundă.
    return new Promise(function (resolve) {
      var incercari = 0;
      (function asteapta() {
        if (window.supabaseClient && window.supabaseClient.auth) {
          window.supabaseClient.auth.getSession()
            .then(function (r) { resolve((r && r.data && r.data.session) || null); })
            .catch(function () { resolve(null); });
        } else if (incercari++ < 10) setTimeout(asteapta, 100);
        else resolve(null);
      })();
    });
  }

  function actualizeaza() {
    afiseaza(0);
    return sesiune().then(function (s) {
      var token = tokenVizitator();
      if (!(s && s.access_token) && !token) return;
      var url = '/api/client/cos-multi' + (s && s.access_token ? '' : '?sesiune_token=' + encodeURIComponent(token));
      var headers = s && s.access_token ? { Authorization: 'Bearer ' + s.access_token } : {};
      return fetch(url, { headers: headers })
        .then(function (r) { return r.json(); })
        .then(function (d) { afiseaza(d && d.ok ? (d.itemi || []).length : 0); })
        .catch(function () { afiseaza(0); });
    });
  }

  window.MDCos = { actualizeaza: actualizeaza };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', actualizeaza);
  else actualizeaza();
})();

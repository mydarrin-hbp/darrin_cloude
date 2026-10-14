// profil-partener-card.js — cardul „Profil incomplet” din dashboard-urile de
// partener (mydarrin-dashboard-partener.html, mydarrin-dashboard-furnizor.html).
// Decizie LM, 14 oct. 2026: cardul apare cât timp lipsesc codurile NACE sau
// clauza de zonă acceptată și duce direct la pasul lipsă din „Completare
// profil partener” (mydarrin-devino-partener-wizard.html?pas=N). Starea vine
// din /api/partener/profil-status (tabelele reale, nu user_metadata); la orice
// eroare cardul nu apare — fără stări inventate.
//
// Textele românești sunt sursa; traducerea EN e în i18n/en.json (_texte).
(function () {
  'use strict';
  var STIL = 'myd-profil-card-stil';
  function stil() {
    if (document.getElementById(STIL)) return;
    var s = document.createElement('style');
    s.id = STIL;
    s.textContent =
      '.myd-profil-wrap{background:#F0F4F8;padding:22px 22px 0}' +
      '@media(max-width:768px){.myd-profil-wrap{padding:14px 14px 0}}' +
      '.myd-profil-card{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:#FFF7EC;border:1.5px solid #FFC98A;border-left:5px solid #FF8C00;border-radius:14px;padding:14px 16px}' +
      '.myd-profil-card .t{font-weight:800;font-size:14px;color:#1A2332;margin-bottom:2px}' +
      '.myd-profil-card .d{font-size:12.5px;color:#5A6B7D;line-height:1.5}' +
      '.myd-profil-card a{margin-left:auto;background:#FF8C00;color:#fff;font-weight:700;font-size:12.5px;padding:9px 16px;border-radius:10px;text-decoration:none;white-space:nowrap}';
    document.head.appendChild(s);
  }

  var TEXT_LIPSA = {
    'nace,clauza_zona': 'Lipsesc codurile NACE și clauza de zonă acceptată.',
    nace: 'Lipsesc codurile NACE.',
    clauza_zona: 'Lipsește clauza de zonă acceptată.',
  };

  function ascunde(el) { el.style.display = 'none'; el.innerHTML = ''; }

  async function afiseaza(idContainer) {
    var el = document.getElementById(idContainer);
    if (!el) return;
    try {
      var sesiune = window.supabaseClient ? (await window.supabaseClient.auth.getSession()).data.session : null;
      if (!sesiune) return ascunde(el);
      var res = await fetch('/api/partener/profil-status', { headers: { Authorization: 'Bearer ' + sesiune.access_token } });
      if (!res.ok) return ascunde(el);
      var s = await res.json();
      if (s.complet || !s.pas) return ascunde(el);
      stil();
      el.className = 'myd-profil-wrap';
      el.innerHTML =
        '<div class="myd-profil-card" role="status">' +
          '<div><div class="t">Profil incomplet</div>' +
          '<div class="d">' + (TEXT_LIPSA[(s.lipsa || []).join(',')] || TEXT_LIPSA['nace,clauza_zona']) + '</div></div>' +
          '<a href="mydarrin-devino-partener-wizard.html?pas=' + Number(s.pas) + '">Completează profilul →</a>' +
        '</div>';
      el.style.display = 'block';
    } catch (e) {
      console.warn('[profil-partener-card]', e);
      ascunde(el);
    }
  }

  window.MYDProfilPartener = { afiseaza: afiseaza };
})();

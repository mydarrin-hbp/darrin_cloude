/**
 * ui-comun.js — funcțiile comune de interfață ale paginilor publice
 * (meniul lateral ≡, locația, contul, „Devino partener”, rolurile, GPS).
 *
 * De ce există (9 oct. 2026): funcțiile erau definite inline, pagină cu
 * pagină. Paginile publicate în 15–19 iulie 2026 (cum-*, întrebări frecvente,
 * garanții, reclamații, servicii urgente…) au primit antetul și meniul din
 * șablon, dar fără blocul de script — iar unele nici markup-ul meniului
 * lateral / al ferestrei de cont. openRolePicker a dispărut din
 * account-system.js la rescrierea din 2 iulie (f845254). Rezultat: 153 de
 * apeluri către funcții inexistente pe 31 de pagini.
 *
 * Reguli:
 *   - Fiecare funcție se definește DOAR dacă pagina nu are deja una proprie
 *     (scriptul se încarcă cu defer, după scripturile inline).
 *   - Comportamentul e cel din versiunile din istoric (cum-comanzi.html
 *     înainte de 5531e7e, account-system.js înainte de f845254,
 *     mydarrin-produs.html pentru GPS). Nimic nou.
 *   - Dacă pagina nu are markup-ul meniului lateral, îl preia din
 *     index.html (o singură sursă), la primul click pe ≡.
 *   - Dacă pagina nu are fereastra de cont, trimite la index.html, care o
 *     deschide (?reason=cont).
 */
(function () {
  'use strict';

  function lipseste(nume) { return typeof window[nume] !== 'function'; }
  function defineste(nume, fn) { if (lipseste(nume)) window[nume] = fn; }
  function el(id) { return document.getElementById(id); }
  function icone() { try { if (window.lucide) window.lucide.createIcons(); } catch (e) {} }

  // ── Meniul lateral ≡ ──────────────────────────────────────────────
  var promMeniu = null;
  function incarcaMeniu() {
    if (el('sidebar')) return Promise.resolve(true);
    if (promMeniu) return promMeniu;
    promMeniu = fetch('index.html', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('index.html ' + r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        ['sidebar-overlay', 'sidebar'].forEach(function (id) {
          var sursa = doc.getElementById(id);
          if (sursa && !el(id)) document.body.appendChild(document.importNode(sursa, true));
        });
        icone();
        afiseazaLinkuriCont();
        return !!el('sidebar');
      })
      .catch(function (e) {
        console.warn('[ui-comun] meniul lateral nu a putut fi încărcat:', e.message);
        promMeniu = null;
        return false;
      });
    return promMeniu;
  }

  // „Comenzile mele” / „Rolurile mele” apar doar cu sesiune (ca pe index).
  function afiseazaLinkuriCont() {
    utilizatorCurent().then(function (u) {
      if (!u) return;
      ['sb-comenzi-link', 'sb-roluri-link'].forEach(function (id) {
        var a = el(id);
        if (a) a.style.display = 'flex';
      });
    });
  }

  function deschideMeniu() {
    el('sidebar').classList.add('open');
    var ov = el('sidebar-overlay');
    if (ov) ov.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  defineste('openSidebar', function () {
    if (el('sidebar')) { deschideMeniu(); return; }
    incarcaMeniu().then(function (ok) {
      if (ok) requestAnimationFrame(deschideMeniu);
      else window.location.href = 'index.html';
    });
  });

  defineste('closeSidebar', function () {
    var sb = el('sidebar'), ov = el('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
    document.body.style.overflow = '';
  });

  defineste('toggleSbSection', function (id) {
    var sec = el(id), ico = el('ico-' + id);
    if (!sec) return;
    sec.classList.toggle('hidden');
    if (ico) ico.style.transform = sec.classList.contains('hidden') ? '' : 'rotate(180deg)';
  });

  // ── Locația ───────────────────────────────────────────────────────
  defineste('openLocModal', function () {
    var m = el('loc-modal');
    if (!m) return;
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });

  defineste('closeLocModal', function () {
    var m = el('loc-modal');
    if (m) m.classList.add('hidden');
    document.body.style.overflow = '';
  });

  defineste('setLoc', function (oras) {
    var inp = el('loc-input');
    if (inp) inp.value = oras;
  });

  defineste('saveLocation', function () {
    var inp = el('loc-input'), disp = el('loc-display');
    if (inp && disp && inp.value.trim()) disp.textContent = inp.value.trim();
    window.closeLocModal();
  });

  // ── GPS (din mydarrin-produs.html, fără partea de monedă) ─────────
  defineste('showGeoToast', function (msg) {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#1A2332;color:#fff;padding:10px 20px;border-radius:12px;font-size:12.5px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.3);font-family:inherit;max-width:90vw;text-align:center;pointer-events:none';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 3500);
  });

  function aplicaLocatie(d) {
    var adresa = d.address || [d.city, d.region].filter(Boolean).join(', ') || d.country;
    var disp = el('loc-display'), inp = el('loc-input'), mbn = el('mbn-loc-text');
    if (disp) disp.textContent = adresa;
    if (inp) inp.value = adresa;
    if (mbn) mbn.textContent = d.city || d.country;
    try { window.dispatchEvent(new CustomEvent('myd-geo-update', { detail: d })); } catch (e) {}
  }

  defineste('detectFromGPS', function () {
    if (!navigator.geolocation) { window.showGeoToast('GPS indisponibil în acest browser'); return; }
    var ico = el('mbn-gps-icon');
    var svg = ico && ico.querySelector('svg');
    if (svg) svg.classList.add('mbn-gps-loading');
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (svg) svg.classList.remove('mbn-gps-loading');
      var lat = pos.coords.latitude, lng = pos.coords.longitude, acc = Math.round(pos.coords.accuracy);
      fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&accept-language=ro')
        .then(function (r) { return r.json(); })
        .then(function (geo) {
          var a = geo.address || {};
          var oras = a.city || a.town || a.village || a.municipality || '';
          var regiune = a.county || a.state || '';
          var strada = [a.road, a.house_number].filter(Boolean).join(' ');
          aplicaLocatie({
            country: (a.country_code || 'ro').toUpperCase(), city: oras, region: regiune,
            address: [strada, oras, regiune].filter(Boolean).join(', '),
            lat: lat, lng: lng, source: 'gps', accuracy: acc,
          });
          window.showGeoToast('Locație GPS detectată · ±' + acc + 'm · ' + oras);
        })
        .catch(function () {
          aplicaLocatie({ country: 'RO', city: lat.toFixed(3) + '°N ' + lng.toFixed(3) + '°E', lat: lat, lng: lng, source: 'gps', accuracy: acc });
          window.showGeoToast('GPS ±' + acc + 'm (adresa nu a putut fi determinată)');
        });
    }, function (err) {
      if (svg) svg.classList.remove('mbn-gps-loading');
      var mesaje = { 1: 'Permite accesul la locație în browser → Setări → Locație', 2: 'Semnal GPS slab — încearcă în exterior sau lângă fereastră', 3: 'Timeout GPS — încearcă din nou' };
      window.showGeoToast(mesaje[err.code] || 'Eroare GPS');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });

  // ── Contul ────────────────────────────────────────────────────────
  function utilizatorCurent() {
    try {
      if (window.MyDarrinAuth && window.supabaseClient) {
        return window.MyDarrinAuth.getCurrentUser().catch(function () { return null; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  defineste('toggleAuthModal', function () {
    var m = el('auth-modal');
    if (!m) { window.location.href = 'index.html?reason=cont'; return; }
    m.classList.toggle('hidden');
    document.body.style.overflow = m.classList.contains('hidden') ? '' : 'hidden';
  });

  // „Comenzile mele”: cu sesiune → dashboard-ul clientului; fără → contul.
  defineste('checkAuth', function () {
    utilizatorCurent().then(function (u) {
      if (u) { window.location.href = 'mydarrin-dashboard-client.html'; return; }
      window.toggleAuthModal();
      if (typeof window.switchAuthTab === 'function' && el('auth-modal')) window.switchAuthTab('login');
    });
  });

  // ── Devino partener ───────────────────────────────────────────────
  defineste('openPartnerModal', function (tip) {
    var m = el('partner-modal');
    if (!m) {
      window.location.href = 'mydarrin-devino-partener.html' + (tip ? '?type=' + encodeURIComponent(tip) : '');
      return;
    }
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (tip && typeof window.selectPartnerType === 'function') setTimeout(function () { window.selectPartnerType(tip); }, 80);
  });

  // ── Coșul: fără panou pe pagină → checkout (ca pe index.html) ─────
  defineste('toggleBasket', function () {
    var p = el('basket-panel');
    if (!p) { window.location.href = 'mydarrin-checkout.html'; return; }
    p.classList.toggle('hidden');
    document.body.style.overflow = p.classList.contains('hidden') ? '' : 'hidden';
  });

  // ── Consultanța Darrin AI: fereastra există doar în catalog ───────
  defineste('openConsultanta', function () { window.location.href = 'mydarrin-catalog.html?openAI=true'; });

  defineste('handlePartnerNavigation', function (tip) { window.openPartnerModal(tip); });

  // ── Rolurile mele (din account-system.js înainte de f845254) ──────
  var ROLURI = {
    client:             { titlu: 'Client',                 culoare: '#003366', fundal: 'linear-gradient(135deg,#EBF4FB,#DDE6F5)', dashboard: 'mydarrin-dashboard-client.html' },
    partener_servicii:  { titlu: 'Furnizor de Servicii',   culoare: '#FF8C00', fundal: 'linear-gradient(135deg,#FFF0D6,#FDE8C4)', dashboard: 'mydarrin-dashboard-partener.html?type=servicii', tip: 'servicii' },
    partener_materiale: { titlu: 'Furnizor de Materiale',  culoare: '#003366', fundal: 'linear-gradient(135deg,#EBF4FB,#DDE6F5)', dashboard: 'mydarrin-dashboard-furnizor.html?type=materiale', tip: 'materiale' },
    partener_inchirieri:{ titlu: 'Furnizor de Închirieri', culoare: '#0E9E99', fundal: 'linear-gradient(135deg,#E0F5F4,#C5EEEC)', dashboard: 'mydarrin-dashboard-furnizor.html?type=inchirieri', tip: 'inchirieri' },
    partener_curier:    { titlu: 'Curier de Cartier',      culoare: '#7C3AED', fundal: 'linear-gradient(135deg,#F3EEFF,#E9D8FD)', dashboard: 'mydarrin-dashboard-partener.html?type=curier', tip: 'curier' },
    partener_asigurari: { titlu: 'Furnizor de Asigurări',  culoare: '#1A7A3A', fundal: 'linear-gradient(135deg,#D4EDDA,#B8DFC5)', dashboard: 'mydarrin-dashboard-partener.html?type=asigurari', tip: 'asigurator' },
    investor:           { titlu: 'Investitor',             culoare: '#CC7000', fundal: 'linear-gradient(135deg,#FFF3E0,#FFE0B2)', dashboard: 'mydarrin-investitori.html' },
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  defineste('closeRolePicker', function () {
    var m = el('role-picker-modal');
    if (m) m.style.display = 'none';
    document.body.style.overflow = '';
  });

  defineste('openRolePicker', function () {
    utilizatorCurent().then(function (u) {
      if (!u) {
        window.toggleAuthModal();
        if (typeof window.switchAuthTab === 'function' && el('auth-modal')) window.switchAuthTab('register');
        return;
      }
      return window.MyDarrinAuth.getUserRoles(u).then(function (active) {
        var m = el('role-picker-modal');
        if (!m) {
          m = document.createElement('div');
          m.id = 'role-picker-modal';
          m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9500;align-items:center;justify-content:center;padding:16px';
          m.innerHTML =
            '<div style="position:absolute;inset:0;background:rgba(0,0,0,.5)" onclick="closeRolePicker()"></div>' +
            '<div style="position:relative;background:#fff;border-radius:20px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;padding:28px">' +
            '<button onclick="closeRolePicker()" aria-label="Închide" style="position:absolute;top:16px;right:16px;width:44px;height:44px;border-radius:9px;border:1px solid #E2E8F0;background:#fff;cursor:pointer;font-size:18px;color:#5A6B7D">×</button>' +
            '<h2 style="font-size:19px;font-weight:800;color:#1A2332;margin:0 44px 6px 0">Rolurile tale pe My Darrin</h2>' +
            '<p style="font-size:12.5px;color:#5A6B7D;margin:0 0 18px;line-height:1.6">Poți avea mai multe roluri pe același cont. Rolurile de partener se activează după înregistrarea și verificarea din „Devino partener”.</p>' +
            '<div id="role-picker-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px"></div></div>';
          document.body.appendChild(m);
        }
        el('role-picker-grid').innerHTML = Object.keys(ROLURI).map(function (cheie) {
          var r = ROLURI[cheie];
          var activ = active.indexOf(cheie) !== -1;
          var tinta = activ ? r.dashboard
            : cheie === 'investor' ? 'mydarrin-investitori.html'
            : r.tip ? 'mydarrin-devino-partener.html?type=' + r.tip
            : r.dashboard;
          return '<a href="' + esc(tinta) + '" style="display:block;text-decoration:none;background:' + (activ ? r.fundal : '#F8FAFC') +
            ';border:1.5px solid ' + (activ ? r.culoare : '#E2E8F0') + ';border-radius:14px;padding:16px;position:relative">' +
            (activ ? '<span style="position:absolute;top:8px;right:8px;font-size:10px;background:' + r.culoare + ';color:#fff;padding:2px 8px;border-radius:99px;font-weight:700">ACTIV</span>' : '') +
            '<div style="font-weight:700;font-size:13px;color:#1A2332">' + esc(r.titlu) + '</div>' +
            '<div style="font-size:11px;color:#5A6B7D;margin-top:4px">' + (activ ? 'Mergi la dashboard →' : 'Adaugă acest rol →') + '</div></a>';
        }).join('');
        m.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      });
    }).catch(function (e) { console.warn('[ui-comun] rolurile nu au putut fi citite:', e && e.message); });
  });

})();

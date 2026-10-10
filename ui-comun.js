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
      // mesajul comun, tradus (vezi „GPS doar la cerere” mai jos)
      window.showGeoToast(window.MYD_GPS ? window.MYD_GPS.mesajEroare(err) : 'Eroare GPS');
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

  // ── Butoanele plutitoare și straturile pe mobil (9 oct. 2026) ────────
  // Regulile vizuale sunt în ui-public.css; aici doar stările:
  //  - iconițele butonului Darrin AI: pe multe pagini butonul apare în HTML
  //    DUPĂ ultimul lucide.createIcons(), așa că <i data-lucide> rămânea gol
  //    (cercul închis fără iconiță). Le transformăm după încărcare; dacă
  //    biblioteca nu e disponibilă (ex. blocată în browserul Facebook),
  //    punem o iconiță SVG inline. Plus eticheta „Darrin AI” (vizibilă pe mobil);
  //  - html.myd-are-mbn: bara de jos e vizibilă (butonul urcă deasupra ei);
  //  - html.myd-strat-deschis: meniul lateral sau o fereastră e deschisă —
  //    butonul plutitor se ascunde;
  //  - share-ul trece în meniul lateral (butonul plutitor de share e ascuns
  //    pe mobil din CSS).
  var SVG_BOT = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>';

  function iconiteFab() {
    try { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (e) {}
    var fab = el('dai-fab');
    if (!fab) return;
    var chat = el('dai-fab-icon-chat');
    if (!fab.querySelector('svg')) {
      var loc = el('dai-fab-icon') || fab;
      var inchis = chat && chat.style && chat.style.display === 'none';
      loc.innerHTML = '<span id="dai-fab-icon-chat"' + (inchis ? ' style="display:none"' : '') + '>' + SVG_BOT + '</span>' +
        '<span id="dai-fab-icon-close" style="display:' + (inchis ? '' : 'none') + ';color:#fff;font-size:22px;line-height:1">×</span>';
    }
    if (!fab.querySelector('.myd-fab-eticheta')) {
      var et = document.createElement('span');
      et.className = 'myd-fab-eticheta';
      et.textContent = 'Darrin AI';
      fab.appendChild(et);
    }
    if (!fab.getAttribute('aria-label')) fab.setAttribute('aria-label', 'Darrin AI — asistentul My Darrin');
    document.body.classList.add('myd-are-fab');
  }

  function vizibil(x) {
    if (!x) return false;
    var cs = getComputedStyle(x);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    var r = x.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
  }

  function stareBaraJos() {
    var nav = el('mobile-bottom-nav');
    var areBara = vizibil(nav);
    document.documentElement.classList.toggle('myd-are-mbn', areBara);
    if (areBara) document.documentElement.style.setProperty('--myd-mbn-h', Math.round(nav.getBoundingClientRect().height) + 'px');
    if (el('chat-toggle')) document.body.classList.add('myd-are-fab');
  }

  var SELECTOR_STRAT = '[id$="-modal"],[id$="-overlay"],[id$="-drawer"],#basket-panel,#zone-unavailable,#myd-loc-fereastra';
  function stratDeschis() {
    var sb = el('sidebar');
    if (sb && sb.classList.contains('open')) return true;
    var noduri = document.querySelectorAll(SELECTOR_STRAT);
    for (var i = 0; i < noduri.length; i++) {
      var n = noduri[i];
      if (n.id === 'sidebar-overlay' || n.id === 'dai-chat-panel') continue;
      if (getComputedStyle(n).position !== 'fixed' || !vizibil(n)) continue;
      var r = n.getBoundingClientRect();
      if (r.width * r.height > window.innerWidth * window.innerHeight * 0.3) return true;
    }
    return false;
  }
  var programat = false;
  function actualizeazaStraturi() {
    if (programat) return;
    programat = true;
    requestAnimationFrame(function () {
      programat = false;
      document.documentElement.classList.toggle('myd-strat-deschis', stratDeschis());
      stareBaraJos();
    });
  }

  // „Distribuie pagina” nu mai stă în meniul lateral (decizie LM, 10 oct. 2026):
  // share rămâne doar butonul plutitor din share-widget.js (ascuns pe mobil).

  function pornestePlutitoare() {
    iconiteFab();
    stareBaraJos();
    actualizeazaStraturi();
    try {
      new MutationObserver(function (lista) {
        actualizeazaStraturi();
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    } catch (e) {}
    window.addEventListener('resize', actualizeazaStraturi);
    window.addEventListener('load', function () { iconiteFab(); actualizeazaStraturi(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pornestePlutitoare);
  else pornestePlutitoare();

  // ── Locația, păstrată între pagini (9 oct. 2026) ──────────────────────
  // Raport LM: pe unele pagini bara de jos arăta orașul, pe altele doar
  // „Locație”; pe paginile fără #loc-modal butonul era mort. Cauze:
  //  - locația aleasă / detectată nu se salva nicăieri;
  //  - unele pagini ascultă `myd-geo-update` pe document, dar evenimentul
  //    e emis pe window — ascultătorul nu primea nimic;
  //  - openLocModal() nu făcea nimic fără #loc-modal.
  // Acum: localStorage `myd_locatie` (try/catch), aplicată la încărcarea
  // oricărei pagini (bara de jos, antet, câmpul din fereastră); schimbarea
  // emite `myd-geo-update` pe window ȘI pe document. Fără #loc-modal se
  // deschide o fereastră simplă: GPS + oraș cu sugestii.
  var CHEIE_LOC = 'myd_locatie';
  var ORASE = ['București', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Constanța', 'Craiova', 'Brașov', 'Galați', 'Ploiești', 'Oradea', 'Brăila', 'Arad', 'Pitești', 'Sibiu', 'Bacău', 'Târgu Mureș', 'Baia Mare', 'Buzău', 'Botoșani', 'Satu Mare', 'Râmnicu Vâlcea', 'Suceava', 'Piatra Neamț', 'Târgu Neamț', 'Drobeta-Turnu Severin', 'Focșani', 'Târgu Jiu', 'Tulcea', 'Târgoviște', 'Reșița', 'Bistrița', 'Slatina', 'Călărași', 'Alba Iulia', 'Giurgiu', 'Deva', 'Hunedoara', 'Zalău', 'Sfântu Gheorghe', 'Bârlad', 'Vaslui', 'Roman', 'Turda', 'Mediaș', 'Slobozia', 'Alexandria', 'Voluntari', 'Lugoj', 'Medgidia', 'Onești', 'Miercurea Ciuc', 'Chișinău'];

  function citesteLocatie() {
    try { var v = JSON.parse(localStorage.getItem(CHEIE_LOC) || 'null'); return v && v.oras ? v : null; } catch (e) { return null; }
  }
  function scrieLocatie(d) {
    try { localStorage.setItem(CHEIE_LOC, JSON.stringify(d)); } catch (e) {}
  }
  function emiteGeo(d) {
    var detaliu = { country: d.tara || 'RO', city: d.oras, region: d.regiune || '', address: d.adresa || '', source: d.sursa || 'manual', din_ui_comun: true };
    try { window.dispatchEvent(new CustomEvent('myd-geo-update', { detail: detaliu })); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('myd-geo-update', { detail: detaliu })); } catch (e) {}
  }
  function afiseazaLocatie(d) {
    if (!d || !d.oras) return;
    var text = d.adresa || d.oras;
    var disp = el('loc-display'), inp = el('loc-input'), mbn = el('mbn-loc-text'), loc2 = el('myd-loc-oras');
    if (disp && disp.textContent !== text) disp.textContent = text;
    if (inp && document.activeElement !== inp) inp.value = text;
    if (mbn && mbn.textContent !== d.oras) mbn.textContent = d.oras;
    if (loc2 && document.activeElement !== loc2) loc2.value = d.oras;
  }
  function salveazaSiAplica(d) {
    d.ts = Date.now();
    scrieLocatie(d);
    afiseazaLocatie(d);
    emiteGeo(d);
  }

  // Fereastra simplă, pentru paginile fără #loc-modal.
  function fereastraLocatie() {
    var f = el('myd-loc-fereastra');
    if (!f) {
      f = document.createElement('div');
      f.id = 'myd-loc-fereastra';
      f.setAttribute('role', 'dialog');
      f.setAttribute('aria-label', 'Alege locația');
      f.style.cssText = 'position:fixed;inset:0;z-index:3100;display:none;align-items:center;justify-content:center;padding:16px';
      f.innerHTML =
        '<div style="position:absolute;inset:0;background:rgba(0,0,0,.45)" data-inchide="1"></div>' +
        '<div style="position:relative;background:#fff;border-radius:18px;width:100%;max-width:380px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:inherit">' +
          '<div style="font-size:17px;font-weight:800;color:#1A2332;margin-bottom:4px">Locația ta</div>' +
          '<div style="font-size:12.5px;color:#6B7A8D;margin-bottom:14px">O folosim pentru partenerii din zonă și pentru prețuri.</div>' +
          '<button type="button" id="myd-loc-gps" style="width:100%;min-height:48px;border:none;border-radius:12px;background:#FF8C00;color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;margin-bottom:12px">' + trG('gps.buton_gps', 'Folosește locația mea (GPS)') + '</button>' +
          '<label for="myd-loc-oras" style="font-size:12px;font-weight:700;color:#5A6B7D">Sau scrie orașul</label>' +
          '<input id="myd-loc-oras" list="myd-loc-sugestii" autocomplete="address-level2" placeholder="ex. Iași" style="width:100%;box-sizing:border-box;margin-top:6px;padding:12px;border:1.5px solid #D5DFE8;border-radius:12px;font-size:15px;font-family:inherit"/>' +
          '<datalist id="myd-loc-sugestii">' + ORASE.map(function (o) { return '<option value="' + o + '"></option>'; }).join('') + '</datalist>' +
          '<div style="display:flex;gap:8px;margin-top:14px">' +
            '<button type="button" data-inchide="1" style="flex:1;min-height:44px;border:1.5px solid #D5DFE8;border-radius:12px;background:#fff;color:#5A6B7D;font-weight:700;cursor:pointer;font-family:inherit">Renunță</button>' +
            '<button type="button" id="myd-loc-salveaza" style="flex:2;min-height:44px;border:none;border-radius:12px;background:#003366;color:#fff;font-weight:800;cursor:pointer;font-family:inherit">Salvează locația</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(f);
      f.addEventListener('click', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-inchide')) inchideFereastra(); });
      el('myd-loc-gps').onclick = function () { inchideFereastra(); gpsDinFereastra(); };
      el('myd-loc-salveaza').onclick = function () {
        var v = (el('myd-loc-oras').value || '').trim();
        if (!v) { el('myd-loc-oras').focus(); return; }
        salveazaSiAplica({ oras: v, tara: v === 'Chișinău' ? 'MD' : 'RO', sursa: 'manual' });
        inchideFereastra();
        window.showGeoToast && window.showGeoToast('Locația a fost salvată: ' + v);
      };
    }
    var d = citesteLocatie();
    el('myd-loc-oras').value = d ? d.oras : '';
    f.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function inchideFereastra() {
    var f = el('myd-loc-fereastra');
    if (f) f.style.display = 'none';
    document.body.style.overflow = '';
  }

  // openLocModal: pagina are #loc-modal → al ei (cu buton GPS adăugat);
  // altfel fereastra de mai sus. Se înlocuiește și varianta paginii, ca
  // butonul să nu mai fie mort nicăieri.
  var openLocPagina = typeof window.openLocModal === 'function' ? window.openLocModal : null;
  window.openLocModal = function () {
    var m = el('loc-modal');
    if (!m) { fereastraLocatie(); return; }
    if (!m.querySelector('#myd-loc-gps-modal')) {
      var inp = el('loc-input');
      var b = document.createElement('button');
      b.type = 'button';
      b.id = 'myd-loc-gps-modal';
      b.textContent = trG('gps.buton_gps', 'Folosește locația mea (GPS)');
      b.style.cssText = 'width:100%;min-height:44px;border:none;border-radius:12px;background:#FF8C00;color:#fff;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;margin-bottom:12px';
      b.onclick = function () { window.closeLocModal(); gpsDinFereastra(); };
      var tinta = inp ? inp.closest('div') : null;
      if (tinta && tinta.parentNode) tinta.parentNode.insertBefore(b, tinta);
    }
    if (openLocPagina) openLocPagina(); else { m.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  };

  // saveLocation (al paginii sau al nostru) → și salvăm.
  var saveLocPagina = typeof window.saveLocation === 'function' ? window.saveLocation : null;
  window.saveLocation = function () {
    var inp = el('loc-input');
    var v = inp ? (inp.value || '').trim() : '';
    if (saveLocPagina) saveLocPagina.apply(this, arguments);
    else window.closeLocModal();
    if (v) salveazaSiAplica({ oras: v.split(',')[0].trim(), adresa: v, tara: 'RO', sursa: 'manual' });
  };

  // Tab-ul „Locație” din bara de jos deschide fereastra (GPS + oraș), nu
  // doar GPS-ul direct — în browserul Facebook GPS-ul e adesea blocat.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#mbn-gps');
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.openLocModal();
  }, true);

  // Detectările (GPS / adresă) salvează; IP-ul nu suprascrie o alegere.
  function laGeo(e) {
    var d = e && e.detail;
    if (!d || d.din_ui_comun) return;
    var salvata = citesteLocatie();
    if ((d.source === 'gps' || d.source === 'manual') && d.city) {
      scrieLocatie({ oras: d.city, regiune: d.region || '', adresa: d.address || '', tara: d.country || 'RO', sursa: d.source, ts: Date.now() });
      if (el('mbn-loc-text')) el('mbn-loc-text').textContent = d.city;
    } else if (salvata) {
      setTimeout(function () { afiseazaLocatie(salvata); }, 0);
    }
  }
  window.addEventListener('myd-geo-update', laGeo);

  function pornesteLocatie() {
    var d = citesteLocatie();
    if (!d) return;
    afiseazaLocatie(d);
    // Detectările automate ale paginii (IP, cache) rulează după încărcare și
    // ar rescrie afișajul — reaplicăm alegerea salvată.
    setTimeout(function () { afiseazaLocatie(citesteLocatie()); }, 1500);
    setTimeout(function () { afiseazaLocatie(citesteLocatie()); }, 4000);
    emiteGeo(d);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pornesteLocatie);
  else pornesteLocatie();


  // ── GPS doar la cerere (decizie LM, 10 oct. 2026) ─────────────────────
  // La deschiderea paginii locația vine doar din IP (myd-geo.js / modulul GEO
  // inline). GPS se cere numai când vizitatorul apasă explicit un buton:
  //  - fereastra de locație și tab-ul „Locație” din bara de jos;
  //  - „Folosește locația mea”, lângă câmpul de adresă din checkout și din
  //    pagina de produs (completează adresa; câmpul rămâne editabil).
  // Un singur apel getCurrentPosition pe apăsare; la refuz, mesaj tradus.
  function trG(k, ro) { return typeof window.t === 'function' ? window.t(k, ro) : ro; }

  function cereGPS() {
    return new Promise(function (ok, fail) {
      if (!navigator.geolocation) { fail({ code: 'no-api' }); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude, acc = Math.round(pos.coords.accuracy);
        var limba = (window.MYD_I18N && window.MYD_I18N.lang) === 'ro' ? 'ro' : 'en';
        fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&addressdetails=1&accept-language=' + limba)
          .then(function (r) { return r.json(); })
          .then(function (geo) {
            var a = (geo && geo.address) || {};
            var oras = a.city || a.town || a.village || a.municipality || '';
            var regiune = a.county || a.state || '';
            var strada = [a.road, a.house_number].filter(Boolean).join(' ');
            ok({ country: (a.country_code || 'ro').toUpperCase(), city: oras, region: regiune, street: strada,
              address: [strada, oras, regiune].filter(Boolean).join(', '), lat: lat, lng: lng, accuracy: acc, source: 'gps' });
          })
          .catch(function () {
            ok({ country: 'RO', city: '', region: '', street: '', address: '', lat: lat, lng: lng, accuracy: acc, source: 'gps' });
          });
      }, function (err) { fail(err || {}); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }

  function mesajEroareGPS(err) {
    var c = err && err.code;
    if (c === 1) return trG('gps.blocat', 'Accesul la locație e blocat. Poți scrie adresa sau poți permite locația din setările browserului.');
    if (c === 2) return trG('gps.semnal_slab', 'Semnal GPS slab — încearcă în exterior sau lângă fereastră');
    if (c === 3) return trG('gps.timeout', 'Timeout GPS — încearcă din nou');
    if (c === 'no-api') return trG('gps.indisponibil', 'GPS indisponibil în acest browser');
    return trG('gps.eroare', 'Nu am putut afla locația. Poți scrie adresa.');
  }

  window.MYD_GPS = { cere: cereGPS, mesajEroare: mesajEroareGPS };

  // Butoanele GPS din fereastra de locație (pagini cu sau fără #loc-modal).
  function gpsDinFereastra() {
    window.showGeoToast(trG('gps.se_cauta', 'Se caută locația…'));
    cereGPS().then(function (d) {
      if (d.city || d.region) salveazaSiAplica({ oras: d.city || d.region, regiune: d.region, adresa: d.address, tara: d.country, sursa: 'gps' });
      aplicaLocatie(d);
      window.showGeoToast(trG('gps.detectata', 'Locația ta a fost detectată') + (d.city ? ': ' + d.city : ''));
    }, function (err) { window.showGeoToast(mesajEroareGPS(err)); });
  }
  window.MYD_GPS.dinFereastra = gpsDinFereastra;

  // „Folosește locația mea” lângă un câmp de adresă.
  function butonGPSLangaCamp(input, umple) {
    if (!input || input.getAttribute('data-gps-buton')) return;
    input.setAttribute('data-gps-buton', '1');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'myd-gps-buton';
    b.style.cssText = 'margin-top:6px;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:6px 12px;border-radius:10px;border:1.5px solid #D5DFE8;background:#fff;color:#003366;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit';
    var et = document.createElement('span');
    et.textContent = trG('gps.buton', 'Folosește locația mea');
    b.innerHTML = '<span aria-hidden="true">📍</span>';
    b.appendChild(et);
    var msg = document.createElement('div');
    msg.className = 'myd-gps-mesaj';
    msg.setAttribute('role', 'status');
    msg.style.cssText = 'display:none;margin-top:6px;font-size:12px;line-height:1.4;font-weight:600';
    b.onclick = function () {
      b.disabled = true;
      var text = et.textContent;
      et.textContent = trG('gps.se_cauta', 'Se caută locația…');
      msg.style.display = 'none';
      cereGPS().then(function (d) {
        umple(d);
        b.disabled = false; et.textContent = text;
        msg.style.color = '#1A7A3A';
        msg.textContent = '✓ ' + trG('gps.completata', 'Adresa a fost completată din locația ta — verific-o înainte de a continua.');
        msg.style.display = 'block';
      }, function (err) {
        b.disabled = false; et.textContent = text;
        msg.style.color = '#C0392B';
        msg.textContent = mesajEroareGPS(err);
        msg.style.display = 'block';
      });
    };
    input.insertAdjacentElement('afterend', msg);
    input.insertAdjacentElement('afterend', b);
  }
  function declanseaza(inp, tip) { try { inp.dispatchEvent(new Event(tip, { bubbles: true })); } catch (e) {} }

  function pornesteGPSLaCerere() {
    // pagina de produs: o singură linie de adresă (onAddr() o geocodează)
    var addr = el('addr-input');
    butonGPSLangaCamp(addr, function (d) {
      addr.value = d.address || [d.city, d.region].filter(Boolean).join(', ');
      declanseaza(addr, 'input');
    });
    // checkout: stradă + oraș + județ
    var co = el('co-adresa');
    butonGPSLangaCamp(co, function (d) {
      if (d.street) { co.value = d.street; declanseaza(co, 'input'); }
      var oras = el('co-oras');
      if (oras && d.city) { oras.value = d.city; declanseaza(oras, 'input'); }
      var jud = el('co-judet');
      if (jud && d.region) {
        var cauta = d.region.replace(/^(Județul|Judetul|County of)\s+/i, '').replace(/\s+County$/i, '').trim().toLowerCase();
        var fara = function (s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
        for (var i = 0; i < jud.options.length; i++) {
          var o = jud.options[i];
          if (o.value && (fara(o.value) === fara(cauta) || (/bucure/.test(fara(cauta)) && /bucure/.test(fara(o.value))))) { jud.value = o.value; declanseaza(jud, 'change'); break; }
        }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pornesteGPSLaCerere);
  else pornesteGPSLaCerere();

  // ── Limba și țara, sus în meniul lateral (9 oct. 2026) ─────────────────
  // Pe mobil nu exista niciun selector: cel de limbă (#langDd) stă în bara
  // de sus, ascunsă sub 768 px, și există doar pe 6 pagini. Acum, pe toate
  // paginile, sus în meniul lateral: limba (fișierele din /i18n) și țara
  // (țările cu checkout activ, /api/public/tari-active).
  //  - limba: i18n-loader.js (încărcat aici dacă pagina nu-l are), salvată
  //    în localStorage `myd_lang_v1`, ca pe desktop;
  //  - țara: localStorage `myd_tara`; se aplică prin mecanismul paginii
  //    (MYD_GEO.setCountry / setManual / applyGeoData) și evenimentul
  //    `myd:tara` (pagina de produs recalculează prețul și TVA-ul).
  var LIMBI = [['ro', '🇷🇴', 'Română'], ['en', '🇬🇧', 'English'], ['de', '🇩🇪', 'Deutsch'], ['fr', '🇫🇷', 'Français'], ['tr', '🇹🇷', 'Türkçe'], ['bg', '🇧🇬', 'Български'], ['el', '🇬🇷', 'Ελληνικά']];
  var STEAGURI = { RO: '🇷🇴', MD: '🇲🇩', AT: '🇦🇹', BG: '🇧🇬', GR: '🇬🇷', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', HU: '🇭🇺', PL: '🇵🇱' };
  var CHEIE_LIMBA = 'myd_lang_v1', CHEIE_TARA = 'myd_tara';
  function citeste(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function scrie(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var promI18n = null;
  function asiguraI18n() {
    if (window.MYD_I18N) return Promise.resolve(window.MYD_I18N);
    if (promI18n) return promI18n;
    promI18n = new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = 'i18n-loader.js';
      s.onload = function () { ok(window.MYD_I18N || null); };
      s.onerror = function () { ok(null); };
      document.head.appendChild(s);
    });
    return promI18n;
  }

  // Schimbarea limbii o face i18n-loader.js: salvează alegerea și reîncarcă
  // pagina (textele românești vin din HTML, traducerea se aplică la încărcare).
  function schimbaLimba(cod) {
    scrie(CHEIE_LIMBA, cod);
    asiguraI18n().then(function (i18n) {
      if (i18n) i18n.setLanguage(cod, { persist: true });
      else location.reload();
    });
  }

  function aplicaTara(cc, emite) {
    if (!cc) return;
    var loc = citesteLocatie();
    try {
      if (window.MYD_GEO && typeof window.MYD_GEO.setCountry === 'function') window.MYD_GEO.setCountry(cc);
      else if (window.MYD_GEO && typeof window.MYD_GEO.setManual === 'function') window.MYD_GEO.setManual(cc);
      else if (typeof window.applyGeoData === 'function') window.applyGeoData({ country: cc, city: (loc && loc.oras) || '', source: 'manual' });
    } catch (e) { console.warn('[ui-comun] aplicarea țării a eșuat:', e.message); }
    if (emite !== false) { try { window.dispatchEvent(new CustomEvent('myd:tara', { detail: { tara: cc } })); } catch (e) {} }
  }

  function schimbaTara(cc) {
    scrie(CHEIE_TARA, cc);
    aplicaTara(cc, true);
  }

  var tariCache = null;
  function incarcaTari() {
    if (tariCache) return Promise.resolve(tariCache);
    return fetch('/api/public/tari-active').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { tariCache = (d && d.tari) || [{ tara_cod: 'RO', tara_nume: 'România' }]; return tariCache; })
      .catch(function () { return [{ tara_cod: 'RO', tara_nume: 'România' }]; });
  }

  function adaugaSelectorInMeniu() {
    var sb = el('sidebar');
    if (!sb || sb.querySelector('#sb-limba-tara')) return;
    // Paginile interne (superadmin, back-office) rămân în română.
    if (window.MYD_I18N && window.MYD_I18N.intern) return;
    var bloc = document.createElement('div');
    bloc.id = 'sb-limba-tara';
    // un singur rând compact; vizibil doar când bara de sus nu-și arată selectorul
    bloc.style.cssText = 'display:none;gap:8px;padding:10px 20px;border-bottom:1px solid #F0F2F7;align-items:flex-end';
    // limba activă: aleasă sau, la prima vizită, engleza (i18n-loader.js)
    var limba = (window.MYD_I18N && window.MYD_I18N.lang) || citeste(CHEIE_LIMBA) || 'en';
    var tr = function (k, ro) { return typeof window.t === 'function' ? window.t(k, ro) : ro; };
    var etL = tr('meniu.limba', 'Limba'), etT = tr('meniu.tara', 'Țara');
    var stil = 'width:100%;min-height:40px;border:1.5px solid #D5DFE8;border-radius:10px;padding:0 8px;font-size:13.5px;font-family:inherit;background:#fff;color:#1A2332';
    var stilEt = 'flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:3px;font-size:10px;font-weight:700;color:#8C9BAD;text-transform:uppercase;letter-spacing:.06em';
    bloc.innerHTML =
      '<label class="sb-lt-et" style="' + stilEt + '">' + etL +
        '<select id="sb-limba" aria-label="' + etL + '" style="' + stil + '">' + LIMBI.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === limba ? ' selected' : '') + '>' + l[1] + ' ' + l[2] + '</option>'; }).join('') + '</select></label>' +
      '<label class="sb-lt-et" style="' + stilEt + '">' + etT +
        '<select id="sb-tara" aria-label="' + etT + '" style="' + stil + '"><option value="RO">🇷🇴 ' + tr('', 'România') + '</option></select></label>';
    // sub antetul meniului (logo + închidere)
    var antet = sb.firstElementChild;
    if (antet && antet.nextSibling) sb.insertBefore(bloc, antet.nextSibling); else sb.insertBefore(bloc, sb.firstChild);
    el('sb-limba').onchange = function () { schimbaLimba(this.value); };
    incarcaTari().then(function (tari) {
      var sel = el('sb-tara');
      if (!sel) return;
      var curenta = citeste(CHEIE_TARA) || 'RO';
      var trN = function (s) { return typeof window.t === 'function' ? window.t('', s) : s; };
      sel.innerHTML = tari.map(function (t) { return '<option value="' + t.tara_cod + '"' + (t.tara_cod === curenta ? ' selected' : '') + '>' + (STEAGURI[t.tara_cod] || '') + ' ' + trN(t.tara_nume) + '</option>'; }).join('');
      sel.onchange = function () { schimbaTara(this.value); };
    });
    vizibilitateSelector();
  }

  // Selectorul din meniu apare doar când selectorul din bara de sus (#langDd /
  // .lang-chip) nu e vizibil: bara de sus se ascunde sub 768 px (Tailwind md:),
  // deci pe paginile cu bară de sus pragul e exact al ei; pe paginile fără
  // selector sus, meniul rămâne singurul loc de unde se schimbă limba.
  function selectorSusVizibil() {
    var noduri = document.querySelectorAll('#langDd, .lang-chip, #lang-switcher');
    for (var i = 0; i < noduri.length; i++) {
      var n = noduri[i];
      if (n.closest && n.closest('#sidebar')) continue;
      var r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden') return true;
    }
    return false;
  }
  function vizibilitateSelector() {
    var bloc = el('sb-limba-tara');
    if (bloc) bloc.style.display = selectorSusVizibil() ? 'none' : 'flex';
  }

  function pornesteLimbaTara() {
    adaugaSelectorInMeniu();
    window.addEventListener('resize', vizibilitateSelector);
    // și la deschiderea meniului (bara de sus poate fi ascunsă de stilurile paginii)
    document.addEventListener('click', function () { setTimeout(vizibilitateSelector, 0); }, true);
    try { new MutationObserver(function () { adaugaSelectorInMeniu(); }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    // Limba aleasă (alt cod decât ro) pe o pagină fără i18n-loader.js.
    var limba = citeste(CHEIE_LIMBA);
    if (limba && limba !== 'ro' && !window.MYD_I18N) asiguraI18n();
    // Țara aleasă se reaplică după detectarea automată a paginii (IP / cache).
    var tara = citeste(CHEIE_TARA);
    if (tara) {
      setTimeout(function () { aplicaTara(tara, true); }, 1200);
      setTimeout(function () { aplicaTara(tara, false); }, 3500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pornesteLimbaTara);
  else pornesteLimbaTara();

})();

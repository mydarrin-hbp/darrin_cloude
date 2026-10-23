/* ════════════════════════════════════════════════════════════════
   pitch-deck-prezentare.js — modurile de prezentare ale pitch deck-ului
   (pasul 11-K3, 23 oct. 2026; cerința LM din 23 oct.). Același modul pentru:
     - pagina publică mydarrin-pitch-deck.html;
     - previzualizarea din back-office (mydarrin-superadmin.html).
   Butonul „▶ Prezintă” deschide meniul cu exact trei moduri, în ordinea:
     1. Ecran complet;  2. Vedere prezentator;  3. Redare automată.
   Desktop / tabletă landscape: dropdown ancorat sub buton, aliniat la
   dreapta lui. Tabletă portrait / telefon (< 768 px sau pe verticală):
   foaie de jos (bottom sheet) cu mâner și fundal estompat.
   Opțiunile indisponibile rămân în meniu, dezactivate, cu motivul scris.

   Dreptul la vederea prezentatorului îl decide serverul (acțiunea
   `prezentare` / `previzualizare` din api/admin/pitch-deck.js, din
   profiles.roles și admin_permissions); pagina doar afișează răspunsul.

   În Node (teste) se exportă doar textele și vitezele.
   ════════════════════════════════════════════════════════════════ */
(function (radacina, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(null);
  else radacina.MDPrezentare = fabrica(radacina);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  // ── Texte (RO pentru interfața în română, EN pentru celelalte limbi) ──
  var TEXTE = {
    ro: {
      prezinta: 'Prezintă', meniu: 'Moduri de prezentare',
      ecran_t: 'Ecran complet', ecran_d: 'Prezintă pe tot ecranul',
      prez_t: 'Vedere prezentator', prez_d: 'Vezi notele și slide-urile următoare',
      auto_t: 'Redare automată', auto_d: 'Setează viteza de derulare automată',
      motiv_admin: 'Disponibilă pentru administratori', motiv_ecran: 'Necesită un ecran mai mare sau orientare orizontală',
      motiv_verifica: 'Se verifică accesul…',
      iesire: 'Ieși din ecran complet', ecran_real: 'Treci în ecran complet', anterior: 'Slide-ul anterior', urmator: 'Slide-ul următor',
      roteste: 'Rotește telefonul pentru o vizualizare mai bună', inchide_mesaj: 'Închide mesajul',
      pv_titlu: 'Vedere prezentator', urmeaza: 'Urmează', final: 'Sfârșitul prezentării', note: 'Note',
      fara_note: 'Fără note pentru acest slide', text_mic: 'Text mai mic', text_mare: 'Text mai mare',
      cronometru: 'Cronometru', cron_pauza: 'Pune cronometrul pe pauză', cron_porneste: 'Pornește cronometrul', cron_reset: 'Resetează cronometrul',
      ora: 'Ora curentă', negru: 'Ecran negru', negru_activ: 'Ecranul publicului e negru (B)', incheie: 'Încheie prezentarea',
      miniaturi: 'Toate slide-urile', mergi_la: 'Mergi la slide-ul', slide: 'Slide', din: 'din',
      blocat_t: 'Fereastra prezentatorului a fost blocată',
      blocat_p: 'Browserul a blocat deschiderea unei ferestre noi. Permite ferestrele pop-up pentru acest site sau continuă pe un singur ecran.',
      un_ecran: 'Continuă pe un singur ecran', inchide: 'Închide', conectare: 'Se conectează la fereastra publicului…',
      deconectat: 'Fereastra publicului s-a închis. Închide această fereastră și pornește din nou vederea prezentatorului.',
      fara_canal: 'Deschide vederea prezentatorului din pitch deck: „▶ Prezintă” → „Vedere prezentator”.',
      eroare_note: 'Notele nu se pot încărca acum. Încearcă din nou.', pe_ecran: 'Vederea prezentatorului e deschisă în altă fereastră.',
      viteza: 'Viteza (pe slide)', viteza_aria: 'secunde pe slide', bucla: 'Reia de la început la final', porneste: 'Pornește',
      pauza: 'Pauză', continua: 'Continuă', opreste: 'Oprește redarea automată',
    },
    en: {
      prezinta: 'Present', meniu: 'Presentation modes',
      ecran_t: 'Full screen', ecran_d: 'Present in full screen',
      prez_t: 'Presenter view', prez_d: 'View notes and upcoming slides',
      auto_t: 'Autoplay', auto_d: 'Set speed to automatically play',
      motiv_admin: 'Available to administrators', motiv_ecran: 'Requires a larger screen or landscape orientation',
      motiv_verifica: 'Checking access…',
      iesire: 'Exit full screen', ecran_real: 'Switch to full screen', anterior: 'Previous slide', urmator: 'Next slide',
      roteste: 'Rotate your phone for a better view', inchide_mesaj: 'Dismiss the message',
      pv_titlu: 'Presenter view', urmeaza: 'Up next', final: 'End of the presentation', note: 'Notes',
      fara_note: 'No notes for this slide', text_mic: 'Smaller text', text_mare: 'Larger text',
      cronometru: 'Timer', cron_pauza: 'Pause the timer', cron_porneste: 'Start the timer', cron_reset: 'Reset the timer',
      ora: 'Current time', negru: 'Black screen', negru_activ: 'The audience screen is black (B)', incheie: 'End the presentation',
      miniaturi: 'All slides', mergi_la: 'Go to slide', slide: 'Slide', din: 'of',
      blocat_t: 'The presenter window was blocked',
      blocat_p: 'The browser blocked a new window. Allow pop-ups for this site or continue on a single screen.',
      un_ecran: 'Continue on a single screen', inchide: 'Close', conectare: 'Connecting to the audience window…',
      deconectat: 'The audience window was closed. Close this window and start the presenter view again.',
      fara_canal: 'Open the presenter view from the pitch deck: “▶ Present” → “Presenter view”.',
      eroare_note: 'The notes cannot be loaded right now. Please try again.', pe_ecran: 'The presenter view is open in another window.',
      viteza: 'Speed (per slide)', viteza_aria: 'seconds per slide', bucla: 'Start over at the end', porneste: 'Start',
      pauza: 'Pause', continua: 'Resume', opreste: 'Stop autoplay',
    },
  };
  var MODURI = ['ecran', 'prezentator', 'auto'];
  // Redarea automată (2.5): secunde pe slide; implicit 10 s.
  var VITEZE = [5, 10, 15, 30, 60], VITEZA_IMPLICITA = 10, CHEIE_VITEZA = 'mdpd_autoplay_viteza_v1';

  var exporturi = { TEXTE: TEXTE, MODURI: MODURI, VITEZE: VITEZE, VITEZA_IMPLICITA: VITEZA_IMPLICITA };
  if (!win) return exporturi;

  var doc = win.document;
  var nr = 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Ascultătorii pe document / fereastră, ca să poată fi scoși la distrugere.
  function leaga(lista, tinta, ev, fn, opt) { tinta.addEventListener(ev, fn, opt); lista.push([tinta, ev, fn, opt]); }
  function dezleaga(lista) { lista.splice(0).forEach(function (x) { x[0].removeEventListener(x[1], x[2], x[3]); }); }
  function el(tag, cls, atr) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    Object.keys(atr || {}).forEach(function (k) { e.setAttribute(k, atr[k]); });
    return e;
  }

  // Iconițele (24 px), desenate în cod: fără fișiere și fără biblioteci.
  var ICO = {
    ecran: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    prezentator: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="16.5" y="4" width="5" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16.5 11h5M16.5 14h5M2.5 17.5h19M8.5 13v4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/></svg>',
  };

  // Telefon / tabletă portrait → foaie de jos; altfel dropdown ancorat.
  function esteFoaie() {
    var w = win.innerWidth, h = win.innerHeight;
    return w < 768 || (h > w && w < 1024);
  }

  /**
   * Leagă butonul „▶ Prezintă” de deck.
   * o: { buton, limba() → 'ro'|'en', moduri: { ecran, prezentator, auto } (acțiunile),
   *      stareMod(mod) → null (disponibil) | text (motivul dezactivării),
   *      laDeschidere() (ex. pauza redării automate) }
   */
  function meniu(o) {
    var id = 'pdp-meniu-' + (++nr);
    var T = function () { return TEXTE[o.limba() === 'ro' ? 'ro' : 'en']; };
    var fundal = el('div', 'pdp-fundal', { hidden: '', 'data-i18n-skip': '' });
    var m = el('div', 'pdp-meniu', { id: id, role: 'menu', hidden: '', 'data-i18n-skip': '', tabindex: '-1' });
    doc.body.appendChild(fundal);
    doc.body.appendChild(m);
    var b = o.buton;
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', id);

    function deseneaza() {
      var t = T();
      m.setAttribute('aria-label', t.meniu);
      m.innerHTML = '<div class="pdp-maner" aria-hidden="true"></div>' + MODURI.map(function (mod) {
        var motiv = o.stareMod ? o.stareMod(mod) : null;
        var k = mod === 'prezentator' ? 'prez' : mod;
        return '<button type="button" role="menuitem" class="pdp-opt" data-mod="' + mod + '" tabindex="-1"' + (motiv ? ' aria-disabled="true"' : '') +
          (mod === 'auto' && o.panouAuto ? ' aria-expanded="false"' : '') + '>' +
          '<span class="pdp-ico">' + ICO[mod] + '</span><span class="pdp-txt"><span class="pdp-titlu">' + esc(t[k + '_t']) + '</span>' +
          '<span class="pdp-desc">' + esc(t[k + '_d']) + '</span>' + (motiv ? '<span class="pdp-motiv">' + esc(motiv) + '</span>' : '') + '</span></button>' +
          (mod === 'auto' && o.panouAuto ? '<div class="pdp-panou" role="group" aria-label="' + esc(t.auto_t) + '" hidden></div>' : '');
      }).join('');
    }
    function optiuni() { return Array.prototype.slice.call(m.querySelectorAll('[role="menuitem"]')).filter(function (x) { return x.offsetParent !== null; }); }
    function deschis() { return !m.hidden; }

    // Poziția: foaie de jos, sau dropdown sub buton, aliniat la dreapta lui, în ecran.
    function aseaza() {
      var foaie = esteFoaie();
      m.classList.toggle('pdp-foaie', foaie);
      fundal.classList.toggle('pdp-foaie', foaie);
      if (foaie) { m.style.left = m.style.top = m.style.width = m.style.maxHeight = ''; return; }
      var r = b.getBoundingClientRect(), W = doc.documentElement.clientWidth, H = win.innerHeight;
      var lat = Math.min(win.innerWidth >= 1024 ? 320 : 300, W - 16);
      m.style.width = lat + 'px';
      m.style.left = Math.max(8, Math.min(r.right - lat, W - 8 - lat)) + 'px';
      m.style.top = Math.round(r.bottom + 8) + 'px';
      m.style.maxHeight = Math.max(160, H - r.bottom - 16) + 'px';
    }
    function deschide(focus) {
      if (o.laDeschidere) o.laDeschidere();
      deseneaza();
      m.classList.remove('pdp-scurt');
      m.hidden = false; fundal.hidden = false;
      b.setAttribute('aria-expanded', 'true');
      aseaza();
      var lista = optiuni();
      var tinta = focus === 'ultim' ? lista[lista.length - 1] : lista[0];
      if (tinta) tinta.focus();
    }
    function inchide(revino) {
      if (!deschis()) return;
      m.hidden = true; fundal.hidden = true;
      b.setAttribute('aria-expanded', 'false');
      if (revino !== false) b.focus();
    }
    function activeaza(opt) {
      var mod = opt.getAttribute('data-mod');
      if (opt.getAttribute('aria-disabled') === 'true') return;
      if (mod === 'auto' && o.panouAuto) {
        var p = m.querySelector('.pdp-panou');
        var arata = p.hidden;
        p.hidden = !arata;
        opt.setAttribute('aria-expanded', arata ? 'true' : 'false');
        // Ecran jos (telefon pe orizontală): cât e deschis panoul, celelalte opțiuni se strâng.
        m.classList.toggle('pdp-scurt', arata && win.innerHeight < 500);
        if (arata) { o.panouAuto(p, function () { inchide(); }); var f = p.querySelector('[aria-checked="true"], button, input'); if (f) f.focus(); }
        if (!m.classList.contains('pdp-foaie')) aseaza();
        return;
      }
      inchide(false);
      if (o.moduri[mod]) o.moduri[mod]();
    }

    b.addEventListener('click', function () { if (deschis()) inchide(); else deschide(); });
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); deschide(e.key === 'ArrowUp' ? 'ultim' : null); }
    });
    m.addEventListener('click', function (e) {
      var opt = e.target.closest && e.target.closest('[role="menuitem"]');
      if (opt) activeaza(opt);
    });
    m.addEventListener('keydown', function (e) {
      var lista = optiuni(), i = lista.indexOf(doc.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inchide(); return; }
      if (e.key === 'Tab' && !m.contains(e.target.closest('.pdp-panou'))) { inchide(false); return; }
      if (i === -1) {
        // În panoul redării automate: săgețile aleg viteza; nimic nu ajunge la slide-ul din spate.
        var r = e.target.closest && e.target.closest('[role="radio"]');
        if (r && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
          e.preventDefault();
          var toate = Array.prototype.slice.call(r.parentNode.querySelectorAll('[role="radio"]'));
          var nou = toate[(toate.indexOf(r) + (/Right|Down/.test(e.key) ? 1 : -1) + toate.length) % toate.length];
          nou.click(); nou.focus();
        }
        if (/^(Arrow|Home$|End$|Page)/.test(e.key)) e.stopPropagation();
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); lista[(i + 1) % lista.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); lista[(i - 1 + lista.length) % lista.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); lista[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); lista[lista.length - 1].focus(); }
      e.stopPropagation(); // săgețile nu mută și slide-ul din spate
    });
    fundal.addEventListener('click', function () { inchide(false); });
    var asc = [];
    leaga(asc, doc, 'pointerdown', function (e) {
      if (deschis() && !m.contains(e.target) && !b.contains(e.target)) inchide(false);
    }, true);
    leaga(asc, win, 'resize', function () { if (deschis()) aseaza(); });

    return {
      deschide: deschide, inchide: inchide, get deschis() { return deschis(); }, element: m,
      actualizeaza: function () { if (deschis()) { deseneaza(); aseaza(); } },
      distruge: function () { dezleaga(asc); m.remove(); fundal.remove(); },
    };
  }

  // ── Ecran complet (2.2) ──────────────────────────────────────────
  // Fullscreen API pe scenă (#pd-deck); fără API (iPhone) sau refuzat → mod
  // simulat: scena pe tot viewport-ul (position: fixed, 100dvh), bara paginii
  // ascunsă. Controalele (anterior / următor / „3 / 20” / ieșire) dispar după
  // 2,5 s fără mișcare și revin la mișcare, atingere sau tastă. Ieșirea
  // (Escape, X, gestul sistemului) nu redesenează deck-ul: slide-ul rămâne.
  var PAUZA_CONTROALE = 2500;
  var X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function apiFs(e) { return e.requestFullscreen || e.webkitRequestFullscreen || null; }
  function elementFs() { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }
  function fsPermis() { return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled); }

  /**
   * o: { scena, deck() → obiectul MDPitchDeck, limba(), laSchimbareMod(activ) }
   */
  function ecranComplet(o) {
    var scena = o.scena;
    var T = function () { return TEXTE[o.limba() === 'ro' ? 'ro' : 'en']; };
    var fs = el('div', 'pdp-fs', { 'data-i18n-skip': '' });
    fs.innerHTML = '<div class="pdp-fs-sus"><button type="button" class="pdp-fs-btn" data-fs="real" hidden>' + ICO.ecran + '</button>' +
      '<button type="button" class="pdp-fs-btn" data-fs="iesire">' + X + '</button></div>' +
      '<div class="pdp-fs-jos"><button type="button" class="pdp-fs-btn" data-fs="anterior"><span aria-hidden="true">←</span></button>' +
      '<span class="pdp-fs-contor" aria-live="polite"></span><button type="button" class="pdp-fs-btn" data-fs="urmator"><span aria-hidden="true">→</span></button>' +
      '<span class="pdp-fs-extra"></span></div>' +
      '<div class="pdp-roteste" role="status" hidden><span class="pdp-roteste-t"></span><button type="button" class="pdp-fs-btn pdp-fs-mic" data-fs="roteste">' + X + '</button></div>';
    scena.appendChild(fs);
    var $f = function (k) { return fs.querySelector('[data-fs="' + k + '"]'); };
    var activ = false, simulat = false, ceas = null, rotireInchisa = false;

    function texte() {
      var t = T();
      [['real', t.ecran_real], ['iesire', t.iesire], ['anterior', t.anterior], ['urmator', t.urmator], ['roteste', t.inchide_mesaj]].forEach(function (x) {
        $f(x[0]).setAttribute('aria-label', x[1]); $f(x[0]).title = x[1];
      });
      fs.querySelector('.pdp-roteste-t').textContent = t.roteste;
    }
    function verificaRotire() {
      var w = win.innerWidth, h = win.innerHeight;
      fs.querySelector('.pdp-roteste').hidden = !(activ && !rotireInchisa && w < 768 && h > w);
    }
    function arata() {
      fs.classList.remove('pdp-ascuns');
      scena.classList.remove('pdp-fara-cursor');
      win.clearTimeout(ceas);
      if (activ) ceas = win.setTimeout(function () { fs.classList.add('pdp-ascuns'); scena.classList.add('pdp-fara-cursor'); }, PAUZA_CONTROALE);
    }
    function marcheaza(on, sim) {
      var era = activ;
      activ = on; simulat = !!(on && sim);
      scena.classList.toggle('pdp-ecran', on);
      scena.classList.toggle('pdp-simulat', simulat);
      doc.documentElement.classList.toggle('pdp-simulat-activ', simulat);
      // Modul simulat într-un browser care are totuși API-ul: „Treci în ecran complet”.
      $f('real').hidden = !(simulat && apiFs(scena) && fsPermis());
      texte(); verificaRotire(); arata();
      if (on) { var st = scena.querySelector('.mdpd-stage'); if (st && !fs.contains(doc.activeElement)) { try { st.focus({ preventScroll: true }); } catch (e) {} } }
      if (era !== on && o.laSchimbareMod) o.laSchimbareMod(on);
    }
    function intra() {
      var f = apiFs(scena);
      if (f && fsPermis() && (!activ || simulat)) {
        try {
          var p = f.call(scena);
          if (p && typeof p.then === 'function') return p.catch(function () { if (!activ) marcheaza(true, true); });
          return Promise.resolve();
        } catch (e) { /* refuzat → simulat */ }
      }
      if (!activ) marcheaza(true, true);
      return Promise.resolve();
    }
    function iesi() {
      if (!activ) return;
      if (elementFs() === scena) {
        var x = doc.exitFullscreen || doc.webkitExitFullscreen;
        var p = x && x.call(doc);
        if (p && p.catch) p.catch(function () {});
      } else marcheaza(false, false);
    }
    function schimbare() {
      if (elementFs() === scena) marcheaza(true, false);
      else if (activ && !simulat) marcheaza(false, false);
    }
    var asc = [];
    leaga(asc, doc, 'fullscreenchange', schimbare);
    leaga(asc, doc, 'webkitfullscreenchange', schimbare);
    ['mousemove', 'pointerdown', 'touchstart', 'wheel'].forEach(function (ev) { scena.addEventListener(ev, function () { if (activ) arata(); }, { passive: true }); });
    // Escape iese din modul simulat (în cel real îl tratează browserul).
    leaga(asc, doc, 'keydown', function (e) {
      if (!activ) return;
      arata();
      if (e.key === 'Escape' && simulat && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); iesi(); }
    }, true);
    leaga(asc, win, 'resize', verificaRotire);
    fs.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-fs]');
      if (!b) return;
      var k = b.getAttribute('data-fs'), d = o.deck();
      if (k === 'iesire') iesi();
      else if (k === 'real') intra();
      else if (k === 'anterior' && d) d.anterior();
      else if (k === 'urmator' && d) d.urmator();
      else if (k === 'roteste') { rotireInchisa = true; verificaRotire(); }
    });
    texte();

    return {
      intra: intra, iesi: iesi, element: fs, extra: fs.querySelector('.pdp-fs-extra'), texte: texte,
      distruge: function () { iesi(); win.clearTimeout(ceas); dezleaga(asc); fs.remove(); },
      get activ() { return activ; }, get simulat() { return simulat; },
      laSchimbare: function (i, total) {
        fs.querySelector('.pdp-fs-contor').textContent = (i + 1) + ' / ' + total;
        $f('anterior').disabled = i === 0;
        $f('urmator').disabled = i === total - 1;
      },
    };
  }

  // ── Vederea prezentatorului (2.4) ───────────────────────────────
  // Desktop / laptop: fereastră separată (window.open) + fereastra publicului
  // în ecran complet, sincronizate prin BroadcastChannel (rezervă: postMessage,
  // doar între ferestrele aceleiași origini). Tabletă landscape (sau fereastra
  // blocată): pe același ecran. Tabletă portrait / telefon: dezactivată.
  var NOTE_MARIMI = [14, 16, 18, 20, 24, 28, 32], NOTE_IMPLICIT = 2, CHEIE_NOTE = 'mdpd_note_marime_v1';
  function citeste(k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }
  function scrie(k, v) { try { win.localStorage.setItem(k, v); } catch (e) { /* stocare indisponibilă */ } }
  function totalDeck(p) { var d = (p && p.deck) || {}; return (Array.isArray(d.slide_uri) ? d.slide_uri.length : 0) + (p && p.stare === 'rezumat' ? 1 : 0); }
  // Ecran suficient de mare pentru vederea prezentatorului (nu telefon, nu vertical).
  function ecranMare() { var w = win.innerWidth, h = win.innerHeight; return w >= 768 && w >= h && h >= 500; }
  // Desktop / laptop (fereastră separată) — altfel tabletă (același ecran).
  function esteDesktop() {
    var atingere = !!(win.matchMedia && win.matchMedia('(hover: none) and (pointer: coarse)').matches);
    return win.innerWidth >= 1024 && win.innerHeight >= 600 && !atingere;
  }
  function idCanal() {
    var a = new Uint8Array(12);
    try { win.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  // Canalul dintre cele două ferestre. tinta() = fereastra cealaltă (pentru postMessage).
  function transport(canal, tinta) {
    var bc = null, asc = [];
    try { if (win.BroadcastChannel) bc = new win.BroadcastChannel('mdpd-prezentare-' + canal); } catch (e) { bc = null; }
    function primeste(m) { if (m && m.canal === canal) asc.forEach(function (f) { f(m); }); }
    function laMesaj(e) {
      if (e.origin !== win.location.origin) return;
      var t = tinta();
      if (!t || e.source !== t) return;
      primeste(e.data);
    }
    if (bc) bc.onmessage = function (e) { primeste(e.data); };
    else win.addEventListener('message', laMesaj);
    return {
      tip: bc ? 'BroadcastChannel' : 'postMessage',
      trimite: function (m) {
        m.canal = canal;
        if (bc) { bc.postMessage(m); return; }
        var t = tinta();
        if (t && !t.closed) t.postMessage(m, win.location.origin);
      },
      asculta: function (f) { asc.push(f); },
      inchide: function () { if (bc) bc.close(); else win.removeEventListener('message', laMesaj); asc = []; },
    };
  }

  function format2(n) { return (n < 10 ? '0' : '') + n; }
  function formatDurata(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + format2(m) : format2(m)) + ':' + format2(s % 60);
  }

  /**
   * Vederea prezentatorului în `root`.
   * o: { payload, limbaDeck, limbaUi, index, miniaturi (bool), onMergi(i), onNegru(activ), onInchide(), onAuto() }
   */
  function vedere(root, o) {
    var t = TEXTE[o.limbaUi === 'ro' ? 'ro' : 'en'];
    var p = o.payload, total = totalDeck(p), slideuri = (p.deck && p.deck.slide_uri) || [];
    var idx = -1, negru = false, marime = Number(citeste(CHEIE_NOTE));
    if (!(marime >= 0 && marime < NOTE_MARIMI.length)) marime = NOTE_IMPLICIT;
    var cron = { start: Date.now(), oprit: 0, pauza: false };
    var btn = function (k, cls, html, eticheta) { return '<button type="button" class="pdp-pv-btn ' + (cls || '') + '" data-pv="' + k + '"' + (eticheta ? ' aria-label="' + esc(eticheta) + '" title="' + esc(eticheta) + '"' : '') + '>' + html + '</button>'; };
    root.innerHTML = '<div class="pdp-pv' + (o.miniaturi ? ' pdp-pv-cu-mini' : '') + '" data-i18n-skip>' +
      '<header class="pdp-pv-cap"><strong class="pdp-pv-titlu">' + esc(t.pv_titlu) + '</strong>' +
        '<div class="pdp-pv-grup" role="group" aria-label="' + esc(t.cronometru) + '"><span class="pdp-pv-timp" role="timer" aria-label="' + esc(t.cronometru) + '">00:00</span>' +
          btn('cron', 'pdp-pv-ico', '<span aria-hidden="true">⏸</span>', t.cron_pauza) + btn('reset', 'pdp-pv-ico', '<span aria-hidden="true">↺</span>', t.cron_reset) + '</div>' +
        '<span class="pdp-pv-ora" aria-label="' + esc(t.ora) + '"></span>' +
        '<span class="pdp-pv-contor" aria-live="polite"></span>' +
        '<span class="pdp-pv-spatiu"></span>' +
        btn('auto', 'pdp-pv-auto', '', '') +
        btn('negru', 'pdp-pv-negru-btn', '<span class="pdp-pv-patrat" aria-hidden="true"></span>' + esc(t.negru) + ' <kbd>B</kbd>', '') +
        btn('inchide', 'pdp-pv-inchide', esc(t.incheie), '') +
      '</header>' +
      '<section class="pdp-pv-curent"><div class="pdp-pv-deck"></div><div class="pdp-pv-negru" hidden><span>' + esc(t.negru_activ) + '</span></div></section>' +
      '<div class="pdp-pv-dr">' +
        '<section class="pdp-pv-urm" aria-label="' + esc(t.urmeaza) + '"><div class="pdp-pv-et">' + esc(t.urmeaza) + '</div><div class="pdp-pv-urm-deck"></div><div class="pdp-pv-final" hidden>' + esc(t.final) + '</div></section>' +
        '<section class="pdp-pv-note" aria-label="' + esc(t.note) + '"><div class="pdp-pv-et"><span>' + esc(t.note) + '</span><span class="pdp-pv-grup">' +
          btn('mic', 'pdp-pv-ico', 'A−', t.text_mic) + btn('mare', 'pdp-pv-ico', 'A+', t.text_mare) + '</span></div>' +
          '<div class="pdp-pv-note-text" tabindex="0"></div></section>' +
      '</div>' +
      '<nav class="pdp-pv-nav">' + btn('anterior', '', '<span aria-hidden="true">←</span> ' + esc(t.anterior), '') + btn('urmator', '', esc(t.urmator) + ' <span aria-hidden="true">→</span>', '') + '</nav>' +
      (o.miniaturi ? '<div class="pdp-pv-mini" role="list" aria-label="' + esc(t.miniaturi) + '"></div>' : '') +
    '</div>';
    var $ = function (s) { return root.querySelector(s); };
    var curent = win.MDPitchDeck.creeaza($('.pdp-pv-deck'), { payload: p, limba: o.limbaDeck, prefix: 'pv-c-' });

    if (o.miniaturi) {
      $('.pdp-pv-mini').innerHTML = Array.apply(null, Array(total)).map(function (_, i) {
        return '<div role="listitem"><button type="button" class="pdp-pv-mini-btn" data-mergi="' + i + '" aria-label="' + esc(t.mergi_la + ' ' + (i + 1)) + '"><span class="pdp-pv-mini-slide"></span><span class="pdp-pv-mini-nr">' + (i + 1) + '</span></button></div>';
      }).join('');
      Array.prototype.forEach.call(root.querySelectorAll('.pdp-pv-mini-slide'), function (e, i) { win.MDPitchDeck.creeazaStatic(e, { payload: p, limba: o.limbaDeck, index: i, prefix: 'pv-m' + i + '-' }); });
    }
    function note(i) {
      var s = slideuri[i], n = s && typeof s.note_prezentator === 'string' ? s.note_prezentator.trim() : '';
      var e = $('.pdp-pv-note-text');
      e.classList.toggle('pdp-pv-gol', !n);
      e.textContent = n || t.fara_note;
      e.scrollTop = 0;
    }
    function aplicaMarime() { $('.pdp-pv-note-text').style.fontSize = NOTE_MARIMI[marime] + 'px'; $('[data-pv="mic"]').disabled = marime === 0; $('[data-pv="mare"]').disabled = marime === NOTE_MARIMI.length - 1; }
    function seteaza(i) {
      i = Math.max(0, Math.min(total - 1, i | 0));
      if (i === idx) return;
      idx = i;
      curent.mergiLa(i);
      win.MDPitchDeck.creeazaStatic($('.pdp-pv-urm-deck'), { payload: p, limba: o.limbaDeck, index: i + 1, prefix: 'pv-u-' });
      $('.pdp-pv-final').hidden = i + 1 < total;
      note(i);
      $('.pdp-pv-contor').textContent = (i + 1) + ' / ' + total;
      $('[data-pv="anterior"]').disabled = i === 0;
      $('[data-pv="urmator"]').disabled = i === total - 1;
      Array.prototype.forEach.call(root.querySelectorAll('.pdp-pv-mini-btn'), function (b, k) {
        if (k === i) { b.setAttribute('aria-current', 'true'); var r = b.getBoundingClientRect(), pr = b.closest('.pdp-pv-mini').getBoundingClientRect(); if (r.left < pr.left || r.right > pr.right) b.closest('.pdp-pv-mini').scrollLeft += r.left - pr.left - pr.width / 2 + r.width / 2; }
        else b.removeAttribute('aria-current');
      });
    }
    function mergi(i) { i = Math.max(0, Math.min(total - 1, i)); if (i === idx) return; seteaza(i); if (o.onMergi) o.onMergi(i); }
    function seteazaNegru(v) {
      negru = !!v;
      $('.pdp-pv-negru').hidden = !negru;
      $('[data-pv="negru"]').setAttribute('aria-pressed', negru ? 'true' : 'false');
    }
    function comutaNegru() { seteazaNegru(!negru); if (o.onNegru) o.onNegru(negru); }
    function ceas() {
      var acum = Date.now();
      $('.pdp-pv-timp').textContent = formatDurata(cron.pauza ? cron.oprit : cron.oprit + acum - cron.start);
      try { $('.pdp-pv-ora').textContent = new Intl.DateTimeFormat(o.limbaUi === 'ro' ? 'ro-RO-u-nu-latn' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(acum)); } catch (e) { $('.pdp-pv-ora').textContent = ''; }
    }
    function comutaCron() {
      var acum = Date.now();
      if (cron.pauza) { cron.start = acum; cron.pauza = false; } else { cron.oprit += acum - cron.start; cron.pauza = true; }
      var b = $('[data-pv="cron"]');
      b.innerHTML = '<span aria-hidden="true">' + (cron.pauza ? '▶' : '⏸') + '</span>';
      b.setAttribute('aria-label', cron.pauza ? t.cron_porneste : t.cron_pauza); b.title = b.getAttribute('aria-label');
      ceas();
    }
    var interval = win.setInterval(ceas, 1000);
    // Tabletă (ecran tactil) sau fereastră îngustă → aspectul pe trei zone, fără miniaturi.
    function aspect() { root.querySelector('.pdp-pv').classList.toggle('pdp-pv-tableta', !esteDesktop() || win.innerWidth < 1024); }
    win.addEventListener('resize', aspect);
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-pv], [data-mergi]');
      if (!b || b.disabled) return;
      if (b.hasAttribute('data-mergi')) return mergi(Number(b.getAttribute('data-mergi')));
      var k = b.getAttribute('data-pv');
      if (k === 'anterior') mergi(idx - 1);
      else if (k === 'urmator') mergi(idx + 1);
      else if (k === 'negru') comutaNegru();
      else if (k === 'inchide') { if (o.onInchide) o.onInchide(); }
      else if (k === 'cron') comutaCron();
      else if (k === 'reset') { cron.start = Date.now(); cron.oprit = 0; ceas(); }
      else if (k === 'mic' || k === 'mare') { marime = Math.max(0, Math.min(NOTE_MARIMI.length - 1, marime + (k === 'mare' ? 1 : -1))); scrie(CHEIE_NOTE, String(marime)); aplicaMarime(); }
      else if (k === 'auto' && o.onAuto) o.onAuto();
    });
    function taste(e) {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
      var k = e.key, gestionat = true;
      // Space avansează mereu (nu apasă butonul care are focusul).
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') mergi(idx + 1);
      else if (k === 'ArrowLeft' || k === 'PageUp') mergi(idx - 1);
      else if (k === 'Home') mergi(0);
      else if (k === 'End') mergi(total - 1);
      else if (k === 'b' || k === 'B') comutaNegru();
      else if (k === 'Escape') { if (o.onInchide) o.onInchide(); }
      else gestionat = false;
      if (gestionat) { e.preventDefault(); e.stopPropagation(); }
    }
    doc.addEventListener('keydown', taste, true);
    aspect(); aplicaMarime(); seteaza(o.index || 0); seteazaAuto(null); ceas();
    function seteazaAuto(a) {
      var b = $('[data-pv="auto"]');
      b.hidden = !(a && a.activ);
      if (!b.hidden) b.innerHTML = '<span aria-hidden="true">' + (a.ruleaza ? '⏸' : '▶') + '</span> ' + esc(a.eticheta || '');
    }
    return {
      seteaza: seteaza, seteazaNegru: seteazaNegru, seteazaAuto: seteazaAuto,
      get index() { return idx; }, element: root,
      focus: function () { var b = $('[data-pv="urmator"]'); if (b) b.focus(); },
      distruge: function () { win.clearInterval(interval); win.removeEventListener('resize', aspect); doc.removeEventListener('keydown', taste, true); curent.distruge(); root.innerHTML = ''; },
    };
  }

  // Fereastra prezentatorului (pitch-deck-prezentator.html): primește deck-ul
  // cu note de la fereastra publicului, prin canalul din adresă.
  function fereastraPrezentator(root) {
    var canal = (String(win.location.search).match(/[?&]canal=([0-9a-f]{8,64})/) || [])[1];
    var limbaUi = String(citeste('myd_lang_v1') || '').slice(0, 2) === 'ro' ? 'ro' : 'en';
    var mesaj = function (txt) { root.innerHTML = '<p class="pdp-pv-mesaj" role="status">' + esc(txt) + '</p>'; };
    doc.documentElement.lang = limbaUi;
    doc.title = TEXTE[limbaUi].pv_titlu + ' · My Darrin';
    if (!canal || !win.opener) { mesaj(TEXTE[limbaUi].fara_canal); return null; }
    var opener = win.opener;
    var tr = transport(canal, function () { return opener; });
    var pv = null;
    mesaj(TEXTE[limbaUi].conectare);
    tr.asculta(function (m) {
      if (m.tip === 'date' && !pv && m.payload) {
        limbaUi = m.limbaUi === 'ro' ? 'ro' : 'en';
        doc.documentElement.lang = limbaUi;
        doc.title = TEXTE[limbaUi].pv_titlu + ' · My Darrin';
        pv = vedere(root, {
          payload: m.payload, limbaDeck: m.limbaDeck, limbaUi: limbaUi, index: m.index, miniaturi: true,
          onMergi: function (i) { tr.trimite({ tip: 'mergi', index: i }); },
          onNegru: function (v) { tr.trimite({ tip: 'negru', activ: v }); },
          onAuto: function () { tr.trimite({ tip: 'auto' }); },
          onInchide: function () { tr.trimite({ tip: 'gata' }); win.close(); },
        });
        if (m.auto) pv.seteazaAuto(m.auto);
        pv.focus();
      } else if (m.tip === 'stare' && pv) {
        pv.seteaza(m.index);
        pv.seteazaAuto(m.auto);
        if (typeof m.negru === 'boolean') pv.seteazaNegru(m.negru);
      } else if (m.tip === 'eroare' && !pv) mesaj(TEXTE[limbaUi].eroare_note);
      else if (m.tip === 'inchis') {
        if (pv) { pv.distruge(); pv = null; }
        mesaj(TEXTE[limbaUi].deconectat);
      }
    });
    tr.trimite({ tip: 'salut' });
    win.addEventListener('pagehide', function () { tr.trimite({ tip: 'gata' }); });
    return tr;
  }

  // Fereastră de mesaj (ex. „fereastra prezentatorului a fost blocată”).
  // butoane: [[text, fn, principal]]; Escape = primul buton.
  function dialog(titlu, text, butoane) {
    var d = el('div', 'pdp-dialog-fundal', { 'data-i18n-skip': '' });
    d.innerHTML = '<div class="pdp-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pdp-dialog-t" aria-describedby="pdp-dialog-p">' +
      '<h2 id="pdp-dialog-t">' + esc(titlu) + '</h2><p id="pdp-dialog-p">' + esc(text) + '</p><div class="pdp-dialog-btn">' +
      butoane.map(function (b, i) { return '<button type="button" class="pdp-pv-btn' + (b[2] ? ' pdp-pv-primar' : '') + '" data-d="' + i + '">' + esc(b[0]) + '</button>'; }).join('') + '</div></div>';
    doc.body.appendChild(d);
    function gata(i) { doc.removeEventListener('keydown', taste, true); d.remove(); butoane[i][1](); }
    function taste(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); gata(0); } }
    doc.addEventListener('keydown', taste, true);
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-d]');
      if (b) gata(Number(b.getAttribute('data-d')));
    });
    var principal = d.querySelector('.pdp-pv-primar') || d.querySelector('[data-d]');
    principal.focus();
    return d;
  }

  /**
   * Totul legat de o scenă: meniul, ecranul complet, vederea prezentatorului
   * (și redarea automată, mai jos).
   * o: { buton, scena, deck(), limba() (interfața), limbaDeck(),
   *      acces() → 'da' | 'nu' | 'verifica' (răspunsul serverului),
   *      prezentator() → Promise<payload cu note>, urlPrezentator }
   */
  function ataseaza(o) {
    var T = function () { return TEXTE[o.limba() === 'ro' ? 'ro' : 'en']; };
    var ecran = ecranComplet({ scena: o.scena, deck: o.deck, limba: o.limba });
    var negru = el('div', 'pdp-negru', { hidden: '', 'aria-hidden': 'true' });
    (o.scena.querySelector('.pdp-cadru') || o.scena).appendChild(negru);
    var conex = null, pvLocal = null, stareNegru = false;

    function stareMod(mod) {
      var t = T();
      if (mod !== 'prezentator') return null;
      var a = o.acces ? o.acces() : 'nu';
      if (a === 'verifica') return t.motiv_verifica;
      if (a !== 'da') return t.motiv_admin;
      if (!ecranMare()) return t.motiv_ecran;
      return null;
    }
    function seteazaNegru(v) { stareNegru = !!v; negru.hidden = !stareNegru; }
    function stareSync() {
      var d = o.deck();
      return { tip: 'stare', index: d ? d.index : 0, total: d ? d.total : 0, auto: stareAuto(), negru: stareNegru };
    }
    function trimiteStare() { if (conex) conex.tr.trimite(stareSync()); if (pvLocal) pvLocal.seteazaAuto(stareAuto()); }
    function mergiDinPrezentator(i) { var d = o.deck(); if (d && d.index !== i) d.mergiLa(i); }

    function inchideConex() {
      if (!conex) return;
      try { conex.tr.inchide(); } catch (e) { /* închis deja */ }
      conex = null; seteazaNegru(false);
    }
    function peUnEcran(payloadP) {
      if (pvLocal) return;
      var gazda = el('div', 'pdp-pv-ecran', { role: 'dialog', 'aria-modal': 'true', 'aria-label': T().pv_titlu, 'data-i18n-skip': '' });
      doc.body.appendChild(gazda);
      doc.documentElement.classList.add('pdp-pv-deschis');
      payloadP.then(function (payload) {
        var d = o.deck();
        pvLocal = vedere(gazda, {
          payload: payload, limbaDeck: o.limbaDeck ? o.limbaDeck() : payload.limba, limbaUi: o.limba(), index: d ? d.index : 0,
          miniaturi: esteDesktop(),
          onMergi: mergiDinPrezentator, onNegru: seteazaNegru, onAuto: comutaAutoDinPrezentator,
          onInchide: function () { pvLocal.distruge(); pvLocal = null; gazda.remove(); doc.documentElement.classList.remove('pdp-pv-deschis'); seteazaNegru(false); o.buton.focus(); },
        });
        pvLocal.seteazaAuto(stareAuto());
        pvLocal.focus();
      }, function () { gazda.remove(); doc.documentElement.classList.remove('pdp-pv-deschis'); arataEroare(); });
    }
    function arataEroare() {
      dialog(T().pv_titlu, T().eroare_note, [[T().inchide, function () { o.buton.focus(); }, true]]);
    }
    function inFereastra(payloadP) {
      inchideConex();
      var canal = idCanal();
      // window.open trebuie apelat direct din clic (altfel browserul îl blochează).
      var pop = null;
      try { pop = win.open((o.urlPrezentator || '/pitch-deck-prezentator') + '?canal=' + canal, 'mdpd-prezentator', 'popup=yes,width=1280,height=800'); } catch (e) { pop = null; }
      if (!pop) {
        dialog(T().blocat_t, T().blocat_p, [[T().inchide, function () { o.buton.focus(); }], [T().un_ecran, function () { peUnEcran(payloadP); }, true]]);
        return;
      }
      var c = conex = { tr: transport(canal, function () { return pop; }), pop: pop, payload: null, asteapta: false };
      function trimiteDate() {
        var d = o.deck();
        c.tr.trimite({ tip: 'date', payload: c.payload, limbaDeck: o.limbaDeck ? o.limbaDeck() : c.payload.limba, limbaUi: o.limba(), index: d ? d.index : 0, auto: stareAuto() });
      }
      c.tr.asculta(function (m) {
        if (conex !== c) return;
        if (m.tip === 'salut') { if (c.payload) trimiteDate(); else c.asteapta = true; }
        else if (m.tip === 'mergi') mergiDinPrezentator(m.index);
        else if (m.tip === 'negru') seteazaNegru(m.activ);
        else if (m.tip === 'auto') comutaAutoDinPrezentator();
        else if (m.tip === 'gata') inchideConex();
      });
      payloadP.then(function (payload) {
        if (conex !== c) return;
        c.payload = payload;
        if (c.asteapta) trimiteDate();
      }, function () { if (conex === c) { c.tr.trimite({ tip: 'eroare' }); inchideConex(); arataEroare(); } });
      ecran.intra();
    }
    function deschidePrezentator() {
      if (stareMod('prezentator')) return;
      var payloadP = Promise.resolve().then(o.prezentator);
      if (esteDesktop()) inFereastra(payloadP); else peUnEcran(payloadP);
    }
    var asc = [];
    function anuntaInchis() { if (conex) conex.tr.trimite({ tip: 'inchis' }); }
    leaga(asc, win, 'pagehide', anuntaInchis);

    // ── Redarea automată (2.5) ─────────────────────────────────────
    // Timpul pe slide începe DUPĂ animațiile slide-ului. Pauză automată la
    // orice navigare manuală, la deschiderea meniului, când fila nu e vizibilă
    // și la Space (din nou Space → continuă). La ultimul slide: oprire, sau
    // reluare de la început dacă e bifat. Viteza se ține minte pe dispozitiv.
    var viteza = Number(citeste(CHEIE_VITEZA));
    if (VITEZE.indexOf(viteza) === -1) viteza = VITEZA_IMPLICITA;
    var auto = { activ: false, ruleaza: false, bucla: false, timer: null, t0: 0, ramas: 0, slide: -1 }, navAuto = false;
    var progres = el('div', 'pdp-progres', { hidden: '', 'aria-hidden': 'true' });
    progres.innerHTML = '<div></div>';
    (o.scena.querySelector('.pdp-cadru') || o.scena).appendChild(progres);
    var bara = progres.firstChild;
    function controaleAuto(cls, clsBtn) {
      var g = el('div', cls, { role: 'group', hidden: '', 'data-i18n-skip': '' });
      g.innerHTML = '<button type="button" class="' + clsBtn + '" data-auto="comuta"></button><span class="pdp-auto-viteza"></span>' +
        '<button type="button" class="' + clsBtn + '" data-auto="opreste">' + X + '</button>';
      g.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-auto]');
        if (!b) return;
        if (b.getAttribute('data-auto') === 'opreste') opresteAuto(); else comutaAuto();
      });
      return g;
    }
    var grupuri = [controaleAuto('pdp-auto pdp-auto-fs', 'pdp-fs-btn')];
    ecran.extra.appendChild(grupuri[0]);
    if (o.bara) { grupuri.push(controaleAuto('pdp-auto pdp-auto-bara', 'pdp-auto-btn')); o.bara.appendChild(grupuri[1]); }

    // Cât durează animațiile slide-ului curent (tranziții, animații finite, cifrele care cresc).
    var miscareRedusa = function () { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); };
    function secunde(v) { return String(v || '0s').split(',').map(function (x) { x = x.trim(); return /ms$/.test(x) ? parseFloat(x) : parseFloat(x) * 1000; }); }
    function durataAnimatii() {
      var d = o.deck(), s = d && d.element && d.element.querySelector('.mdpd-slide.mdpd-activ');
      if (!s || miscareRedusa()) return 0;
      var max = s.querySelector('[data-tinta]') ? 1100 : 0;
      [s].concat(Array.prototype.slice.call(s.querySelectorAll('*'))).forEach(function (e) {
        var cs = win.getComputedStyle(e);
        var td = secunde(cs.transitionDelay), tt = secunde(cs.transitionDuration);
        tt.forEach(function (t, k) { if (t > 0) max = Math.max(max, t + (td[k % td.length] || 0)); });
        var nume = String(cs.animationName || 'none').split(','), ad = secunde(cs.animationDelay), at = secunde(cs.animationDuration), it = String(cs.animationIterationCount || '1').split(',');
        nume.forEach(function (n, k) {
          n = n.trim();
          // Zoom-ul lent al imaginilor (mdpd-kb, 9 s) e decor, nu animația slide-ului.
          if (n === 'none' || /kb$/.test(n) || /infinite/.test(it[k % it.length] || '')) return;
          max = Math.max(max, (at[k % at.length] || 0) * (parseFloat(it[k % it.length]) || 1) + (ad[k % ad.length] || 0));
        });
      });
      return Math.min(6000, Math.round(max));
    }
    function deseneazaAuto() {
      var t = T();
      grupuri.forEach(function (g) {
        g.hidden = !auto.activ;
        g.setAttribute('aria-label', t.auto_t);
        var b = g.querySelector('[data-auto="comuta"]');
        b.innerHTML = '<span aria-hidden="true">' + (auto.ruleaza ? '⏸' : '▶') + '</span>';
        b.setAttribute('aria-label', auto.ruleaza ? t.pauza : t.continua); b.title = b.getAttribute('aria-label');
        b.setAttribute('aria-pressed', auto.ruleaza ? 'false' : 'true');
        var s = g.querySelector('[data-auto="opreste"]');
        s.setAttribute('aria-label', t.opreste); s.title = t.opreste;
        var v = g.querySelector('.pdp-auto-viteza');
        v.textContent = viteza + ' s'; v.setAttribute('aria-label', viteza + ' ' + t.viteza_aria);
      });
      progres.hidden = !auto.activ;
      bara.style.animationPlayState = auto.ruleaza ? 'running' : 'paused';
      trimiteStare();
    }
    function curataTimer() { if (auto.timer) win.clearTimeout(auto.timer); auto.timer = null; }
    function programeaza() {
      curataTimer();
      var d = o.deck();
      if (!d) return;
      var anim = durataAnimatii();
      auto.slide = d.index; auto.ramas = anim + viteza * 1000;
      bara.style.animation = 'none';
      void bara.offsetWidth;
      bara.style.animation = 'pdp-umple ' + viteza + 's linear ' + anim + 'ms forwards';
      if (auto.ruleaza) { auto.t0 = Date.now(); auto.timer = win.setTimeout(pas, auto.ramas); }
    }
    function pas() {
      auto.timer = null;
      var d = o.deck();
      if (!d || !auto.activ) return;
      navAuto = true;
      try {
        if (d.index < d.total - 1) d.urmator();
        else if (auto.bucla) d.mergiLa(0);
        else { opresteAuto(); return; }
      } finally { navAuto = false; }
      programeaza(); deseneazaAuto();
    }
    function pornesteAuto(sec, bucla) {
      if (VITEZE.indexOf(sec) !== -1) { viteza = sec; scrie(CHEIE_VITEZA, String(sec)); }
      auto.activ = true; auto.ruleaza = true; auto.bucla = !!bucla;
      programeaza(); deseneazaAuto();
    }
    function pauzaAuto() {
      if (!auto.activ || !auto.ruleaza) return;
      curataTimer();
      auto.ramas = Math.max(0, auto.ramas - (Date.now() - auto.t0));
      auto.ruleaza = false; deseneazaAuto();
    }
    function continuaAuto() {
      if (!auto.activ || auto.ruleaza) return;
      auto.ruleaza = true;
      var d = o.deck();
      // Navigat între timp (manual): timpul pornește de la zero pe noul slide.
      if (!d || d.index !== auto.slide) programeaza();
      else { auto.t0 = Date.now(); auto.timer = win.setTimeout(pas, auto.ramas); }
      deseneazaAuto();
    }
    function comutaAuto() { if (auto.ruleaza) pauzaAuto(); else continuaAuto(); }
    function opresteAuto() { curataTimer(); auto.activ = false; auto.ruleaza = false; bara.style.animation = 'none'; deseneazaAuto(); }
    function stareAuto() { return auto.activ ? { activ: true, ruleaza: auto.ruleaza, viteza: viteza, eticheta: viteza + ' s' } : null; }
    function comutaAutoDinPrezentator() { comutaAuto(); }
    leaga(asc, doc, 'visibilitychange', function () { if (doc.hidden) pauzaAuto(); });
    leaga(asc, doc, 'keydown', function (e) {
      if (!auto.activ || pvLocal || e.key !== ' ' || e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (e.target.closest && e.target.closest('.pdp-meniu, .pdp-dialog-fundal'))) return;
      e.preventDefault(); e.stopPropagation();
      comutaAuto();
    }, true);

    // Panoul din meniu: viteza, „Reia de la început la final”, „Pornește”.
    function panouAuto(p, inchideMeniu) {
      var t = T();
      p.innerHTML = '<div class="pdp-panou-et" id="pdp-viteza-et">' + esc(t.viteza) + '</div>' +
        '<div class="pdp-viteze" role="radiogroup" aria-labelledby="pdp-viteza-et">' + VITEZE.map(function (v) {
          return '<button type="button" role="radio" class="pdp-viteza" data-viteza="' + v + '" aria-checked="' + (v === viteza) + '" tabindex="' + (v === viteza ? 0 : -1) + '" aria-label="' + v + ' ' + esc(t.viteza_aria) + '">' + v + ' s</button>';
        }).join('') + '</div>' +
        '<label class="pdp-bifa"><input type="checkbox" data-bucla' + (auto.bucla ? ' checked' : '') + '><span>' + esc(t.bucla) + '</span></label>' +
        '<button type="button" class="pdp-porneste" data-porneste><span aria-hidden="true">▶</span> ' + esc(t.porneste) + '</button>';
      var ales = viteza;
      p.onclick = function (e) {
        var r = e.target.closest && e.target.closest('[data-viteza]');
        if (r) {
          ales = Number(r.getAttribute('data-viteza'));
          Array.prototype.forEach.call(p.querySelectorAll('[data-viteza]'), function (x) { var da = x === r; x.setAttribute('aria-checked', da ? 'true' : 'false'); x.tabIndex = da ? 0 : -1; });
          return;
        }
        if (e.target.closest && e.target.closest('[data-porneste]')) {
          var bucla = p.querySelector('[data-bucla]').checked;
          inchideMeniu();
          pornesteAuto(ales, bucla);
        }
      };
    }

    var m = meniu({
      buton: o.buton, limba: o.limba, stareMod: stareMod, panouAuto: panouAuto,
      laDeschidere: pauzaAuto,
      moduri: { ecran: function () { ecran.intra(); }, prezentator: deschidePrezentator },
    });
    return {
      meniu: m, ecran: ecran,
      laSchimbare: function (i, total) {
        ecran.laSchimbare(i, total);
        if (!navAuto) pauzaAuto(); // navigare manuală → pauză
        if (pvLocal) pvLocal.seteaza(i);
        trimiteStare();
      },
      texte: function () { ecran.texte(); m.actualizeaza(); deseneazaAuto(); },
      get auto() { return stareAuto(); },
      actualizeaza: function () { m.actualizeaza(); },
      get conexiune() { return conex ? conex.tr.tip : null; },
      // Back-office: previzualizarea se închide → totul se desface.
      distruge: function () {
        anuntaInchis(); inchideConex();
        if (pvLocal) { pvLocal.distruge(); pvLocal = null; var g = doc.querySelector('.pdp-pv-ecran'); if (g) g.remove(); doc.documentElement.classList.remove('pdp-pv-deschis'); }
        opresteAuto(); dezleaga(asc); m.distruge(); ecran.distruge(); negru.remove(); progres.remove();
        grupuri.forEach(function (g) { g.remove(); });
      },
    };
  }

  exporturi.meniu = meniu;
  exporturi.ecranComplet = ecranComplet;
  exporturi.ataseaza = ataseaza;
  exporturi.vedere = vedere;
  exporturi.fereastraPrezentator = fereastraPrezentator;
  exporturi.transport = transport;
  exporturi.esteFoaie = esteFoaie;
  return exporturi;
});

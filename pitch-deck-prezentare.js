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
    },
  };
  var MODURI = ['ecran', 'prezentator', 'auto'];

  var exporturi = { TEXTE: TEXTE, MODURI: MODURI };
  if (!win) return exporturi;

  var doc = win.document;
  var nr = 0;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
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
    function optiuni() { return Array.prototype.slice.call(m.querySelectorAll('[role="menuitem"]')); }
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
        if (arata) { o.panouAuto(p, function () { inchide(false); }); var f = p.querySelector('[aria-checked="true"], button, input'); if (f) f.focus(); }
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
      if (i === -1) return; // în panoul redării automate: tastele lui
      if (e.key === 'ArrowDown') { e.preventDefault(); lista[(i + 1) % lista.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); lista[(i - 1 + lista.length) % lista.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); lista[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); lista[lista.length - 1].focus(); }
      e.stopPropagation(); // săgețile nu mută și slide-ul din spate
    });
    fundal.addEventListener('click', function () { inchide(false); });
    doc.addEventListener('pointerdown', function (e) {
      if (deschis() && !m.contains(e.target) && !b.contains(e.target)) inchide(false);
    }, true);
    win.addEventListener('resize', function () { if (deschis()) aseaza(); });

    return { deschide: deschide, inchide: inchide, get deschis() { return deschis(); }, element: m, actualizeaza: function () { if (deschis()) { deseneaza(); aseaza(); } } };
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
    doc.addEventListener('fullscreenchange', schimbare);
    doc.addEventListener('webkitfullscreenchange', schimbare);
    ['mousemove', 'pointerdown', 'touchstart', 'wheel'].forEach(function (ev) { scena.addEventListener(ev, function () { if (activ) arata(); }, { passive: true }); });
    // Escape iese din modul simulat (în cel real îl tratează browserul).
    doc.addEventListener('keydown', function (e) {
      if (!activ) return;
      arata();
      if (e.key === 'Escape' && simulat && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); iesi(); }
    }, true);
    win.addEventListener('resize', verificaRotire);
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
      get activ() { return activ; }, get simulat() { return simulat; },
      laSchimbare: function (i, total) {
        fs.querySelector('.pdp-fs-contor').textContent = (i + 1) + ' / ' + total;
        $f('anterior').disabled = i === 0;
        $f('urmator').disabled = i === total - 1;
      },
    };
  }

  /**
   * Totul legat de o scenă: meniul și ecranul complet (redarea automată și
   * vederea prezentatorului se adaugă mai jos).
   * o: { buton, scena, deck(), limba(), stareMod(mod) }
   */
  function ataseaza(o) {
    var ecran = ecranComplet({ scena: o.scena, deck: o.deck, limba: o.limba });
    var m = meniu({
      buton: o.buton, limba: o.limba,
      stareMod: function (mod) { return o.stareMod ? o.stareMod(mod) : null; },
      moduri: { ecran: function () { ecran.intra(); } },
    });
    return {
      meniu: m, ecran: ecran,
      laSchimbare: function (i, total) { ecran.laSchimbare(i, total); },
      texte: function () { ecran.texte(); m.actualizeaza(); },
    };
  }

  exporturi.meniu = meniu;
  exporturi.ecranComplet = ecranComplet;
  exporturi.ataseaza = ataseaza;
  exporturi.esteFoaie = esteFoaie;
  return exporturi;
});

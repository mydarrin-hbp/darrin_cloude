/* ════════════════════════════════════════════════════════════════
   MY DARRIN — i18n Loader v2 (10 oct. 2026)

   Platforma publică se deschide în ENGLEZĂ (decizie LM, 9 oct. 2026).
   Româna (și celelalte limbi) se aleg doar din selector; alegerea se
   păstrează în localStorage `myd_lang_v1`. Geolocalizarea NU mai schimbă
   limba — doar țara, moneda și locația.

   Româna e limba sursă: textul din HTML și din scripturi. Traducerea vine
   din două surse, încărcate în paralel:
     /i18n/<limba>.json            chei (data-i18n, window.t) + texte comune
     /i18n/<limba>/<pagina>.json   textele paginii curente
   plus, pentru conținutul din baza de date (catalog), /api/public/
   traduceri-catalog?lang=<limba> (gol până la aplicarea migrării).

   Structura unui fișier de limbă:
     { "<grup>": { "<cheie>": "text" }, ...      chei, ca înainte
       "_texte":  { "Text român": "Translation" }, după textul sursă
       "_modele": { "Ai {n} servicii": "You have {n} services" } }
   `_texte` traduce orice nod de text sau atribut (placeholder, title,
   aria-label, alt, value la butoane, title-ul paginii, meta description)
   al cărui text român (spațiile normalizate) se potrivește exact — inclusiv
   conținutul generat din JavaScript (MutationObserver), fără chei puse pe
   fiecare element. `_modele` acoperă textele cu numere sau nume variabile.

   Fără flash de română: <html class="myd-i18n-pending"> e ascuns vizual
   până se aplică traducerea, cel mult 800 ms (după aceea se afișează
   oricum, ca pagina să nu rămână goală la o eroare).

   Paginile interne (superadmin, back-office, documentație tehnică) rămân
   în română: aici nu se traduce nimic.

   Schimbarea limbii reîncarcă pagina: textele românești vin mereu din HTML,
   fără restaurări parțiale.

   Se include sincron, cât mai sus în <head> (înaintea celorlalte scripturi),
   ca formatarea numerelor să urmeze limba de la început.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_I18N && window.MYD_I18N.v2) return;

  var LANG_KEY = 'myd_lang_v1';
  var IMPLICIT = 'en';
  // Limbile cu fișier de traducere; engleza e rezerva oricărei limbi netraduse.
  var SUPPORTED = ['en', 'de', 'fr', 'tr', 'bg', 'el'];
  var LOCALE = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', tr: 'tr-TR', bg: 'bg-BG', el: 'el-GR' };
  var INTERNE = /\/(mydarrin-(superadmin|backoffice-serviciu|deviz-engine|auth-schema|sync-architecture|business-model|design-system))(\.html)?$/;
  var ATRIBUTE = ['placeholder', 'title', 'aria-label', 'alt'];
  var MAX_ASTEPTARE = 800;

  var root = document.documentElement;
  var intern = INTERNE.test(location.pathname) || root.hasAttribute('data-i18n-off');

  function citeste() { try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; } }
  function salveaza(l) { try { localStorage.setItem(LANG_KEY, l); } catch (e) {} }
  function normalizeaza(l) {
    l = String(l || '').toLowerCase().slice(0, 2);
    if (l === 'ro') return 'ro';
    return SUPPORTED.indexOf(l) !== -1 ? l : 'en';
  }

  // ?lang=ro / ?lang=en (linkurile hreflang) = alegere explicită, se păstrează.
  var dinUrl = (location.search.match(/[?&]lang=([a-zA-Z]{2})\b/) || [])[1];
  if (dinUrl && !intern) salveaza(normalizeaza(dinUrl));

  var limba = intern ? 'ro' : normalizeaza(citeste() || IMPLICIT);
  root.lang = limba;

  // ── Formatarea numerelor și a datelor urmează limba ───────────────────
  // Scripturile paginilor scriu explicit 'ro-RO' (≈90 de locuri); în altă
  // limbă îl înlocuim cu localizarea ei (EN: 226.65, RO: 226,65).
  if (limba !== 'ro') {
    var loc = LOCALE[limba] || 'en-GB';
    var schimba = function (l) { return (typeof l === 'string' && /^ro(-RO)?$/i.test(l)) ? loc : (l == null ? loc : l); };
    [[Number.prototype, 'toLocaleString'], [Date.prototype, 'toLocaleString'], [Date.prototype, 'toLocaleDateString'], [Date.prototype, 'toLocaleTimeString']].forEach(function (p) {
      var orig = p[0][p[1]];
      p[0][p[1]] = function (l, o) { return orig.call(this, schimba(l), o); };
    });
    ['NumberFormat', 'DateTimeFormat'].forEach(function (n) {
      var Orig = Intl[n];
      var Nou = function (l, o) { return new Orig(schimba(l), o); };
      Nou.prototype = Orig.prototype;
      Nou.supportedLocalesOf = Orig.supportedLocalesOf;
      Intl[n] = Nou;
    });
  }

  // ── Dicționarul ───────────────────────────────────────────────────────
  var chei = {}, texte = {}, modele = [], gata = false;

  function aplatizeaza(o, pref, out) {
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k) || k.charAt(0) === '_') continue;
      if (o[k] && typeof o[k] === 'object') aplatizeaza(o[k], pref + k + '.', out);
      else out[pref + k] = o[k];
    }
    return out;
  }
  function norm(s) { return String(s).replace(/[\s ]+/g, ' ').trim(); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function adaugaDictionar(d) {
    if (!d || typeof d !== 'object') return;
    aplatizeaza(d, '', chei);
    var t = d._texte || {};
    for (var k in t) if (t[k]) texte[norm(k)] = t[k];
    var m = d._modele || {};
    for (var r in m) {
      var nume = [];
      // {n}, {n1}… = număr; orice altă variabilă = text
      var sursa = escRe(norm(r)).replace(/\\\{(\w+)\\\}/g, function (_, n) { nume.push(n); return /^n\d*$/.test(n) ? '(\\d+(?:[.,]\\d+)*)' : '(.+?)'; });
      modele.push({ re: new RegExp('^' + sursa + '$'), nume: nume, en: m[r], fix: norm(r).replace(/\{\w+\}/g, '').length });
    }
    // cel mai specific model întâi (cel mai mult text fix): „/ {u} manoperă” înaintea lui „/ {u}”
    modele.sort(function (a, b) { return b.fix - a.fix; });
  }

  // Traducerea unui text român; null dacă nu există.
  function traduce(s) {
    if (s == null) return null;
    var n = norm(s);
    if (!n) return null;
    if (Object.prototype.hasOwnProperty.call(texte, n)) return texte[n];
    for (var i = 0; i < modele.length; i++) {
      var m = modele[i].re.exec(n);
      if (m) {
        var v = {};
        modele[i].nume.forEach(function (x, j) { v[x] = traduceFragment(m[j + 1]); });
        return modele[i].en.replace(/\{(\w+)\}/g, function (_, x) { return v[x] != null ? v[x] : ''; });
      }
    }
    return null;
  }
  // Valorile din modele (ex. numele unui serviciu) se traduc și ele, dacă se poate.
  function traduceFragment(s) {
    var t = traduce(s); // fragmentul e mai scurt decât textul: recursia se oprește
    return t != null ? t : s;
  }
  function pastreazaSpatii(orig, nou) {
    var a = orig.match(/^[\s ]*/)[0], b = orig.match(/[\s ]*$/)[0];
    return a + nou + b;
  }

  // ── Aplicarea pe DOM ──────────────────────────────────────────────────
  var pus = new WeakMap(); // nod → textul pus de noi (ca să nu-l retraducem)
  function sarit(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var tag = e.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'CODE' || tag === 'PRE') return true;
      if (e.getAttribute('translate') === 'no' || e.hasAttribute('data-i18n-skip') || e.isContentEditable) return true;
      if (e.classList && e.classList.contains('notranslate')) return true;
    }
    return false;
  }
  function traduNodText(n) {
    var v = n.data;
    if (!v || pus.get(n) === v || !/[^\s ]/.test(v)) return;
    if (n.parentElement && sarit(n.parentElement)) return;
    var t = traduce(v);
    if (t != null) { var nou = pastreazaSpatii(v, t); pus.set(n, nou); if (nou !== v) n.data = nou; }
  }
  function traduAtribute(el) {
    // atributele unui <textarea> se traduc (placeholder); conținutul lui, nu
    if (sarit(el.tagName === 'TEXTAREA' ? el.parentElement : el)) return;
    for (var i = 0; i < ATRIBUTE.length; i++) {
      var a = ATRIBUTE[i], v = el.getAttribute(a);
      if (v) { var t = traduce(v); if (t != null && t !== v) el.setAttribute(a, t); }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      var tv = traduce(el.value); if (tv != null && tv !== el.value) el.value = tv;
    }
  }
  function aplicaChei(rad) {
    var q = function (s) { return rad.querySelectorAll ? rad.querySelectorAll(s) : []; };
    Array.prototype.forEach.call(q('[data-i18n]'), function (el) {
      var k = el.getAttribute('data-i18n');
      if (chei[k] != null && el.textContent !== chei[k]) el.textContent = chei[k];
    });
    Array.prototype.forEach.call(q('[data-i18n-html]'), function (el) {
      var k = el.getAttribute('data-i18n-html');
      if (chei[k] != null && el.innerHTML !== chei[k]) el.innerHTML = chei[k];
    });
    Array.prototype.forEach.call(q('[data-i18n-attr]'), function (el) {
      // format: "atribut:cheie[;atribut:cheie]"
      (el.getAttribute('data-i18n-attr') || '').split(';').forEach(function (spec) {
        var p = spec.split(':'), a = (p[0] || '').trim(), k = (p[1] || '').trim();
        if (a && k && chei[k] != null) el.setAttribute(a, chei[k]);
      });
    });
  }
  function traduArbore(rad) {
    if (!rad) return;
    if (rad.nodeType === 3) { traduNodText(rad); return; }
    if (rad.nodeType !== 1 && rad.nodeType !== 9 && rad.nodeType !== 11) return;
    aplicaChei(rad);
    if (rad.nodeType === 1) traduAtribute(rad);
    var w = document.createTreeWalker(rad, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) {
        if (n.nodeType === 1) {
          var tag = n.tagName;
          if (tag === 'TEXTAREA') { traduAtribute(n); return NodeFilter.FILTER_REJECT; }
          return (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (w.nextNode()) {
      var n = w.currentNode;
      if (n.nodeType === 3) traduNodText(n); else traduAtribute(n);
    }
  }
  function traduHead() {
    var titluOrig = document.title;
    var t = traduce(titluOrig);
    if (t != null && t !== titluOrig) document.title = t;
    var metas = document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]');
    Array.prototype.forEach.call(metas, function (m) {
      var c = m.getAttribute('content'); var tc = traduce(c);
      if (tc != null && tc !== c) m.setAttribute('content', tc);
    });
  }

  var observator = null;
  function porneste() {
    if (observator || !document.body) return;
    observator = new MutationObserver(function (lista) {
      if (!gata) return;
      for (var i = 0; i < lista.length; i++) {
        var m = lista[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) traduArbore(m.addedNodes[j]);
          if (m.target && m.target.nodeName === 'TITLE') traduHead();
        } else if (m.type === 'characterData') {
          if (m.target.parentNode && m.target.parentNode.nodeName === 'TITLE') traduHead();
          else traduNodText(m.target);
        } else if (m.type === 'attributes') {
          traduAtribute(m.target);
        }
      }
    });
    observator.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTE.concat(['value']) });
  }

  // ── Mesajele alert / confirm / prompt ─────────────────────────────────
  if (limba !== 'ro') {
    ['alert', 'confirm', 'prompt'].forEach(function (f) {
      var orig = window[f];
      if (typeof orig !== 'function') return;
      window[f] = function (mesaj) {
        var a = Array.prototype.slice.call(arguments);
        if (typeof mesaj === 'string') { var t = traduce(mesaj); if (t != null) a[0] = t; }
        return orig.apply(window, a);
      };
    });
  }

  // ── window.t — pentru textele compuse în JavaScript ──────────────────
  // t('cheie', 'Text român {n}', { n: 3 }): cheia, apoi textul român din
  // dicționar, apoi textul român. Parametrii {x} se înlocuiesc la final.
  function t(cheie, ro, param) {
    var s = ro != null ? String(ro) : String(cheie);
    if (limba !== 'ro') {
      if (cheie && chei[cheie] != null) s = chei[cheie];
      else { var tr = traduce(s); if (tr != null) s = tr; }
    }
    if (param) s = s.replace(/\{(\w+)\}/g, function (m, x) { return param[x] != null ? param[x] : m; });
    return s;
  }

  // ── Limba activă și schimbarea ei ─────────────────────────────────────
  function setLanguage(l, opts) {
    opts = opts || {};
    l = normalizeaza(l);
    if (opts.persist !== false) salveaza(l);
    if (l !== limba) location.reload();
  }
  function _actualizeazaSelectoare() {
    var steaguri = { ro: ['🇷🇴', 'Română', 'RO'], en: ['🇬🇧', 'English', 'EN'], de: ['🇩🇪', 'Deutsch', 'DE'], fr: ['🇫🇷', 'Français', 'FR'], tr: ['🇹🇷', 'Türkçe', 'TR'], bg: ['🇧🇬', 'Български', 'BG'], el: ['🇬🇷', 'Ελληνικά', 'EL'] };
    var s = steaguri[limba];
    var f = document.getElementById('lang-flag'), lb = document.getElementById('lang-label');
    if (s && f) f.textContent = s[0];
    if (s && lb) lb.textContent = s[1];
    Array.prototype.forEach.call(document.querySelectorAll('.lang-opt'), function (o) {
      o.classList.toggle('active', (o.getAttribute('onclick') || '').indexOf("setLang('" + limba + "'") !== -1);
    });
    var sel = document.getElementById('lang-switcher') || document.getElementById('sb-limba');
    if (sel && sel.value !== limba) sel.value = limba;
  }

  // ── Încărcarea ────────────────────────────────────────────────────────
  // Pagina vine din <script src="/i18n-loader.js" data-pagina="...">: cu
  // cleanUrls și rewrite-uri (/servicii/:slug) calea nu spune fișierul.
  var scriptCurent = document.currentScript;
  var pagina = (scriptCurent && scriptCurent.getAttribute('data-pagina')) ||
    (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  function json(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  var ascuns = false;
  function arata() {
    if (!ascuns) return;
    ascuns = false;
    root.classList.remove('myd-i18n-pending');
  }

  window.MYD_I18N = {
    v2: true,
    lang: limba,
    intern: intern,
    SUPPORTED: SUPPORTED,
    setLanguage: setLanguage,
    t: t,
    traduce: function (s) { var r = limba === 'ro' ? null : traduce(s); return r == null ? s : r; },
    aplica: function (rad) { if (limba !== 'ro' && gata) traduArbore(rad || document.body); },
  };
  window.t = t;

  function dupaDom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  dupaDom(_actualizeazaSelectoare);

  if (limba === 'ro') {
    // Cheile cu nume vin și în română din /i18n/ro.json (identic cu HTML-ul),
    // ca textul să nu depindă doar de marcajul paginii. Fără ascundere.
    var roJson = intern ? Promise.resolve(null) : json('/i18n/ro.json');
    dupaDom(function () {
      roJson.then(function (d) {
        if (d) { adaugaDictionar(d); aplicaChei(document); }
        try { window.dispatchEvent(new CustomEvent('myd:lang', { detail: { lang: 'ro' } })); } catch (e) {}
      });
    });
    return;
  }

  // Ascuns vizual până se aplică traducerea (max. 800 ms).
  try {
    var st = document.createElement('style');
    // opacity pe <body>, nu visibility pe <html>: unele stiluri ale paginilor pun
    // visibility:visible pe elemente, care ar fi scăpat de ascundere (româna se
    // vedea o clipă); opacitatea părintelui nu poate fi anulată de copii.
    st.textContent = 'html.myd-i18n-pending body{opacity:0!important}';
    (document.head || root).appendChild(st);
    root.classList.add('myd-i18n-pending');
    ascuns = true;
    setTimeout(arata, MAX_ASTEPTARE);
  } catch (e) {}

  // + /i18n/ro.json: cheile cu nume (ex. meniu.*) au textul român acolo și
  // traducerea în fișierul limbii — un text egal cu valoarea românească a unei
  // chei primește traducerea cheii (meniul lateral se traduce astfel prin chei,
  // fără data-i18n pe fiecare element, care i-ar șterge iconițele).
  var dictionare = Promise.all([json('/i18n/' + limba + '.json'), json('/i18n/' + limba + '/' + pagina + '.json'), json('/i18n/ro.json')]);
  // Conținutul din baza de date (titluri de servicii, niveluri, categorii) —
  // nu ține pagina ascunsă; se aplică imediat ce sosește.
  var catalog = json('/api/public/traduceri-catalog?lang=' + limba);

  dictionare.then(function (d) {
    adaugaDictionar(d[0]);
    adaugaDictionar(d[1]);
    var ro = d[2] || {};
    for (var k in ro) {
      if (k.charAt(0) === '_' || typeof ro[k] !== 'string' || chei[k] == null || /</.test(ro[k])) continue;
      var n = norm(ro[k]);
      if (n) texte[n] = chei[k];
    }
    dupaDom(function () {
      gata = true;
      traduHead();
      traduArbore(document.body);
      porneste();
      arata();
      try { window.dispatchEvent(new CustomEvent('myd:lang', { detail: { lang: limba } })); } catch (e) {}
      catalog.then(function (c) {
        if (c && c._texte && Object.keys(c._texte).length) { adaugaDictionar(c); traduArbore(document.body); traduHead(); }
      });
    });
  });
})();

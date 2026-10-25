// seo-panou.js
// Panoul „SEO — Titluri & Descrieri” din mydarrin-superadmin.html (pasul 11-S,
// 23 oct. 2026). Pagina internă rămâne în română (CLAUDE.md).
//
// Tabelul paginilor publice → „Editează” → trei taburi:
//   SEO                      titlu / descriere / canonic, pe limbă (RO / EN), cu contoare;
//   Partajare (OG)           seo-panou-og.js — imaginea 1,91:1 și previzualizarea cardului;
//   Social media & campanii  seo-panou-campanii.js — campaniile paginii.
// SEO și OG sunt pe același rând din seo_config (page_path, limba): orice
// salvare trimite toate câmpurile limbii, ca un tab să nu le șteargă pe ale celuilalt.
// Drepturile le decide serverul (api/admin/seo.js, lib/permisiuni-seo.js);
// panoul doar dezactivează butoanele când răspunsul spune „doar citire”.

(function () {
  'use strict';

  var CAMPURI = ['meta_title', 'meta_description', 'canonical_url', 'og_titlu', 'og_descriere', 'og_imagine_url', 'og_imagine_alt', 'og_imagine_latime', 'og_imagine_inaltime'];
  // Lungimi orientative (Google taie titlul pe la ~60 de caractere și descrierea pe la ~160).
  var ORIENTATIV = { meta_title: 60, meta_description: 160 };

  var S = { pagini: [], cale: null, limba: 'ro', date: { ro: {}, en: {} }, poateScrie: false, tab: 'seo' };
  var TABURI = [];   // { id, titlu, randeaza(container, S), laIesire? }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function $(sel, r) { return (r || document).querySelector(sel); }

  async function antet() {
    if (typeof window._adminAuthHeader === 'function') return window._adminAuthHeader();
    var s = window.supabaseClient ? (await window.supabaseClient.auth.getSession()).data.session : null;
    return { Authorization: 'Bearer ' + ((s && s.access_token) || '') };
  }
  async function api(url, optiuni) {
    var o = Object.assign({}, optiuni || {});
    o.headers = Object.assign({}, await antet(), o.headers || {});
    return window.MDFeedback.cerere(url, o);
  }

  // Contor de caractere: verde sub 90 % din limită, galben până la limită, roșu peste.
  function culoareContor(n, limita) {
    if (!limita) return 'verde';
    if (n > limita) return 'rosu';
    return n >= Math.round(limita * 0.9) ? 'galben' : 'verde';
  }
  function legaContor(camp, eticheta, limita, textLimita) {
    var actualizeaza = function () {
      var n = [...(camp.value || '')].length;
      eticheta.textContent = n + ' / ' + limita + (textLimita || '');
      eticheta.className = 'seo-contor ' + culoareContor(n, limita);
    };
    camp.addEventListener('input', actualizeaza);
    actualizeaza();
    return actualizeaza;
  }

  function limbaHtml(id) {
    return '<div class="seo-limba" role="group" aria-label="Limba suprascrierii" data-limba-grup="' + id + '">' +
      ['ro', 'en'].map(function (l) {
        return '<button type="button" data-limba="' + l + '" aria-pressed="' + (S.limba === l) + '">' + l.toUpperCase() + '</button>';
      }).join('') + '</div>';
  }
  function legaLimba(container, laSchimbare) {
    container.querySelectorAll('[data-limba]').forEach(function (b) {
      b.addEventListener('click', function () {
        citesteFormular(container);
        S.limba = b.getAttribute('data-limba');
        laSchimbare();
      });
    });
  }

  // Câmpurile cu data-camp din container → S.date[S.limba].
  function citesteFormular(container) {
    container.querySelectorAll('[data-camp]').forEach(function (el) {
      S.date[S.limba][el.getAttribute('data-camp')] = el.value;
    });
  }

  async function salveazaLimba(buton, zona, form, textOk) {
    if (form) citesteFormular(form);
    var limba = S.limba, cale = S.cale;
    var corp = { page_path: cale, limba: limba };
    CAMPURI.forEach(function (c) { corp[c] = S.date[limba][c] == null ? '' : S.date[limba][c]; });
    return window.MDFeedback.salveaza(buton, zona, async function () {
      var j = await api('/api/admin/seo', { method: 'POST', body: corp });
      var p = S.pagini.find(function (x) { return x.page_path === cale; });
      if (p) p.override[limba] = j.config;
      randeazaTabel();
      return textOk || ('Salvat pentru ' + limba.toUpperCase() + '.');
    }, { form: form });
  }

  // ── Tabul „SEO” ───────────────────────────────────────────────────────
  TABURI.push({
    id: 'seo', titlu: 'SEO',
    randeaza: function (c) {
      var d = S.date[S.limba];
      var ro = S.limba === 'ro';
      c.innerHTML = limbaHtml('seo') +
        '<form class="seo-form" novalidate>' +
        '<div class="seo-camp"><label for="seo-input-title"><span>Titlu ' + S.limba.toUpperCase() + ' (tab-ul browserului și rezultatele de căutare)</span><span class="seo-contor" data-contor="meta_title"></span></label>' +
        '<input id="seo-input-title" type="text" maxlength="200" data-camp="meta_title" value="' + esc(d.meta_title) + '"/></div>' +
        '<div class="seo-camp"><label for="seo-input-description"><span>Descriere ' + S.limba.toUpperCase() + ' (sub titlu, în rezultatele de căutare)</span><span class="seo-contor" data-contor="meta_description"></span></label>' +
        '<textarea id="seo-input-description" maxlength="400" rows="3" data-camp="meta_description">' + esc(d.meta_description) + '</textarea></div>' +
        '<div class="seo-camp"><label for="seo-input-canonical"><span>URL canonic (opțional — lasă gol dacă nu e cazul)</span></label>' +
        '<input id="seo-input-canonical" type="url" data-camp="canonical_url" placeholder="https://mydarrin.homebestpal.com/..." value="' + esc(d.canonical_url) + '"/></div>' +
        '<p class="seo-nota">Contoarele sunt orientative (titlu ~60, descriere ~160 de caractere). ' +
        (ro ? 'Varianta RO se aplică vizitatorilor cu limba română.' : 'Varianta EN se aplică vizitatorilor cu orice altă limbă (en, bg, de, el, fr, tr).') +
        ' Câmpurile goale lasă textul static din fișierul paginii.</p>' +
        '<div class="seo-mesaj" id="seo-editor-msg" role="status"></div>' +
        '<div class="seo-actiuni">' +
        '<button type="button" class="seo-buton principal" data-act="salveaza">Salvează ' + S.limba.toUpperCase() + '</button>' +
        '<button type="button" class="seo-buton pericol" data-act="sterge">Șterge suprascrierea ' + S.limba.toUpperCase() + '</button>' +
        '</div></form>';
      var form = $('form', c);
      Object.keys(ORIENTATIV).forEach(function (k) {
        legaContor(form.querySelector('[data-camp="' + k + '"]'), form.querySelector('[data-contor="' + k + '"]'), ORIENTATIV[k]);
      });
      legaLimba(c, function () { deseneazaTab(); });
      var bSalv = form.querySelector('[data-act="salveaza"]');
      var bSterge = form.querySelector('[data-act="sterge"]');
      bSalv.addEventListener('click', function () { salveazaLimba(bSalv, $('#seo-editor-msg', c), form); });
      bSterge.addEventListener('click', function () { stergeLimba(bSterge, $('#seo-editor-msg', c)); });
      if (!S.poateScrie) { bSalv.disabled = true; bSterge.disabled = true; }
      bSterge.disabled = bSterge.disabled || !(paginaCurenta() && paginaCurenta().override[S.limba]);
    },
  });

  async function stergeLimba(buton, zona) {
    var limba = S.limba, cale = S.cale;
    var da = await window.MDFeedback.confirma('Ștergi suprascrierea ' + limba.toUpperCase() + ' (SEO și partajare) pentru ' + cale + '? Pagina revine la textele statice din fișier.',
      { textOk: 'Șterge', textAnulare: 'Anulează', periculos: true });
    if (!da) return;
    await window.MDFeedback.salveaza(buton, zona, async function () {
      await api('/api/admin/seo?page_path=' + encodeURIComponent(cale) + '&limba=' + limba, { method: 'DELETE' });
      var p = paginaCurenta();
      if (p) p.override[limba] = null;
      S.date[limba] = {};
      randeazaTabel();
      deseneazaTab();
      return 'Suprascrierea ' + limba.toUpperCase() + ' a fost ștearsă — revine la textele statice din fișier.';
    }, { textSalveaza: 'Se șterge…', textOk: '✓ Șters' });
  }

  function paginaCurenta() { return S.pagini.find(function (p) { return p.page_path === S.cale; }) || null; }

  // ── Tabelul paginilor ─────────────────────────────────────────────────
  function etichetaLimba(l, override) {
    var are = !!override && !!(override.meta_title || override.meta_description || override.canonical_url || override.og_titlu || override.og_imagine_url);
    return '<span class="seo-eticheta ' + (are ? 'da' : 'nu') + '">' + l.toUpperCase() + ': ' + (are ? 'Suprascris' : 'Implicit') + '</span>';
  }
  function randeazaTabel() {
    var corp = document.getElementById('seo-tabel-body');
    if (!corp) return;
    corp.innerHTML = S.pagini.map(function (p) {
      var o = p.override || {};
      var titlu = (o.ro && o.ro.meta_title) || (p.titlu_pagina + ' (implicit din fișier)');
      return '<tr>' +
        '<td class="seo-cale">' + esc(p.page_path) + '</td>' +
        '<td>' + esc(titlu) + '</td>' +
        '<td>' + etichetaLimba('ro', o.ro) + etichetaLimba('en', o.en) + '</td>' +
        '<td style="text-align:right"><button type="button" class="seo-buton contur" data-editeaza="' + esc(p.page_path) + '">Editează</button></td>' +
        '</tr>';
    }).join('');
    corp.querySelectorAll('[data-editeaza]').forEach(function (b) {
      b.addEventListener('click', function () { deschide(b.getAttribute('data-editeaza')); });
    });
  }

  async function incarca() {
    var status = document.getElementById('seo-status');
    if (!status) return;
    status.style.color = '';
    status.textContent = 'Se încarcă…';
    try {
      var j = await api('/api/admin/seo');
      S.pagini = j.pagini || [];
      S.poateScrie = j.poate_scrie === true;
      status.textContent = S.pagini.length + ' pagini publice cunoscute.' + (S.poateScrie ? '' : ' Ai acces doar de citire.');
      randeazaTabel();
    } catch (e) {
      status.style.color = '#E57373';
      status.textContent = 'Eroare: ' + e.message;
    }
  }

  // ── Editorul ──────────────────────────────────────────────────────────
  function deschide(cale) {
    var p = S.pagini.find(function (x) { return x.page_path === cale; });
    if (!p) return;
    S.cale = cale;
    ['ro', 'en'].forEach(function (l) {
      var o = p.override[l] || {};
      S.date[l] = {};
      CAMPURI.forEach(function (c) { S.date[l][c] = o[c] == null ? '' : o[c]; });
    });
    var ed = document.getElementById('seo-editor');
    document.getElementById('seo-editor-path').textContent = cale;
    ed.hidden = false;
    ed.style.display = '';
    alegeTab(S.tab || 'seo');
    ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function inchide() {
    var ed = document.getElementById('seo-editor');
    TABURI.forEach(function (t) { if (t.laIesire) t.laIesire(); });
    ed.hidden = true;
    S.cale = null;
  }

  function randeazaTaburi() {
    var bara = document.getElementById('seo-taburi');
    bara.innerHTML = TABURI.map(function (t) {
      return '<button type="button" class="seo-tab" role="tab" id="seo-tab-' + t.id + '" data-tab="' + t.id + '" aria-controls="seo-panou-tab" aria-selected="' + (S.tab === t.id) + '" tabindex="' + (S.tab === t.id ? 0 : -1) + '">' + esc(t.titlu) + '</button>';
    }).join('');
    bara.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { alegeTab(b.getAttribute('data-tab')); });
      b.addEventListener('keydown', function (e) {
        var i = TABURI.findIndex(function (t) { return t.id === S.tab; });
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var n = TABURI[(i + (e.key === 'ArrowRight' ? 1 : TABURI.length - 1)) % TABURI.length];
          alegeTab(n.id);
          document.getElementById('seo-tab-' + n.id).focus();
        }
      });
    });
  }
  function alegeTab(id) {
    var c = document.getElementById('seo-panou-tab');
    if (c && S.tab !== id) { citesteFormular(c); var vechi = TABURI.find(function (t) { return t.id === S.tab; }); if (vechi && vechi.laIesire) vechi.laIesire(); }
    S.tab = TABURI.some(function (t) { return t.id === id; }) ? id : 'seo';
    randeazaTaburi();
    deseneazaTab();
  }
  function deseneazaTab() {
    var c = document.getElementById('seo-panou-tab');
    var t = TABURI.find(function (x) { return x.id === S.tab; });
    c.setAttribute('aria-labelledby', 'seo-tab-' + t.id);
    t.randeaza(c, S);
  }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#seo-editor-inchide')) window.SeoPanou.inchide();
  });

  window.SeoPanou = {
    S: S, TABURI: TABURI, CAMPURI: CAMPURI, incarca: incarca, deschide: deschide, inchide: inchide, alegeTab: alegeTab,
    deseneazaTab: deseneazaTab, api: api, antet: antet, esc: esc, legaContor: legaContor, culoareContor: culoareContor,
    limbaHtml: limbaHtml, legaLimba: legaLimba, citesteFormular: citesteFormular, salveazaLimba: salveazaLimba, paginaCurenta: paginaCurenta,
  };
})();

/* categorie-catalog.js — paginile de categorie (pasul 11-C2, 3 nov. 2026)
   mydarrin-categorie-servicii / -materiale / -inchirieri.html

   Produsele vin din catalogul real (/api/public/catalog-categorie, același
   catalog ca mydarrin-catalog.html), nu din listele scrise de mână de înainte
   (produse inexistente în catalog, prețuri „price:450” și imagini Unsplash).
     - prețul „de la” doar din catalog_preturi (calculat pe server); fără preț,
       nicio cifră;
     - imaginea doar din catalog; fără ea, iconița categoriei;
     - filtrul de preț își ia maximul din date;
     - butoanele (regula 11-C1): serviciu / închiriere → configurare;
       material → direct în coș (cos-indicator.js → MDCos.adauga).
   Tipul paginii: <script src="categorie-catalog.js" data-tip="servicii|materiale|inchirieri">.
   Textele trec prin window.t (RO / EN, i18n/en.json → _texte). */
(function () {
  'use strict';
  var script = document.currentScript;
  var TIP = (script && script.getAttribute('data-tip')) || 'servicii';
  var SLUG_IMPLICIT = { servicii: 'instalatii-electrice', materiale: 'electrice-cabluri', inchirieri: 'scule-echipamente' };
  var TIP_PARAM = { servicii: 'serviciu', materiale: 'material', inchirieri: 'inchiriere' };
  var ETICHETA_TIP = { servicii: 'Servicii', materiale: 'Materiale', inchirieri: 'Închirieri' };
  var STARE = { produse: [], categorie: null, moneda: 'RON' };

  function tr(ro, p) {
    if (typeof window.t === 'function') return window.t(null, ro, p);
    return p ? String(ro).replace(/\{(\w+)\}/g, function (m, x) { return p[x] != null ? p[x] : m; }) : ro;
  }
  function en() { return !!(window.MYD_I18N && window.MYD_I18N.lang && window.MYD_I18N.lang !== 'ro'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function fmt(n) {
    if (typeof window.formatCurrency === 'function') return window.formatCurrency(n);
    return Math.round(n).toLocaleString('ro-RO') + ' ' + (STARE.moneda === 'RON' ? 'Lei' : STARE.moneda);
  }
  function icoana(nume) {
    return '<i data-lucide="' + esc(nume || 'layers') + '" style="width:1em;height:1em;display:inline-block;vertical-align:middle"></i>';
  }
  function icoane() { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }

  function antet(cat, slug) {
    var titlu = cat ? (en() && cat.title_en ? cat.title_en : cat.title) : tr('Categorie');
    var descriere = cat ? (en() && cat.description_en ? cat.description_en : (cat.description || '')) : '';
    document.title = titlu + ' · My Darrin';
    var ic = document.getElementById('cat-icon');
    if (ic) ic.innerHTML = icoana(cat && cat.icon_name);
    setText('cat-label', titlu);
    setText('cat-title', titlu);
    setText('cat-subtitle', descriere);
    setText('bc-cat', titlu);
    var link = document.getElementById('bc-cat-link');
    if (link) { link.textContent = tr(ETICHETA_TIP[TIP]); link.setAttribute('href', 'mydarrin-catalog.html?cat=' + encodeURIComponent(slug)); }
  }

  function card(p, idx) {
    var media = p.imagine
      ? '<img src="' + esc(p.imagine) + '" alt="' + esc(p.titlu) + '" loading="lazy"/>'
      : '<div class="card-icoana" aria-hidden="true">' + icoana(STARE.categorie && STARE.categorie.icon_name) + '</div>';
    var pret = p.pret_de_la != null
      ? '<div class="card-price"><span class="price-from">' + esc(tr('De la')) + '</span> <span class="price-val">' + esc(fmt(p.pret_de_la)) + '</span>'
        + (p.unitate ? ' <span class="price-unit">/ ' + esc(p.unitate) + '</span>' : '') + '</div>'
      : p.are_pret ? '<div class="card-price"></div>'
      : '<div class="card-price"><span class="price-from">' + esc(tr('Prețul se stabilește prin deviz')) + '</span></div>';
    // Fără preț real: „Cere un deviz” (configurarea arată fluxul de deviz), nu „Adaugă în coș”.
    var eticheta = p.pret_de_la == null && !p.are_pret ? tr('Cere un deviz') : tr('Adaugă în coș');
    return '<div class="rich-card" data-slug="' + esc(p.slug) + '" data-tab="' + esc(TIP) + '" data-idx="' + idx + '">'
      + '<div class="card-media">' + media + '</div>'
      + '<div class="card-body"><div class="card-title">' + esc(p.titlu) + '</div>'
      + (p.descriere ? '<div class="card-desc">' + esc(p.descriere) + '</div>' : '')
      + '<div class="card-footer">' + pret
      + '<button type="button" class="card-cta" data-actiune="' + (p.pret_de_la == null && !p.are_pret ? 'deviz' : 'adauga') + '">' + esc(eticheta) + '</button></div></div></div>';
  }

  function randeaza(lista) {
    var grid = document.getElementById('sub-grid');
    var gol = document.getElementById('empty-state');
    setText('result-num', String(lista.length));
    if (!lista.length) {
      grid.innerHTML = '';
      gol.style.display = 'block';
      gol.innerHTML = '<div style="font-size:44px;margin-bottom:14px">' + icoana('package-search') + '</div>'
        + '<div style="font-size:15px;font-weight:600">' + esc(STARE.produse.length ? tr('Niciun produs nu se potrivește filtrelor.') : tr('Încă nu avem produse în această categorie.')) + '</div>'
        + '<div style="font-size:13px;margin-top:8px"><a href="mydarrin-catalog.html" style="color:#CC7000;font-weight:700;text-decoration:none">' + esc(tr('Vezi catalogul complet →')) + '</a></div>';
      icoane();
      return;
    }
    gol.style.display = 'none';
    grid.innerHTML = lista.map(function (p) { return card(p, STARE.produse.indexOf(p)); }).join('');
    icoane();
  }

  function deschide(p) {
    window.location.href = 'mydarrin-produs.html?slug=' + encodeURIComponent(p.slug) + '&type=' + TIP_PARAM[TIP];
  }
  function adauga(p, buton) {
    if (TIP !== 'materiale') { deschide(p); return; }
    if (!window.MDCos) return;
    buton.disabled = true;
    window.MDCos.adauga({ tip: 'material', slug: p.slug, titlu: p.titlu }).then(function () { buton.disabled = false; });
  }

  // Filtrul paginii: căutare, sortare și preț maxim (din datele reale).
  window.applySubFilters = function () {
    var q = ((document.getElementById('filter-search') || {}).value || '').toLowerCase().trim();
    var sort = (document.getElementById('filter-sort') || {}).value || 'default';
    var slider = document.getElementById('filter-price');
    var max = slider && !slider.disabled ? Number(slider.value) : Infinity;
    var lista = STARE.produse.filter(function (p) {
      if (p.pret_de_la != null && p.pret_de_la > max) return false;
      if (q && String(p.titlu).toLowerCase().indexOf(q) === -1 && String(p.descriere || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var cheie = function (p) { return p.pret_de_la == null ? Infinity : p.pret_de_la; };
    if (sort === 'price-asc') lista.sort(function (a, b) { return cheie(a) - cheie(b); });
    else if (sort === 'price-desc') lista.sort(function (a, b) { return (b.pret_de_la || 0) - (a.pret_de_la || 0); });
    randeaza(lista);
  };

  function filtruPret(maxim) {
    var slider = document.getElementById('filter-price');
    var et = document.getElementById('filter-price-label');
    if (!slider) return;
    if (maxim == null) {
      slider.disabled = true;
      slider.closest('div').style.display = 'none';
      return;
    }
    slider.disabled = false;
    slider.min = '0';
    slider.max = String(maxim);
    slider.value = String(maxim);
    slider.oninput = function () { if (et) et.textContent = fmt(Number(slider.value)); window.applySubFilters(); };
    if (et) et.textContent = fmt(maxim);
  }

  window.loadCategory = function () {
    var params = new URLSearchParams(window.location.search);
    var slug = params.get('cat') || SLUG_IMPLICIT[TIP];
    var tara = (window.MYD_GEO_LAST && window.MYD_GEO_LAST.cc) || 'RO';
    var grid = document.getElementById('sub-grid');
    // O imagine din catalog care nu se încarcă → iconița categoriei.
    grid.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || img.tagName !== 'IMG' || !img.parentNode) return;
      var d = document.createElement('div');
      d.className = 'card-icoana';
      d.setAttribute('aria-hidden', 'true');
      d.innerHTML = icoana(STARE.categorie && STARE.categorie.icon_name);
      img.parentNode.replaceChild(d, img);
      icoane();
    }, true);
    grid.addEventListener('click', function (e) {
      var c = e.target.closest('.rich-card');
      if (!c) return;
      var p = STARE.produse[Number(c.getAttribute('data-idx'))];
      if (!p) return;
      var b = e.target.closest('[data-actiune="adauga"]');
      if (b) { e.stopPropagation(); adauga(p, b); } else deschide(p); // „Cere un deviz” → configurarea, cu fluxul de deviz
    });
    return fetch('/api/public/catalog-categorie?cat=' + encodeURIComponent(slug) + '&tip=' + TIP + '&tara=' + encodeURIComponent(tara))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok || !x.d || !x.d.ok) throw new Error('api');
        STARE.produse = x.d.produse || [];
        STARE.categorie = x.d.categorie;
        STARE.moneda = x.d.moneda || 'RON';
        antet(x.d.categorie, slug);
        filtruPret(x.d.pret_maxim);
        window.applySubFilters();
      })
      .catch(function () {
        STARE.produse = [];
        antet(null, slug);
        filtruPret(null);
        randeaza([]);
        var gol = document.getElementById('empty-state');
        if (gol) gol.querySelector('div:nth-child(2)').textContent = tr('Produsele nu s-au putut încărca. Reîncarcă pagina.');
      });
  };

  // „Livrare la”: orașul detectat (IP), fără o adresă implicită inventată.
  function adresaUtilizator() {
    var el = document.getElementById('user-address');
    if (!el) return;
    fetch('https://ipapi.co/json/').then(function (r) { return r.json(); }).then(function (d) {
      el.textContent = d && d.city ? d.city + (d.region ? ', ' + d.region : '') : '—';
    }).catch(function () { el.textContent = '—'; });
  }
  window.detectUserAddress = adresaUtilizator;

  var st = document.createElement('style');
  st.textContent = '.card-icoana{width:100%;height:100%;min-height:140px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#EBF4FB,#F4F7F9);color:#003366;font-size:44px}';
  document.head.appendChild(st);

  document.addEventListener('DOMContentLoaded', function () { window.loadCategory(); adresaUtilizator(); });
  window.addEventListener('myd:lang', function () { if (STARE.categorie) { antet(STARE.categorie, new URLSearchParams(location.search).get('cat') || SLUG_IMPLICIT[TIP]); window.applySubFilters(); } });
})();

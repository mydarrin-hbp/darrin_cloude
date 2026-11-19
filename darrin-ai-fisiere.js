/* ════════════════════════════════════════════════════════════════
   MY DARRIN — darrin-ai-fisiere.js (pasul 12-D2, 18 nov. 2026)
   Atașarea fișierelor la Darrin AI, comună pentru modalul din catalog și
   „Creează deviz”. Regula LM: cel mult 5 fișiere (poze sau PDF), de pe orice
   dispozitiv; nicio poză nu se refuză pentru mărime — se micșorează aici:
     - decodare cu orientarea corectă (createImageBitmap … imageOrientation
       'from-image', cu rezervă pe <img>);
     - latura mare ≤ 1568 px, JPEG calitate 0,82; țintă ≤ 500 KB: calitatea
       scade în trepte până la 0,6, apoi latura devine 1280 px;
     - re-encodarea scoate EXIF și GPS (serverul le mai șterge o dată);
     - HEIC / format pe care browserul nu-l poate citi → mesaj;
     - PDF: nu se micșorează, cel mult 2 MB;
     - total ≤ 3 MB după micșorare (base64 rămâne sub limita Vercel de 4,5 MB).
   Selecția: <input type="file" multiple accept="image/*,application/pdf">,
   fără `capture` — telefonul oferă singur Cameră / Galerie / Fișiere.
   Cât se pregătesc pozele: mesaj informativ MDFeedback și butonul de
   trimitere blocat. Mesajele trec doar prin MDFeedback (RO / EN prin window.t).

   Utilizare:
     const atasari = DarrinAIFisiere.creeaza({
       input, zona, previzualizare, mesaj, buton,   // elemente DOM
     });
     atasari.adauga(fileList);          // Promise
     atasari.fisiere();                 // [{ mime, data_base64, nume, octeti }]
     atasari.ocupat();                  // true cât se pregătesc
     atasari.goleste();
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.DarrinAIFisiere) return;

  var MAX_FISIERE = 5;
  var MAX_TOTAL = 3 * 1024 * 1024;
  var MAX_PDF = 2 * 1024 * 1024;
  var TINTA = 500 * 1024;
  var LATURI = [1568, 1280];
  var CALITATI = [0.82, 0.75, 0.68, 0.6];

  function tr(ro, param) {
    if (typeof window.t === 'function') return window.t(null, ro, param);
    return param ? String(ro).replace(/\{(\w+)\}/g, function (m, x) { return param[x] != null ? param[x] : m; }) : ro;
  }
  function mesaj(zona, tip, text) {
    if (window.MDFeedback && zona) window.MDFeedback.mesaj(zona, tip, text);
  }

  function blobInBase64(blob) {
    return new Promise(function (rezolva, respinge) {
      var r = new FileReader();
      r.onload = function () { rezolva(String(r.result).split(',').pop() || ''); };
      r.onerror = function () { respinge(r.error); };
      r.readAsDataURL(blob);
    });
  }

  // Sursa de desenat, cu orientarea din EXIF aplicată; null dacă nu se poate citi.
  async function decodeaza(file) {
    if (typeof window.createImageBitmap === 'function') {
      try {
        var bmp = await window.createImageBitmap(file, { imageOrientation: 'from-image' });
        return { sursa: bmp, latime: bmp.width, inaltime: bmp.height, inchide: function () { try { bmp.close(); } catch (e) {} } };
      } catch (e) { /* rezerva pe <img> */ }
    }
    var url = URL.createObjectURL(file);
    try {
      var img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      if (!img.naturalWidth) throw new Error('imagine goală');
      return { sursa: img, latime: img.naturalWidth, inaltime: img.naturalHeight, inchide: function () { URL.revokeObjectURL(url); } };
    } catch (e) {
      URL.revokeObjectURL(url);
      return null;
    }
  }

  function canvasLaJpeg(canvas, calitate) {
    return new Promise(function (rezolva) {
      if (canvas.toBlob) canvas.toBlob(function (b) { rezolva(b); }, 'image/jpeg', calitate);
      else rezolva(null);
    });
  }

  // Micșorează o imagine: latura ≤ 1568 px, JPEG 0,82 → … → 0,6, apoi 1280 px.
  async function micsoreaza(file) {
    var d = await decodeaza(file);
    if (!d) return null;
    try {
      var cel = null;
      for (var li = 0; li < LATURI.length; li++) {
        var scara = Math.min(1, LATURI[li] / Math.max(d.latime, d.inaltime));
        var w = Math.max(1, Math.round(d.latime * scara));
        var h = Math.max(1, Math.round(d.inaltime * scara));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; // fundal alb pentru PNG-urile transparente
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(d.sursa, 0, 0, w, h);
        for (var ci = 0; ci < CALITATI.length; ci++) {
          var b = await canvasLaJpeg(c, CALITATI[ci]);
          if (!b) return null;
          if (!cel || b.size < cel.blob.size) cel = { blob: b, latime: w, inaltime: h, calitate: CALITATI[ci] };
          if (b.size <= TINTA) return cel;
        }
      }
      return cel;
    } finally {
      d.inchide();
    }
  }

  function estePdf(file) {
    return file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name || ''));
  }
  function esteImagine(file) {
    return /^image\//.test(file.type || '') || (!file.type && /\.(heic|heif|jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || ''));
  }

  function creeaza(opt) {
    opt = opt || {};
    var lista = [];      // { id, nume, mime, blob, octeti, url, el }
    var inLucru = 0;
    var urmatorId = 1;
    var blocatInainte = null;

    function total() { return lista.reduce(function (n, f) { return n + f.octeti; }, 0); }

    function blocheaza(da) {
      var b = opt.buton;
      if (!b) return;
      if (da) {
        if (blocatInainte === null) blocatInainte = !!b.disabled;
        b.disabled = true;
        b.setAttribute('aria-busy', 'true');
        b.setAttribute('data-pregatire-fisiere', '1');
      } else {
        b.disabled = !!blocatInainte;
        blocatInainte = null;
        b.removeAttribute('aria-busy');
        b.removeAttribute('data-pregatire-fisiere');
      }
    }

    function miniatura(f) {
      var p = opt.previzualizare;
      if (!p) return;
      var item = document.createElement('div');
      item.className = 'dai-miniatura';
      item.setAttribute('data-dai-fisier', String(f.id));
      // Fără overflow:hidden pe cadru: zona de apăsare a lui „×” (44 × 44) iese puțin în afară.
      item.style.cssText = 'position:relative;width:64px;height:64px;flex-shrink:0';
      var cadru = document.createElement('div');
      cadru.style.cssText = 'width:64px;height:64px;border-radius:10px;overflow:hidden;border:1px solid #D5DFE8;background:#F4F7F9;display:flex;align-items:center;justify-content:center';
      if (f.mime === 'application/pdf') {
        cadru.innerHTML = '<span style="font-size:11px;font-weight:800;color:#6B7A8D">PDF</span>';
      } else {
        var img = document.createElement('img');
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover';
        img.src = f.url;
        cadru.appendChild(img);
      }
      item.appendChild(cadru);
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'dai-sterge-fisier';
      rm.setAttribute('aria-label', tr('Scoate fișierul'));
      rm.style.cssText = 'position:absolute;top:-12px;right:-12px;width:44px;height:44px;padding:0;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center';
      rm.innerHTML = '<span aria-hidden="true" style="width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;font-size:13px;line-height:20px;text-align:center;display:block">×</span>';
      rm.onclick = function (e) { e.preventDefault(); e.stopPropagation(); scoate(f.id); };
      item.appendChild(rm);
      f.el = item;
      p.appendChild(item);
      if (p.style) p.style.gap = '12px';
      actualizeazaZona();
    }

    function actualizeazaZona() {
      if (opt.laSchimbare) { try { opt.laSchimbare(lista.length); } catch (e) {} }
    }

    function scoate(id) {
      lista = lista.filter(function (f) {
        if (f.id !== id) return true;
        if (f.el && f.el.parentNode) f.el.parentNode.removeChild(f.el);
        if (f.url) URL.revokeObjectURL(f.url);
        return false;
      });
      actualizeazaZona();
    }

    async function pregateste(file) {
      if (estePdf(file)) {
        if (file.size > MAX_PDF) return { eroare: tr('PDF-ul „{nume}” are mai mult de 2 MB. Alege un PDF mai mic sau trimite o poză a paginii.', { nume: file.name || 'PDF' }) };
        return { mime: 'application/pdf', blob: file, octeti: file.size };
      }
      if (!esteImagine(file)) return { eroare: tr('Poți atașa doar poze sau PDF-uri.') };
      var m = await micsoreaza(file);
      if (!m) return { eroare: tr('Nu putem citi această poză. Fă poza direct din cameră sau alege una JPG / PNG.') };
      return { mime: 'image/jpeg', blob: m.blob, octeti: m.blob.size, latime: m.latime, inaltime: m.inaltime, calitate: m.calitate };
    }

    async function adauga(fisiere) {
      var noi = Array.prototype.slice.call(fisiere || []);
      if (!noi.length) return;
      var erori = [];
      var loc = MAX_FISIERE - lista.length - inLucru;
      if (noi.length > loc) {
        erori.push(tr('Poți atașa cel mult 5 fișiere.'));
        noi = noi.slice(0, Math.max(0, loc));
      }
      if (!noi.length) { mesaj(opt.mesaj, 'eroare', erori.join(' ')); return; }
      inLucru += noi.length;
      blocheaza(true);
      mesaj(opt.mesaj, 'info', tr('Se pregătesc pozele…'));
      for (var i = 0; i < noi.length; i++) {
        var r;
        try { r = await pregateste(noi[i]); } catch (e) { r = { eroare: tr('Nu putem citi această poză. Fă poza direct din cameră sau alege una JPG / PNG.') }; }
        inLucru--;
        if (r.eroare) { erori.push(r.eroare); continue; }
        if (total() + r.octeti > MAX_TOTAL) {
          erori.push(tr('Fișierele atașate au împreună mai mult de 3 MB. Scoate un fișier sau alege unul mai mic.'));
          continue;
        }
        var f = { id: urmatorId++, nume: noi[i].name || '', mime: r.mime, blob: r.blob, octeti: r.octeti, latime: r.latime || null, inaltime: r.inaltime || null, url: r.mime === 'application/pdf' ? null : URL.createObjectURL(r.blob) };
        lista.push(f);
        miniatura(f);
      }
      if (opt.input) { try { opt.input.value = ''; } catch (e) {} }
      if (inLucru === 0) blocheaza(false);
      if (erori.length) mesaj(opt.mesaj, 'eroare', erori.filter(function (x, k) { return erori.indexOf(x) === k; }).join(' '));
      else if (inLucru === 0) mesaj(opt.mesaj, 'info', '');
    }

    async function fisiereTrimise() {
      var out = [];
      for (var i = 0; i < lista.length; i++) {
        out.push({ mime: lista[i].mime, data_base64: await blobInBase64(lista[i].blob), nume: lista[i].nume, octeti: lista[i].octeti });
      }
      return out;
    }

    function goleste() {
      lista.slice().forEach(function (f) { scoate(f.id); });
    }

    // Legăturile cu pagina: input, drag & drop (desktop).
    if (opt.input) {
      opt.input.setAttribute('accept', 'image/*,application/pdf');
      opt.input.setAttribute('multiple', '');
      opt.input.removeAttribute('capture');
      opt.input.addEventListener('change', function () { adauga(opt.input.files); });
    }
    if (opt.zona) {
      opt.zona.addEventListener('dragover', function (e) { e.preventDefault(); });
      opt.zona.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files) adauga(e.dataTransfer.files);
      });
    }

    return {
      adauga: adauga,
      fisiere: fisiereTrimise,
      lista: function () { return lista.map(function (f) { return { id: f.id, nume: f.nume, mime: f.mime, octeti: f.octeti, latime: f.latime, inaltime: f.inaltime }; }); },
      numar: function () { return lista.length; },
      ocupat: function () { return inLucru > 0; },
      scoate: scoate,
      goleste: goleste,
    };
  }

  window.DarrinAIFisiere = { creeaza: creeaza, MAX_FISIERE: MAX_FISIERE, MAX_TOTAL: MAX_TOTAL, MAX_PDF: MAX_PDF, _micsoreaza: micsoreaza };
})();

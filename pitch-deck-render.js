/* ════════════════════════════════════════════════════════════════
   pitch-deck-render.js — renderul animat al pitch deck-ului (pasul 11-K,
   22 oct. 2026). Același render pentru:
     - pagina publică mydarrin-pitch-deck.html;
     - previzualizarea din back-office (mydarrin-superadmin.html).
   Conținutul vine de la server (api/public/pitch-deck.js sau acțiunea
   `previzualizare` din api/admin/pitch-deck.js); aici nu există niciun
   conținut de rezervă și nicio cifră scrisă în cod. Slide-ul `runda` și
   punctul `din_runda` al slide-ului `exit` folosesc runda primită (fără rundă
   publică → „Termenii rundei vor fi anunțați”).

   Animații: CSS (pitch-deck.css) + IntersectionObserver; pornesc când slide-ul
   devine activ și e pe ecran. prefers-reduced-motion → totul afișat direct.
   Formatarea numerelor: Intl.NumberFormat pe limba deck-ului
   (RO 3,5 mil. € · 12,5% · 1.000 €; EN €3.5M · 12.5% · €1,000).

   În Node (teste) se exportă doar formatarea și textele.
   ════════════════════════════════════════════════════════════════ */
(function (radacina, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(null);
  else radacina.MDPitchDeck = fabrica(radacina);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  // ── Texte (RO pentru deck-ul RO, EN pentru deck-ul EN) ───────────
  var TEXTE = {
    ro: {
      live: 'Vezi cifrele reale →', anunt: 'Termenii rundei vor fi anunțați', pre_money: 'Pre-money', tinta: 'Ținta rundei',
      post_money: 'Post-money', equity: 'Equity oferit', pret: 'Preț / acțiune', minim: 'Investiție minimă', tickete: 'Tickete',
      perioada: 'Perioada', stare: 'Stare', stari: { deschisa: 'Deschisă', planificata: 'Planificată', inchisa: 'Închisă' },
      venituri: 'Venituri', profit: 'Profit net', an: 'Anul', email: 'Email', qr: 'Scanează pentru pagina Investitori',
      qr_alt: 'Cod QR către pagina Investitori', logo: 'My Darrin — HomeBestPal', slide: 'Slide', din: 'din',
      rezumat_titlu: 'Restul pitch deck-ului', rezumat_text: 'Pitch deck-ul complet e disponibil investitorilor cu identitatea verificată. Intră în rundă pentru acces.',
      rezumat_btn: 'Intră în rundă', anterior: 'Slide-ul anterior', urmator: 'Slide-ul următor', deck: 'Pitch deck My Darrin',
    },
    en: {
      live: 'See the real figures →', anunt: 'The round terms will be announced', pre_money: 'Pre-money', tinta: 'Round target',
      post_money: 'Post-money', equity: 'Equity offered', pret: 'Price / share', minim: 'Minimum investment', tickete: 'Tickets',
      perioada: 'Period', stare: 'Status', stari: { deschisa: 'Open', planificata: 'Planned', inchisa: 'Closed' },
      venituri: 'Revenue', profit: 'Net profit', an: 'Year', email: 'Email', qr: 'Scan for the Investors page',
      qr_alt: 'QR code to the Investors page', logo: 'My Darrin — HomeBestPal', slide: 'Slide', din: 'of',
      rezumat_titlu: 'The rest of the pitch deck', rezumat_text: 'The full pitch deck is available to investors with a verified identity. Join the round for access.',
      rezumat_btn: 'Join the round', anterior: 'Previous slide', urmator: 'Next slide', deck: 'My Darrin pitch deck',
    },
  };

  // Textul alternativ al imaginilor v1 (assets/pitch-deck/v1/).
  var ALT = {
    '01-coperta-robot.webp': ['Un om și robotul Darrin își strâng mâna pe o terasă, deasupra orașului', 'A person and the Darrin robot shaking hands on a rooftop above the city'],
    '03-sistem-vechi.webp': ['Calculatoare vechi, cu monitoare cu tub, pe un birou', 'Old computers with tube monitors on a desk'],
    '04-clepsidra.webp': ['Clepsidră prin care se scurg monede de euro', 'An hourglass with euro coins running through it'],
    '06-ai-diagnoza.webp': ['Fotografii, video și mesaje vocale transformate de AI într-un deviz tehnic', 'Photos, video and voice messages turned by AI into a technical quote'],
    '07-ecosistem-laptop.webp': ['Platforma My Darrin pe un laptop și pe un telefon', 'The My Darrin platform on a laptop and a phone'],
    '10-harta-romania.webp': ['Harta României cu puncte de lucru conectate', 'Map of Romania with connected service points'],
    '11-harta-europa.webp': ['Harta Europei cu legături pornind din România', 'Map of Europe with links starting from Romania'],
    '20-echipa-robot.webp': ['Robotul Darrin în fața unei echipe, într-un birou cu ferestre mari', 'The Darrin robot in front of a team, in an office with large windows'],
  };
  var LOGO = '/assets/pitch-deck/v1/logo-mydarrin-homebestpal.webp';
  var NR_LIVE = [10, 12, 17, 18]; // slide-urile de prognoză care au un echivalent live
  var SIMBOL = { EUR: '€', GBP: '£', USD: '$' };

  // ── Formatare (Intl.NumberFormat) ────────────────────────────────
  // „ro-RO-u-nu-latn” în loc de „ro-RO”: i18n-loader.js înlocuiește „ro-RO”
  // cu limba paginii; deck-ul își urmează propria limbă.
  function loc(l) { return l === 'ro' ? 'ro-RO-u-nu-latn' : 'en-GB'; }
  function formatNumar(v, l, zecimale) {
    var z = zecimale == null ? 2 : zecimale;
    try { return new Intl.NumberFormat(loc(l), { maximumFractionDigits: z, useGrouping: 'always' }).format(v); }
    catch (e) { return new Intl.NumberFormat(loc(l), { maximumFractionDigits: z }).format(v); }
  }
  function formatCompact(v, l) {
    var parti = new Intl.NumberFormat(loc(l), { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1 }).formatToParts(v);
    // EN: €3.5M, €500bn (motoarele dau „m” / „B” după versiunea ICU).
    var EN = { m: 'M', M: 'M', B: 'bn', bn: 'bn', k: 'K', K: 'K' };
    return parti.map(function (p) { return p.type === 'compact' && l !== 'ro' && EN[p.value] ? EN[p.value] : p.value; }).join('');
  }
  function formatBani(v, moneda, l, optiuni) {
    if (v == null || !isFinite(v)) return '—';
    var o = optiuni || {};
    var compact = o.compact != null ? o.compact : Math.abs(v) >= 1e6;
    var neg = v < 0;
    var n = compact ? formatCompact(Math.abs(v), l) : formatNumar(Math.abs(v), l, Math.abs(v) % 1 ? 2 : 0);
    var s = SIMBOL[moneda];
    var semn = neg ? '-' : '';
    if (l === 'ro') return semn + n + ' ' + (s || moneda || '');
    return s ? semn + s + n : semn + (moneda ? moneda + ' ' : '') + n;
  }
  function formatProcent(v, l) { return v == null || !isFinite(v) ? '—' : formatNumar(v, l, 2) + '%'; }
  function formatData(iso, l) {
    if (!iso) return '';
    var d = new Date(String(iso).length === 10 ? iso + 'T12:00:00Z' : iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat(loc(l), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' }).format(d);
  }
  function formatCifra(c, l) { return (c.prefix || '') + formatNumar(c.valoare, l) + (c.sufix || ''); }

  var exporturi = { TEXTE: TEXTE, ALT: ALT, NR_LIVE: NR_LIVE, formatNumar: formatNumar, formatCompact: formatCompact, formatBani: formatBani, formatProcent: formatProcent, formatData: formatData, formatCifra: formatCifra };
  if (!win) return exporturi;

  var doc = win.document;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function srcImagine(v) { return /^https:\/\//.test(v) ? v : '/assets/pitch-deck/v1/' + v; }
  function altImagine(v, l, s) { var a = ALT[v]; return a ? a[l === 'ro' ? 0 : 1] : (s && s.titlu) || ''; }
  function img(v, l, s, cls) {
    return '<img class="' + (cls || '') + '" src="' + esc(srcImagine(v)) + '" alt="' + esc(altImagine(v, l, s)) + '" loading="lazy" decoding="async">';
  }
  // Atributele unui element animat: clasa și indicele (decalajul de ~80 ms).
  function a(i) { return ' class="mdpd-a" style="--i:' + i + '"'; }
  function aCls(i, cls, stil) { return ' class="mdpd-a ' + cls + '" style="--i:' + i + (stil ? ';' + stil : '') + '"'; }
  // Cifră care crește de la 0 la valoare: data-tinta + formatul ei.
  function numar(valoare, fmt, extra, cls) {
    var e = extra || {};
    return '<span class="' + (cls || 'mdpd-num') + '" data-tinta="' + valoare + '" data-fmt="' + fmt + '"' +
      (e.moneda ? ' data-moneda="' + esc(e.moneda) + '"' : '') + (e.prefix ? ' data-prefix="' + esc(e.prefix) + '"' : '') +
      (e.sufix ? ' data-sufix="' + esc(e.sufix) + '"' : '') + '>' + esc(e.text) + '</span>';
  }
  function cifraAnimata(c, l, cls) { return numar(c.valoare, 'numar', { prefix: c.prefix, sufix: c.sufix, text: formatCifra(c, l) }, cls); }
  function baniAnimati(v, moneda, l, cls) { return numar(v, 'bani', { moneda: moneda, text: formatBani(v, moneda, l) }, cls); }
  function initiale(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(''); }

  // ── Slide-urile, pe tipuri ──────────────────────────────────────
  var TIP = {
    coperta: function (s, l) {
      return '<div class="mdpd-fundal">' + img(s.imagine, l, s, 'mdpd-kb') + '</div><div class="mdpd-col">' +
        (s.eyebrow ? '<div' + aCls(0, 'mdpd-eyebrow') + '>' + esc(s.eyebrow) + '</div>' : '') +
        '<h1' + a(1) + '>' + esc(s.titlu) + '</h1>' + (s.subtitlu ? '<p' + aCls(2, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        (s.accent ? '<p' + aCls(3, 'mdpd-acc mdpd-txt') + '>' + esc(s.accent) + '</p>' : '') + '</div>';
    },
    flux: function (s) {
      var i = 2;
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2>' + (s.subtitlu ? '<p' + aCls(1, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        '<div class="mdpd-col" style="flex:1;justify-content:center;margin-top:calc(1.4*var(--u))">' +
        '<div class="mdpd-blocuri">' + (s.blocuri || []).map(function (b) { return '<div' + aCls(i++, 'mdpd-card') + '><h3>' + esc(b.eticheta) + '</h3><p class="mdpd-txt">' + esc(b.text) + '</p></div>'; }).join('') + '</div>' +
        fluxPasi((s.pasi || []).map(function (p) { return { eticheta: p }; }), i) +
        (s.valori && s.valori.length ? '<div class="mdpd-chips">' + s.valori.map(function (v, k) { return '<span' + aCls(i + 2 * s.pasi.length + k, 'mdpd-chip') + '>' + esc(v) + '</span>'; }).join('') + '</div>' : '') + '</div>';
    },
    lista_imagine: function (s, l) {
      return '<div class="mdpd-2col"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2>' +
        (s.subtitlu ? '<p' + aCls(1, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        '<ul class="mdpd-lista">' + (s.puncte || []).map(function (p, k) { return '<li' + a(2 + k) + '>' + esc(p) + '</li>'; }).join('') + '</ul>' +
        (s.nota ? '<p' + aCls(2 + s.puncte.length, 'mdpd-mic') + '>' + esc(s.nota) + '</p>' : '') + '</div>' +
        '<div' + aCls(1, 'mdpd-img') + '>' + img(s.imagine, l, s, 'mdpd-kb') + '</div></div>';
    },
    cifre_imagine: function (s, l) {
      return '<div class="mdpd-2col"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2>' +
        (s.cifre || []).map(function (c, k) { return '<div' + a(1 + k) + '>' + cifraAnimata(c, l) + '<div class="mdpd-num-et">' + esc(c.text) + '</div></div>'; }).join('') +
        '</div><div' + aCls(1, 'mdpd-img') + '>' + img(s.imagine, l, s, 'mdpd-kb') + '</div></div>';
    },
    ciclu: function (s) {
      var n = (s.noduri || []).length || 1;
      var noduri = (s.noduri || []).map(function (x, k) {
        var ung = -Math.PI / 2 + (2 * Math.PI * k) / n;
        return '<span class="mdpd-nod-loc" style="left:' + (50 + 46 * Math.cos(ung)).toFixed(2) + '%;top:' + (50 + 46 * Math.sin(ung)).toFixed(2) + '%"><span' + aCls(3 + k, 'mdpd-nod') + '>' + esc(x) + '</span></span>';
      }).join('');
      return '<div class="mdpd-2col"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2>' +
        (s.subtitlu ? '<p' + aCls(1, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        (s.bloc_titlu || s.bloc_text ? '<div' + aCls(2, 'mdpd-card') + '><h3 class="mdpd-acc" style="font-size:var(--fs);margin-bottom:.4em">' + esc(s.bloc_titlu) + '</h3><p class="mdpd-txt">' + esc(s.bloc_text) + '</p></div>' : '') +
        '</div><div class="mdpd-ciclu" aria-hidden="false"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="mdpd-inel" cx="50" cy="50" r="46" pathLength="1"/></svg>' +
        '<div' + aCls(1, 'mdpd-centru') + '>' + esc(s.centru) + (s.eticheta ? '<small>' + esc(s.eticheta) + '</small>' : '') + '</div>' + noduri + '</div></div>';
    },
    cifra_mare_imagine: function (s, l) {
      return '<div class="mdpd-2col"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2>' +
        (s.subtitlu ? '<p' + aCls(1, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        '<div' + a(2) + '>' + cifraAnimata(s.cifra, l, 'mdpd-num-xl') + '</div><p' + aCls(3, 'mdpd-txt') + '>' + esc(s.text) + '</p></div>' +
        '<div' + aCls(1, 'mdpd-img') + '>' + img(s.imagine, l, s, 'mdpd-kb') + '</div></div>';
    },
    verticale: function (s) {
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2>' + (s.subtitlu ? '<p' + aCls(1, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        '<div class="mdpd-col" style="flex:1;justify-content:center"><div class="mdpd-vert">' +
        (s.verticale || []).map(function (v, k) { return '<div' + aCls(2 + k, k === s.activa ? 'mdpd-evid' : '') + '>' + esc(v) + '</div>'; }).join('') + '</div>' +
        (s.accent ? '<p' + aCls(8, 'mdpd-acc mdpd-txt') + '>' + esc(s.accent) + '</p>' : '') + (s.text ? '<p' + aCls(9, 'mdpd-txt') + '>' + esc(s.text) + '</p>' : '') + '</div>';
    },
    piata: function (s, l) {
      var culori = ['#0BA39A', '#3FC1B8', '#F08120'];
      var niv = s.nivele || [];
      var cercuri = niv.map(function (n, k) {
        var d = 100 - k * (62 / Math.max(1, niv.length - 1 || 1));
        return '<div' + aCls(1 + k, 'mdpd-cerc', 'width:' + d.toFixed(1) + '%;height:' + d.toFixed(1) + '%;left:' + ((100 - d) / 2).toFixed(1) + '%;border-color:' + culori[k % 3] + ';background:' + culori[k % 3] + '1f') + '><span>' + esc(n.eticheta.split(' ')[0]) + '</span></div>';
      }).join('');
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2><div class="mdpd-2col"><div class="mdpd-cercuri">' + cercuri + '</div>' +
        '<div class="mdpd-col">' + niv.map(function (n, k) {
          return '<div' + a(4 + k) + '><div class="mdpd-eyebrow" style="margin:0;color:' + culori[k % 3] + '">' + esc(n.eticheta) + '</div>' + baniAnimati(n.valoare, n.moneda, l) + (n.extra ? ' <span class="mdpd-chip">' + esc(n.extra) + '</span>' : '') + '</div>';
        }).join('') + '</div></div>';
    },
    cifre_banda: function (s, l) {
      var cifre = '<div class="mdpd-cifre4">' + (s.cifre || []).map(function (c, k) { return '<div' + a(1 + k) + '>' + cifraAnimata(c, l) + '<div class="mdpd-num-et">' + esc(c.text) + '</div></div>'; }).join('') + '</div>';
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2><div class="mdpd-banda">' + (s.imagine ? img(s.imagine, l, s, 'mdpd-kb') : '') + cifre + '</div>';
    },
    faze_imagine: function (s, l) {
      return '<div class="mdpd-2col"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2><div class="mdpd-linie mdpd-linie-v">' +
        (s.faze || []).map(function (f, k) { return '<div' + a(1 + k) + '><div class="mdpd-eyebrow">' + esc(f.eticheta) + '</div><h3>' + esc(f.text) + '</h3></div>'; }).join('') +
        '</div></div><div' + aCls(1, 'mdpd-img') + '>' + img(s.imagine, l, s, 'mdpd-kb') + '</div></div>';
    },
    model_afaceri: function (s) {
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2>' + (s.subtitlu_accent ? '<p' + aCls(1, 'mdpd-acc mdpd-txt') + '>' + esc(s.subtitlu_accent) + '</p>' : '') +
        (s.subtitlu ? '<p' + aCls(2, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        '<div class="mdpd-col" style="flex:1;justify-content:center;margin-top:calc(1.2*var(--u))">' + fluxPasi(s.flux || [], 3) +
        (s.venituri && s.venituri.length ? '<div' + a(12) + '><div class="mdpd-eyebrow">' + esc(s.venituri_titlu) + '</div><div class="mdpd-chips">' + s.venituri.map(function (v) { return '<span class="mdpd-chip">' + esc(v) + '</span>'; }).join('') + '</div></div>' : '') + '</div>';
    },
    cronologie: function (s) {
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2><div class="mdpd-col" style="flex:1;justify-content:center"><div class="mdpd-linie">' +
        (s.etape || []).map(function (e, k) { return '<div' + a(1 + k) + '><div class="mdpd-eyebrow">' + esc(e.perioada) + '</div><h3>' + esc(e.titlu) + '</h3><p class="mdpd-mic">' + esc(e.text) + '</p></div>'; }).join('') + '</div></div>';
    },
    comparatie: function (s) {
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2><div class="mdpd-col" style="flex:1;justify-content:center"><table class="mdpd-tabel"><thead><tr' + a(1) + '><th></th>' +
        (s.coloane || []).map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (s.randuri || []).map(function (r, k) {
          return '<tr' + aCls(2 + k, r.evidentiat ? 'mdpd-evid' : '') + '><td>' + esc(r.nume) + '</td>' + (r.valori || []).map(function (v, j) {
            return '<td>' + (v ? '<span class="mdpd-da" role="img" aria-label="' + esc(s.coloane[j]) + ': ✓">✓</span>' : '<span class="mdpd-nu" role="img" aria-label="' + esc(s.coloane[j]) + ': ✗">✗</span>') + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    },
    palnie: function (s) {
      var n = (s.nivele || []).length;
      return '<div class="mdpd-2col"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2>' +
        (s.accent ? '<p' + aCls(1, 'mdpd-acc mdpd-txt') + '>' + esc(s.accent) + '</p>' : '') + (s.text ? '<p' + aCls(2, 'mdpd-txt') + '>' + esc(s.text) + '</p>' : '') +
        '</div><div class="mdpd-palnie">' + (s.nivele || []).map(function (v, k) { return '<div style="--i:' + k + ';width:' + (100 - k * (44 / Math.max(1, n - 1))) + '%">' + esc(v) + '</div>'; }).join('') + '</div></div>';
    },
    echipa: function (s) {
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2><div class="mdpd-col" style="flex:1;justify-content:center"><div class="mdpd-echipa">' +
        (s.membri || []).map(function (m, k) {
          return '<div' + aCls(1 + k, 'mdpd-card mdpd-membru' + (m.evidentiat ? ' mdpd-evid' : '')) + '><div class="mdpd-avatar">' +
            (m.foto ? '<img src="' + esc(srcImagine(m.foto)) + '" alt="' + esc(m.nume) + '" loading="lazy">' : '<span aria-hidden="true">' + esc(initiale(m.nume)) + '</span>') +
            '</div><h3>' + esc(m.nume) + '</h3><p class="mdpd-mic">' + esc(m.rol) + '</p></div>';
        }).join('') + '</div></div>';
    },
    grafice: function (s, l, ctx) {
      var ani = s.ani || [], v = s.venituri || [], p = s.profit_net || [];
      var W = 600, H = 300, sus = 30, jos = 40, st = 10;
      var max = Math.max.apply(null, v.concat(p).concat([0])), min = Math.min.apply(null, p.concat([0]));
      var y = function (x) { return sus + ((max - x) / ((max - min) || 1)) * (H - sus - jos); };
      var pas = (W - st * 2) / Math.max(1, ani.length), lat = pas * 0.5;
      var bare = v.map(function (x, k) {
        var cx = st + pas * k + pas / 2, y0 = y(0), y1 = y(x);
        return '<rect class="mdpd-bara' + (k === v.length - 1 ? ' mdpd-ultima' : '') + '" style="--i:' + k + '" x="' + (cx - lat / 2).toFixed(1) + '" y="' + Math.min(y0, y1).toFixed(1) + '" width="' + lat.toFixed(1) + '" height="' + Math.abs(y0 - y1).toFixed(1) + '" rx="4"><title>' + esc(TEXTE[l].an + ' ' + ani[k] + ': ' + formatBani(x, s.moneda, l)) + '</title></rect>' +
          '<text x="' + cx.toFixed(1) + '" y="' + (Math.min(y0, y1) - 8).toFixed(1) + '" text-anchor="middle">' + esc(formatBani(x, s.moneda, l, { compact: Math.abs(x) >= 1e6 })) + '</text>' +
          '<text x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(TEXTE[l].an + ' ' + ani[k]) + '</text>';
      }).join('');
      var puncte = p.map(function (x, k) { return (st + pas * k + pas / 2).toFixed(1) + ',' + y(x).toFixed(1); });
      var linie = puncte.length ? '<polyline class="mdpd-traseu" pathLength="1" points="' + puncte.join(' ') + '"/>' + p.map(function (x, k) {
        var xy = puncte[k].split(',');
        return '<circle class="mdpd-punct" cx="' + xy[0] + '" cy="' + xy[1] + '" r="5"><title>' + esc(TEXTE[l].profit + ' · ' + TEXTE[l].an + ' ' + ani[k] + ': ' + formatBani(x, s.moneda, l)) + '</title></circle>';
      }).join('') : '';
      return '<div class="mdpd-2col mdpd-c-grafic"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2>' +
        (s.subtitlu ? '<p' + aCls(1, 'mdpd-sub') + '>' + esc(s.subtitlu) + '</p>' : '') +
        '<div' + a(2) + '>' + baniAnimati(s.cifra.valoare, s.moneda, l, 'mdpd-num-xl') + '<div class="mdpd-num-et">' + esc(s.cifra.text) + '</div></div></div>' +
        '<div class="mdpd-col"><div class="mdpd-grafic"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(s.titlu) + '">' +
        '<line class="mdpd-ax" x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>' + bare + linie + '</svg></div>' +
        '<div class="mdpd-legenda"><span style="--c:#0BA39A">' + esc(TEXTE[l].venituri) + '</span><span style="--c:#22C55E">' + esc(TEXTE[l].profit) + '</span></div></div></div>';
    },
    runda: function (s, l, ctx) {
      var r = ctx.runda;
      var T = TEXTE[l];
      var titlu = String(s.titlu || '').replace(/\s*\{denumire\}/, r ? ' ' + (l === 'ro' ? r.denumire_ro : r.denumire_en) : '');
      var cifre = r ? '<div class="mdpd-rgrid">' + [
        [T.pre_money, baniAnimati(r.evaluare_pre_money, r.moneda, l)], [T.tinta, baniAnimati(r.suma_tinta, r.moneda, l)],
        [T.post_money, baniAnimati(r.post_money, r.moneda, l)], [T.equity, numar(r.equity_oferit_pct, 'procent', { text: formatProcent(r.equity_oferit_pct, l) })],
        [T.pret, baniAnimati(r.pret_actiune, r.moneda, l)], [T.minim, r.investitie_minima != null ? baniAnimati(r.investitie_minima, r.moneda, l) : '<span class="mdpd-num">—</span>'],
        [T.tickete, '<span class="mdpd-num">' + esc(r.tickete ? r.tickete.map(function (t) { return formatBani(t, r.moneda, l); }).join(' · ') : '—') + '</span>'],
        [T.stare, '<span class="mdpd-num">' + esc(T.stari[r.stare] || r.stare) + '</span>'],
      ].map(function (x, k) { return '<div' + aCls(2 + k, 'mdpd-card') + '><div class="mdpd-num-et" style="margin:0 0 .4em">' + esc(x[0]) + '</div>' + x[1] + '</div>'; }).join('') + '</div>' +
        (r.data_start || r.data_sfarsit ? '<p' + aCls(10, 'mdpd-mic') + '>' + esc(T.perioada) + ': ' + esc([formatData(r.data_start, l), formatData(r.data_sfarsit, l)].filter(Boolean).join(' – ')) + '</p>' : '')
        : '<div' + aCls(2, 'mdpd-anunt') + ' data-runda-anunt>' + esc(T.anunt) + '</div>';
      return '<h2' + a(0) + '>' + esc(titlu) + '</h2>' + (s.accent ? '<p' + aCls(1, 'mdpd-acc mdpd-txt') + '>' + esc(s.accent) + '</p>' : '') +
        '<div class="mdpd-2col mdpd-c-runda"><div class="mdpd-col">' + cifre + '</div>' +
        '<div' + aCls(11, 'mdpd-card') + '><div class="mdpd-eyebrow">' + esc(s.fonduri_titlu) + '</div><ul class="mdpd-lista">' + (s.fonduri || []).map(function (f) { return '<li class="mdpd-mic" style="color:#fff">' + esc(f) + '</li>'; }).join('') + '</ul></div></div>';
    },
    exit: function (s, l, ctx) {
      var r = ctx.runda;
      return '<h2' + a(0) + '>' + esc(s.titlu) + '</h2><div class="mdpd-2col mdpd-c-exit">' +
        '<div class="mdpd-col"><div' + a(1) + '><span class="mdpd-num-xl mdpd-exit-cifra">' + esc(s.cifra) + '</span></div>' + (s.text ? '<p' + aCls(2, 'mdpd-txt') + '>' + esc(s.text) + '</p>' : '') + '</div>' +
        '<div class="mdpd-col"><div class="mdpd-linie">' + (s.puncte || []).map(function (p, k) {
          var v = p.din_runda === 'post_money' ? (r ? formatBani(r.post_money, r.moneda, l) : '—') : p.valoare;
          return '<div' + a(3 + k) + '><div class="mdpd-eyebrow">' + esc(p.eticheta) + '</div><div class="mdpd-num mdpd-num-s"' + (p.din_runda ? ' data-din-runda="' + esc(p.din_runda) + '"' : '') + '>' + esc(v) + '</div></div>';
        }).join('') + '</div><p class="mdpd-avert" role="note">' + esc(s.avertisment) + '</p></div></div>';
    },
    contact: function (s, l, ctx) {
      var T = TEXTE[l];
      var email = ctx.contact && ctx.contact.investitori_email;
      var host = String(s.url_site || '').replace(/^https:\/\//, '').replace(/\/$/, '');
      return '<div class="mdpd-2col"><div class="mdpd-col"><h2' + a(0) + '>' + esc(s.titlu) + '</h2>' +
        (s.citat ? '<p' + aCls(1, 'mdpd-citat') + '>' + esc(s.citat) + '</p>' : '') + (s.semnatura ? '<p' + aCls(2, 'mdpd-mic') + '>' + esc(s.semnatura) + '</p>' : '') +
        '<div' + aCls(3, 'mdpd-contact-rand') + '>' +
        (ctx.qr_svg ? '<div class="mdpd-qr" role="img" aria-label="' + esc(T.qr_alt) + '" data-qr>' + ctx.qr_svg + '</div>' : '') +
        '<div class="mdpd-col" style="gap:calc(.5*var(--u))">' + (ctx.qr_svg ? '<span class="mdpd-mic">' + esc(T.qr) + '</span>' : '') +
        (email ? '<a class="mdpd-acc mdpd-txt" href="mailto:' + esc(email) + '" data-email>' + esc(email) + '</a>' : '') +
        '<a class="mdpd-txt" style="color:#fff" href="' + esc(s.url_site) + '">' + esc(host) + '</a></div></div>' +
        '<div' + a(4) + '><a class="mdpd-btn" href="' + esc(s.url_site) + '">' + esc(s.buton) + '</a></div></div>' +
        (s.imagine ? '<div' + aCls(1, 'mdpd-img') + '>' + img(s.imagine, l, s, 'mdpd-kb') + '</div>' : '') + '</div>';
    },
  };

  // Pași legați (flux, model de afaceri): pas, linie, pas…
  function fluxPasi(pasi, i0) {
    return '<div class="mdpd-flux">' + pasi.map(function (p, k) {
      var pas = '<div' + aCls(i0 + 2 * k, 'mdpd-pas' + (k === pasi.length - 1 ? ' mdpd-evid' : '')) + '>' + esc(p.eticheta) +
        (p.valoare ? '<span class="mdpd-num">' + esc(p.valoare) + '</span>' : '') + '</div>';
      return (k ? '<div class="mdpd-leg" style="--i:' + (i0 + 2 * k - 1) + '" aria-hidden="true"></div>' : '') + pas;
    }).join('') + '</div>';
  }

  function slideHtml(s, idx, total, ctx) {
    var l = ctx.limba, T = TEXTE[l];
    var corp = TIP[s.tip] ? TIP[s.tip](s, l, ctx) : '';
    var prog = s.prognoza === true && ctx.disclaimer ? '<span class="mdpd-prognoza" role="note" data-prognoza>' + esc(ctx.disclaimer) + '</span>' : '';
    var live = ctx.onLive && NR_LIVE.indexOf(s.nr) !== -1 ? '<button type="button" class="mdpd-live-link" data-live="' + s.nr + '">' + esc(T.live) + '</button>' : '';
    return '<section class="mdpd-slide mdpd-t-' + esc(s.tip) + '" id="' + ctx.prefix + 'slide-' + (idx + 1) + '" data-nr="' + (idx + 1) + '" data-tip="' + esc(s.tip) + '" data-animatie="' + esc(s.animatie || 'elemente') + '" role="group" aria-roledescription="slide" aria-label="' + esc(T.slide + ' ' + (idx + 1) + ' ' + T.din + ' ' + total + ': ' + (s.titlu || '').replace(/\{denumire\}/, '')) + '">' +
      corp + '<div class="mdpd-jos"><span class="mdpd-logo"><img src="' + LOGO + '" alt="' + esc(T.logo) + '" loading="lazy"></span>' +
      (prog || live ? '<div class="mdpd-dreapta">' + prog + live + '</div>' : '') + '</div></section>';
  }

  function rezumatHtml(idx, total, ctx) {
    var T = TEXTE[ctx.limba];
    return '<section class="mdpd-slide mdpd-t-rezumat" id="' + ctx.prefix + 'slide-' + (idx + 1) + '" data-nr="' + (idx + 1) + '" data-animatie="elemente" data-rezumat role="group" aria-roledescription="slide" aria-label="' + esc(T.rezumat_titlu) + '">' +
      '<div class="mdpd-col" style="margin:auto"><h2' + a(0) + '>' + esc(T.rezumat_titlu) + '</h2><p' + aCls(1, 'mdpd-sub') + '>' + esc(T.rezumat_text) + '</p>' +
      '<div' + a(2) + '><a class="mdpd-btn" href="' + esc(ctx.urlRunda) + '" data-intra-runda>' + esc(T.rezumat_btn) + '</a></div></div>' +
      '<div class="mdpd-jos"><span class="mdpd-logo"><img src="' + LOGO + '" alt="' + esc(T.logo) + '" loading="lazy"></span></div></section>';
  }

  var miscareRedusa = function () { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  // Cifrele cresc de la 0 la valoare; la final, textul exact.
  function animaCifre(slide, l) {
    var el = slide.querySelectorAll('[data-tinta]');
    Array.prototype.forEach.call(el, function (e) {
      var tinta = Number(e.getAttribute('data-tinta'));
      var fmt = e.getAttribute('data-fmt');
      var final = e.textContent;
      if (e.__mdpdFinal == null) e.__mdpdFinal = final;
      final = e.__mdpdFinal;
      if (miscareRedusa() || !isFinite(tinta)) { e.textContent = final; return; }
      var t0 = null, dur = 1100;
      var pref = e.getAttribute('data-prefix') || '', suf = e.getAttribute('data-sufix') || '', mon = e.getAttribute('data-moneda');
      var intreg = Math.floor(tinta) === tinta;
      function cadru(t) {
        if (!slide.classList.contains('mdpd-on')) { e.textContent = final; return; }
        if (t0 == null) t0 = t;
        var p = Math.min(1, (t - t0) / dur), u = 1 - Math.pow(1 - p, 3), v = tinta * u;
        if (p >= 1) { e.textContent = final; return; }
        var x = intreg ? Math.round(v) : Math.round(v * 100) / 100;
        e.textContent = fmt === 'bani' ? formatBani(x, mon, l) : fmt === 'procent' ? formatProcent(x, l) : pref + formatNumar(x, l) + suf;
        win.requestAnimationFrame(cadru);
      }
      e.textContent = fmt === 'bani' ? formatBani(0, mon, l) : fmt === 'procent' ? formatProcent(0, l) : pref + formatNumar(0, l) + suf;
      win.requestAnimationFrame(cadru);
    });
  }

  /**
   * Desenează deck-ul în `container`.
   * o: { payload (de la server), limba ('ro'|'en'), hash (true pe pagina publică),
   *      onLive(nr), onSchimbare(i, total), urlRunda, prefix (id-uri unice) }
   */
  function creeaza(container, o) {
    var p = o.payload || {};
    var deck = p.deck || {};
    var slideuri = Array.isArray(deck.slide_uri) ? deck.slide_uri : [];
    var ctx = { limba: o.limba === 'ro' ? 'ro' : 'en', runda: p.runda || null, contact: p.contact || null, qr_svg: p.qr_svg || null, disclaimer: deck.disclaimer || '', onLive: o.onLive || null, prefix: o.prefix || '', urlRunda: o.urlRunda || '/mydarrin-investitori#runda' };
    var rezumat = p.stare === 'rezumat';
    var total = slideuri.length + (rezumat ? 1 : 0);
    var T = TEXTE[ctx.limba];
    container.innerHTML = '<div class="mdpd" lang="' + ctx.limba + '"><div class="mdpd-stage" tabindex="0" role="region" aria-roledescription="carousel" aria-label="' + esc(deck.titlu || T.deck) + '">' +
      slideuri.map(function (s, i) { return slideHtml(s, i, total, ctx); }).join('') + (rezumat ? rezumatHtml(slideuri.length, total, ctx) : '') + '</div></div>';
    var stage = container.querySelector('.mdpd-stage');
    var slides = Array.prototype.slice.call(container.querySelectorAll('.mdpd-slide'));
    var idx = -1, vizibil = true;

    function porneste(s) {
      if (!s || s.classList.contains('mdpd-on')) return;
      void s.offsetWidth; // pornește tranzițiile de la starea inițială
      s.classList.add('mdpd-on');
      animaCifre(s, ctx.limba);
    }
    function mergiLa(i, optiuni) {
      i = Math.max(0, Math.min(total - 1, i | 0));
      if (i === idx) return;
      slides.forEach(function (s, k) { s.classList.toggle('mdpd-activ', k === i); if (k !== i) s.classList.remove('mdpd-on'); s.setAttribute('aria-hidden', k === i ? 'false' : 'true'); });
      idx = i;
      if (vizibil || miscareRedusa()) porneste(slides[i]);
      if (o.hash && !(optiuni && optiuni.faraHash) && win.history && win.history.replaceState) win.history.replaceState(null, '', '#slide-' + (i + 1));
      if (o.onSchimbare) o.onSchimbare(i, total);
    }
    // Animația pornește doar când deck-ul e pe ecran.
    var io = null;
    if (win.IntersectionObserver) {
      io = new win.IntersectionObserver(function (intrari) {
        vizibil = intrari.some(function (x) { return x.isIntersecting; });
        if (vizibil) porneste(slides[idx]);
      }, { threshold: 0.2 });
      io.observe(stage);
    }
    // Swipe pe telefon
    var x0 = null, y0 = null;
    stage.addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) mergiLa(idx + (dx < 0 ? 1 : -1));
    }, { passive: true });
    container.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-live]');
      if (b && ctx.onLive) ctx.onLive(Number(b.getAttribute('data-live')));
    });

    var start = 0;
    if (o.hash) { var m = String(win.location.hash || '').match(/^#slide-(\d+)$/); if (m) start = Number(m[1]) - 1; }
    mergiLa(start, { faraHash: true });

    return {
      get index() { return idx; },
      total: total,
      mergiLa: mergiLa,
      urmator: function () { mergiLa(idx + 1); },
      anterior: function () { mergiLa(idx - 1); },
      element: stage,
      distruge: function () { if (io) io.disconnect(); container.innerHTML = ''; },
    };
  }

  exporturi.creeaza = creeaza;
  return exporturi;
});

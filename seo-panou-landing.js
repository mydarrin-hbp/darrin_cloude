// seo-panou-landing.js
// Tabul „Pagini de destinație” din mydarrin-superadmin.html → SEO (pasul 12-L1,
// 19 nov. 2026; macheta L1.5, aprobată de LM). Pagina internă rămâne în română.
//
// Pentru cele 7 pagini de destinație (lib/landing-pagini.js): variantele
// („Implicită” + câte una pe utm_campaign), RO / EN, câmpurile primului ecran
// cu limitele lor, imaginea principală (convertită aici în WebP, latura mare
// ≤ 1600 px, ≤ 300 KB, fără metadate, plus variantele 800 / 480 px pentru
// srcset; încărcată direct în Storage pe adresa semnată, ca în
// seo-panou-media.js), „Salvează ciorna” / „Publică” (doar cu RO și EN
// complete), istoricul cu revenire, previzualizarea telefon / desktop și
// linkul pentru reclamă, gata de copiat.
// Serverul: api/admin/seo-landing.js (drepturile SEO, validarea, auditul).
// Rezultatul fiecărei acțiuni: MDFeedback (ui-feedback.js), fără alert / confirm.

(function () {
  'use strict';
  var L = window.MYD_LANDING_PAGINI;
  var P = window.SeoPanou;
  if (!L || !P) return;
  var esc = P.esc;

  var S = { pagini: [], cale: '/parteneri/servicii', varianta: L.IMPLICITA, limba: 'ro', d: null, texte: null, profesie: '', poateScrie: false, previz: 'telefon', istoric: false, profesii: null, incarcat: false };
  var ETICHETE_STARE = {
    din_fisier: ['Din fișier', 'nu'], ciorna: ['Ciornă nepublicată', 'ciorna'], publicata: ['Publicată', 'da'], modificata: ['Modificată, nepublicată', 'ciorna'],
  };

  function $(sel, r) { return (r || document).querySelector(sel); }
  function radacina() { return document.getElementById('seo-landing'); }
  function paginaCurenta() { return S.pagini.find(function (p) { return p.cale === S.cale; }) || null; }
  function variantaCurenta() { var p = paginaCurenta(); return p ? p.variante.find(function (v) { return v.varianta === S.varianta; }) || null : null; }
  function numeVarianta(v) { return v === L.IMPLICITA ? 'Implicită' : v; }
  // Adresa site-ului (SITE_URL, lib/adresa-site.js), trimisă de server: back-office-ul are alt domeniu.
  function adresaSite() { return String(S.urlSite || location.origin).replace(/\/+$/, ''); }

  // ── Datele ────────────────────────────────────────────────────────────
  async function incarcaLista() {
    var j = await P.api('/api/admin/seo-landing');
    S.pagini = j.pagini || [];
    S.poateScrie = j.poate_scrie === true;
    S.urlSite = j.url_site || null;
  }
  async function incarcaVarianta() {
    var j = await P.api('/api/admin/seo-landing?pagina=' + encodeURIComponent(S.cale) + '&varianta=' + encodeURIComponent(S.varianta));
    primesteDetalii(j);
  }
  function primesteDetalii(j) {
    S.d = j;
    S.texte = { ro: Object.assign({}, j.ciorna.ro), en: Object.assign({}, j.ciorna.en) };
    S.profesie = j.profesie || '';
    if (typeof j.poate_scrie === 'boolean') S.poateScrie = j.poate_scrie;
  }

  async function incarca() {
    var r = radacina();
    if (!r) return;
    r.innerHTML = '<p class="seo-nota" id="lp-bo-stare">Se încarcă paginile de destinație…</p>';
    try {
      await incarcaLista();
      await incarcaVarianta();
      S.incarcat = true;
      randeaza();
    } catch (e) {
      r.innerHTML = '<div class="seo-mesaj" id="lp-bo-eroare" role="alert"></div>';
      window.MDFeedback.mesaj($('#lp-bo-eroare'), 'eroare', 'Nu am putut încărca paginile de destinație: ' + e.message);
    }
  }

  // ── Desenarea ─────────────────────────────────────────────────────────
  function htmlPagini() {
    return '<nav class="lp-bo-pagini" aria-label="Pagini de destinație"><p class="lp-bo-titlu-col">PAGINI</p>' + S.pagini.map(function (p) {
      var pub = p.variante.filter(function (v) { return v.stare === 'publicata' || v.stare === 'modificata'; }).length;
      return '<button type="button" class="lp-bo-pagina" data-pagina="' + esc(p.cale) + '"' + (p.cale === S.cale ? ' aria-current="page"' : '') + '>' +
        '<span>' + esc(p.cale) + '</span><span class="lp-bo-nr" title="Variante publicate">' + pub + ' / ' + p.variante.length + '</span></button>';
    }).join('') + '</nav>';
  }

  function htmlVariante() {
    var p = paginaCurenta();
    return '<div class="lp-bo-variante" role="group" aria-label="Varianta"><span class="lp-bo-leg">Varianta:</span>' +
      p.variante.map(function (v) {
        var et = ETICHETE_STARE[v.stare] || ETICHETE_STARE.din_fisier;
        return '<button type="button" class="lp-bo-chip" data-varianta="' + esc(v.varianta) + '" aria-pressed="' + (v.varianta === S.varianta) + '">' +
          esc(numeVarianta(v.varianta)) + (v.varianta === L.IMPLICITA ? '' : ' <small>(utm_campaign = ' + esc(v.varianta) + ')</small>') +
          ' <span class="seo-eticheta ' + et[1] + '">' + et[0] + (v.versiune ? ' v' + v.versiune : '') + '</span></button>';
      }).join('') +
      '<button type="button" class="lp-bo-chip nou" data-act="varianta-noua"' + (S.poateScrie ? '' : ' disabled') + '>+ Variantă nouă</button>' +
      '</div>' +
      '<form class="lp-bo-nou" id="lp-bo-nou" hidden novalidate>' +
      '<div class="seo-camp"><label for="lp-bo-nou-nume"><span>Numele variantei = valoarea utm_campaign din reclamă (litere mici, cifre, „-”, „_”, „.”)</span></label>' +
      '<input id="lp-bo-nou-nume" type="text" data-camp="varianta" maxlength="60" placeholder="ex. instalatori" autocomplete="off" required/></div>' +
      '<div class="seo-actiuni"><button type="button" class="seo-buton principal" data-act="creeaza-varianta">Creează varianta</button>' +
      '<button type="button" class="seo-buton" data-act="anuleaza-varianta">Anulează</button></div>' +
      '<div class="seo-mesaj" id="lp-bo-nou-msg" role="status"></div></form>';
  }

  function htmlCamp(f, limba) {
    var v = S.texte[limba][f.cheie] || '';
    var id = 'lp-bo-' + limba + '-' + f.cheie;
    var lung = f.max > 60;
    return '<div class="seo-camp' + (f.cheie === 'titlu' || f.cheie === 'subtitlu' ? ' lat' : '') + '"><label for="' + id + '"><span>' + esc(f.eticheta) + ' (max. ' + f.max + ')' + (f.obligatoriu ? '' : ' — doar cu imagine') + '</span>' +
      '<span class="seo-contor" data-contor="' + f.cheie + '"></span></label>' +
      (lung ? '<textarea id="' + id + '" rows="2" data-camp="' + limba + '.' + f.cheie + '" data-cheie="' + f.cheie + '" data-eticheta="' + esc(f.eticheta) + ' (' + limba.toUpperCase() + ')">' + esc(v) + '</textarea>'
        : '<input id="' + id + '" type="text" data-camp="' + limba + '.' + f.cheie + '" data-cheie="' + f.cheie + '" data-eticheta="' + esc(f.eticheta) + ' (' + limba.toUpperCase() + ')" value="' + esc(v) + '"/>') +
      '</div>';
  }

  function htmlImagine() {
    var im = S.d.imagine;
    var mic = im && (im.variante || []).slice().sort(function (a, b) { return a.w - b.w; })[0];
    return '<div class="lp-bo-imagine" id="lp-bo-imagine">' +
      (im ? '<img src="' + esc((mic && mic.url) || im.url) + '" alt="" class="lp-bo-miniatura"/>' : '<span class="lp-bo-miniatura gol" aria-hidden="true">🖼</span>') +
      '<span class="lp-bo-imagine-text"><strong>Imaginea principală</strong><span>' +
      (im ? esc(im.latime + ' × ' + im.inaltime + ' px, WebP, ' + (im.variante || []).length + ' mărimi pentru srcset') : 'Fără imagine — pagina nu afișează niciuna.') +
      ' JPG, PNG sau WebP · se convertește automat în WebP (latura mare ≤ 1600 px, ≤ 300 KB, fără metadate) · textul alternativ RO + EN e obligatoriu.</span></span>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp" hidden id="lp-bo-fisier"/>' +
      '<span class="lp-bo-imagine-act"><button type="button" class="seo-buton contur" data-act="alege-imagine"' + (S.poateScrie ? '' : ' disabled') + '>' + (im ? 'Schimbă imaginea' : 'Încarcă imaginea') + '</button>' +
      (im ? '<button type="button" class="seo-buton pericol" data-act="scoate-imagine"' + (S.poateScrie ? '' : ' disabled') + '>Scoate</button>' : '') + '</span>' +
      '<progress class="seo-progres" max="100" value="0" hidden aria-label="Progresul încărcării"></progress>' +
      '<div class="seo-mesaj" id="lp-bo-imagine-msg" role="status"></div></div>';
  }

  function htmlIstoric() {
    var ist = S.d.istoric || [];
    return '<section class="lp-bo-istoric" id="lp-bo-istoric"' + (S.istoric ? '' : ' hidden') + ' aria-labelledby="lp-bo-istoric-titlu">' +
      '<h4 id="lp-bo-istoric-titlu">Istoricul publicărilor</h4>' +
      (S.d.versiune ? '<p class="seo-nota">Publicată acum: <strong>v' + S.d.versiune + '</strong>' + (S.d.publicat_la ? ', ' + esc(dataOra(S.d.publicat_la)) : '') + '.</p>' : '<p class="seo-nota">Varianta nu a fost publicată încă.</p>') +
      (ist.length ? '<div class="seo-tabel-cutie"><table class="seo-tabel"><thead><tr><th>Versiune</th><th>Publicată</th><th>Titlul (RO / EN)</th><th></th></tr></thead><tbody>' +
        ist.map(function (v) {
          return '<tr><td>v' + v.versiune + '</td><td>' + esc(dataOra(v.publicat_la)) + (v.publicat_de_email ? '<br><small>' + esc(v.publicat_de_email) + '</small>' : '') + '</td>' +
            '<td>' + esc(v.titlu_ro || '') + '<br><small>' + esc(v.titlu_en || '') + '</small></td>' +
            '<td style="text-align:right"><button type="button" class="seo-buton contur" data-revino="' + v.versiune + '"' + (S.poateScrie ? '' : ' disabled') + '>Revino la v' + v.versiune + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="seo-nota">Nicio versiune anterioară. Fiecare publicare păstrează aici versiunea dinainte.</p>') +
      '<div class="seo-mesaj" id="lp-bo-istoric-msg" role="status"></div></section>';
  }

  function htmlPreviz() {
    return '<aside class="lp-bo-previz" aria-label="Previzualizare">' +
      '<div class="seo-limba" role="group" aria-label="Previzualizare">' +
      '<button type="button" data-previz="telefon" aria-pressed="' + (S.previz === 'telefon') + '">Telefon</button>' +
      '<button type="button" data-previz="desktop" aria-pressed="' + (S.previz === 'desktop') + '">Desktop</button></div>' +
      '<div class="lp-bo-ecran ' + S.previz + '" id="lp-bo-ecran"><iframe title="Previzualizarea paginii (' + S.limba.toUpperCase() + ')" id="lp-bo-iframe" sandbox="allow-same-origin" tabindex="-1"></iframe></div>' +
      '<p class="seo-nota">Previzualizarea arată ciorna din formular (' + S.limba.toUpperCase() + '), cu stilul real al paginii.</p>' +
      '<div class="lp-bo-link"><label for="lp-bo-link"><span>Link pentru reclamă</span></label>' +
      '<div class="lp-bo-link-rand"><input id="lp-bo-link" type="text" readonly value="' + esc(linkReclama()) + '"/>' +
      '<button type="button" class="seo-buton principal" data-act="copiaza-link">Copiază</button></div>' +
      (S.varianta === L.IMPLICITA ? '<p class="seo-nota">Varianta implicită: linkul nu are utm_campaign. Pentru o reclamă, creați o variantă cu numele campaniei.</p>' : '') +
      '</div></aside>';
  }

  function linkReclama() { return adresaSite() + L.linkReclama(S.cale, S.varianta, S.profesie || null); }
  function dataOra(s) { try { return new Date(s).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return String(s || ''); } }

  function htmlCap() {
    var v = variantaCurenta() || { stare: 'din_fisier' };
    var et = ETICHETE_STARE[v.stare] || ETICHETE_STARE.din_fisier;
    return '<div class="lp-bo-cap"><h3 class="lp-bo-cale">' + esc(S.cale) + '</h3><span class="seo-eticheta ' + et[1] + '">' + et[0] + (v.versiune ? ' · v' + v.versiune : '') + '</span>' +
      (S.poateScrie ? '' : '<span class="seo-eticheta nu">Doar citire</span>') + '</div>';
  }

  // După salvare / publicare / imagine: doar antetul, variantele, imaginea, istoricul și linkul
  // se redesenează — formularul și mesajul MDFeedback (zona #lp-bo-msg) rămân pe loc.
  function reimprospateaza() {
    var r = radacina();
    if (!r || !$('#lp-bo-cap-zona', r)) return randeaza();
    $('#lp-bo-cap-zona', r).innerHTML = htmlCap();
    $('#lp-bo-variante-zona', r).innerHTML = htmlVariante();
    $('#lp-bo-imagine-zona', r).innerHTML = htmlImagine();
    $('#lp-bo-istoric-zona', r).innerHTML = htmlIstoric();
    $('#lp-bo-link', r).value = linkReclama();
    var nav = r.querySelector('.lp-bo-pagini');
    if (nav) nav.outerHTML = htmlPagini();
    legaPagini(r);
    legaVariante(r);
    legaImagine(r);
    legaIstoric(r);
    actualizeazaPreviz();
  }

  function randeaza() {
    var r = radacina();
    if (!r || !S.d) return;
    var p = L.pagina(S.cale);
    var servicii = p && p.categorie === 'servicii';
    r.innerHTML = '<div class="lp-bo">' + htmlPagini() +
      '<div class="lp-bo-editor">' +
      '<div id="lp-bo-cap-zona">' + htmlCap() + '</div>' +
      '<div id="lp-bo-variante-zona">' + htmlVariante() + '</div>' +
      (S.d.din_implicit ? '<p class="seo-nota">Câmpurile pornesc de la textele de azi ale paginii (HTML și dicționarele RO / EN). Pagina publică le folosește până la prima publicare.</p>' : '') +
      '<div class="seo-taburi" role="tablist" aria-label="Limba">' +
      ['ro', 'en'].map(function (l) {
        return '<button type="button" class="seo-tab" role="tab" id="lp-bo-tab-' + l + '" aria-controls="lp-bo-form" aria-selected="' + (S.limba === l) + '" data-limba-lp="' + l + '" tabindex="' + (S.limba === l ? 0 : -1) + '">' + (l === 'ro' ? 'Română' : 'English') + '</button>';
      }).join('') + '</div>' +
      '<form class="lp-bo-form" id="lp-bo-form" role="tabpanel" aria-labelledby="lp-bo-tab-' + S.limba + '" novalidate>' +
      '<div class="lp-bo-campuri">' + L.CAMPURI.map(function (f) { return htmlCamp(f, S.limba); }).join('') + '</div>' +
      (servicii ? '<div class="seo-camp"><label for="lp-bo-profesie"><span>Profesia din linkul pentru reclamă (opțional, ex. instalator) — preselectată la înscriere</span></label>' +
        '<input id="lp-bo-profesie" type="text" list="lp-bo-profesii" data-camp="profesie" value="' + esc(S.profesie) + '" maxlength="60" autocomplete="off"/><datalist id="lp-bo-profesii"></datalist></div>' : '') +
      '</form>' +
      '<div id="lp-bo-imagine-zona">' + htmlImagine() + '</div>' +
      '<div class="seo-mesaj" id="lp-bo-msg" role="status"></div>' +
      '<div class="lp-bo-actiuni">' +
      '<button type="button" class="seo-buton" data-act="istoric" aria-expanded="' + S.istoric + '" aria-controls="lp-bo-istoric">Istoricul modificărilor</button>' +
      '<span class="lp-bo-spatiu"></span>' +
      (S.varianta !== L.IMPLICITA ? '<button type="button" class="seo-buton pericol" data-act="sterge-varianta"' + (S.poateScrie ? '' : ' disabled') + '>Șterge varianta</button>' : '') +
      '<button type="button" class="seo-buton contur" data-act="salveaza"' + (S.poateScrie ? '' : ' disabled') + '>Salvează ciorna</button>' +
      '<button type="button" class="seo-buton principal" data-act="publica"' + (S.poateScrie ? '' : ' disabled') + '>Publică</button>' +
      '</div>' +
      '<div id="lp-bo-istoric-zona">' + htmlIstoric() + '</div>' +
      '</div>' + htmlPreviz() + '</div>';
    lega(r);
    actualizeazaPreviz();
  }

  // ── Formularul ────────────────────────────────────────────────────────
  function citesteFormular() {
    var r = radacina();
    if (!r || !S.texte) return;
    r.querySelectorAll('#lp-bo-form [data-cheie]').forEach(function (el) { S.texte[S.limba][el.getAttribute('data-cheie')] = el.value; });
    var pr = $('#lp-bo-profesie', r);
    if (pr) S.profesie = pr.value.trim().toLowerCase();
  }
  function corp(actiune) {
    citesteFormular();
    return { actiune: actiune, pagina: S.cale, varianta: S.varianta, profesie: S.profesie || null, ro: S.texte.ro, en: S.texte.en };
  }
  async function dupaScriere(j, complet) {
    primesteDetalii(j);
    await incarcaLista();
    if (complet) randeaza(); else reimprospateaza();
  }

  // Erorile serverului pe câmpurile celeilalte limbi: se trece pe tabul ei și se marchează acolo.
  function erorileInAltaLimba(rez) {
    var c = rez && rez.eroare && rez.eroare.campuri;
    if (!c || !c.length) return;
    var dePe = function (l) { return c.filter(function (x) { return typeof x.camp === 'string' && x.camp.indexOf(l + '.') === 0; }); };
    if (dePe(S.limba).length || !dePe(S.limba === 'ro' ? 'en' : 'ro').length) return;
    var mesaj = $('#lp-bo-msg') && $('#lp-bo-msg').innerHTML;
    S.limba = S.limba === 'ro' ? 'en' : 'ro';
    randeaza();
    if (mesaj) $('#lp-bo-msg').innerHTML = mesaj;
    window.MDFeedback.aplicaErori($('#lp-bo-form'), c);
  }

  async function salveaza(buton) {
    var rez = await window.MDFeedback.salveaza(buton, $('#lp-bo-msg'), async function () {
      var j = await P.api('/api/admin/seo-landing', { method: 'POST', body: corp('salveaza') });
      await dupaScriere(j);
      return 'Ciorna variantei „' + numeVarianta(S.varianta) + '” (RO + EN) a fost salvată. Publicul vede în continuare varianta publicată.';
    }, { form: $('#lp-bo-form'), textSalveaza: 'Se salvează…', textOk: '✓ Salvat' });
    erorileInAltaLimba(rez);
  }

  async function publica(buton) {
    var rez = await window.MDFeedback.salveaza(buton, $('#lp-bo-msg'), async function () {
      // Întâi ciorna din formular, apoi publicarea (serverul cere RO și EN complete).
      await P.api('/api/admin/seo-landing', { method: 'POST', body: corp('salveaza') });
      var j = await P.api('/api/admin/seo-landing', { method: 'POST', body: { actiune: 'publica', pagina: S.cale, varianta: S.varianta } });
      await dupaScriere(j);
      return 'Publicată: v' + j.versiune + '. Pagina publică o afișează în cel mult un minut (cache-ul scurt).';
    }, { form: $('#lp-bo-form'), textSalveaza: 'Se publică…', textOk: '✓ Publicat' });
    erorileInAltaLimba(rez);
  }

  async function revino(buton, versiune) {
    var da = await window.MDFeedback.confirma('Revii la v' + versiune + ' pentru „' + numeVarianta(S.varianta) + '” pe ' + S.cale + '? Se publică din nou conținutul ei (ca versiune nouă), iar versiunea de acum trece în istoric.',
      { textOk: 'Revino la v' + versiune, textAnulare: 'Anulează' });
    if (!da) return;
    await window.MDFeedback.salveaza(buton, $('#lp-bo-istoric-msg'), async function () {
      var j = await P.api('/api/admin/seo-landing', { method: 'POST', body: { actiune: 'revino', pagina: S.cale, varianta: S.varianta, versiune: versiune } });
      S.istoric = true;
      await dupaScriere(j, true);
      return 'Conținutul v' + versiune + ' e publicat din nou, ca v' + j.versiune + '.';
    }, { textSalveaza: 'Se revine…', textOk: '✓ Gata', toast: true });
  }

  async function stergeVarianta(buton) {
    var da = await window.MDFeedback.confirma('Ștergi varianta „' + S.varianta + '” de pe ' + S.cale + ' (ciorna și publicarea)? Reclamele cu utm_campaign=' + S.varianta + ' vor afișa varianta implicită. Istoricul rămâne.',
      { textOk: 'Șterge varianta', textAnulare: 'Anulează', periculos: true });
    if (!da) return;
    var nume = S.varianta;
    await window.MDFeedback.salveaza(buton, $('#lp-bo-msg'), async function () {
      await P.api('/api/admin/seo-landing', { method: 'POST', body: { actiune: 'sterge', pagina: S.cale, varianta: nume } });
      S.varianta = L.IMPLICITA;
      await incarcaLista();
      await incarcaVarianta();
      randeaza();
      return 'Varianta „' + nume + '” a fost ștearsă.';
    }, { textSalveaza: 'Se șterge…', textOk: '✓ Șters', toast: true });
  }

  async function creeazaVarianta(buton) {
    var form = $('#lp-bo-nou');
    var camp = $('#lp-bo-nou-nume');
    var nume = String(camp.value || '').trim().toLowerCase();
    camp.value = nume;
    await window.MDFeedback.salveaza(buton, $('#lp-bo-nou-msg'), async function () {
      if (!L.numeVarianta(nume) || nume === L.IMPLICITA) {
        var e = new Error('Numele variantei: doar litere mici, cifre, „.”, „-”, „_”, cel mult 60 de caractere (ex. instalatori).');
        e.campuri = [{ camp: 'varianta', mesaj: { ro: 'Folosiți doar a-z, 0-9, „.”, „-”, „_”.', en: 'Use only a-z, 0-9, ".", "-", "_".' } }];
        throw e;
      }
      var p = paginaCurenta();
      if (p.variante.some(function (v) { return v.varianta === nume; })) throw new Error('Varianta „' + nume + '” există deja pe această pagină.');
      citesteFormular();
      // Varianta nouă pornește de la textele variantei deschise acum (le editați apoi).
      var j = await P.api('/api/admin/seo-landing', { method: 'POST', body: { actiune: 'salveaza', pagina: S.cale, varianta: nume, profesie: S.profesie || null, ro: S.texte.ro, en: S.texte.en } });
      S.varianta = nume;
      await dupaScriere(j, true);
      return 'Varianta „' + nume + '” a fost creată ca ciornă.';
    }, { form: form, textSalveaza: 'Se creează…', textOk: '✓ Creată', toast: true });
  }

  // ── Imaginea: WebP în browser, apoi încărcare directă ─────────────────
  function laBlob(c, calitate) { return new Promise(function (ok) { c.toBlob(function (b) { ok(b); }, 'image/webp', calitate); }); }
  async function webp(img, latime, inaltime) {
    var c = document.createElement('canvas');
    c.width = latime; c.height = inaltime;
    var x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, latime, inaltime);
    for (var q = 0.82; q >= 0.5; q -= 0.08) {
      var b = await laBlob(c, q);
      if (!b || b.type !== 'image/webp') throw new Error('Browserul nu poate converti imaginea în WebP. Folosiți Chrome, Edge sau Firefox.');
      if (b.size <= L.IMAGINE.marimeMaxima) return b;
    }
    return null;
  }
  // → [{ w, blob, latime, inaltime }], cea mai mare prima (latura mare ≤ 1600 px, fiecare ≤ 300 KB).
  async function pregatesteImagine(fisier) {
    if (!/^image\/(jpeg|png|webp)$/.test(fisier.type)) throw new Error('Alegeți o imagine JPG, PNG sau WebP.');
    var info = await window.SeoMedia.citesteImagine(fisier);
    try {
      var W = info.latime, H = info.inaltime;
      if (W < 600 && H < 600) throw new Error('Imaginea are doar ' + W + ' × ' + H + ' px. Alegeți una de cel puțin 800 px pe latura mare.');
      var sMax = Math.min(1, L.IMAGINE.laturaMaxima / Math.max(W, H));
      var rez = [];
      for (var i = L.IMAGINE.latimi.length - 1; i >= 0; i--) {
        var tinta = L.IMAGINE.latimi[i];
        var s = Math.min(sMax, tinta / W);
        var w = Math.round(W * s), h = Math.round(H * s);
        if (rez.length && w >= rez[rez.length - 1].latime * 0.9) continue; // fără mărimi aproape egale
        var b = await webp(info.img, w, h);
        // Cea mare nu încape în 300 KB: se micșorează treptat (fotografiile foarte detaliate).
        while (!b && w > 480) { w = Math.round(w * 0.85); h = Math.round(h * 0.85); b = await webp(info.img, w, h); }
        if (!b) throw new Error('Imaginea nu scade sub 300 KB nici convertită în WebP. Alegeți o fotografie mai simplă.');
        rez.push({ w: tinta, blob: b, latime: w, inaltime: h });
      }
      return rez;
    } finally { URL.revokeObjectURL(info.url); }
  }

  function legaImagine(r) {
    var input = $('#lp-bo-fisier', r);
    var bAlege = $('[data-act="alege-imagine"]', r);
    if (bAlege) bAlege.addEventListener('click', function () { input.click(); });
    var bScoate = $('[data-act="scoate-imagine"]', r);
    if (bScoate) bScoate.addEventListener('click', async function () {
      var da = await window.MDFeedback.confirma('Scoți imaginea din ciorna variantei? Varianta publicată o păstrează până la următoarea publicare.', { textOk: 'Scoate imaginea', textAnulare: 'Anulează', periculos: true });
      if (!da) return;
      await window.MDFeedback.salveaza(bScoate, $('#lp-bo-imagine-msg'), async function () {
        citesteFormular();
        await P.api('/api/admin/seo-landing', { method: 'POST', body: corp('salveaza') });
        var j = await P.api('/api/admin/seo-landing', { method: 'POST', body: { actiune: 'sterge_imagine', pagina: S.cale, varianta: S.varianta } });
        await dupaScriere(j);
        return 'Imaginea a fost scoasă din ciornă.';
      }, { textSalveaza: 'Se scoate…', textOk: '✓ Scoasă', toast: true });
    });
    input.addEventListener('change', async function () {
      var fisier = input.files && input.files[0];
      input.value = '';
      if (!fisier) return;
      var msg = $('#lp-bo-imagine-msg');
      var marimi;
      try { marimi = await pregatesteImagine(fisier); } catch (e) { window.MDFeedback.mesaj(msg, 'eroare', e.message); return; }
      await window.MDFeedback.salveaza(bAlege, msg, async function () {
        citesteFormular();
        // Textele din formular se păstrează: întâi ciorna, apoi imaginea.
        await P.api('/api/admin/seo-landing', { method: 'POST', body: corp('salveaza') });
        var id = null, fisiere = [];
        for (var i = 0; i < marimi.length; i++) {
          var m = marimi[i];
          var c = await P.api('/api/admin/seo-landing', { method: 'POST', body: { actiune: 'url_incarcare', pagina: S.cale, varianta: S.varianta, id: id, w: m.w, mime: 'image/webp', marime: m.blob.size, latime: m.latime, inaltime: m.inaltime } });
          id = c.id;
          await window.SeoMedia.incarcaPeAdresa(c.url_semnat, m.blob, 'image/webp', function (p) {
            var bar = $('#lp-bo-imagine .seo-progres');
            if (bar) { bar.hidden = false; bar.value = Math.round((i * 100 + p) / marimi.length); }
          });
          fisiere.push({ w: m.w, cale: c.cale, latime: m.latime, inaltime: m.inaltime });
        }
        var j = await P.api('/api/admin/seo-landing', { method: 'POST', body: { actiune: 'confirma_imagine', pagina: S.cale, varianta: S.varianta, id: id, fisiere: fisiere } });
        await dupaScriere(j);
        return 'Imaginea a fost încărcată: ' + marimi[0].latime + ' × ' + marimi[0].inaltime + ' px, WebP, ' + window.SeoMedia.mb(marimi[0].blob.size) + ' (' + marimi.length + ' mărimi). Completați textul alternativ RO + EN.';
      }, { textSalveaza: 'Se încarcă…', textOk: '✓ Încărcat', toast: true, timeout: 5 * 60 * 1000 });
    });
  }

  // ── Previzualizarea (ciorna din formular, stilul real) ─────────────────
  function htmlPagina() {
    citesteFormular();
    var t = S.texte[S.limba];
    var p = L.pagina(S.cale);
    var im = S.d.imagine;
    var bifa = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#0E9E99" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
    return '<!doctype html><html lang="' + S.limba + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link rel="stylesheet" href="' + location.origin + '/landing.css"><style>body{margin:0;background:#F6F8FB}.antet{height:56px;background:#fff;border-bottom:1px solid #E6ECF2;display:flex;align-items:center;gap:8px;padding:0 16px;font:800 16px Arial;color:#003366}.antet b{width:32px;height:32px;border-radius:9px;background:#003366;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px}</style></head><body>' +
      '<div class="antet"><b>MD</b>My Darrin</div>' +
      '<main class="lp" data-lp-tip="' + esc(p.tip) + '"><section class="lp-erou"><div class="lp-erou-in">' +
      '<p class="lp-eticheta">' + esc(t.eticheta) + '</p><h1 class="lp-titlu">' + esc(t.titlu) + '</h1><p class="lp-sub">' + esc(t.subtitlu) + '</p>' +
      '<ul class="lp-beneficii">' + [1, 2, 3].map(function (i) { return '<li>' + bifa + '<span>' + esc(t['beneficiu_' + i]) + '</span></li>'; }).join('') + '</ul>' +
      '<a class="lp-buton" href="#">' + esc(t.buton) + '</a><p class="lp-sub-buton">' + esc(t.sub_buton) + '</p></div></section>' +
      (im ? '<section class="lp-sec"><figure class="lp-imagine"><img src="' + esc(im.url) + '" alt="' + esc(t.imagine_alt) + '" width="' + im.latime + '" height="' + im.inaltime + '"></figure></section>' : '') +
      '</main></body></html>';
  }
  var cronoPreviz = null;
  function actualizeazaPreviz() {
    clearTimeout(cronoPreviz);
    cronoPreviz = setTimeout(function () {
      var f = $('#lp-bo-iframe');
      if (!f) return;
      f.srcdoc = htmlPagina();
      var ecran = $('#lp-bo-ecran');
      var lat = S.previz === 'telefon' ? 390 : 1280, ina = S.previz === 'telefon' ? 844 : 800;
      var s = Math.min(1, (ecran.clientWidth || 268) / lat);
      f.style.width = lat + 'px'; f.style.height = ina + 'px'; f.style.transform = 'scale(' + s + ')';
      ecran.style.height = Math.round(ina * s) + 'px';
    }, 120);
  }

  function leagaContoare(r) {
    L.CAMPURI.forEach(function (f) {
      var el = $('#lp-bo-' + S.limba + '-' + f.cheie, r);
      var c = $('#lp-bo-form [data-contor="' + f.cheie + '"]', r);
      if (el && c) P.legaContor(el, c, f.max);
      if (el) el.addEventListener('input', function () {
        actualizeazaPreviz();
      });
    });
  }

  function legaPagini(r) {
    r.querySelectorAll('[data-pagina]').forEach(function (b) {
      b.addEventListener('click', async function () {
        citesteFormular();
        S.cale = b.getAttribute('data-pagina'); S.varianta = L.IMPLICITA; S.istoric = false;
        try { await incarcaVarianta(); randeaza(); } catch (e) { window.MDFeedback.toast('eroare', 'Nu am putut încărca pagina: ' + e.message); }
      });
    });
  }
  function legaVariante(r) {
    r.querySelectorAll('[data-varianta]').forEach(function (b) {
      b.addEventListener('click', async function () {
        S.varianta = b.getAttribute('data-varianta'); S.istoric = false;
        try { await incarcaVarianta(); randeaza(); } catch (e) { window.MDFeedback.toast('eroare', 'Nu am putut încărca varianta: ' + e.message); }
      });
    });
    var act = function (n) { return $('[data-act="' + n + '"]', r); };
    act('varianta-noua').addEventListener('click', function () { var f = $('#lp-bo-nou', r); f.hidden = false; $('#lp-bo-nou-nume', r).focus(); });
    act('anuleaza-varianta').addEventListener('click', function () { $('#lp-bo-nou', r).hidden = true; });
    act('creeaza-varianta').addEventListener('click', function () { creeazaVarianta(act('creeaza-varianta')); });
    $('#lp-bo-nou-nume', r).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); creeazaVarianta(act('creeaza-varianta')); } });
  }
  function legaIstoric(r) {
    r.querySelectorAll('[data-revino]').forEach(function (b) {
      b.addEventListener('click', function () { revino(b, Number(b.getAttribute('data-revino'))); });
    });
  }

  function lega(r) {
    legaPagini(r);
    legaVariante(r);
    legaIstoric(r);
    r.querySelectorAll('[data-limba-lp]').forEach(function (b) {
      b.addEventListener('click', function () { citesteFormular(); S.limba = b.getAttribute('data-limba-lp'); randeaza(); var t = $('#lp-bo-tab-' + S.limba); if (t) t.focus(); });
      b.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault(); citesteFormular(); S.limba = S.limba === 'ro' ? 'en' : 'ro'; randeaza(); var t = $('#lp-bo-tab-' + S.limba); if (t) t.focus();
      });
    });
    r.querySelectorAll('[data-previz]').forEach(function (b) {
      b.addEventListener('click', function () { citesteFormular(); S.previz = b.getAttribute('data-previz'); randeaza(); });
    });
    var act = function (n) { return $('[data-act="' + n + '"]', r); };
    if (act('salveaza')) act('salveaza').addEventListener('click', function () { salveaza(act('salveaza')); });
    if (act('publica')) act('publica').addEventListener('click', function () { publica(act('publica')); });
    if (act('sterge-varianta')) act('sterge-varianta').addEventListener('click', function () { stergeVarianta(act('sterge-varianta')); });
    act('istoric').addEventListener('click', function () {
      S.istoric = !S.istoric;
      $('#lp-bo-istoric', r).hidden = !S.istoric;
      act('istoric').setAttribute('aria-expanded', String(S.istoric));
    });
    act('copiaza-link').addEventListener('click', async function () {
      var b = act('copiaza-link');
      var text = linkReclama();
      await window.MDFeedback.salveaza(b, null, async function () {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
        else { var c = $('#lp-bo-link', r); c.select(); if (!document.execCommand('copy')) throw new Error('Copiați manual linkul din câmp.'); }
        return 'Linkul a fost copiat: ' + text;
      }, { textSalveaza: 'Se copiază…', textOk: '✓ Copiat', toast: true });
    });
    var pr = $('#lp-bo-profesie', r);
    if (pr) {
      pr.addEventListener('input', function () { S.profesie = pr.value.trim().toLowerCase(); $('#lp-bo-link', r).value = linkReclama(); });
      incarcaProfesii(r);
    }
    if (!S.poateScrie) r.querySelectorAll('#lp-bo-form input, #lp-bo-form textarea').forEach(function (el) { el.readOnly = true; });
    leagaContoare(r);
    legaImagine(r);
  }

  // Profesiile pentru linkul pentru reclamă (aceeași listă ca pe pagina de înscriere).
  function incarcaProfesii(r) {
    var umple = function () {
      var dl = $('#lp-bo-profesii', r);
      if (dl && S.profesii) dl.innerHTML = S.profesii.map(function (p) { return '<option value="' + esc(p.slug) + '">' + esc(p.denumire_ro || p.slug) + '</option>'; }).join('');
    };
    if (S.profesii) return umple();
    fetch('/api/public/profesii?lang=ro').then(function (x) { return x.ok ? x.json() : null; }).then(function (j) {
      S.profesii = (j && (j.profesii || j.lista)) || [];
      umple();
    }).catch(function () { S.profesii = []; });
  }

  window.SeoPanouLanding = { incarca: incarca, S: S, linkReclama: linkReclama, pregatesteImagine: pregatesteImagine };
})();

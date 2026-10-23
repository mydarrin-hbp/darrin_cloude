// seo-panou-media.js
// Încărcarea materialelor din editorul SEO (pasul 11-S, 23 oct. 2026):
// imaginea OG a paginii (bucket-ul public seo-og) și materialele campaniilor
// (bucket-ul privat campanii-media). Fișierul merge DIRECT din browser în
// Storage, pe adresa semnată emisă de server; nu trece prin funcțiile Vercel.
//
// Înainte de încărcare, în browser:
//   - imagini: raportul (2 % toleranță) și rezoluția minimă; peste 5 MB (sau
//     alt format decât JPG / PNG / WebP) → convertită cu canvas în WebP / JPEG
//     (calitate ~0,85);
//   - video: metadatele din <video> (lățime, înălțime, durată), raportul,
//     rezoluția, mărimea ≤ 50 MB. Videoclipul NU se comprimă (nici aici, nici
//     pe server): dacă e prea mare, mesaj „Exportați din nou la …”.
// După încărcare, serverul verifică din nou conținutul, mărimea și calea.
// Regulile: lib/seo-campanii.js (window.SeoCampaniiReguli).

(function () {
  'use strict';
  var P = window.SeoPanou;
  var R = window.SeoCampaniiReguli;
  if (!P || !R) return;
  var esc = P.esc;
  var TIMEOUT_INCARCARE = 10 * 60 * 1000;

  function eroare(text) { var e = new Error(text); e.campuri = []; return e; }

  function citesteImagine(fisier) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(fisier);
      var img = new Image();
      img.onload = function () { ok({ img: img, url: url, latime: img.naturalWidth, inaltime: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); ko(eroare('Fișierul nu se poate deschide ca imagine. Alegeți un JPG, PNG sau WebP.')); };
      img.src = url;
    });
  }
  function citesteVideo(fisier) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(fisier);
      var v = document.createElement('video');
      var gata = false;
      var termina = function (f) { if (gata) return; gata = true; clearTimeout(ceas); f(); };
      var ceas = setTimeout(function () { termina(function () { URL.revokeObjectURL(url); ko(eroare('Nu am putut citi dimensiunile videoclipului. Exportați-l în MP4 (H.264) și încercați din nou.')); }); }, 15000);
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = function () {
        var durata = v.duration;
        var citeste = function () {
          termina(function () { URL.revokeObjectURL(url); ok({ latime: v.videoWidth, inaltime: v.videoHeight, durata: isFinite(v.duration) ? v.duration : (isFinite(durata) ? durata : null) }); });
        };
        // WebM înregistrat fără durată în antet: Infinity până la o căutare la final.
        if (!isFinite(durata)) { v.ontimeupdate = function () { v.ontimeupdate = null; citeste(); }; try { v.currentTime = 1e9; } catch (e) { citeste(); } }
        else citeste();
      };
      v.onerror = function () { termina(function () { URL.revokeObjectURL(url); ko(eroare('Videoclipul nu se poate citi în browser. Exportați-l în MP4 (H.264) și încercați din nou.')); }); };
      v.src = url;
    });
  }
  function laBlob(canvas, mime, calitate) {
    return new Promise(function (ok) { canvas.toBlob(function (b) { ok(b); }, mime, calitate); });
  }
  function mb(n) { return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }

  // → { blob, mime, latime, inaltime, convertit }
  async function pregatesteImagine(fisier, tip) {
    var info = await citesteImagine(fisier);
    try {
      var v = R.verificaDimensiuni(tip, info.latime, info.inaltime);
      if (!v.ok) throw eroare(v.ro);
      var permis = !!R.mimePermis(tip, fisier.type);
      if (permis && fisier.size <= R.MARIME_IMAGINE) return { blob: fisier, mime: fisier.type, latime: info.latime, inaltime: info.inaltime, convertit: false, avertisment: v.avertisment };
      var c = document.createElement('canvas');
      c.width = info.latime; c.height = info.inaltime;
      c.getContext('2d').drawImage(info.img, 0, 0);
      var blob = await laBlob(c, 'image/webp', 0.85);
      if (!blob || blob.type !== 'image/webp' || blob.size > R.MARIME_IMAGINE) blob = await laBlob(c, 'image/jpeg', 0.85);
      if (!blob || blob.size > R.MARIME_IMAGINE) {
        throw eroare('Imaginea are ' + mb(fisier.size) + ' și nici convertită nu scade sub 5 MB. Exportați-o din nou, sub 5 MB.');
      }
      return { blob: blob, mime: blob.type, latime: info.latime, inaltime: info.inaltime, convertit: true, avertisment: v.avertisment };
    } finally { URL.revokeObjectURL(info.url); }
  }
  async function pregatesteVideo(fisier, tip) {
    if (!R.mimePermis(tip, fisier.type)) throw eroare('Videoclipul trebuie să fie MP4, MOV sau WebM.');
    var m = R.spec(tip);
    if (fisier.size > R.MARIME_VIDEO) {
      var rec = (m.recomandat || m.minim)[0];
      throw eroare('Videoclipul are ' + mb(fisier.size) + ' (maximum 50 MB). Exportați din nou la ' + rec[0] + ' × ' + rec[1] + ', H.264, sub 50 MB — videoclipul nu se comprimă pe platformă.');
    }
    var info = await citesteVideo(fisier);
    var v = R.verificaDimensiuni(tip, info.latime, info.inaltime);
    if (!v.ok) throw eroare(v.ro);
    return { blob: fisier, mime: fisier.type, latime: info.latime, inaltime: info.inaltime, durata: info.durata, avertisment: v.avertisment };
  }

  // PUT pe adresa semnată, cu progres (fetch nu dă progresul încărcării).
  function incarcaPeAdresa(url, blob, mime, laProgres) {
    return new Promise(function (ok, ko) {
      var x = new XMLHttpRequest();
      x.open('PUT', url);
      x.setRequestHeader('content-type', mime);
      x.setRequestHeader('x-upsert', 'true');
      x.setRequestHeader('cache-control', 'max-age=3600');
      x.upload.onprogress = function (e) { if (e.lengthComputable && laProgres) laProgres(Math.round(e.loaded * 100 / e.total)); };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) ok();
        else ko(eroare('Stocarea a refuzat fișierul (HTTP ' + x.status + '). Verificați tipul și mărimea, apoi reîncercați.'));
      };
      x.onerror = function () { var e = eroare('Încărcarea s-a întrerupt. Verificați conexiunea și reîncercați.'); e.reincercabil = true; ko(e); };
      x.send(blob);
    });
  }

  function progresHtml() { return '<progress class="seo-progres" max="100" value="0" hidden aria-label="Progresul încărcării"></progress>'; }
  function arataProgres(zona, buton, p) {
    var bar = zona.querySelector('.seo-progres');
    if (bar) { bar.hidden = p == null; bar.value = p || 0; }
    if (buton && p != null) buton.textContent = 'Se încarcă… ' + p + ' %';
  }

  // Fluxul comun: alegere → verificare în browser → adresă semnată → încărcare → confirmare pe server.
  function legaIncarcare(zona, optiuni) {
    var input = zona.querySelector('input[type=file]');
    var msg = zona.querySelector('.seo-media-msg');
    var buton = null;
    zona.querySelectorAll('[data-media-act="alege"]').forEach(function (b) {
      b.addEventListener('click', function () { buton = b; input.click(); });
    });
    input.addEventListener('change', async function () {
      var fisier = input.files && input.files[0];
      input.value = '';
      if (!fisier) return;
      var b = buton || zona.querySelector('[data-media-act="alege"]');
      var pregatit;
      try {
        pregatit = optiuni.video ? await pregatesteVideo(fisier, optiuni.tip) : await pregatesteImagine(fisier, optiuni.tip);
      } catch (e) {
        window.MDFeedback.mesaj(msg, 'eroare', e.message);
        return;
      }
      var confirmat = null;
      var r = await window.MDFeedback.salveaza(b, msg, async function () {
        var cerere = await optiuni.cereAdresa(pregatit);
        arataProgres(zona, b, 0);
        try { await incarcaPeAdresa(cerere.url_semnat, pregatit.blob, pregatit.mime, function (p) { arataProgres(zona, b, p); }); }
        finally { arataProgres(zona, null, null); }
        confirmat = await optiuni.confirma(cerere, pregatit);
        var detalii = pregatit.latime + ' × ' + pregatit.inaltime + (pregatit.durata ? ', ' + pregatit.durata.toFixed(1).replace('.', ',') + ' s' : '') + ', ' + mb(pregatit.blob.size);
        return 'Încărcat (' + detalii + ')' + (pregatit.convertit ? ' — convertit în ' + pregatit.mime.split('/')[1].toUpperCase() + ', peste 5 MB' : '') + (pregatit.avertisment ? '. ' + pregatit.avertisment.ro : '') + (optiuni.textDupa || '');
      }, { textSalveaza: 'Se încarcă…', textOk: '✓ Încărcat', timeout: TIMEOUT_INCARCARE });
      // Redesenarea abia după rezultat, ca mesajul să rămână în zona nouă.
      if (r && r.ok && optiuni.dupa) optiuni.dupa(confirmat, r.rezultat);
    });
  }

  // ── Imaginea OG a paginii ─────────────────────────────────────────────
  function zonaOg(zona, form, laSchimbare) {
    var S = P.S;
    var deseneaza = function () {
      var url = S.date[S.limba].og_imagine_url;
      var d = S.date[S.limba];
      zona.innerHTML = '<div class="seo-media-rand">' +
        '<div class="seo-media-cutie" style="--raport:1.91/1">' + (url ? '<img src="' + esc(url) + '" alt=""/>' : '<span class="seo-media-gol">1,91:1 · min. 1200 × 630</span>') + '</div>' +
        '<div class="seo-media-info">' +
        (url ? '<div class="seo-nota">' + esc(d.og_imagine_latime) + ' × ' + esc(d.og_imagine_inaltime) + ' px</div>' : '<div class="seo-nota">Nicio imagine încărcată pentru ' + S.limba.toUpperCase() + '.</div>') +
        '<div class="seo-actiuni">' +
        '<button type="button" class="seo-buton contur" data-media-act="alege"' + (S.poateScrie ? '' : ' disabled') + '>' + (url ? 'Înlocuiește' : 'Încarcă') + '</button>' +
        (url ? '<button type="button" class="seo-buton pericol" data-media-act="scoate"' + (S.poateScrie ? '' : ' disabled') + '>Șterge</button>' : '') +
        '</div>' + progresHtml() +
        '<input type="file" accept="image/jpeg,image/png,image/webp" hidden/>' +
        '<div class="seo-media-msg" role="status"></div></div></div>';
      legaIncarcare(zona, {
        tip: 'og',
        cereAdresa: function (p) {
          return P.api('/api/admin/seo', { method: 'POST', body: { actiune: 'url_incarcare_og', page_path: S.cale, limba: S.limba, mime: p.mime, marime: p.blob.size, latime: p.latime, inaltime: p.inaltime } });
        },
        confirma: function (cerere, p) {
          return P.api('/api/admin/seo', { method: 'POST', body: { actiune: 'confirma_og', page_path: S.cale, limba: S.limba, cale: cerere.cale, latime: p.latime, inaltime: p.inaltime } });
        },
        dupa: function (j, text) {
          seteaza(j.url_public, j.latime, j.inaltime);
          window.MDFeedback.mesaj(zona.querySelector('.seo-media-msg'), 'ok', text);
        },
        textDupa: '. Apăsați „Salvează” ca imaginea să se aplice.',
      });
      var scoate = zona.querySelector('[data-media-act="scoate"]');
      if (scoate) scoate.addEventListener('click', function () {
        seteaza('', '', '');
        window.MDFeedback.mesaj(zona.querySelector('.seo-media-msg'), 'info', 'Imaginea a fost scoasă. Apăsați „Salvează” ca schimbarea să se aplice.');
      });
    };
    var seteaza = function (url, w, h) {
      var d = S.date[S.limba];
      d.og_imagine_url = url; d.og_imagine_latime = w; d.og_imagine_inaltime = h;
      ['og_imagine_url', 'og_imagine_latime', 'og_imagine_inaltime'].forEach(function (k) {
        var el = form.querySelector('[data-camp="' + k + '"]');
        if (el) el.value = d[k] == null ? '' : d[k];
      });
      deseneaza();
      if (laSchimbare) laSchimbare();
    };
    deseneaza();
  }

  // ── Materialele unei campanii ─────────────────────────────────────────
  // ctx: { campanie, tip, url, poateScrie, laSchimbare(campanie, media_urls) }
  function raportCss(tip) {
    var r = R.MEDIA[tip].rapoarte[0];
    return r[0] + '/' + r[1];
  }
  function zonaCampanie(zona, ctx) {
    var tip = ctx.tip;
    var m = R.MEDIA[tip];
    var video = m.tip === 'video';
    var media = (ctx.campanie.media || {})[tip];
    var raport = media && media.latime && media.inaltime ? media.latime + '/' + media.inaltime : raportCss(tip);
    var vertical = media ? media.inaltime > media.latime : (m.rapoarte[0][1] > m.rapoarte[0][0]);
    var poate = ctx.poateScrie && ctx.campanie.stare !== 'arhivata';
    var min = m.minim.map(function (x) { return x[0] + ' × ' + x[1]; }).join(' / ');
    var continut = '<span class="seo-media-gol">' + esc(m.eticheta) + '<br/>min. ' + esc(min) + '</span>';
    if (media && ctx.url) {
      continut = video
        ? '<video src="' + esc(ctx.url) + '" muted loop playsinline controls preload="metadata" aria-label="' + esc(m.eticheta) + '"></video>'
        : '<img src="' + esc(ctx.url) + '" alt="' + esc(m.eticheta) + '"/>';
    } else if (media) {
      continut = '<span class="seo-media-gol">' + esc(m.eticheta) + ' încărcat</span>';
    }
    // Zona sigură pe 9:16: ~14 % sus și ~20 % jos le acoperă interfața aplicației.
    var sigur = tip === 'video_vertical' || (tip === 'miniatura_video' && vertical)
      ? '<div class="seo-zona-sigura" aria-hidden="true"><span class="sus">Interfață ~14 %</span><span class="jos">Text și butoane ~20 %</span></div>' : '';
    zona.innerHTML = '<div class="seo-media-titlu"><strong>' + esc(m.eticheta) + '</strong><span>' + esc(m.rost) + '</span></div>' +
      '<div class="seo-media-cutie' + (vertical ? ' vertical' : '') + '" style="--raport:' + raport + '" data-media-tip="' + tip + '">' + continut + sigur + '</div>' +
      (media ? '<div class="seo-nota">' + media.latime + ' × ' + media.inaltime + (media.durata_s ? ' · ' + String(media.durata_s).replace('.', ',') + ' s' : '') + (media.marime_bytes ? ' · ' + mb(media.marime_bytes) : '') + '</div>' : '') +
      '<div class="seo-actiuni">' +
      '<button type="button" class="seo-buton contur" data-media-act="alege"' + (poate ? '' : ' disabled') + '>' + (media ? 'Înlocuiește' : 'Încarcă') + '</button>' +
      (media ? '<button type="button" class="seo-buton pericol" data-media-act="scoate"' + (poate ? '' : ' disabled') + '>Șterge</button>' : '') +
      '</div>' + progresHtml() +
      '<input type="file" accept="' + Object.keys(video ? R.MIME_VIDEO : R.MIME_IMAGINE).join(',') + '" hidden data-input-media="' + tip + '"/>' +
      '<div class="seo-media-msg" role="status"></div>';
    legaIncarcare(zona, {
      tip: tip, video: video,
      cereAdresa: function (p) {
        return P.api('/api/admin/seo-campanii', { method: 'POST', body: { actiune: 'url_incarcare', id: ctx.campanie.id, tip: tip, mime: p.mime, marime: p.blob.size, latime: p.latime, inaltime: p.inaltime, durata_s: p.durata } });
      },
      confirma: function (cerere, p) {
        return P.api('/api/admin/seo-campanii', { method: 'POST', body: { actiune: 'confirma_media', id: ctx.campanie.id, tip: tip, cale: cerere.cale, latime: p.latime, inaltime: p.inaltime, durata_s: p.durata } });
      },
      dupa: function (j, text) { ctx.laSchimbare(j.campanie, j.media_urls, tip, text); },
    });
    var scoate = zona.querySelector('[data-media-act="scoate"]');
    if (scoate) scoate.addEventListener('click', async function () {
      var da = await window.MDFeedback.confirma('Ștergi materialul „' + m.eticheta + '” al campaniei?', { textOk: 'Șterge', textAnulare: 'Anulează', periculos: true });
      if (!da) return;
      var j = null;
      var r = await window.MDFeedback.salveaza(scoate, zona.querySelector('.seo-media-msg'), async function () {
        j = await P.api('/api/admin/seo-campanii', { method: 'POST', body: { actiune: 'sterge_media', id: ctx.campanie.id, tip: tip } });
        return 'Materialul a fost șters.';
      }, { textSalveaza: 'Se șterge…', textOk: '✓ Șters' });
      if (r && r.ok) ctx.laSchimbare(j.campanie, j.media_urls, tip, r.rezultat);
    });
    var v = zona.querySelector('video');
    if (v) { v.muted = true; v.play && v.play().catch(function () {}); }
  }

  window.SeoMedia = {
    zonaOg: zonaOg, zonaCampanie: zonaCampanie, pregatesteImagine: pregatesteImagine, pregatesteVideo: pregatesteVideo,
    citesteImagine: citesteImagine, citesteVideo: citesteVideo, incarcaPeAdresa: incarcaPeAdresa, mb: mb,
  };
})();

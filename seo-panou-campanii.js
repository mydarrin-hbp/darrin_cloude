// seo-panou-campanii.js
// Tabul „Social media & campanii” din editorul SEO (seo-panou.js; pasul 11-S,
// 23 oct. 2026): campaniile paginii, pe limbă, cu textele reclamei, CTA, linkul
// cu UTM, materialele (seo-panou-media.js), previzualizări simulate (feed Meta,
// ecran vertical TikTok / Reels, player 16:9) și exportul materialelor.
//
// Nu publică reclame și nu se leagă de conturile Meta / TikTok / Google: LM
// descarcă exportul (.zip, construit aici, în browser, din adresele semnate
// de 10 minute — un răspuns Vercel are cel mult 4,5 MB) și îl încarcă manual.
// Câmpurile pornesc goale; nimic nu se completează în locul lui LM.

(function () {
  'use strict';
  var P = window.SeoPanou;
  var R = window.SeoCampaniiReguli;
  if (!P || !R) return;
  var esc = P.esc;

  var C = { pagina: null, lista: null, limite: Object.assign({}, R.LIMITE_IMPLICITE), poateScrie: false, curent: null, media_urls: {}, eroareLista: null };
  var ICONITE = { facebook: 'f', instagram: '◎', tiktok: '♪', youtube: '▶', general_patrat: '■', vertical_mobil: '▮' };
  var ETICHETA_STARE = { ciorna: 'Ciornă', activa: 'Activă', arhivata: 'Arhivată' };
  var CAMPURI = ['nume_campanie', 'titlu_reclama', 'text_principal', 'descriere_link', 'cta', 'url_destinatie', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'note_interne'];

  function api(url, o) { return P.api(url, o); }
  function data(s) { try { return new Date(s).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } }

  async function incarcaLista(S) {
    C.pagina = S.cale;
    C.lista = null;
    C.eroareLista = null;
    try {
      var j = await api('/api/admin/seo-campanii?page_path=' + encodeURIComponent(S.cale));
      C.lista = j.campanii || [];
      C.limite = Object.assign({}, R.LIMITE_IMPLICITE, j.limite || {});
      C.poateScrie = j.poate_scrie === true;
    } catch (e) {
      C.lista = [];
      C.eroareLista = e.message;
    }
  }

  // ── Lista ─────────────────────────────────────────────────────────────
  function listaHtml() {
    var randuri = (C.lista || []).map(function (c) {
      return '<tr><td><strong style="color:#fff">' + esc(c.nume_campanie) + '</strong></td>' +
        '<td>' + esc(String(c.limba).toUpperCase()) + '</td>' +
        '<td>' + ((c.platforme || []).map(function (p) { return '<span class="seo-eticheta nu" title="' + esc(R.ETICHETE_PLATFORME[p]) + '">' + ICONITE[p] + ' ' + esc(R.ETICHETE_PLATFORME[p]) + '</span>'; }).join('') || '—') + '</td>' +
        '<td><span class="seo-eticheta ' + (c.stare === 'activa' ? 'da' : 'nu') + '">' + ETICHETA_STARE[c.stare] + '</span></td>' +
        '<td>' + esc(data(c.updated_at)) + (c.actualizat_de_email ? '<br/><span class="seo-nota">' + esc(c.actualizat_de_email) + '</span>' : '') + '</td>' +
        '<td style="text-align:right"><button type="button" class="seo-buton contur" data-deschide="' + esc(c.id) + '">Deschide</button></td></tr>';
    }).join('');
    return '<div class="seo-ed-cap"><div class="seo-nota" style="margin:0">Campaniile paginii, pe limbă. Nu se publică de aici: materialele se descarcă și se încarcă manual în Ads Manager / TikTok Ads / Google Ads.</div>' +
      '<button type="button" class="seo-buton principal" data-act="noua"' + (C.poateScrie ? '' : ' disabled') + '>+ Campanie nouă</button></div>' +
      (C.eroareLista ? '<div class="seo-mesaj" style="color:#E57373">Eroare: ' + esc(C.eroareLista) + '</div>' : '') +
      '<div class="seo-tabel-cutie"><table class="seo-tabel seo-tabel-campanii"><thead><tr><th>Nume</th><th>Limba</th><th>Platforme</th><th>Stare</th><th>Actualizat</th><th></th></tr></thead>' +
      '<tbody>' + (randuri || '<tr><td colspan="6" class="seo-gol">Nicio campanie pentru această pagină.</td></tr>') + '</tbody></table></div>';
  }

  // ── Formularul ────────────────────────────────────────────────────────
  function campanieNoua(S) {
    return { id: null, page_path: S.cale, limba: S.limba, nume_campanie: '', platforme: [], stare: 'ciorna', media: {}, cta: '' };
  }
  function inputText(nume, eticheta, v, extra) {
    return '<div class="seo-camp"><label for="cc-' + nume + '"><span>' + eticheta + '</span>' + (extra || '') + '</label>' +
      '<input id="cc-' + nume + '" name="' + nume + '" type="text" value="' + esc(v) + '"/></div>';
  }
  function formHtml(c) {
    var nou = !c.id;
    var arhivata = c.stare === 'arhivata';
    var L = String(c.limba).toUpperCase();
    var alt = c.limba === 'ro' ? 'en' : 'ro';
    var cta = R.CTA.map(function (k) { return '<option value="' + k + '"' + (c.cta === k ? ' selected' : '') + '>' + esc(R.ETICHETE_CTA[k].ro + ' / ' + R.ETICHETE_CTA[k].en) + '</option>'; }).join('');
    var platforme = R.PLATFORME.map(function (p) {
      return '<label class="seo-platforma"><input type="checkbox" value="' + p + '"' + ((c.platforme || []).indexOf(p) !== -1 ? ' checked' : '') + '/><span class="seo-ic" aria-hidden="true">' + ICONITE[p] + '</span>' + esc(R.ETICHETE_PLATFORME[p]) + '</label>';
    }).join('');
    return '<div class="seo-ed-cap"><button type="button" class="seo-buton" data-act="inapoi">← Lista campaniilor</button>' +
      '<span class="seo-eticheta ' + (c.stare === 'activa' ? 'da' : 'nu') + '">' + (nou ? 'Campanie nouă' : ETICHETA_STARE[c.stare]) + '</span></div>' +
      '<div class="seo-doua-coloane">' +
      '<form class="seo-form" id="cc-form" novalidate' + (arhivata ? ' inert' : '') + '>' +
      (arhivata ? '<div class="seo-mesaj" style="color:#E0A526">Campania e arhivată. Readuceți-o la ciornă ca s-o editați.</div>' : '') +
      '<div class="seo-camp"><label for="cc-nume_campanie"><span>Numele campaniei *</span></label><input id="cc-nume_campanie" name="nume_campanie" type="text" maxlength="' + R.MAXIM.nume_campanie + '" data-obligatoriu value="' + esc(c.nume_campanie) + '"/></div>' +
      '<div class="seo-camp"><div class="seo-legenda"><span>Limba campaniei</span></div>' +
      '<div class="seo-limba" role="group" aria-label="Limba campaniei">' + ['ro', 'en'].map(function (l) {
        return '<button type="button" data-cc-limba="' + l + '" aria-pressed="' + (c.limba === l) + '"' + (nou ? '' : ' disabled') + '>' + l.toUpperCase() + '</button>';
      }).join('') + '</div>' + (nou ? '' : '<div class="seo-nota">Limba nu se schimbă după creare: folosiți „Duplică pentru ' + alt.toUpperCase() + '”.</div>') + '</div>' +
      '<fieldset class="seo-camp seo-platforme" name="platforme" data-eticheta="Platforme"><legend>Platforme</legend>' + platforme + '</fieldset>' +
      '<div class="seo-camp"><label for="cc-titlu_reclama"><span>Titlul reclamei ' + L + '</span><span class="seo-contor" data-cc-contor="titlu_reclama"></span></label>' +
      '<input id="cc-titlu_reclama" name="titlu_reclama" type="text" maxlength="' + R.MAXIM.titlu_reclama + '" value="' + esc(c.titlu_reclama) + '"/></div>' +
      '<div class="seo-camp"><label for="cc-text_principal"><span>Textul principal ' + L + '</span><span class="seo-contor" data-cc-contor="text_principal"></span></label>' +
      '<textarea id="cc-text_principal" name="text_principal" rows="4" maxlength="' + R.MAXIM.text_principal + '">' + esc(c.text_principal) + '</textarea></div>' +
      '<div class="seo-camp"><label for="cc-descriere_link"><span>Descrierea linkului ' + L + '</span><span class="seo-contor" data-cc-contor="descriere_link"></span></label>' +
      '<input id="cc-descriere_link" name="descriere_link" type="text" maxlength="' + R.MAXIM.descriere_link + '" value="' + esc(c.descriere_link) + '"/></div>' +
      '<div class="seo-camp"><label for="cc-cta"><span>Butonul (CTA)</span></label><select id="cc-cta" name="cta"><option value="">— alegeți —</option>' + cta + '</select></div>' +
      '<div class="seo-camp"><label for="cc-url_destinatie"><span>Linkul de destinație (https://mydarrin.homebestpal.com/…)</span></label>' +
      '<input id="cc-url_destinatie" name="url_destinatie" type="url" inputmode="url" placeholder="https://mydarrin.homebestpal.com' + esc(c.page_path === '/' ? '/' : c.page_path) + '" value="' + esc(c.url_destinatie) + '"/></div>' +
      '<div class="seo-utm">' + inputText('utm_source', 'utm_source', c.utm_source) + inputText('utm_medium', 'utm_medium', c.utm_medium) + inputText('utm_campaign', 'utm_campaign', c.utm_campaign) + inputText('utm_content', 'utm_content', c.utm_content) + '</div>' +
      '<div class="seo-camp"><div class="seo-legenda"><span>Linkul final</span></div><div class="seo-link-final"><code id="cc-link-final"></code>' +
      '<button type="button" class="seo-buton contur" data-act="copiaza">Copiază</button></div></div>' +
      '<div class="seo-camp"><div class="seo-legenda"><span>Materialele</span></div>' +
      (nou ? '<div class="seo-nota">Salvați campania ca să puteți încărca materialele.</div>' : '<div class="seo-media-grila" id="cc-media">' + R.TIPURI_MEDIA.map(function (t) {
        return '<div class="seo-media-card" name="media.' + t + '" data-eticheta="' + esc(R.MEDIA[t].eticheta) + '" data-zona-media="' + t + '"></div>';
      }).join('') + '</div><div class="seo-nota" id="cc-cerute"></div>') + '</div>' +
      '<div class="seo-camp"><label for="cc-stare"><span>Starea</span></label><select id="cc-stare" name="stare"' + (nou ? ' disabled' : '') + '>' +
      ['ciorna', 'activa'].map(function (s) { return '<option value="' + s + '"' + (c.stare === s ? ' selected' : '') + '>' + ETICHETA_STARE[s] + '</option>'; }).join('') + '</select>' +
      '<div class="seo-nota">„Activă” = gata de încărcat manual în platformele de reclame (serverul verifică textele, linkul și materialele platformelor bifate).</div></div>' +
      '<div class="seo-camp"><label for="cc-note_interne"><span>Note interne (nu apar în reclamă)</span></label><textarea id="cc-note_interne" name="note_interne" rows="2" maxlength="' + R.MAXIM.note_interne + '">' + esc(c.note_interne) + '</textarea></div>' +
      '<div class="seo-mesaj" id="cc-msg" role="status"></div>' +
      '</form>' +
      '<aside class="seo-prev" aria-label="Previzualizări simulate">' +
      '<div class="seo-prev-titlu">Previzualizări simulate (desen local, aproximativ)</div>' +
      '<div id="cc-prev"></div></aside></div>' +
      '<div class="seo-actiuni seo-actiuni-cc">' +
      (arhivata
        ? '<button type="button" class="seo-buton principal" data-act="readu">Readu la ciornă</button>'
        : '<button type="button" class="seo-buton principal" data-act="salveaza">Salvează</button>') +
      (nou ? '' : '<button type="button" class="seo-buton contur" data-act="duplica-' + alt + '">Duplică pentru ' + alt.toUpperCase() + '</button>' +
        '<button type="button" class="seo-buton contur" data-act="export">Exportă materialele</button>' +
        (arhivata ? '' : '<button type="button" class="seo-buton" data-act="arhiveaza">Arhivează</button>') +
        (c.stare === 'ciorna' ? '<button type="button" class="seo-buton pericol" data-act="sterge">Șterge ciorna</button>' : '')) +
      '</div>';
  }

  // Valorile formularului peste campania curentă (fără să salveze).
  function dinFormular(form, c) {
    var r = Object.assign({}, c);
    CAMPURI.forEach(function (k) { var el = form.querySelector('[name="' + k + '"]'); if (el) r[k] = el.value; });
    r.platforme = Array.prototype.map.call(form.querySelectorAll('.seo-platforme input:checked'), function (i) { return i.value; });
    var st = form.querySelector('[name="stare"]');
    r.stareAleasa = st ? st.value : c.stare;
    return r;
  }

  function actualizeazaContoare(c, rad) {
    var lp = R.limitePeCamp(c.platforme, C.limite);
    ['titlu_reclama', 'text_principal', 'descriere_link'].forEach(function (k) {
      var el = rad.querySelector('[data-cc-contor="' + k + '"]');
      if (!el) return;
      var n = R.lungime(c[k]);
      if (!lp[k].length) { el.textContent = n + ' caractere' + (c.platforme.length ? ' · fără limită pentru platformele bifate' : ''); el.className = 'seo-contor verde'; return; }
      var cul = 'verde';
      el.textContent = lp[k].map(function (x) {
        var cx = P.culoareContor(n, x.limita);
        if (cx === 'rosu' || (cx === 'galben' && cul === 'verde')) cul = cx;
        return x.platforma + ' ' + n + ' / ' + x.limita;
      }).join(' · ');
      el.className = 'seo-contor ' + cul;
    });
    var link = rad.querySelector('#cc-link-final');
    if (link) {
      var f = R.linkFinal(c);
      link.textContent = f || (c.url_destinatie ? 'Linkul trebuie să fie https://mydarrin.homebestpal.com/…' : '—');
      link.className = f ? '' : 'seo-link-gol';
    }
    var cer = rad.querySelector('#cc-cerute');
    if (cer) {
      var lipsa = R.materialeCerute(c.platforme).filter(function (m) { return !m.oricare.some(function (t) { return c.media && c.media[t] && c.media[t].cale; }); });
      cer.textContent = lipsa.length ? 'Pentru activare lipsesc: ' + lipsa.map(function (m) { return R.ETICHETE_PLATFORME[m.platforma] + ' — ' + m.oricare.map(function (t) { return R.MEDIA[t].eticheta; }).join(' sau '); }).join('; ') + '.' : (c.platforme.length ? 'Materialele platformelor bifate sunt încărcate.' : '');
      rad.querySelectorAll('[data-zona-media]').forEach(function (z) {
        var t = z.getAttribute('data-zona-media');
        // „cerut” doar cât timp cerința platformei nu e acoperită de alt material.
        z.classList.toggle('cerut', lipsa.some(function (m) { return m.oricare.indexOf(t) !== -1; }));
      });
    }
  }

  // ── Previzualizările simulate ─────────────────────────────────────────
  function mediaHtml(tip, cls) {
    var m = C.curent && C.curent.media && C.curent.media[tip];
    var u = C.media_urls[tip] && C.media_urls[tip].url;
    if (!m || !u) return '';
    return R.MEDIA[tip].tip === 'video'
      ? '<video class="' + cls + '" src="' + esc(u) + '" muted loop playsinline autoplay></video>'
      : '<img class="' + cls + '" src="' + esc(u) + '" alt=""/>';
  }
  function prevHtml(c) {
    var cta = R.ETICHETE_CTA[c.cta] ? R.ETICHETE_CTA[c.cta][c.limba === 'en' ? 'en' : 'ro'] : (c.limba === 'en' ? 'Learn more' : 'Află mai multe');
    var ctaReal = !!R.ETICHETE_CTA[c.cta];
    var sponsor = c.limba === 'en' ? 'Sponsored' : 'Sponsorizat';
    var text = c.text_principal || '';
    var lim = C.limite.meta_text || 125;
    var textMeta = R.lungime(text) > lim ? Array.from(text).slice(0, lim).join('') + '… ' + (c.limba === 'en' ? 'See more' : 'Vezi mai mult') : text;
    var feed = mediaHtml('imagine_patrat', 'sim-media') || mediaHtml('imagine_feed_4x5', 'sim-media') || mediaHtml('video_vertical', 'sim-media') || mediaHtml('video_orizontal', 'sim-media');
    var raportFeed = mediaHtml('imagine_patrat', 'x') ? '1/1' : (mediaHtml('imagine_feed_4x5', 'x') ? '4/5' : (mediaHtml('video_vertical', 'x') ? '4/5' : (mediaHtml('video_orizontal', 'x') ? '16/9' : '1/1')));
    var gol = function (t) { return '<span class="sim-gol">' + t + '</span>'; };
    var dom = 'mydarrin.homebestpal.com';
    return '<div class="seo-prev-grup"><div class="seo-prev-eticheta">Feed Meta (Facebook / Instagram)</div>' +
      '<div class="seo-sim sim-meta"><div class="sim-cap"><span class="sim-avatar">MD</span><div><strong>My Darrin</strong><br/><small>' + sponsor + '</small></div></div>' +
      '<div class="sim-text">' + (textMeta ? esc(textMeta) : gol('Textul principal')) + '</div>' +
      '<div class="sim-cutie" style="aspect-ratio:' + raportFeed + '">' + (feed || gol('Pătrat 1:1 / Feed 4:5 / video')) + '</div>' +
      '<div class="sim-bara"><div class="sim-bara-text"><small>' + dom.toUpperCase() + '</small><strong>' + (c.titlu_reclama ? esc(c.titlu_reclama) : gol('Titlul reclamei')) + '</strong>' +
      (c.descriere_link ? '<small>' + esc(c.descriere_link) + '</small>' : '') + '</div><span class="sim-cta' + (ctaReal ? '' : ' gol') + '">' + esc(cta) + '</span></div></div></div>' +
      '<div class="seo-prev-grup"><div class="seo-prev-eticheta">Ecran vertical (TikTok / Reels / Shorts)</div>' +
      '<div class="seo-sim sim-vertical"><div class="sim-cutie" style="aspect-ratio:9/16">' + (mediaHtml('video_vertical', 'sim-media') || gol('Vertical 9:16')) +
      '<div class="sim-ui-dreapta" aria-hidden="true"><span>♥</span><span>💬</span><span>↗</span></div>' +
      '<div class="sim-ui-jos"><strong>@mydarrin · ' + sponsor + '</strong><div class="sim-text-v">' + (text ? esc(text) : '') + '</div><span class="sim-cta' + (ctaReal ? '' : ' gol') + '">' + esc(cta) + '</span></div>' +
      '<div class="seo-zona-sigura" aria-hidden="true"><span class="sus"></span><span class="jos"></span></div></div></div></div>' +
      '<div class="seo-prev-grup"><div class="seo-prev-eticheta">Player 16:9 (YouTube)</div>' +
      '<div class="seo-sim sim-player"><div class="sim-cutie" style="aspect-ratio:16/9">' + (mediaHtml('video_orizontal', 'sim-media') || mediaHtml('miniatura_video', 'sim-media') || gol('Orizontal 16:9')) +
      '<span class="sim-cta sim-cta-player' + (ctaReal ? '' : ' gol') + '">' + esc(cta) + '</span></div>' +
      '<div class="sim-titlu-player">' + (c.titlu_reclama ? esc(c.titlu_reclama) : gol('Titlul reclamei')) + '</div><small>' + dom + '</small></div></div>';
  }

  // ── Desenarea tabului ─────────────────────────────────────────────────
  function deseneaza(rad, S) {
    if (!C.curent) {
      rad.innerHTML = listaHtml();
      rad.querySelector('[data-act="noua"]').addEventListener('click', function () { C.curent = campanieNoua(S); C.media_urls = {}; deseneaza(rad, S); });
      rad.querySelectorAll('[data-deschide]').forEach(function (b) {
        b.addEventListener('click', function () { deschide(rad, S, b.getAttribute('data-deschide'), b); });
      });
      return;
    }
    var c = C.curent;
    rad.innerHTML = formHtml(c);
    var form = rad.querySelector('#cc-form');
    var msg = rad.querySelector('#cc-msg');
    var refa = function () {
      var v = dinFormular(form, c);
      actualizeazaContoare(v, rad);
      rad.querySelector('#cc-prev').innerHTML = prevHtml(v);
    };
    form.addEventListener('input', refa);
    form.addEventListener('change', refa);
    rad.querySelectorAll('[data-cc-limba]').forEach(function (b) {
      b.addEventListener('click', function () {
        C.curent = Object.assign(dinFormular(form, c), { limba: b.getAttribute('data-cc-limba') });
        deseneaza(rad, S);
      });
    });
    if (c.id) {
      rad.querySelectorAll('[data-zona-media]').forEach(function (z) {
        var tip = z.getAttribute('data-zona-media');
        window.SeoMedia.zonaCampanie(z, {
          campanie: c, tip: tip, url: C.media_urls[tip] && C.media_urls[tip].url, poateScrie: C.poateScrie,
          laSchimbare: function (campanie, urls, t, text) {
            var ciorna = dinFormular(form, c);
            C.curent = Object.assign({}, campanie, pastreazaCampuri(ciorna));
            C.media_urls = urls || {};
            actualizeazaInLista(campanie);
            deseneaza(rad, S);
            var zn = rad.querySelector('[data-zona-media="' + t + '"] .seo-media-msg');
            if (zn && text) window.MDFeedback.mesaj(zn, 'ok', text);
          },
        });
      });
    }
    var act = function (nume) { return rad.querySelector('[data-act="' + nume + '"]'); };
    act('inapoi').addEventListener('click', function () { C.curent = null; deseneaza(rad, S); });
    act('copiaza').addEventListener('click', async function () {
      var f = R.linkFinal(dinFormular(form, c));
      if (!f) { window.MDFeedback.mesaj(msg, 'eroare', 'Completați un link de destinație valid (https://mydarrin.homebestpal.com/…).'); return; }
      try { await navigator.clipboard.writeText(f); window.MDFeedback.toast('succes', 'Linkul final a fost copiat.'); }
      catch (e) { window.MDFeedback.toast('eroare', 'Nu am putut copia automat. Selectați linkul și copiați-l manual.'); }
    });
    if (act('salveaza')) act('salveaza').addEventListener('click', function () { salveaza(rad, S, form, act('salveaza'), msg); });
    if (act('readu')) act('readu').addEventListener('click', function () { schimbaStare(rad, S, act('readu'), msg, 'ciorna', 'Campania a revenit la ciornă.'); });
    if (act('arhiveaza')) act('arhiveaza').addEventListener('click', async function () {
      if (!(await window.MDFeedback.confirma('Arhivezi campania „' + c.nume_campanie + '”? Rămâne în listă, dar nu se mai editează până o readuceți la ciornă.', { textOk: 'Arhivează', textAnulare: 'Anulează' }))) return;
      schimbaStare(rad, S, act('arhiveaza'), msg, 'arhivata', 'Campania a fost arhivată.');
    });
    ['duplica-en', 'duplica-ro'].forEach(function (n) {
      var b = act(n);
      if (b) b.addEventListener('click', function () { duplica(rad, S, b, msg, n.slice(-2)); });
    });
    if (act('export')) act('export').addEventListener('click', function () { exporta(act('export'), msg, c); });
    if (act('sterge')) act('sterge').addEventListener('click', async function () {
      if (!(await window.MDFeedback.confirma('Ștergi definitiv ciorna „' + c.nume_campanie + '” și materialele ei?', { textOk: 'Șterge', textAnulare: 'Anulează', periculos: true }))) return;
      var r = await window.MDFeedback.salveaza(act('sterge'), msg, async function () {
        await api('/api/admin/seo-campanii', { method: 'POST', body: { actiune: 'sterge', id: c.id } });
        return 'Ciorna a fost ștearsă.';
      }, { textSalveaza: 'Se șterge…', textOk: '✓ Șters' });
      if (r.ok) { C.lista = C.lista.filter(function (x) { return x.id !== c.id; }); C.curent = null; deseneaza(rad, S); window.MDFeedback.toast('succes', 'Ciorna a fost ștearsă.'); }
    });
    if (!C.poateScrie) rad.querySelectorAll('[data-act="salveaza"],[data-act="readu"],[data-act="arhiveaza"],[data-act^="duplica"],[data-act="sterge"]').forEach(function (b) { b.disabled = true; });
    refa();
  }

  function pastreazaCampuri(v) {
    var r = {};
    CAMPURI.forEach(function (k) { r[k] = v[k]; });
    r.platforme = v.platforme;
    return r;
  }
  function actualizeazaInLista(campanie) {
    if (!C.lista) return;
    var i = C.lista.findIndex(function (x) { return x.id === campanie.id; });
    if (i === -1) C.lista.unshift(campanie); else C.lista[i] = Object.assign({}, C.lista[i], campanie);
  }

  async function deschide(rad, S, id, buton) {
    var text = buton.textContent;
    buton.disabled = true;
    buton.textContent = 'Se deschide…';
    try {
      var j = await api('/api/admin/seo-campanii?id=' + encodeURIComponent(id));
      C.curent = j.campanie;
      C.media_urls = j.media_urls || {};
      if (j.limite) C.limite = Object.assign({}, R.LIMITE_IMPLICITE, j.limite);
      deseneaza(rad, S);
    } catch (e) {
      buton.disabled = false;
      buton.textContent = text;
      window.MDFeedback.toast('eroare', 'Campania nu s-a putut deschide: ' + e.message);
    }
  }

  async function salveaza(rad, S, form, buton, msg) {
    var c = C.curent;
    var v = dinFormular(form, c);
    var corp = pastreazaCampuri(v);
    corp.cta = corp.cta || null;
    var salvata = null;
    var r = await window.MDFeedback.salveaza(buton, msg, async function () {
      var j;
      if (!c.id) j = await api('/api/admin/seo-campanii', { method: 'POST', body: Object.assign({ actiune: 'creeaza', page_path: c.page_path, limba: c.limba }, corp) });
      else j = await api('/api/admin/seo-campanii', { method: 'POST', body: Object.assign({ actiune: 'salveaza', id: c.id }, corp) });
      salvata = j.campanie;
      // Starea se schimbă după salvarea câmpurilor (serverul verifică materialele la activare).
      if (c.id && v.stareAleasa && v.stareAleasa !== salvata.stare) {
        var s = await api('/api/admin/seo-campanii', { method: 'POST', body: { actiune: 'stare', id: c.id, stare: v.stareAleasa } });
        salvata = s.campanie;
      }
      return c.id ? 'Campania a fost salvată' + (salvata.stare === 'activa' ? ' (activă).' : '.') : 'Campania a fost creată. Acum puteți încărca materialele.';
    }, { form: form });
    if (salvata) {
      C.curent = salvata;
      actualizeazaInLista(salvata);
    }
    if (r.ok) {
      deseneaza(rad, S);
      window.MDFeedback.mesaj(rad.querySelector('#cc-msg'), 'ok', r.rezultat);
    } else if (salvata) {
      // Câmpurile s-au salvat, dar activarea a fost refuzată: formularul rămâne cu
      // valorile introduse, iar erorile marcate (MDFeedback, opțiunea form).
      C.curent = Object.assign({}, salvata, pastreazaCampuri(v));
    }
  }
  // Erorile pe materiale (media.<tip>) se marchează pe cardul materialului.
  function marcheazaMedia(rad, r) {
    var campuri = r && r.eroare && r.eroare.campuri;
    if (!campuri || !campuri.length) return;
    var form = rad.querySelector('#cc-form');
    if (form) window.MDFeedback.aplicaErori(form, campuri);
  }

  async function schimbaStare(rad, S, buton, msg, stare, textOk) {
    var c = C.curent;
    var r = await window.MDFeedback.salveaza(buton, msg, async function () {
      var j = await api('/api/admin/seo-campanii', { method: 'POST', body: { actiune: 'stare', id: c.id, stare: stare } });
      C.curent = j.campanie;
      actualizeazaInLista(j.campanie);
      return textOk;
    });
    if (r.ok) { deseneaza(rad, S); window.MDFeedback.mesaj(rad.querySelector('#cc-msg'), 'ok', textOk); }
    else marcheazaMedia(rad, r);
  }

  async function duplica(rad, S, buton, msg, limba) {
    var c = C.curent;
    var noua = null;
    var r = await window.MDFeedback.salveaza(buton, msg, async function () {
      var j = await api('/api/admin/seo-campanii', { method: 'POST', body: { actiune: 'duplica', id: c.id, limba: limba } });
      noua = j.campanie;
      return 'Ciorna „' + noua.nume_campanie + '” a fost creată' + (limba !== c.limba ? ': textele sunt goale, de tradus; materialele se încarcă separat.' : '.');
    }, { textSalveaza: 'Se duplică…', textOk: '✓ Duplicat' });
    if (r.ok) {
      actualizeazaInLista(noua);
      C.curent = noua;
      C.media_urls = {};
      deseneaza(rad, S);
      window.MDFeedback.mesaj(rad.querySelector('#cc-msg'), 'ok', r.rezultat);
    }
  }

  // ── Exportul: .zip „stored” (fără comprimare; materialele sunt deja comprimate) ──
  var CRC = null;
  function crc32(b) {
    if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var x = n; for (var k = 0; k < 8; k++) x = x & 1 ? 0xEDB88320 ^ (x >>> 1) : x >>> 1; CRC[n] = x >>> 0; } }
    var c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(fisiere) {
    var enc = new TextEncoder();
    var parti = [], central = [], pozitie = 0;
    var acum = new Date();
    var ora = (acum.getHours() << 11) | (acum.getMinutes() << 5) | (acum.getSeconds() >> 1);
    var zi = ((acum.getFullYear() - 1980) << 9) | ((acum.getMonth() + 1) << 5) | acum.getDate();
    fisiere.forEach(function (f) {
      var nume = enc.encode(f.nume);
      var crc = crc32(f.date);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, ora, true); h.setUint16(12, zi, true); h.setUint32(14, crc, true);
      h.setUint32(18, f.date.length, true); h.setUint32(22, f.date.length, true); h.setUint16(26, nume.length, true); h.setUint16(28, 0, true);
      var d = new DataView(new ArrayBuffer(46));
      d.setUint32(0, 0x02014B50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true); d.setUint16(10, 0, true);
      d.setUint16(12, ora, true); d.setUint16(14, zi, true); d.setUint32(16, crc, true); d.setUint32(20, f.date.length, true); d.setUint32(24, f.date.length, true);
      d.setUint16(28, nume.length, true); d.setUint32(42, pozitie, true);
      parti.push(new Uint8Array(h.buffer), nume, f.date);
      central.push(new Uint8Array(d.buffer), nume);
      pozitie += 30 + nume.length + f.date.length;
    });
    var marimeCentral = central.reduce(function (s, x) { return s + x.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054B50, true); e.setUint16(8, fisiere.length, true); e.setUint16(10, fisiere.length, true);
    e.setUint32(12, marimeCentral, true); e.setUint32(16, pozitie, true);
    return new Blob(parti.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  }
  async function exporta(buton, msg, c) {
    var arhiva = null;
    await window.MDFeedback.salveaza(buton, msg, async function () {
      var j = await api('/api/admin/seo-campanii?export=1&id=' + encodeURIComponent(c.id));
      var ex = j.export;
      var fisiere = [{ nume: ex.txt.nume, date: new TextEncoder().encode(ex.txt.continut) }];
      for (var i = 0; i < ex.fisiere.length; i++) {
        buton.textContent = 'Se descarcă ' + (i + 1) + ' / ' + ex.fisiere.length + '…';
        var rf = await fetch(ex.fisiere[i].url);
        if (!rf.ok) throw new Error('Materialul ' + ex.fisiere[i].nume + ' nu s-a putut descărca (HTTP ' + rf.status + '). Reîncercați.');
        fisiere.push({ nume: ex.fisiere[i].nume, date: new Uint8Array(await rf.arrayBuffer()) });
      }
      arhiva = { blob: zip(fisiere), nume: ex.nume_arhiva };
      return 'Arhiva ' + ex.nume_arhiva + ' (' + fisiere.length + ' fișiere) e gata de descărcat.';
    }, { textSalveaza: 'Se pregătește…', textOk: '✓ Exportat', timeout: 10 * 60 * 1000 });
    if (!arhiva) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(arhiva.blob);
    a.download = arhiva.nume;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  P.TABURI.push({
    id: 'campanii', titlu: 'Social media & campanii',
    randeaza: async function (rad, S) {
      if (C.pagina !== S.cale || C.lista == null) {
        C.curent = null;
        rad.innerHTML = '<div class="seo-gol">Se încarcă campaniile…</div>';
        await incarcaLista(S);
        if (P.S.tab !== 'campanii' || P.S.cale !== S.cale) return;
      }
      deseneaza(rad, S);
    },
    laIesire: function () { /* campania deschisă rămâne pentru revenirea în tab */ },
  });
  var inchideVechi = P.inchide;
  P.inchide = function () { C.pagina = null; C.lista = null; C.curent = null; inchideVechi(); };

  P.campanii = { C: C, zip: zip, crc32: crc32, prevHtml: prevHtml };
})();

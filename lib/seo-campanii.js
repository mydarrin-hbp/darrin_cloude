// lib/seo-campanii.js
// Regulile campaniilor social media (pasul 11-S, 23 oct. 2026), comune
// serverului (api/admin/seo-campanii.js) și panoului (seo-panou-campanii.js,
// încărcat ca /lib/seo-campanii.js): platformele, CTA-urile, materialele și
// rapoartele lor, limitele de text, validarea, linkul final cu UTM.
//
// Pasul NU publică reclame și nu se leagă de conturile Meta / TikTok / Google:
// pregătește și păstrează materialele, pe care LM le descarcă și le încarcă
// manual în Ads Manager / TikTok Ads / Google Ads.

(function (radacina, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else radacina.SeoCampaniiReguli = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PLATFORME = ['facebook', 'instagram', 'tiktok', 'youtube', 'general_patrat', 'vertical_mobil'];
  var ETICHETE_PLATFORME = {
    facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube',
    general_patrat: 'General pătrat', vertical_mobil: 'Vertical mobil',
  };
  var CTA = ['afla_mai_multe', 'inscrie_te', 'contacteaza_ne', 'programeaza', 'cere_oferta', 'cumpara', 'descarca'];
  var ETICHETE_CTA = {
    afla_mai_multe: { ro: 'Află mai multe', en: 'Learn more' },
    inscrie_te: { ro: 'Înscrie-te', en: 'Sign up' },
    contacteaza_ne: { ro: 'Contactează-ne', en: 'Contact us' },
    programeaza: { ro: 'Programează', en: 'Book now' },
    cere_oferta: { ro: 'Cere ofertă', en: 'Get quote' },
    cumpara: { ro: 'Cumpără', en: 'Shop now' },
    descarca: { ro: 'Descarcă', en: 'Download' },
  };
  var STARI = ['ciorna', 'activa', 'arhivata'];
  var LIMBI = ['ro', 'en'];

  // Doar domeniul public al platformei (nu back-office-ul admin.*).
  var DOMENII = ['mydarrin.homebestpal.com'];

  var MB = 1024 * 1024;
  var MIME_IMAGINE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  var MIME_VIDEO = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  var MARIME_IMAGINE = 5 * MB;
  var MARIME_VIDEO = 50 * MB;
  var TOLERANTA = 0.02;   // 2 % la raport

  // Materialele: raportul (lățime / înălțime), dimensiunea minimă acceptată și cea recomandată.
  var MEDIA = {
    imagine_patrat: { tip: 'imagine', eticheta: 'Pătrat 1:1', rost: 'Facebook / Instagram feed', rapoarte: [[1, 1]], minim: [[1080, 1080]] },
    imagine_feed_4x5: { tip: 'imagine', eticheta: 'Feed 4:5', rost: 'Facebook / Instagram feed', rapoarte: [[4, 5]], minim: [[1080, 1350]] },
    imagine_link_1_91: { tip: 'imagine', eticheta: 'Link 1,91:1', rost: 'Facebook / LinkedIn link', rapoarte: [[1.91, 1]], minim: [[1200, 630]] },
    video_vertical: { tip: 'video', eticheta: 'Vertical 9:16', rost: 'TikTok / Reels / Shorts / Stories', rapoarte: [[9, 16]], minim: [[720, 1280]], recomandat: [[1080, 1920]] },
    video_orizontal: { tip: 'video', eticheta: 'Orizontal 16:9', rost: 'YouTube', rapoarte: [[16, 9]], minim: [[1280, 720]] },
    miniatura_video: { tip: 'imagine', eticheta: 'Miniatură video', rost: '16:9 (YouTube) sau 9:16', rapoarte: [[16, 9], [9, 16]], minim: [[1280, 720], [720, 1280]] },
  };
  var TIPURI_MEDIA = Object.keys(MEDIA);
  // Imaginea de partajare a paginii (OG, bucket-ul public seo-og).
  var MEDIA_OG = { tip: 'imagine', eticheta: 'Partajare 1,91:1', rost: 'Facebook / LinkedIn / WhatsApp', rapoarte: [[1.91, 1]], minim: [[1200, 630]] };
  function spec(tip) { return tip && typeof tip === 'object' ? tip : (tip === 'og' ? MEDIA_OG : MEDIA[tip]); }

  // Limitele implicite (orientative, de confirmat de LM; suprascrise din
  // backoffice_config, cheile campanii_limite_*). YouTube: fără limită implicită.
  var LIMITE_IMPLICITE = { meta_titlu: 40, meta_text: 125, meta_descriere: 30, tiktok_text: 100 };
  // Plafoane absolute (orice platformă).
  var MAXIM = { nume_campanie: 120, titlu_reclama: 255, text_principal: 2200, descriere_link: 255, url_destinatie: 2000, utm: 100, note_interne: 2000 };

  // Limita fiecărui câmp pe platformele bifate: [{ platforma, limita }].
  function limitePeCamp(platforme, limite) {
    var L = Object.assign({}, LIMITE_IMPLICITE, limite || {});
    var p = Array.isArray(platforme) ? platforme : [];
    var meta = p.indexOf('facebook') !== -1 || p.indexOf('instagram') !== -1;
    var r = { titlu_reclama: [], text_principal: [], descriere_link: [] };
    if (meta) {
      r.titlu_reclama.push({ platforma: 'Meta', limita: L.meta_titlu });
      r.text_principal.push({ platforma: 'Meta', limita: L.meta_text });
      r.descriere_link.push({ platforma: 'Meta', limita: L.meta_descriere });
    }
    if (p.indexOf('tiktok') !== -1) r.text_principal.push({ platforma: 'TikTok', limita: L.tiktok_text });
    Object.keys(r).forEach(function (k) { r[k] = r[k].filter(function (x) { return x.limita > 0; }); });
    return r;
  }

  function lungime(s) { return Array.from(String(s == null ? '' : s)).length; }

  // Materialele cerute de platformele bifate: [{ platforma, oricare: [tipuri] }].
  function materialeCerute(platforme) {
    var p = Array.isArray(platforme) ? platforme : [];
    var r = [];
    if (p.indexOf('tiktok') !== -1) r.push({ platforma: 'tiktok', oricare: ['video_vertical'] });
    if (p.indexOf('youtube') !== -1) r.push({ platforma: 'youtube', oricare: ['video_orizontal', 'video_vertical'] });
    ['facebook', 'instagram'].forEach(function (x) {
      if (p.indexOf(x) !== -1) r.push({ platforma: x, oricare: ['imagine_patrat', 'imagine_feed_4x5', 'video_vertical', 'video_orizontal'] });
    });
    if (p.indexOf('general_patrat') !== -1) r.push({ platforma: 'general_patrat', oricare: ['imagine_patrat'] });
    if (p.indexOf('vertical_mobil') !== -1) r.push({ platforma: 'vertical_mobil', oricare: ['video_vertical'] });
    return r;
  }

  function urlPermis(v) {
    try {
      var u = new URL(String(v));
      return u.protocol === 'https:' && DOMENII.indexOf(u.hostname.toLowerCase()) !== -1 && !u.username && !u.password;
    } catch (e) { return false; }
  }

  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  function linkFinal(c) {
    if (!c || !c.url_destinatie || !urlPermis(c.url_destinatie)) return '';
    var u = new URL(c.url_destinatie);
    UTM.forEach(function (k) { if (c[k]) u.searchParams.set(k, String(c[k]).trim()); });
    return u.toString();
  }

  function eroare(campNume, ro, en) { return { camp: campNume, ro: ro, en: en }; }

  // Validarea campaniei. optiuni.activare = true: și completitudinea cerută
  // pentru starea „activă” (platforme, texte, CTA, URL, materialele platformelor).
  function valideaza(c, limite, optiuni) {
    var o = optiuni || {};
    var e = [];
    var nume = String(c.nume_campanie == null ? '' : c.nume_campanie).trim();
    if (!nume) e.push(eroare('nume_campanie', 'Completați numele campaniei.', 'Fill in the campaign name.'));
    else if (lungime(nume) > MAXIM.nume_campanie) e.push(eroare('nume_campanie', 'Numele are cel mult ' + MAXIM.nume_campanie + ' de caractere.', 'The name has at most ' + MAXIM.nume_campanie + ' characters.'));
    if (LIMBI.indexOf(c.limba) === -1) e.push(eroare('limba', 'Alegeți limba RO sau EN.', 'Choose RO or EN.'));
    var p = c.platforme;
    if (!Array.isArray(p) || p.some(function (x) { return PLATFORME.indexOf(x) === -1; })) {
      e.push(eroare('platforme', 'Alegeți platformele din listă.', 'Choose the platforms from the list.'));
      p = [];
    }
    if (c.cta != null && c.cta !== '' && CTA.indexOf(c.cta) === -1) e.push(eroare('cta', 'Alegeți butonul (CTA) din listă.', 'Choose the call-to-action button from the list.'));
    if (c.stare != null && STARI.indexOf(c.stare) === -1) e.push(eroare('stare', 'Starea e „ciornă”, „activă” sau „arhivată”.', 'The status is “draft”, “active” or “archived”.'));

    var lp = limitePeCamp(p, limite);
    ['titlu_reclama', 'text_principal', 'descriere_link'].forEach(function (k) {
      var n = lungime(c[k]);
      if (n > MAXIM[k]) { e.push(eroare(k, 'Textul are cel mult ' + MAXIM[k] + ' de caractere.', 'The text has at most ' + MAXIM[k] + ' characters.')); return; }
      var depasite = lp[k].filter(function (x) { return n > x.limita; });
      if (depasite.length) {
        var d = depasite.map(function (x) { return x.platforma + ' ' + x.limita; }).join(', ');
        e.push(eroare(k, 'Textul are ' + n + ' de caractere; limita pentru platformele bifate: ' + d + '. Scurtați-l.', 'The text has ' + n + ' characters; the limit for the ticked platforms: ' + d + '. Shorten it.'));
      }
    });

    if (c.url_destinatie) {
      if (lungime(c.url_destinatie) > MAXIM.url_destinatie || !urlPermis(c.url_destinatie)) {
        e.push(eroare('url_destinatie', 'Linkul trebuie să înceapă cu https:// și să fie pe ' + DOMENII.join(', ') + '.', 'The link must start with https:// and be on ' + DOMENII.join(', ') + '.'));
      }
    }
    UTM.forEach(function (k) {
      var v = c[k] == null ? '' : String(c[k]);
      if (!v) return;
      if (/\s/.test(v)) e.push(eroare(k, 'Fără spații: folosiți „-” sau „_”.', 'No spaces: use “-” or “_”.'));
      else if (lungime(v) > MAXIM.utm) e.push(eroare(k, 'Cel mult ' + MAXIM.utm + ' de caractere.', 'At most ' + MAXIM.utm + ' characters.'));
      else if (/[?&#=]/.test(v)) e.push(eroare(k, 'Fără ? & # =.', 'No ? & # =.'));
    });
    if (lungime(c.note_interne) > MAXIM.note_interne) e.push(eroare('note_interne', 'Notele au cel mult ' + MAXIM.note_interne + ' de caractere.', 'The notes have at most ' + MAXIM.note_interne + ' characters.'));

    if (o.activare) {
      if (!p.length) e.push(eroare('platforme', 'Bifați cel puțin o platformă înainte de activare.', 'Tick at least one platform before activating.'));
      if (!String(c.titlu_reclama || '').trim() && !String(c.text_principal || '').trim()) e.push(eroare('text_principal', 'Completați titlul sau textul principal înainte de activare.', 'Fill in the headline or the primary text before activating.'));
      if (!c.cta) e.push(eroare('cta', 'Alegeți butonul (CTA) înainte de activare.', 'Choose the call-to-action button before activating.'));
      if (!c.url_destinatie) e.push(eroare('url_destinatie', 'Completați linkul de destinație înainte de activare.', 'Fill in the destination link before activating.'));
      var media = c.media && typeof c.media === 'object' ? c.media : {};
      materialeCerute(p).forEach(function (m) {
        if (!m.oricare.some(function (t) { return media[t] && media[t].cale; })) {
          var et = m.oricare.map(function (t) { return MEDIA[t].eticheta; }).join(' sau ');
          e.push(eroare('media.' + m.oricare[0], ETICHETE_PLATFORME[m.platforma] + ' cere materialul: ' + et + '. Încărcați-l înainte de activare.',
            ETICHETE_PLATFORME[m.platforma] + ' needs the asset: ' + et + '. Upload it before activating.'));
        }
      });
    }
    return e;
  }

  // Raportul lățime / înălțime față de cel cerut, cu toleranța de 2 %.
  function raportPotrivit(latime, inaltime, tip) {
    var m = spec(tip);
    if (!m || !(latime > 0) || !(inaltime > 0)) return -1;
    var r = latime / inaltime;
    for (var i = 0; i < m.rapoarte.length; i++) {
      var tinta = m.rapoarte[i][0] / m.rapoarte[i][1];
      if (Math.abs(r - tinta) / tinta <= TOLERANTA) return i;
    }
    return -1;
  }

  // Verificarea dimensiunilor unui material: { ok, ro, en, avertisment? }.
  function verificaDimensiuni(tip, latime, inaltime) {
    var m = spec(tip);
    if (!m) return { ok: false, ro: 'Tip de material necunoscut.', en: 'Unknown asset type.' };
    var i = raportPotrivit(latime, inaltime, tip);
    if (i === -1) {
      var cerut = m.rapoarte.map(function (r) { return String(r[0]).replace('.', ',') + ':' + r[1]; }).join(' sau ');
      return { ok: false, ro: 'Raportul ' + latime + ' × ' + inaltime + ' nu e ' + cerut + ' (toleranță 2 %). Decupați materialul la ' + cerut + '.',
        en: 'The ratio ' + latime + ' × ' + inaltime + ' is not ' + cerut.replace(/,/g, '.') + ' (2 % tolerance). Crop the asset to ' + cerut.replace(/,/g, '.') + '.' };
    }
    var min = m.minim[i];
    if (latime < min[0] || inaltime < min[1]) {
      return { ok: false, ro: 'Rezoluția ' + latime + ' × ' + inaltime + ' e prea mică: minimum ' + min[0] + ' × ' + min[1] + '. Exportați din nou la cel puțin ' + min[0] + ' × ' + min[1] + '.',
        en: 'The resolution ' + latime + ' × ' + inaltime + ' is too low: at least ' + min[0] + ' × ' + min[1] + '. Export again at ' + min[0] + ' × ' + min[1] + ' or more.' };
    }
    var rec = m.recomandat && m.recomandat[i];
    if (rec && (latime < rec[0] || inaltime < rec[1])) {
      return { ok: true, avertisment: { ro: 'Acceptat; recomandat ' + rec[0] + ' × ' + rec[1] + '.', en: 'Accepted; ' + rec[0] + ' × ' + rec[1] + ' recommended.' } };
    }
    return { ok: true };
  }

  function mimePermis(tip, mime) {
    var m = spec(tip);
    if (!m) return null;
    return (m.tip === 'video' ? MIME_VIDEO : MIME_IMAGINE)[mime] || null;
  }
  function marimeMaxima(tip) { var m = spec(tip); return m && m.tip === 'video' ? MARIME_VIDEO : MARIME_IMAGINE; }

  return {
    PLATFORME: PLATFORME, ETICHETE_PLATFORME: ETICHETE_PLATFORME, CTA: CTA, ETICHETE_CTA: ETICHETE_CTA, STARI: STARI, LIMBI: LIMBI,
    DOMENII: DOMENII, MEDIA: MEDIA, MEDIA_OG: MEDIA_OG, TIPURI_MEDIA: TIPURI_MEDIA, spec: spec, MIME_IMAGINE: MIME_IMAGINE, MIME_VIDEO: MIME_VIDEO,
    MARIME_IMAGINE: MARIME_IMAGINE, MARIME_VIDEO: MARIME_VIDEO, TOLERANTA: TOLERANTA, LIMITE_IMPLICITE: LIMITE_IMPLICITE, MAXIM: MAXIM, UTM: UTM,
    limitePeCamp: limitePeCamp, lungime: lungime, materialeCerute: materialeCerute, urlPermis: urlPermis, linkFinal: linkFinal,
    valideaza: valideaza, raportPotrivit: raportPotrivit, verificaDimensiuni: verificaDimensiuni, mimePermis: mimePermis, marimeMaxima: marimeMaxima,
  };
});

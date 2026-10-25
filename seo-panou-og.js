// seo-panou-og.js
// Tabul „Partajare (OG)” din editorul SEO (seo-panou.js; pasul 11-S, 23 oct. 2026).
// Titlul, descrierea și imaginea 1,91:1 pe care le văd Facebook, LinkedIn,
// WhatsApp, TikTok și X când cineva partajează linkul paginii — scrise de
// middleware.js direct în HTML, pentru roboți (nu rulează JavaScript).
// Previzualizarea e desenată local, din câmpuri; rezultatul real îl arată
// instrumentele oficiale (Facebook Sharing Debugger, LinkedIn Post Inspector).
// Încărcarea imaginii: seo-panou-media.js (direct în bucket-ul public seo-og).

(function () {
  'use strict';
  var P = window.SeoPanou;
  if (!P) return;
  var esc = P.esc;
  var SITE = 'https://mydarrin.homebestpal.com';
  // Lungimi orientative ale cardului (Facebook taie titlul pe la ~60–65 de caractere).
  var ORIENTATIV = { og_titlu: 60, og_descriere: 160 };

  function urlPagina(S) {
    return SITE + (S.cale === '/' ? '/' : S.cale) + (S.limba === 'en' ? '?lang=en' : '');
  }
  function valoare(S, c) {
    var d = S.date[S.limba];
    if (c === 'titlu') return d.og_titlu || d.meta_title || '';
    if (c === 'descriere') return d.og_descriere || d.meta_description || '';
    return d[c] || '';
  }

  function cardHtml(S, stil) {
    var img = valoare(S, 'og_imagine_url');
    var titlu = valoare(S, 'titlu') || '(titlul static al paginii)';
    var desc = valoare(S, 'descriere');
    var domeniu = 'mydarrin.homebestpal.com';
    return '<figure class="seo-card seo-card-' + stil + '">' +
      '<div class="seo-card-img">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(valoare(S, 'og_imagine_alt')) + '"/>' : '<span>Fără imagine OG — rămâne imaginea statică a paginii</span>') + '</div>' +
      '<figcaption class="seo-card-text">' +
      (stil === 'facebook' ? '<div class="seo-card-dom">' + domeniu.toUpperCase() + '</div>' : '') +
      '<div class="seo-card-titlu">' + esc(titlu) + '</div>' +
      (stil !== 'linkedin' && desc ? '<div class="seo-card-desc">' + esc(desc) + '</div>' : '') +
      (stil !== 'facebook' ? '<div class="seo-card-dom">' + domeniu + '</div>' : '') +
      '</figcaption></figure>';
  }

  function deseneazaPrevizualizare(c, S) {
    var z = c.querySelector('#seo-og-prev');
    if (!z) return;
    z.innerHTML =
      '<div class="seo-prev-grup"><div class="seo-prev-eticheta">Facebook</div>' + cardHtml(S, 'facebook') + '</div>' +
      '<div class="seo-prev-grup"><div class="seo-prev-eticheta">LinkedIn</div>' + cardHtml(S, 'linkedin') + '</div>' +
      '<div class="seo-prev-grup"><div class="seo-prev-eticheta">WhatsApp</div>' + cardHtml(S, 'whatsapp') + '</div>';
  }

  P.TABURI.push({
    id: 'og', titlu: 'Partajare (OG)',
    randeaza: function (c, S) {
      var d = S.date[S.limba];
      var L = S.limba.toUpperCase();
      var url = urlPagina(S);
      c.innerHTML = P.limbaHtml('og') +
        '<div class="seo-doua-coloane">' +
        '<form class="seo-form" novalidate>' +
        '<div class="seo-camp"><label for="seo-og-titlu"><span>Titlu la partajare ' + L + ' (gol = titlul SEO)</span><span class="seo-contor" data-contor="og_titlu"></span></label>' +
        '<input id="seo-og-titlu" type="text" maxlength="200" data-camp="og_titlu" value="' + esc(d.og_titlu) + '"/></div>' +
        '<div class="seo-camp"><label for="seo-og-descriere"><span>Descriere la partajare ' + L + ' (gol = descrierea SEO)</span><span class="seo-contor" data-contor="og_descriere"></span></label>' +
        '<textarea id="seo-og-descriere" maxlength="400" rows="3" data-camp="og_descriere">' + esc(d.og_descriere) + '</textarea></div>' +
        '<div class="seo-camp"><div class="seo-legenda"><span>Imaginea de partajare ' + L + ' — 1,91:1, minimum 1200 × 630 px</span></div>' +
        '<div class="seo-og-media" id="seo-og-media"></div>' +
        '<input type="hidden" data-camp="og_imagine_url" value="' + esc(d.og_imagine_url) + '"/>' +
        '<input type="hidden" data-camp="og_imagine_latime" value="' + esc(d.og_imagine_latime) + '"/>' +
        '<input type="hidden" data-camp="og_imagine_inaltime" value="' + esc(d.og_imagine_inaltime) + '"/></div>' +
        '<div class="seo-camp"><label for="seo-og-alt"><span>Textul alternativ al imaginii ' + L + '</span></label>' +
        '<input id="seo-og-alt" type="text" maxlength="300" data-camp="og_imagine_alt" value="' + esc(d.og_imagine_alt) + '"/></div>' +
        '<p class="seo-nota">Roboții Facebook, LinkedIn, WhatsApp, TikTok și X citesc aceste câmpuri direct de pe server, doar pe paginile publice. ' +
        'Varianta ' + L + ' se aplică linkurilor ' + (S.limba === 'ro' ? 'fără limbă sau cu ?lang=ro' : 'cu ?lang=en (sau altă limbă decât româna)') + '. Rețelele țin previzualizarea în cache: după salvare, cereți „Scrape again” în instrumentele de mai jos.</p>' +
        '<div class="seo-mesaj" id="seo-og-msg" role="status"></div>' +
        '<div class="seo-actiuni"><button type="button" class="seo-buton principal" data-act="salveaza">Salvează ' + L + '</button></div>' +
        '</form>' +
        '<aside class="seo-prev" aria-label="Cum arată linkul la partajare">' +
        '<div class="seo-prev-titlu">Cum arată linkul pe Facebook / LinkedIn / WhatsApp</div>' +
        '<p class="seo-nota">Desen local, din câmpuri. Rezultatul real îl arată instrumentele oficiale:</p>' +
        '<div class="seo-actiuni" style="margin-bottom:12px">' +
        '<a class="seo-buton contur" target="_blank" rel="noopener noreferrer" href="https://developers.facebook.com/tools/debug/?q=' + encodeURIComponent(url) + '">Facebook Sharing Debugger ↗</a>' +
        '<a class="seo-buton contur" target="_blank" rel="noopener noreferrer" href="https://www.linkedin.com/post-inspector/inspect/' + encodeURIComponent(url) + '">LinkedIn Post Inspector ↗</a>' +
        '</div>' +
        '<div id="seo-og-prev"></div>' +
        '</aside></div>';
      var form = c.querySelector('form');
      Object.keys(ORIENTATIV).forEach(function (k) {
        P.legaContor(form.querySelector('[data-camp="' + k + '"]'), form.querySelector('[data-contor="' + k + '"]'), ORIENTATIV[k]);
      });
      form.addEventListener('input', function () { P.citesteFormular(form); deseneazaPrevizualizare(c, S); });
      P.legaLimba(c, function () { P.deseneazaTab(); });
      var b = form.querySelector('[data-act="salveaza"]');
      b.disabled = !S.poateScrie;
      b.addEventListener('click', function () { P.salveazaLimba(b, c.querySelector('#seo-og-msg'), form, 'Partajarea ' + L + ' a fost salvată. Cereți „Scrape again” în Facebook Sharing Debugger ca să vedeți noua previzualizare.'); });
      if (window.SeoMedia) window.SeoMedia.zonaOg(c.querySelector('#seo-og-media'), form, function () { deseneazaPrevizualizare(c, S); });
      else c.querySelector('#seo-og-media').innerHTML = valoare(S, 'og_imagine_url') ? '<div class="seo-nota">' + esc(valoare(S, 'og_imagine_url')) + '</div>' : '<div class="seo-nota">Nicio imagine încărcată.</div>';
      deseneazaPrevizualizare(c, S);
    },
  });

  P.og = { cardHtml: cardHtml, urlPagina: urlPagina, deseneazaPrevizualizare: deseneazaPrevizualizare };
})();

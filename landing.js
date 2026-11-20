/* ════════════════════════════════════════════════════════════════
   MY DARRIN — landing.js, pasul 12-L1 (macheta L1, LM, 19 nov. 2026)

   Paginile de destinație (/parteneri, cele 5 categorii, /investitori).
   Partea care trebuie să fie gata din prima secundă NU e aici, ci în două
   scripturi mici scrise direct în pagină de scripts/genereaza-pagini-destinatie.js:
     1. în <head> (imediat după i18n-loader.js): citește utm_campaign, cere
        varianta publicată (/api/public/landing, cache scurt) și, doar cu
        utm_campaign, ascunde vizual textele primului ecran cel mult 300 ms
        (html.lp-asteapta). Varianta sosită în fereastra de 300 ms se aplică;
        mai târziu nu (rămâne conținutul implicit din HTML, fără schimbări
        bruște). window.__MYD_LP.gata → numele variantei afișate („default”
        sau numele campaniei), pentru partner_landing_view (masurare.js);
     2. imediat după butonul principal: destinația lui (scrisă în HTML) primește
        parametrii adresei paginii — profesie, lang și UTM-urile — înainte de
        DOMContentLoaded și de orice cod de sesiune.

   Aici (defer, nu blochează afișarea):
     - imaginea campaniei (sub primul ecran), dacă varianta afișată are una:
       srcset din variantele încărcate (480 / 800 / 1600 px), loading="lazy",
       fetchpriority="low", lățimea și înălțimea scrise (fără CLS);
     - butoanele plutitoare (distribuire, Darrin AI): dacă s-ar suprapune peste
       butonul principal, se ascund (html.lp-plutitoare-ascunse), la orice
       lățime, la derulare și la redimensionare.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_LANDING) return;

  var lp = window.__MYD_LP || {};
  var PLUTITOARE = ['myd-share-fab', 'dai-fab', 'chat-toggle'];

  function limba() { return window.MYD_I18N && window.MYD_I18N.lang === 'ro' ? 'ro' : 'en'; }

  // ── Imaginea campaniei ─────────────────────────────────────────────
  function imagine() {
    var fig = document.querySelector('[data-lp-imagine]');
    var d = lp.date;
    if (!fig || !lp.aplicat || !d || !d.imagine || !d.imagine.url) return;
    var img = fig.querySelector('img');
    if (!img) return;
    var im = d.imagine;
    var c = (d.continut && d.continut[limba()]) || {};
    var variante = Array.isArray(im.variante) ? im.variante.filter(function (v) { return v && v.url && v.w > 0; }) : [];
    if (variante.length) {
      img.setAttribute('srcset', variante.map(function (v) { return v.url + ' ' + v.w + 'w'; }).join(', '));
      img.setAttribute('sizes', '(min-width: 768px) 672px, calc(100vw - 32px)');
    }
    if (im.latime > 0 && im.inaltime > 0) { img.setAttribute('width', im.latime); img.setAttribute('height', im.inaltime); }
    img.setAttribute('alt', c.imagine_alt || '');
    img.setAttribute('src', im.url);
    fig.hidden = false;
  }

  // ── Butoanele plutitoare ───────────────────────────────────────────
  function seSuprapun(a, b, marja) {
    return !(a.right + marja <= b.left || b.right + marja <= a.left || a.bottom + marja <= b.top || b.bottom + marja <= a.top);
  }
  var programat = false;
  function verificaPlutitoare() {
    programat = false;
    var cta = document.getElementById('lp-cta');
    if (!cta) return;
    var r = cta.getBoundingClientRect();
    var acoperit = false;
    if (r.width && r.height) {
      PLUTITOARE.forEach(function (id) {
        var el = document.getElementById(id);
        if (!el || acoperit) return;
        var st = getComputedStyle(el);
        if (st.display === 'none' || st.position !== 'fixed') return;
        if (seSuprapun(r, el.getBoundingClientRect(), 8)) acoperit = true;
      });
    }
    document.documentElement.classList.toggle('lp-plutitoare-ascunse', acoperit);
  }
  function programeaza() {
    if (programat) return;
    programat = true;
    (window.requestAnimationFrame || setTimeout)(verificaPlutitoare);
  }

  // Cardurile de categorie și linkul spre întrebări păstrează lang și UTM-urile adresei.
  function transmite() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var chei = ['lang', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    Array.prototype.forEach.call(document.querySelectorAll('[data-lp-transmite]'), function (a) {
      try {
        var u = new URL(a.getAttribute('href'), location.href);
        chei.forEach(function (k) { var v = q.get(k); if (v && !u.searchParams.has(k)) u.searchParams.set(k, String(v).slice(0, 100)); });
        a.setAttribute('href', u.pathname + u.search + u.hash);
      } catch (e) {}
    });
  }

  // /parteneri?type=<tip> (adresele vechi, redirecționate 301): cardul tipului, marcat.
  function tipDinAdresa() {
    var t = '';
    try { t = String(new URLSearchParams(location.search).get('type') || '').toLowerCase().replace('asigurator', 'asigurari'); } catch (e) {}
    var card = t && document.getElementById('tip-' + t);
    if (!card || !card.classList.contains('lp-cat')) return;
    card.classList.add('lp-ales');
    setTimeout(function () { try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { card.scrollIntoView(); } }, 350);
  }

  // Lucide se încarcă acum cu defer, după acest script: iconițele se desenează la DOMContentLoaded.
  function icone() { try { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (e) {} }

  function porneste() {
    imagine();
    transmite();
    tipDinAdresa();
    if (document.readyState === 'loading' || document.readyState === 'interactive') document.addEventListener('DOMContentLoaded', icone);
    window.addEventListener('load', icone);
    verificaPlutitoare();
    window.addEventListener('scroll', programeaza, { passive: true });
    window.addEventListener('resize', programeaza);
    // Butoanele plutitoare apar mai târziu (share-widget.js, ui-comun.js): le prindem când intră în pagină.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(programeaza).observe(document.body, { childList: true });
    }
    setTimeout(verificaPlutitoare, 1500);
    window.addEventListener('load', verificaPlutitoare);
  }

  window.MYD_LANDING = { verificaPlutitoare: verificaPlutitoare, imagine: imagine };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();

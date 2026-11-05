/* ════════════════════════════════════════════════════════════════
   MY DARRIN — ruta-partener.js, pasul 11-R3g (decizia LM, 3 nov. 2026)

   Comportamentul comun al rutei „Devino partener” (hub + cele 5 pagini de
   tip), peste ruta-partener.css:

   - bara fixă de pe telefon ([data-rp-fix]): apare doar când butonul principal
     din hero ([data-rp-principal]) și banda finală (.rp-banda) nu se văd, ca
     butonul să nu fie dublat; stă deasupra butonului Darrin AI și a barei de
     jos (ruta-partener.css), iar body primește spațiu jos cât ea
     (html.rp-are-fix), ca să nu acopere conținutul;
   - pe hub, ?type=<tip> (de exemplu din vechea adresă
     mydarrin-devino-partener.html?type=curier, redirecționată 301) marchează
     cardul tipului și duce la el.

   Textul și acțiunea butoanelor (fereastra de cont cu tipul bifat, sau
   starea contului) vin din cta-partener.js, prin data-cta-partener.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MYD_RUTA_PARTENER) return;

  var TIPURI = ['servicii', 'materiale', 'inchirieri', 'curier', 'asigurari'];
  function tipDin(v) {
    v = String(v || '').toLowerCase();
    if (v === 'asigurator') v = 'asigurari';
    return TIPURI.indexOf(v) !== -1 ? v : null;
  }

  function baraFixa() {
    var bara = document.querySelector('[data-rp-fix]');
    if (!bara) return;
    document.documentElement.classList.add('rp-are-fix');
    var tinte = [document.querySelector('[data-rp-principal]'), document.querySelector('.rp-banda')].filter(Boolean);
    if (!tinte.length || typeof IntersectionObserver !== 'function') { bara.classList.add('rp-vizibil'); return; }
    var vizibile = new Set();
    var obs = new IntersectionObserver(function (intrari) {
      intrari.forEach(function (x) { if (x.isIntersecting) vizibile.add(x.target); else vizibile.delete(x.target); });
      bara.classList.toggle('rp-vizibil', vizibile.size === 0);
    }, { threshold: 0 });
    tinte.forEach(function (t) { obs.observe(t); });
  }

  function tipDinAdresa() {
    var tip = tipDin(new URLSearchParams(location.search).get('type'));
    if (!tip) return;
    var card = document.getElementById('tip-' + tip);
    if (!card) return;
    card.classList.add('rp-ales');
    setTimeout(function () { try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { card.scrollIntoView(); } }, 350);
  }

  function icone() { try { if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); } catch (e) {} }

  function porneste() { baraFixa(); tipDinAdresa(); icone(); }

  window.MYD_RUTA_PARTENER = { tipDin: tipDin };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();

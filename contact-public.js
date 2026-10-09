// contact-public.js
// Datele de contact ale platformei, din back-office (9 oct. 2026), prin
// /api/public/contact (secțiunea `contact` din backoffice_config). Nicio
// pagină nu mai are telefoane sau emailuri scrise direct.
//
// Marcaj:
//   [data-contact="<cheie>"]  — elementul care primește valoarea; dacă e <a>,
//       primește și linkul: contact_whatsapp → https://wa.me/<cifre>,
//       *_telefon → tel:, *_email → mailto:. Cu [data-contact-text] își
//       păstrează textul (ex. „Scrie-ne pe WhatsApp”).
//   [data-contact-href="<cheie>"] — doar linkul (ex. un buton cu pictogramă
//       care conține un [data-contact] pentru text).
//   [data-contact-rand]        — ascuns până când valoarea din el există.
//   [data-contact-bloc]        — ascuns până când măcar un rând e afișat.
// O cheie lipsă din back-office = rândul rămâne ascuns.
//
// Pentru textele generate din JavaScript (mesaje de eroare):
//   window.mydContact('suport_email') → valoarea sau '' dacă lipsește.
(function () {
  var CHEIE_CACHE = 'myd_contact_v1';
  var TTL = 5 * 60 * 1000;

  function citesteCache() {
    try {
      var c = JSON.parse(sessionStorage.getItem(CHEIE_CACHE) || 'null');
      if (c && Date.now() - c.ts < TTL) return c.contact;
    } catch (e) {}
    return null;
  }

  function link(cheie, v) {
    var cifre = v.replace(/[^0-9+]/g, '');
    if (/whatsapp/.test(cheie)) return 'https://wa.me/' + cifre.replace(/^\+/, '');
    if (/telefon/.test(cheie)) return 'tel:' + cifre;
    if (/email/.test(cheie)) return 'mailto:' + v;
    return null;
  }

  var incarcat = {};
  window.mydContact = function (cheie) { return incarcat[cheie] || ''; };

  function aplica(contact) {
    incarcat = contact;
    document.querySelectorAll('[data-contact]').forEach(function (el) {
      var cheie = el.getAttribute('data-contact');
      var v = contact[cheie];
      if (!v) return;
      if (!el.hasAttribute('data-contact-text') && el.textContent !== v) el.textContent = v;
      var href = link(cheie, v);
      if (href && el.tagName === 'A') {
        el.href = href;
        if (/^https:/.test(href)) { el.target = '_blank'; el.rel = 'noopener'; }
      }
      var rand = el.closest('[data-contact-rand]') || el;
      rand.style.display = '';
      rand.removeAttribute('hidden');
    });
    document.querySelectorAll('[data-contact-href]').forEach(function (el) {
      var cheie = el.getAttribute('data-contact-href');
      var v = contact[cheie];
      if (!v) return;
      el.href = link(cheie, v);
      var rand = el.closest('[data-contact-rand]') || el;
      rand.style.display = '';
      rand.removeAttribute('hidden');
    });
    document.querySelectorAll('[data-contact-bloc]').forEach(function (b) {
      var vizibil = [].some.call(b.querySelectorAll('[data-contact-rand]'), function (r) { return r.style.display !== 'none' && !r.hasAttribute('hidden'); });
      if (vizibil) { b.style.display = ''; b.removeAttribute('hidden'); }
    });
  }

  // Conținutul randat mai târziu (slide-uri, modale) primește aceleași date.
  var observat = false;
  function urmareste() {
    if (observat || !window.MutationObserver || !document.body) return;
    observat = true;
    var programat = false;
    new MutationObserver(function () {
      if (programat) return;
      programat = true;
      setTimeout(function () { programat = false; if (Object.keys(incarcat).length) aplicaFaraObservare(); }, 50);
    }).observe(document.body, { childList: true, subtree: true });
  }
  function aplicaFaraObservare() {
    var neaplicate = [].filter.call(document.querySelectorAll('[data-contact],[data-contact-href]'), function (el) {
      var r = el.closest('[data-contact-rand]') || el;
      return r.style.display === 'none' || r.hasAttribute('hidden') || (el.hasAttribute('data-contact') && !el.hasAttribute('data-contact-text') && !el.textContent);
    });
    if (neaplicate.length) aplica(incarcat);
  }

  function porneste() {
    var c = citesteCache();
    if (c) { aplica(c); urmareste(); return; }
    fetch('/api/public/contact')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.contact) return;
        try { sessionStorage.setItem(CHEIE_CACHE, JSON.stringify({ ts: Date.now(), contact: d.contact })); } catch (e) {}
        aplica(d.contact);
        urmareste();
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', porneste);
  else porneste();
})();

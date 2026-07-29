/* format-currency.js — G38 (audit Secțiunea 36, 29 Iulie 2026)
   Helper unic pentru formatarea sumelor bănești — până acum, 107 apariții
   hardcodate (`.toLocaleString('ro-RO')+' Lei'`) în 27 de fișiere, fiecare
   presupunând implicit RON, chiar și pe pagini care afișează sume în EUR
   (mydarrin-investitori.html). Nu face conversie valutară (asta rămâne G39,
   condiționat de o decizie de business) — doar formatează consistent o
   sumă deja în moneda corectă, cu separator de mii real (Intl.NumberFormat)
   și simbolul corect, nu întotdeauna "Lei".
*/
(function () {
  'use strict';

  var SIMBOLURI = {
    RON: 'Lei', MDL: 'Lei', EUR: '€', GBP: '£', USD: '$', BGN: 'BGN',
    HUF: 'Ft', PLN: 'zł', TRY: '₺', UAH: '₴', RSD: 'RSD', CNY: '¥',
  };

  /**
   * @param {number} suma
   * @param {string} [codMoneda] — implicit 'RON', ca să păstreze comportamentul
   *   existent oriunde moneda reală nu e încă urmărită (vezi G39).
   * @param {{zecimale?:number}} [opts]
   * @returns {string} ex. "1.250 Lei", "€1,250.50"
   */
  function formatCurrency(suma, codMoneda, opts) {
    codMoneda = (codMoneda || 'RON').toUpperCase();
    opts = opts || {};
    var numar = Number(suma);
    if (!isFinite(numar)) numar = 0;

    var text;
    try {
      text = new Intl.NumberFormat('ro-RO', {
        minimumFractionDigits: opts.zecimale != null ? opts.zecimale : 0,
        maximumFractionDigits: opts.zecimale != null ? opts.zecimale : 2,
      }).format(numar);
    } catch (e) {
      text = String(Math.round(numar * 100) / 100);
    }

    var simbol = SIMBOLURI[codMoneda] || codMoneda;
    // EUR/GBP/USD se scriu convențional cu simbolul înainte de sumă
    // (€1.250), restul (Lei, Ft, zł etc.) după sumă (1.250 Lei) — la fel
    // cum era deja scris manual, per monedă, în fiecare fișier.
    if (codMoneda === 'EUR' || codMoneda === 'GBP' || codMoneda === 'USD') {
      return simbol + text;
    }
    return text + ' ' + simbol;
  }

  window.formatCurrency = formatCurrency;
})();

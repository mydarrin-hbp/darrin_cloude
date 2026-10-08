// tva-config.js
// Cota de TVA pe țară pentru paginile publice (produs, catalog, checkout),
// citită din tax_configurations prin /api/public/tari-active (câmpul `tva`).
// Înlocuiește cotele scrise direct în pagini (ex. `const TVA = 0.19`, deși
// RO are 21% din 2025).
//
// Rezerva de mai jos e identică cu TVA_FALLBACK din lib/calculeaza-pret.js
// și se folosește doar dacă API-ul nu răspunde — aceeași regulă ca serverul.
//
//   await MDTva.cota('RO')      -> 0.21
//   MDTva.procent(0.21)         -> "21%"
(function () {
  var REZERVA = { RO: 0.21, MD: 0.20, DE: 0.19, FR: 0.20, BG: 0.20 };
  var promisiune = null;

  function incarca() {
    if (!promisiune) {
      promisiune = fetch('/api/public/tari-active')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return (d && d.tva) || {}; })
        .catch(function () { return {}; });
    }
    return promisiune;
  }

  function cota(tara) {
    var cod = String(tara || 'RO').toUpperCase();
    return incarca().then(function (map) {
      var pct = Number(map[cod]);
      if (map[cod] != null && isFinite(pct)) return pct / 100;
      return REZERVA[cod] != null ? REZERVA[cod] : 0.20;
    });
  }

  function procent(c) {
    var p = Math.round(c * 1000) / 10;
    return String(p).replace('.', ',') + '%';
  }

  window.MDTva = { cota: cota, procent: procent };
})();

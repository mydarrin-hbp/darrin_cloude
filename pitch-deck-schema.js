/* ════════════════════════════════════════════════════════════════
   pitch-deck-schema.js — tipurile de slide ale pitch deck-ului (pasul 11-K,
   22 oct. 2026) și validarea lor. Un singur loc, folosit de:
     - server: lib/pitch-deck.js (validarea la salvare și la import);
     - back-office: editorul din mydarrin-superadmin.html (câmpurile fiecărui
       tip și verificarea înainte de trimitere; serverul decide oricum).
   Structura urmează docs/pitch-deck/pitch-deck-v1-ro.json / -en.json
   (câmpul `tip` al fiecărui slide). Nicio cifră a rundei nu stă aici: slide-ul
   `runda` și punctul `din_runda` al slide-ului `exit` iau valorile din runda
   deschisă la afișare (lib/runda-finantare.js).

   Descrierea unui câmp: { t, obl, et, max, campuri, valori, nul }
     t: text | lung | numar | intreg | bool | enum | imagine | url |
        lista_text | lista (de obiecte, cu `campuri`) | obiect (cu `campuri`)
     obl: obligatoriu; nul: acceptă null (ex. `sursa`, `foto`); et: eticheta
     din editor (back-office, în română).
   ════════════════════════════════════════════════════════════════ */
(function (radacina, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else radacina.MDPitchDeckSchema = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TEXT = function (et, obl, max) { return { t: 'text', et: et, obl: !!obl, max: max || 200 }; };
  var LUNG = function (et, obl) { return { t: 'lung', et: et, obl: !!obl, max: 600 }; };
  var NUMAR = function (et, obl) { return { t: 'numar', et: et, obl: !!obl }; };
  var LISTA_TEXT = function (et, obl, max) { return { t: 'lista_text', et: et, obl: !!obl, max: max || 120 }; };
  var LISTA = function (et, campuri, obl) { return { t: 'lista', et: et, obl: !!obl, campuri: campuri }; };
  var IMAGINE = function (obl) { return { t: 'imagine', et: 'Imagine', obl: !!obl, nul: !obl }; };

  var CIFRA = { valoare: NUMAR('Valoare', true), prefix: TEXT('Prefix'), sufix: TEXT('Sufix', false, 20), text: TEXT('Text', true) };

  // Câmpurile comune tuturor slide-urilor (nr și tip se verifică separat).
  var COMUNE = {
    animatie: { t: 'enum', et: 'Animație', obl: true, valori: ['elemente', 'imagine'] },
    titlu: TEXT('Titlu', true),
    prognoza: { t: 'bool', et: 'Slide de prognoză (cifre estimate)' },
    sursa: { t: 'text', et: 'Sursa cifrelor', max: 400, nul: true },
    // Pasul 11-K3 (23 oct. 2026): notele prezentatorului, opționale, interne.
    // api/public/pitch-deck.js nu le trimite niciodată (lib/pitch-deck.js le
    // scoate din payload); le primesc doar previzualizarea și prezentarea din
    // api/admin/pitch-deck.js, cu drept pe secțiunea Investitori.
    note_prezentator: { t: 'lung', et: 'Note de prezentator', max: 2000, nul: true, intern: true },
  };

  var TIPURI = {
    coperta: { imagine: IMAGINE(true), eyebrow: TEXT('Supratitlu'), subtitlu: TEXT('Subtitlu'), accent: TEXT('Accent') },
    flux: {
      subtitlu: TEXT('Subtitlu'),
      blocuri: LISTA('Blocuri', { eticheta: TEXT('Etichetă', true, 40), text: LUNG('Text', true) }, true),
      pasi: LISTA_TEXT('Pașii fluxului (unul pe rând)', true, 40),
      valori: LISTA_TEXT('Valori (una pe rând)', false, 40),
    },
    lista_imagine: { imagine: IMAGINE(true), subtitlu: LUNG('Subtitlu'), puncte: LISTA_TEXT('Puncte (unul pe rând)', true, 200), nota: LUNG('Notă') },
    cifre_imagine: { imagine: IMAGINE(true), cifre: LISTA('Cifre', CIFRA, true) },
    ciclu: {
      subtitlu: TEXT('Subtitlu'), bloc_titlu: TEXT('Titlul blocului'), bloc_text: LUNG('Textul blocului'),
      centru: TEXT('Centru', true, 60), eticheta: TEXT('Etichetă', false, 40), noduri: LISTA_TEXT('Nodurile ciclului (unul pe rând)', true, 40),
    },
    cifra_mare_imagine: {
      imagine: IMAGINE(true), subtitlu: TEXT('Subtitlu'), text: LUNG('Text', true),
      cifra: { t: 'obiect', et: 'Cifra mare', obl: true, campuri: { prefix: TEXT('Prefix', false, 10), valoare: NUMAR('Valoare', true), sufix: TEXT('Sufix', false, 20) } },
    },
    verticale: {
      subtitlu: TEXT('Subtitlu'), verticale: LISTA_TEXT('Verticale (una pe rând)', true, 60),
      activa: { t: 'intreg', et: 'Verticala evidențiată (0 = prima)' }, accent: TEXT('Accent'), text: LUNG('Text'),
    },
    piata: {
      centru: TEXT('Centru', false, 10),
      nivele: LISTA('Niveluri (TAM / SAM / SOM)', { eticheta: TEXT('Etichetă', true, 60), valoare: NUMAR('Valoare', true), moneda: TEXT('Moneda (cod)', true, 3), extra: TEXT('Extra', false, 40) }, true),
    },
    cifre_banda: { imagine: IMAGINE(false), cifre: LISTA('Cifre', CIFRA, true) },
    faze_imagine: { imagine: IMAGINE(true), faze: LISTA('Faze', { eticheta: TEXT('Etichetă', true, 40), text: TEXT('Text', true, 80) }, true) },
    // v1: pași simpli (etichetă + valoare). v1.1 (11-K2, 23 oct. 2026): carduri
    // A + B = C, cu titlu, text, operator și stil pe pas, plus banda escrow;
    // toate opționale, deci un slide v1 rămâne valid și arată la fel.
    model_afaceri: {
      subtitlu_accent: TEXT('Subtitlu (accent)'), subtitlu: TEXT('Subtitlu'),
      flux: LISTA('Fluxul banilor', {
        eticheta: TEXT('Etichetă', true, 40), valoare: { t: 'text', et: 'Valoare', max: 20, nul: true },
        titlu: TEXT('Titlul cardului', false, 60), text: { t: 'lung', et: 'Descrierea cardului', max: 300 },
        operator: { t: 'enum', et: 'Semnul dinaintea cardului (+ / =)', valori: ['+', '='], nul: true },
        stil: { t: 'enum', et: 'Stilul cardului', valori: ['neutru', 'accent', 'final'] },
      }, true),
      escrow: { t: 'obiect', et: 'Banda Escrow (sub carduri)', nul: true, campuri: { titlu: TEXT('Titlu', false, 80), text: { t: 'lung', et: 'Text', max: 300 } } },
      venituri_titlu: TEXT('Titlul veniturilor', false, 60), venituri: LISTA_TEXT('Venituri suplimentare (unul pe rând)', false, 60),
    },
    cronologie: { etape: LISTA('Etape', { perioada: TEXT('Perioada', true, 40), titlu: TEXT('Titlu', true, 80), text: LUNG('Text', true) }, true) },
    comparatie: {
      coloane: LISTA_TEXT('Coloane (una pe rând)', true, 30),
      randuri: LISTA('Rânduri', { nume: TEXT('Nume', true, 40), valori: { t: 'lista_bool', et: 'Bife (în ordinea coloanelor)', obl: true }, evidentiat: { t: 'bool', et: 'Evidențiat' } }, true),
    },
    palnie: { nivele: LISTA_TEXT('Nivelurile pâlniei (de sus în jos)', true, 60), accent: TEXT('Accent'), text: LUNG('Text') },
    echipa: {
      membri: LISTA('Membri', { nume: TEXT('Nume', true, 60), rol: TEXT('Rol', true, 80), foto: { t: 'imagine', et: 'Fotografie (fără → inițiale)', nul: true }, evidentiat: { t: 'bool', et: 'Evidențiat' } }, true),
    },
    grafice: {
      subtitlu: LUNG('Subtitlu'), moneda: TEXT('Moneda (cod)', true, 3),
      ani: { t: 'lista_numar', et: 'Anii (unul pe rând)', obl: true },
      venituri: { t: 'lista_numar', et: 'Venituri pe an (în ordinea anilor)', obl: true },
      profit_net: { t: 'lista_numar', et: 'Profit net pe an (în ordinea anilor)', obl: true },
      cifra: { t: 'obiect', et: 'Cifra evidențiată', obl: true, campuri: { valoare: NUMAR('Valoare', true), text: TEXT('Text', true) } },
    },
    runda: {
      accent: TEXT('Accent'), fonduri_titlu: TEXT('Titlul utilizării fondurilor', false, 60),
      fonduri: LISTA_TEXT('Utilizarea fondurilor (una pe rând)', true, 80),
      sursa_date: { t: 'nota', et: 'Cifrele rundei vin din runda deschisă' }, nota: { t: 'nota', et: 'Notă internă' },
    },
    exit: {
      cifra: TEXT('Orizont (ex. 3–5 ani)', true, 30), text: LUNG('Text'),
      puncte: LISTA('Puncte', { eticheta: TEXT('Etichetă', true, 30), valoare: TEXT('Valoare', true, 30), din_runda: { t: 'enum', et: 'Valoarea din rundă', valori: ['post_money'], nul: true } }, true),
      avertisment: LUNG('Avertisment (mereu vizibil)', true),
    },
    contact: {
      imagine: IMAGINE(false), citat: LUNG('Citat'), semnatura: TEXT('Semnătură', false, 80),
      url_site: { t: 'url', et: 'Adresa platformei', obl: true }, url_investitori: { t: 'url', et: 'Adresa paginii Investitori (QR)', obl: true },
      buton: TEXT('Butonul', true, 60),
      email_din: { t: 'nota', et: 'Emailul vine din backoffice_config.investitori_email' }, qr: { t: 'nota', et: 'QR-ul se generează din adresa paginii Investitori' },
    },
  };

  var ETICHETE_TIP = {
    coperta: 'Copertă', flux: 'Flux', lista_imagine: 'Listă cu imagine', cifre_imagine: 'Cifre cu imagine', ciclu: 'Ciclu',
    cifra_mare_imagine: 'Cifră mare cu imagine', verticale: 'Verticale', piata: 'Piața (TAM / SAM / SOM)', cifre_banda: 'Bandă de cifre',
    faze_imagine: 'Faze cu imagine', model_afaceri: 'Model de afaceri', cronologie: 'Cronologie', comparatie: 'Comparație',
    palnie: 'Pâlnie', echipa: 'Echipa', grafice: 'Grafice', runda: 'Runda (din runda deschisă)', exit: 'Exit', contact: 'Contact',
  };

  var MAX_SLIDEURI = 40;
  // Imaginile: un fișier din assets/pitch-deck/v1/ sau o adresă publică din bucket-ul pitch-deck-media.
  var RE_FISIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(webp|png|jpe?g)$/i;
  var RE_MEDIA = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/pitch-deck-media\/[A-Za-z0-9._\/-]{1,200}\.(webp|png|jpe?g)$/i;

  function campuriTip(tip) {
    var t = TIPURI[tip];
    if (!t) return null;
    var toate = {};
    Object.keys(COMUNE).forEach(function (k) { toate[k] = COMUNE[k]; });
    Object.keys(t).forEach(function (k) { toate[k] = t[k]; });
    return toate;
  }

  function gol(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0); }

  // Validează un câmp; adaugă erorile în `erori` ({ camp, ro, en }).
  function valideazaCamp(d, v, cale, unde, erori) {
    var e = function (ro, en) { erori.push({ camp: cale, ro: unde + ' · «' + d.et + '»: ' + ro, en: unde + ' · «' + d.et + '»: ' + en }); };
    if (d.t === 'nota') return;
    if (gol(v)) {
      if (d.obl) e('completați câmpul.', 'please fill in this field.');
      else if (v === null && !d.nul && d.t !== 'bool') e('valoarea nu poate fi goală.', 'the value cannot be empty.');
      return;
    }
    switch (d.t) {
      case 'text': case 'lung':
        if (typeof v !== 'string') return e('trebuie să fie text.', 'must be text.');
        if (v.length > d.max) e('cel mult ' + d.max + ' de caractere.', 'at most ' + d.max + ' characters.');
        return;
      case 'numar':
        if (typeof v !== 'number' || !isFinite(v)) e('trebuie să fie un număr.', 'must be a number.');
        return;
      case 'intreg':
        if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 0) e('trebuie să fie un număr întreg (0 sau mai mare).', 'must be a whole number (0 or more).');
        return;
      case 'bool':
        if (typeof v !== 'boolean') e('trebuie să fie da / nu.', 'must be yes / no.');
        return;
      case 'enum':
        if (d.valori.indexOf(v) === -1) e('valoare necunoscută (' + d.valori.join(' / ') + ').', 'unknown value (' + d.valori.join(' / ') + ').');
        return;
      case 'imagine':
        if (typeof v !== 'string' || !(RE_FISIER.test(v) || RE_MEDIA.test(v))) e('un fișier din assets/pitch-deck/v1/ sau o imagine încărcată în pitch-deck-media (webp / png / jpg).', 'a file from assets/pitch-deck/v1/ or an image uploaded to pitch-deck-media (webp / png / jpg).');
        return;
      case 'url':
        if (typeof v !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(v) || v.length > 300) e('o adresă care începe cu https://.', 'an address starting with https://.');
        return;
      case 'lista_text':
        if (!Array.isArray(v)) return e('trebuie să fie o listă.', 'must be a list.');
        v.forEach(function (x, i) {
          if (typeof x !== 'string' || !x.trim()) erori.push({ camp: cale + '.' + i, ro: unde + ' · «' + d.et + '», rândul ' + (i + 1) + ': completați textul.', en: unde + ' · «' + d.et + '», row ' + (i + 1) + ': fill in the text.' });
          else if (x.length > d.max) erori.push({ camp: cale + '.' + i, ro: unde + ' · «' + d.et + '», rândul ' + (i + 1) + ': cel mult ' + d.max + ' de caractere.', en: unde + ' · «' + d.et + '», row ' + (i + 1) + ': at most ' + d.max + ' characters.' });
        });
        return;
      case 'lista_numar':
        if (!Array.isArray(v) || !v.every(function (x) { return typeof x === 'number' && isFinite(x); })) e('o listă de numere.', 'a list of numbers.');
        return;
      case 'lista_bool':
        if (!Array.isArray(v) || !v.every(function (x) { return typeof x === 'boolean'; })) e('o listă de bife (da / nu).', 'a list of ticks (yes / no).');
        return;
      case 'obiect':
        if (typeof v !== 'object' || Array.isArray(v)) return e('structură nevalidă.', 'invalid structure.');
        Object.keys(d.campuri).forEach(function (k) { valideazaCamp(d.campuri[k], v[k], cale + '.' + k, unde, erori); });
        return;
      case 'lista':
        if (!Array.isArray(v)) return e('trebuie să fie o listă.', 'must be a list.');
        v.forEach(function (x, i) {
          var u = unde + ' · «' + d.et + '» ' + (i + 1);
          if (!x || typeof x !== 'object' || Array.isArray(x)) { erori.push({ camp: cale + '.' + i, ro: u + ': structură nevalidă.', en: u + ': invalid structure.' }); return; }
          Object.keys(d.campuri).forEach(function (k) { valideazaCamp(d.campuri[k], x[k], cale + '.' + i + '.' + k, u, erori); });
        });
        return;
    }
  }

  // Validarea întregii liste de slide-uri. Întoarce [] dacă e validă.
  function valideaza(slideuri) {
    var erori = [];
    if (!Array.isArray(slideuri) || !slideuri.length) {
      return [{ camp: 'slide_uri', ro: 'Pitch deck-ul nu are niciun slide.', en: 'The pitch deck has no slides.' }];
    }
    if (slideuri.length > MAX_SLIDEURI) erori.push({ camp: 'slide_uri', ro: 'Cel mult ' + MAX_SLIDEURI + ' de slide-uri.', en: 'At most ' + MAX_SLIDEURI + ' slides.' });
    slideuri.forEach(function (s, i) {
      var cale = 'slide_uri.' + i;
      var unde = 'Slide ' + (i + 1);
      if (!s || typeof s !== 'object' || Array.isArray(s)) { erori.push({ camp: cale, ro: unde + ': structură nevalidă.', en: 'Slide ' + (i + 1) + ': invalid structure.' }); return; }
      if (s.nr !== i + 1) erori.push({ camp: cale + '.nr', ro: unde + ': numărul slide-ului trebuie să fie ' + (i + 1) + '.', en: 'Slide ' + (i + 1) + ': the slide number must be ' + (i + 1) + '.' });
      var campuri = campuriTip(s.tip);
      if (!campuri) { erori.push({ camp: cale + '.tip', ro: unde + ': tip de slide necunoscut („' + String(s.tip) + '”).', en: 'Slide ' + (i + 1) + ': unknown slide type (“' + String(s.tip) + '”).' }); return; }
      Object.keys(campuri).forEach(function (k) { valideazaCamp(campuri[k], s[k], cale + '.' + k, unde, erori); });
      // Coerențe între câmpuri
      if (s.tip === 'comparatie' && Array.isArray(s.coloane) && Array.isArray(s.randuri)) {
        s.randuri.forEach(function (r, j) {
          if (r && Array.isArray(r.valori) && r.valori.length !== s.coloane.length) erori.push({ camp: cale + '.randuri.' + j + '.valori', ro: unde + ' · rândul ' + (j + 1) + ': câte o bifă pentru fiecare coloană (' + s.coloane.length + ').', en: 'Slide ' + (i + 1) + ' · row ' + (j + 1) + ': one tick per column (' + s.coloane.length + ').' });
        });
      }
      if (s.tip === 'grafice' && Array.isArray(s.ani)) {
        ['venituri', 'profit_net'].forEach(function (k) {
          if (Array.isArray(s[k]) && s[k].length !== s.ani.length) erori.push({ camp: cale + '.' + k, ro: unde + ' · «' + k + '»: câte o valoare pentru fiecare an (' + s.ani.length + ').', en: 'Slide ' + (i + 1) + ' · «' + k + '»: one value per year (' + s.ani.length + ').' });
        });
      }
      if (s.tip === 'verticale' && typeof s.activa === 'number' && Array.isArray(s.verticale) && s.activa >= s.verticale.length) {
        erori.push({ camp: cale + '.activa', ro: unde + ': verticala evidențiată nu există.', en: 'Slide ' + (i + 1) + ': the highlighted vertical does not exist.' });
      }
    });
    return erori;
  }

  // Slide-urile de prognoză fără sursă (aprobarea le refuză).
  function faraSursa(slideuri) {
    return (Array.isArray(slideuri) ? slideuri : []).filter(function (s) { return s && s.prognoza === true && gol(s.sursa); }).map(function (s) { return s.nr; });
  }

  return { TIPURI: TIPURI, COMUNE: COMUNE, ETICHETE_TIP: ETICHETE_TIP, MAX_SLIDEURI: MAX_SLIDEURI, RE_FISIER: RE_FISIER, RE_MEDIA: RE_MEDIA, campuriTip: campuriTip, valideaza: valideaza, faraSursa: faraSursa };
});

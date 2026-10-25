// forme-juridice-public.js
// Pasul 11-P1 (25 oct. 2026): formele juridice acceptate pentru un partener,
// pentru paginile publice („Devino partener” și wizard-ul). Copie a listei din
// lib/forme-juridice.js (sursa serverului); scripts/test-forme-juridice.js
// verifică că sunt identice. Persoana fizică nu poate deveni partener.
//
//   MDFormeJuridice.completeazaSelect(select, valoareSalvata)
//     → opțiunile, în limba paginii, cu „Alege forma juridică” (goală) prima
//   MDFormeJuridice.esteStraina('firma_straina') → true
(function () {
  var FORME_JURIDICE = [
    { cod: 'pfa', ro: 'Persoană fizică autorizată (PFA)', en: 'Authorised self-employed person (PFA)' },
    { cod: 'ii', ro: 'Întreprindere individuală (II)', en: 'Sole proprietorship (II)' },
    { cod: 'if', ro: 'Întreprindere familială (IF)', en: 'Family business (IF)' },
    { cod: 'srl', ro: 'Societate cu răspundere limitată (SRL)', en: 'Limited liability company (SRL)' },
    { cod: 'srl_d', ro: 'SRL debutant (SRL-D)', en: 'Start-up limited liability company (SRL-D)' },
    { cod: 'sa', ro: 'Societate pe acțiuni (SA)', en: 'Joint-stock company (SA)' },
    { cod: 'snc', ro: 'Societate în nume colectiv (SNC)', en: 'General partnership (SNC)' },
    { cod: 'scs', ro: 'Societate în comandită simplă (SCS)', en: 'Limited partnership (SCS)' },
    { cod: 'sca', ro: 'Societate în comandită pe acțiuni (SCA)', en: 'Partnership limited by shares (SCA)' },
    { cod: 'cooperativa', ro: 'Cooperativă', en: 'Cooperative' },
    { cod: 'institutie_publica', ro: 'Instituție publică', en: 'Public institution' },
    { cod: 'firma_straina', ro: 'Firmă înregistrată în altă țară', en: 'Company registered in another country' },
  ];
  var PRIMA = { ro: 'Alege forma juridică', en: 'Choose the legal form' };

  function limba() {
    var l = window.MYD_I18N && window.MYD_I18N.lang;
    return l && l !== 'ro' ? 'en' : 'ro';
  }

  function completeazaSelect(sel, valoare) {
    if (!sel) return;
    var l = limba();
    sel.innerHTML = '';
    var gol = document.createElement('option');
    gol.value = '';
    gol.textContent = PRIMA[l];
    sel.appendChild(gol);
    FORME_JURIDICE.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f.cod;
      o.textContent = f[l];
      sel.appendChild(o);
    });
    sel.required = true;
    sel.value = valoare && FORME_JURIDICE.some(function (f) { return f.cod === valoare; }) ? valoare : '';
  }

  function esteStraina(cod) { return cod === 'firma_straina'; }

  window.MDFormeJuridice = { FORME_JURIDICE: FORME_JURIDICE, completeazaSelect: completeazaSelect, esteStraina: esteStraina };
})();

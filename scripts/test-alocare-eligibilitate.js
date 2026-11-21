// scripts/test-alocare-eligibilitate.js
// Pasul 12-P2, cerut de LM (20 nov. 2026): alocarea automată (lib/aloca-partener.js)
// nu trebuie să aleagă un partener care nu poate primi comenzi, chiar dacă are
// servicii bifate în portofoliu (partener_servicii_active). Regula unică e
// lib/eligibilitate-partener.js (poatePrimiComenzi): aprobat, contract semnat,
// cont bancar activ, cont nesuspendat; plus disponibilitatea (status_live).
//
// Fiecare caz pornește de la un partener complet eligibil (cazul de control,
// care TREBUIE alocat) și strică un singur lucru. Pasul 12-P2 a deschis
// portofoliul și contului nou (doar rol_solicitat, fără firmă): cazul
// „cont nou” verifică exact acest drum.
// În plus: doi candidați (unul neaprobat, unul eligibil) → e ales cel eligibil;
// jurnalul nu conține id-ul, firma sau emailul partenerului; eligibilitatea
// necitibilă → comanda rămâne in_cautare_partener.
// Nimic nu ajunge la Supabase (lib/supabaseAdmin e simulat).
// Rulare: node scripts/test-alocare-eligibilitate.js

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, RADACINA } = sim;
const { incearcaAlocarePartener } = require(path.join(RADACINA, 'lib/aloca-partener.js'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

const P = 'p-candidat';
const SERV = 's-robinet';

// Starea de pornire: partenerul P poate primi comenzi și are serviciul bifat.
function stareEligibila() {
  return {
    comenzi: [{ id: 'c-1', nr_comanda: 'MD-1', client_id: 'client-1', catalog_serviciu_id: SERV, tara_cod: 'RO', regiune: null, localitate: 'Iași', data_programata: '2026-11-25', ora_inceput_programata: '09:00', ora_sfarsit_programata: '11:00', status: 'in_cautare_partener', partener_id: null }],
    catalog_servicii: [{ id: SERV, cod_esco: null, titlu: 'Montaj robinet' }],
    partener_servicii_active: [{ id: 'psa-1', partener_id: P, catalog_serviciu_id: SERV, activ: true }],
    partener_competente: [],
    parteneri_disponibilitate: [{ partener_id: P, status_live: 'disponibil', tara_cod: 'RO', judete: ['IS'] }],
    partner_angajati: [],
    partners: [{ id: P, partner_type: 'servicii_tehnice', status_verificare: 'approved', contract_semnat: true, entitate_platforma_id: null, nume_firma: 'Test SRL' }],
    partner_conturi_bancare: [{ id: 'cb-1', partner_id: P, activ: true }],
    profiles: [{ id: P, status: 'activ', roles: ['client', 'partener_servicii'], rol_solicitat: 'partener_servicii' }, { id: 'client-1', status: 'activ', roles: ['client'] }],
    backoffice_config: [],
  };
}

const CAZURI = [
  ['control: partener eligibil', () => {}, true],
  ['status_live „indisponibil”', (t) => { t.parteneri_disponibilitate[0].status_live = 'indisponibil'; }, false],
  ['fără rând de disponibilitate', (t) => { t.parteneri_disponibilitate = []; }, false],
  ['neaprobat (pending_review)', (t) => { t.partners[0].status_verificare = 'pending_review'; }, false],
  ['respins (rejected)', (t) => { t.partners[0].status_verificare = 'rejected'; }, false],
  ['fără contract semnat', (t) => { t.partners[0].contract_semnat = false; }, false],
  ['fără cont bancar activ (IBAN)', (t) => { t.partner_conturi_bancare = []; }, false],
  ['cont suspendat', (t) => { t.profiles[0].status = 'suspended'; }, false],
  ['cont nou 12-P2: doar rol_solicitat, fără firmă (partners), servicii bifate', (t) => {
    t.partners = []; t.partner_conturi_bancare = []; t.profiles[0].roles = ['client'];
  }, false],
];

(async () => {
  for (const [nume, strica, asteptat] of CAZURI) {
    const t = stareEligibila();
    strica(t);
    DB.tabele = t;
    DB.utilizatori = {};
    let r;
    try { r = await incearcaAlocarePartener('c-1'); } catch (e) { r = { alocat: false, motiv: 'exceptie: ' + e.message }; }
    const comanda = DB.tabele.comenzi[0];
    if (asteptat) {
      verifica(r.alocat === true && comanda.partener_id === P, `${nume}: trebuia alocat (${JSON.stringify(r)})`);
    } else {
      verifica(r.alocat === false && comanda.partener_id !== P && comanda.status === 'in_cautare_partener', `${nume}: NU trebuia alocat, dar a fost (${JSON.stringify(r)}, status comandă: ${comanda.status})`);
    }
  }
  // Doi candidați cu serviciul bifat: primul neaprobat, al doilea eligibil → e ales al doilea.
  {
    const t = stareEligibila();
    const Q = 'p-neaprobat';
    t.partener_servicii_active.unshift({ id: 'psa-0', partener_id: Q, catalog_serviciu_id: SERV, activ: true });
    t.parteneri_disponibilitate.unshift({ partener_id: Q, status_live: 'disponibil', tara_cod: 'RO', judete: ['IS'] });
    t.partners.unshift({ id: Q, partner_type: 'servicii_tehnice', status_verificare: 'pending_review', contract_semnat: false, entitate_platforma_id: null, nume_firma: 'Nume Firma Secretă SRL' });
    t.profiles.unshift({ id: Q, status: 'activ', roles: ['client', 'partener_servicii'], email: 'secret@example.com' });
    DB.tabele = t;
    DB.utilizatori = {};
    // Jurnalul: fără id de partener, nume de firmă sau email.
    const jurnal = [];
    const [w, e, l] = [console.warn, console.error, console.log];
    console.warn = (...a) => jurnal.push(a.join(' ')); console.error = (...a) => jurnal.push(a.join(' ')); console.log = (...a) => jurnal.push(a.join(' '));
    let r;
    try { r = await incearcaAlocarePartener('c-1'); } finally { console.warn = w; console.error = e; console.log = l; }
    verifica(r.alocat === true && r.partener_id === P && DB.tabele.comenzi[0].partener_id === P, `amestec: e ales partenerul eligibil, nu cel neaprobat (${JSON.stringify(r)})`);
    const text = jurnal.join('\n');
    verifica(/in_verificare/.test(text) && !text.includes(Q) && !/Secretă|secret@example\.com/.test(text), `jurnalul: motivul pe scurt, fără id / firmă / email (${jurnal.filter((x) => /aloca-partener/.test(x)).join(' | ')})`);
  }

  // Eroare la citirea eligibilității: comanda rămâne în căutare (nu se alocă „pe încredere”).
  {
    const t = stareEligibila();
    delete t.partner_conturi_bancare; // tabelul lipsă → eroare de citire
    DB.tabele = t;
    const r = await incearcaAlocarePartener('c-1');
    verifica(r.alocat === false && r.motiv === 'eligibilitate_indisponibila' && DB.tabele.comenzi[0].status === 'in_cautare_partener', `eligibilitatea necitibilă → comanda rămâne in_cautare_partener (${JSON.stringify(r)})`);
  }

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

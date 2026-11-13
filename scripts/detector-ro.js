// scripts/detector-ro.js — detectorul de română pentru paginile publice (10 oct. 2026)
// și, cu --cu-cont, pentru paginile cu cont (14 oct. 2026).
//
// Deschide fiecare pagină publică cu localStorage gol (prima vizită → engleză)
// și raportează, pe fiecare pagină și lățime:
//   - lang-ul paginii;
//   - textele românești vizibile (diacritice și cuvinte frecvente), inclusiv în
//     placeholder / title / aria-label / alt, titlu și meta description — cu
//     selector; numele proprii, orașele și adresele sunt excluse;
//   - chei netraduse afișate (ex. nav.contact);
//   - erori JS, depășiri pe orizontală, butoane / intrări de meniu ieșite din chenar;
//   - dacă pagina s-a încărcat și s-a randat (pasul 11-H1): o pagină care nu
//     s-a încărcat (server oprit, 404) sau a rămas albă / la „Se verifică
//     accesul...” e raportată ca NERANDATĂ și detectorul iese cu cod 1 — nu
//     mai trece drept „0 texte românești”;
//   - aceleași verificări cu meniul lateral, fereastra de cont și preferințele
//     cookie deschise.
// LIMBA=ro rulează testul inversat (selector → română: doar chei netraduse,
// erori și depășiri).
//
// --cu-cont: paginile cu cont (dashboard-uri și completarea profilului de
// partener), deschise cu un utilizator simulat. Supabase (auth + interogări)
// și /api/partener|client|comenzi răspund cu date simulate (vezi
// sesiuneSimulata și RASPUNSURI_SIMULATE) — nimic nu ajunge la producție.
//
// Cerințe: un server local care servește site-ul cu /api (ex. `vercel dev`) și
// Playwright instalat separat (nu e dependență a proiectului):
//   npm i --no-save playwright && npx playwright install chromium
//
// Depășirea pe orizontală (pasul 11-H1): pe lângă scrollWidth, se măsoară
// marginea dreaptă a fiecărui element vizibil. Paginile cu html/body
// { overflow-x: clip } ascund depășirea de scrollWidth, dar conținutul tot e
// tăiat; elementele din containere derulabile (overflow-x: auto / scroll) și
// sertarele închise (complet în afara ecranului) nu se numără.
//
// Captura se face înaintea stărilor ascunse (meniu, cont, cookie), ca să
// arate pagina, nu fereastra de preferințe.
//
// Utilizare:
//   node scripts/detector-ro.js [--base http://localhost:3000] [--latimi 390,1366]
//                               [--out ./detector-out] [--cu-cont]
//                               [--profil extern|propriu|inchirieri|curier|materiale|asigurari] [pagina ...]
// --profil (doar cu --cu-cont): contul simulat — furnizor extern în verificare
// (implicit), furnizorul propriu al platformei sau furnizor de închirieri.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const PUBLICE = ['index', 'servicii-urgente', 'despre-noi', 'afla-ce-facem', 'mydarrin-contact', 'mydarrin-app-mobile',
  // Pasul 11-C4: paginile de categorie → catalogul filtrat (redirect 301).
  'mydarrin-catalog', 'mydarrin-catalog.html?categorie=servicii&subcategorie=instalatii-electrice', 'mydarrin-catalog.html?categorie=materiale',
  'mydarrin-marketplace', 'mydarrin-marketplace-materiale.html?slug=montaj-parchet-laminat&type=servicii&nace=43.33',
  'mydarrin-produs.html?slug=inlocuire-becuri-corpuri&type=servicii', 'mydarrin-checkout', 'mydarrin-cos',
  'mydarrin-creeaza-deviz', 'confirmare-livrare', 'reset-password', 'mydarrin-cum-functioneaza', 'cum-comanzi', 'cum-platesc',
  'cum-programez-serviciu', 'cum-prestam-livram', 'intrebari-frecvente-clienti', 'intrebari-frecvente-parteneri',
  'garantii-si-asigurari', 'ghidul-asiguratorului', 'reclamatii', 'cum-devii-furnizor-servicii',
  'cum-devii-partenerul-nostru', 'cum-devii-curier-de-cartier', 'cum-devii-furnizor-materiale', 'cum-devii-operator-inchirieri',
  'mydarrin-investitori', 'mydarrin-pitch-deck', 'acord-confidentialitate', 'acces-temporar', 'mydarrin-termeni',
  'mydarrin-politica-confidentialitate'];

// Paginile cu cont. Wizard-ul de partener e „Completare profil partener”
// (decizie LM, 14 oct. 2026): nu mai e pagină publică, se testează ca dashboard.
const CU_CONT = ['mydarrin-dashboard-client', 'mydarrin-dashboard-partener', 'mydarrin-dashboard-furnizor',
  'mydarrin-devino-partener-wizard', 'mydarrin-admin-catalog', 'mydarrin-rolurile-mele',
  // Pasul 11-I1: panoul investitorului, fiecare secțiune (panourile ascunse nu se văd altfel).
  'mydarrin-panou-investitor', 'mydarrin-panou-investitor.html#participatii', 'mydarrin-panou-investitor.html#subscrieri', 'mydarrin-panou-investitor.html#exit',
  'mydarrin-panou-investitor.html#istoric', 'mydarrin-panou-investitor.html#indicatori', 'mydarrin-panou-investitor.html#datele-mele'];

const arg = process.argv.slice(2);
const opt = (n, d) => { const i = arg.indexOf('--' + n); if (i === -1) return d; const v = arg[i + 1]; arg.splice(i, 2); return v; };
const flag = (n) => { const i = arg.indexOf('--' + n); if (i === -1) return false; arg.splice(i, 1); return true; };
const BASE = opt('base', 'http://localhost:3000');
const latimi = opt('latimi', '390,1366').split(',').map(Number);
const OUT = opt('out', path.join(process.cwd(), 'detector-out'));
const CU_CONT_MOD = flag('cu-cont');
const PROFIL = opt('profil', 'extern');
let pagini = arg.length ? arg : (CU_CONT_MOD ? CU_CONT : PUBLICE);
const LIMBA = process.env.LIMBA || 'en';
fs.mkdirSync(OUT, { recursive: true });

// ── Sesiunea simulată (--cu-cont) ─────────────────────────────────────────
const UTILIZATOR_SIMULAT = {
  id: '00000000-0000-4000-8000-00000000d37e', email: 'partener.test@example.com',
  email_confirmed_at: '2026-10-01T08:00:00Z', user_metadata: { nume: 'Partener Test' },
};
// Rulează în pagină înaintea oricărui script: window.supabaseClient și
// window.MyDarrinAuth devin obiecte simulate, iar atribuirile din
// lib/supabaseClient.js / account-system.js sunt ignorate.
function sesiuneSimulata(user) {
  const lant = (rezultat) => {
    const p = new Proxy(function () {}, {
      get: (t, k) => (k === 'then' ? (ok) => ok(rezultat) : () => p),
      apply: () => p,
    });
    return p;
  };
  const sesiune = { access_token: 'token-simulat', user };
  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: sesiune }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: () => lant({ data: [], error: null, count: 0 }),
    rpc: () => lant({ data: null, error: null }),
    storage: { from: () => lant({ data: null, error: null }) },
    channel: () => lant({}),
    removeChannel: () => {},
  };
  const auth = new Proxy({
    getCurrentUser: async () => user,
    getUserRoles: async () => ['partener_servicii'],
    hasRole: async () => true,
    performLogout: () => {},
  }, { get: (t, k) => (k in t ? t[k] : async () => null) });
  const fix = (nume, val) => Object.defineProperty(window, nume, { configurable: true, get: () => val, set: () => {} });
  fix('supabaseClient', client);
  fix('MyDarrinAuth', auth);
}

// Răspunsurile API pentru contul simulat. Profilul are compania completă,
// dar fără coduri NACE și fără clauza de zonă.
const RASPUNSURI_SIMULATE = {
  '/api/partener/wizard-companie': { ok: true, partner: { nume_firma: 'Test Instalatii SRL', cui: 'RO12345678', partner_type: 'servicii_tehnice', status_verificare: 'pending_review', tip_entitate_legala: 'srl', is_treasury_account: false, regiune_cod: null }, conturi: [] },
  '/api/partener/wizard-nace': { ok: true, coduri: [] },
  '/api/partener/wizard-utilaje': { ok: true, utilaje: [] },
  '/api/partener/wizard-angajati': { ok: true, angajati: [], total: 0, total_disponibili: 0 },
  '/api/partener/wizard-certificari': { ok: true, certificari: [], cerinte: [], tara: 'RO' },
  '/api/partener/wizard-alocare': { ok: true, alocari: [] },
  '/api/partener/status-aplicare': { ok: true, status: 'pending_review', partner_type: 'servicii_tehnice', documente_respinse: [], darrin_ai_activ: false, darrin_ai_raport: null },
  '/api/partener/cont': { ok: true, partner: { nume_firma: 'Test Instalatii SRL', partner_type: 'servicii_tehnice', status_verificare: 'pending_review', regiune_cod: 'BC', contract_semnat: false }, profil: { email: 'partener.test@example.com', tara: 'RO', limba: 'en' }, are_cont_bancar: false, kpi: { moneda: 'RON', comenzi_active: 0, comenzi_luna: 0, total_activ: 0, total_eliberat: 0, castig_luna: 0, castig_azi: 0 }, documente: [], facturi: [], garantii: [], polite: [] },
  '/api/partener/escrow-tracker': { ok: true, total_activ: 0, total_eliberat: 0, moneda: 'Lei', alocari: [] },
  '/api/partener/facturi': { ok: true, facturabile: [], facturi: [] },
  // profil incomplet: cardul „Profil incomplet” apare și e verificat și el
  '/api/partener/profil-status': { ok: true, complet: false, lipsa: ['nace', 'clauza_zona'], pas: 3 },
  // Pasul 11-I1: panoul investitorului.
  '/api/investitori/portofoliu': { ok: true, kyc_status: 'aprobat', actiuni: 10, valoare_investita: 10000, in_asteptare: 500, pct_companie: 1, runda: null,
    subscrieri: [{ id: 's1', status: 'aprobat', actiuni: 10, valoare_investita: 10000, instrument: 'actiuni', creat_la: '2025-01-05T10:00:00Z', aprobat_la: '2025-02-10T10:00:00Z', sfarsit_lock_up: '2026-02-10T10:00:00Z', actiuni_vandabile_acum: 10, runda: { denumire_ro: 'Test', denumire_en: 'Test', moneda: 'EUR' } }],
    exit: { buyback_disponibil: true, discount_buyback_pct: 10, lock_up_luni: 12, actiuni_vandabile_acum: 8 } },
  '/api/investitori/kyc': { ok: true, lipsa: [], kyc: { status: 'in_verificare', pas_curent: 5, iban_mascat: '•••• 1234', rezidenta_fiscala_tara: 'RO', tip_document: 'ci', act_valabil_pana: '2026-12-01', adresa_domiciliu: { strada: 'Str. Test 1', localitate: 'Bacau', tara: 'RO' } } },
  '/api/investitori/exit': { ok: true, cereri: [{ id: 'c1', tip: 'buyback', numar_actiuni: 2, suma_calculata: null, status: 'in_procesare', creat_la: '2026-10-01T10:00:00Z', anulat_la: null }] },
  '/api/investitori/istoric': { ok: true, evenimente: [{ tip: 'dosar_trimis', data: '2026-10-01T10:00:00Z', titlu: { ro: 'Dosar trimis', en: 'Application submitted' }, motiv: null, runda: null, valoare_investita: null, moneda: null, numar_actiuni: null }] },
  '/api/investitori/indicatori': { ok: true, indicatori: { comenzi_total: 1, comenzi_luna: 1, parteneri_activi: 1, gmv_total: 10, revenue_total: 1, revenue_luna: 1 }, moneda: 'EUR' },
};

// Profilul contului simulat (/api/cont/profil, pasul 10b): rolurile care
// deschid toate dashboard-urile verificate (client, partener, furnizor), ca
// paza din cont-dashboard.js să nu redirecționeze; partener în verificare,
// fără cont bancar — antetul de identitate și benzile de stare apar și ele;
// pasul 10c: poate_vinde / motiv_nu_poate_vinde / furnizor_propriu, ca în API.
const PROFIL_SIMULAT = {
  ok: true, email: 'partener.test@example.com', nume: 'Partener Test',
  roles: ['client', 'partener_servicii', 'partener_materiale', 'investor'], roluri_dashboard: ['partener_servicii', 'partener_materiale'],
  destinatie: '/mydarrin-rolurile-mele', tip_destinatie: 'alegere', furnizor_propriu: false,
  prenume: 'Partener', nume_familie: 'Test', telefon: '+40700000000', tara: 'RO',
  partener: { nume_firma: 'Test Instalatii SRL', partner_type: 'servicii_tehnice', rol: 'partener_servicii', status_verificare: 'pending_review', contract_semnat: false, cont_bancar: false, motiv_respingere: null,
    poate_vinde: false, motiv_nu_poate_vinde: 'in_verificare' },
  // Pasul 11-L: ruta de investitor începută, netrimisă („Rolurile mele” arată „Continuă”).
  investitor: { status: 'ciorna', pas_curent: 2, trimis_la: null, motiv_respingere: null, motiv_respingere_en: null },
};

// Variantele de cont (pasul 11-H1): furnizorul propriu al platformei (HBP) și
// un furnizor de închirieri, pe lângă contul implicit de mai sus.
const PROFILURI_SIMULATE = {
  extern: PROFIL_SIMULAT,
  propriu: {
    ok: true, email: 'contact@homebestpal.ro', nume: null, roles: ['client', 'partener_materiale'], roluri_dashboard: ['partener_materiale'],
    destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol', furnizor_propriu: true,
    partener: { nume_firma: 'Home Best Pal', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'approved', contract_semnat: false, cont_bancar: false, motiv_respingere: null,
      poate_vinde: true, motiv_nu_poate_vinde: null },
  },
  inchirieri: {
    ok: true, email: 'partener.test@example.com', nume: 'Partener Test', roles: ['partener_inchirieri'], roluri_dashboard: ['partener_inchirieri'],
    destinatie: '/mydarrin-dashboard-furnizor.html?type=inchirieri', tip_destinatie: 'rol', furnizor_propriu: false,
    partener: { nume_firma: 'Test Utilaje SRL', partner_type: 'inchirieri_utilaje', rol: 'partener_inchirieri', status_verificare: 'approved', contract_semnat: true, cont_bancar: true, motiv_respingere: null,
      poate_vinde: true, motiv_nu_poate_vinde: null },
  },
  // Pasul 11-T2: curierul de cartier, furnizorul de materiale (extern) și
  // asigurătorul / brokerul, aprobați. `api` înlocuiește răspunsurile implicite
  // de mai sus; `pagini` sunt paginile pe care le deschide acest cont.
  curier: {
    ok: true, email: 'curier.test@example.com', nume: 'Curier Test', roles: ['partener_curier'], roluri_dashboard: ['partener_curier'],
    destinatie: '/mydarrin-dashboard-partener.html', tip_destinatie: 'rol', furnizor_propriu: false,
    partener: { nume_firma: 'Test Curier SRL', partner_type: 'curier_utilitara', rol: 'partener_curier', status_verificare: 'approved', contract_semnat: true, cont_bancar: true, motiv_respingere: null,
      poate_vinde: true, motiv_nu_poate_vinde: null },
    pagini: ['mydarrin-dashboard-partener', 'mydarrin-rolurile-mele', 'mydarrin-devino-partener-wizard'],
    panouri: ['curse', 'activ', 'zona-acoperire', 'venituri', 'documente', 'profil'],
    api: {
      '/api/partener/status-aplicare': { ok: true, status: 'approved', partner_type: 'curier_utilitara', documente_respinse: [], darrin_ai_activ: false, darrin_ai_raport: null },
      '/api/partener/wizard-companie': { ok: true, partner: { nume_firma: 'Test Curier SRL', cui: 'RO23456789', partner_type: 'curier_utilitara', status_verificare: 'approved', tip_entitate_legala: 'srl', is_treasury_account: false, regiune_cod: 'BC' }, conturi: [] },
      '/api/partener/cont': { ok: true, partner: { nume_firma: 'Test Curier SRL', partner_type: 'curier_utilitara', status_verificare: 'approved', regiune_cod: 'BC', contract_semnat: true }, profil: { email: 'curier.test@example.com', tara: 'RO', limba: 'en' }, are_cont_bancar: true, kpi: { moneda: 'RON', comenzi_active: 1, comenzi_luna: 3, total_activ: 120, total_eliberat: 340, castig_luna: 340, castig_azi: 40 }, documente: [], facturi: [], garantii: [], polite: [] },
      '/api/partener/zona-curier': { ok: true, zone: [{ id: 'z1', tara_cod: 'RO', regiune_cod: 'BC', localitate: 'Bacău', raza_livrare_km: 15 }] },
      '/api/partener/sarcini': { ok: true, primite: [], active: [], finalizate: [] },
      '/api/partener/profil-status': { ok: true, complet: true, lipsa: [], pas: null },
    },
  },
  materiale: {
    ok: true, email: 'vanzari.test@example.com', nume: 'Furnizor Test', roles: ['partener_materiale'], roluri_dashboard: ['partener_materiale'],
    destinatie: '/mydarrin-dashboard-furnizor.html?type=materiale', tip_destinatie: 'rol', furnizor_propriu: false,
    partener: { nume_firma: 'Test Materiale SRL', partner_type: 'furnizor_materiale', rol: 'partener_materiale', status_verificare: 'approved', contract_semnat: true, cont_bancar: true, motiv_respingere: null,
      poate_vinde: true, motiv_nu_poate_vinde: null },
    pagini: ['mydarrin-dashboard-furnizor.html?type=materiale', 'mydarrin-rolurile-mele', 'mydarrin-devino-partener-wizard'],
    panouri: ['comenzi', 'stocuri', 'produse', 'import', 'venituri', 'garantii', 'documente', 'adrese'],
    api: {
      '/api/partener/status-aplicare': { ok: true, status: 'approved', partner_type: 'furnizor_materiale', documente_respinse: [], darrin_ai_activ: false, darrin_ai_raport: null },
      '/api/partener/wizard-companie': { ok: true, partner: { nume_firma: 'Test Materiale SRL', cui: 'RO34567890', partner_type: 'furnizor_materiale', status_verificare: 'approved', tip_entitate_legala: 'srl', is_treasury_account: false, regiune_cod: 'BC' }, conturi: [] },
      '/api/partener/cont': { ok: true, partner: { nume_firma: 'Test Materiale SRL', partner_type: 'furnizor_materiale', status_verificare: 'approved', regiune_cod: 'BC', contract_semnat: true }, profil: { email: 'vanzari.test@example.com', tara: 'RO', limba: 'en' }, are_cont_bancar: true, kpi: { moneda: 'RON', comenzi_active: 0, comenzi_luna: 2, total_activ: 0, total_eliberat: 900, castig_luna: 900, castig_azi: 0 }, documente: [], facturi: [], garantii: [], polite: [] },
      '/api/partener/discounturi': { ok: true, discounturi: [], limite: { min: 5, max: 15 } },
      '/api/partener/profil-status': { ok: true, complet: false, lipsa: ['clauza_zona'], pas: 7 },
    },
  },
  asigurari: {
    ok: true, email: 'broker.test@example.com', nume: 'Broker Test', roles: ['partener_asigurari'], roluri_dashboard: ['partener_asigurari'],
    destinatie: '/mydarrin-dashboard-partener.html', tip_destinatie: 'rol', furnizor_propriu: false,
    partener: { nume_firma: 'Test Broker SRL', partner_type: 'asigurari', rol: 'partener_asigurari', status_verificare: 'approved', contract_semnat: true, cont_bancar: true, motiv_respingere: null,
      poate_vinde: true, motiv_nu_poate_vinde: null },
    pagini: ['mydarrin-dashboard-partener', 'mydarrin-rolurile-mele', 'mydarrin-devino-partener-wizard'],
    panouri: ['polite', 'daune', 'tipuri-polita', 'venituri', 'documente', 'profil'],
    api: {
      '/api/partener/status-aplicare': { ok: true, status: 'approved', partner_type: 'asigurari', documente_respinse: [], darrin_ai_activ: false, darrin_ai_raport: null },
      '/api/partener/wizard-companie': { ok: true, partner: { nume_firma: 'Test Broker SRL', cui: 'RO45678901', partner_type: 'asigurari', status_verificare: 'approved', tip_entitate_legala: 'srl', is_treasury_account: false, regiune_cod: 'BC' }, conturi: [] },
      '/api/partener/cont': { ok: true, partner: { nume_firma: 'Test Broker SRL', partner_type: 'asigurari', status_verificare: 'approved', regiune_cod: 'BC', contract_semnat: true }, profil: { email: 'broker.test@example.com', tara: 'RO', limba: 'en' }, are_cont_bancar: true, kpi: { moneda: 'RON', comenzi_active: 0, comenzi_luna: 4, total_activ: 0, total_eliberat: 260, castig_luna: 260, castig_azi: 0 }, documente: [], facturi: [], garantii: [], polite: [] },
      '/api/partener/tipuri-polita': { ok: true, tipuri: [{ id: 't1', tip_polita: 'CAR', limita_acoperire_eur: 50000, comision_pct: 8 }] },
      '/api/partener/dosare-dauna': { ok: true, dosare: [
        { id: 'd1', claim_id: 'CLAIM-2026-CMD0001-EXE', tip: 'EXE', descriere: 'Water leak after the installation.', valoare_estimata: 1200, valoare_aprobata: null, moneda: 'RON', status: 'deschis', decizie_motiv: null, creat_la: '2026-11-02T10:00:00Z', actualizat_la: '2026-11-02T10:00:00Z', nr_comanda: 1, ale_mele: false },
        { id: 'd2', claim_id: 'CLAIM-2026-CMD0002-MAT', tip: 'MAT', descriere: 'Damaged tiles on delivery.', valoare_estimata: 300, valoare_aprobata: 250, moneda: 'RON', status: 'aprobat', decizie_motiv: null, creat_la: '2026-10-20T10:00:00Z', actualizat_la: '2026-10-22T10:00:00Z', nr_comanda: 1, ale_mele: true },
      ] },
      '/api/partener/profil-status': { ok: true, complet: true, lipsa: [], pas: null },
    },
  },
};
if (!PROFILURI_SIMULATE[PROFIL]) { console.error(`--profil necunoscut: ${PROFIL} (${Object.keys(PROFILURI_SIMULATE).join(' | ')})`); process.exit(2); }
// Paginile implicite ale profilului (pasul 11-T2).
if (CU_CONT_MOD && !arg.length && PROFILURI_SIMULATE[PROFIL].pagini) pagini = PROFILURI_SIMULATE[PROFIL].pagini;

// Faza „eroare” (pasul 11-T2): răspunsul API în forma comună (lib/raspuns-eroare.js).
// Rămân valide doar căile care aleg tipul de dashboard și profilul contului.
const EROARE_SIMULATA = require('../lib/raspuns-eroare').corpEroare('EROARE_SERVER',
  'Nu am putut încărca datele. Încearcă din nou.', 'We could not load the data. Please try again.');
const CAI_FARA_EROARE = ['/api/partener/status-aplicare', '/api/partener/cont', '/api/partener/profil-status'];

// Pagina adminului de catalog (pasul 9): răspunsuri POST pe acțiune.
// Antetul cu drepturi; listele încep goale (prima vizită).
const RASPUNSURI_ADMIN = {
  profil: { ok: true, superadmin: false, toate_capitolele: false, tara: null,
    capitole: [{ cod: 'F', titlu_ro: 'Construcții și renovări', titlu_en: 'Construction and renovation', tip_partener: 'servicii' }] },
  lista_servicii: { ok: true, servicii: [] },
  retete_propuse_lista: { ok: true, retete: [] },
};

function detecteaza(limba) {
  const EXCEPTII = /\b(My Darrin|Darrin AI|Darrin|Home Best Pal|SRL|LTD|București|Bucureşti|Iași|Chișinău|Cluj-Napoca|Timișoara|Constanța|Brașov|Bacău|Galați|Ploiești|Pitești|Târgu(?: Mureș| Neamț| Jiu)?|Brăila|Botoșani|Buzău|Focșani|Târgoviște|Reșița|Bistrița|Călărași|Zalău|Sfântu Gheorghe|Bârlad|Mediaș|Onești|Piatra Neamț|Râmnicu Vâlcea|Neamț|România|Română|Ελληνικά|Български|Türkçe|Français|Deutsch|Magyar|Polski|Sector \d|Păcurari|Str\.|Strada|Bd\.|Calea|nr\.|jud\.|Județul \w+|Mureș)\b/g;
  // cuvinte lungi: indiferent de majuscule; scurte: doar cu literă mică (DE, LA, AL pot fi coduri)
  const RO_CUV = /(?<!\p{L})(?:(?:[Pp]entru|[Ss]erviciu|[Ss]ervicii|[Cc]omandă|[Cc]omenzi|[Pp]reț|[Pp]rețuri|[Aa]lege|[Vv]ezi|[Dd]espre|[Cc]ont|[Cc]oș|[Cc]ătre|[Uu]rmător|[Îî]napoi|[Aa]casă|[Ll]ucrare|[Ll]ucrări|[Nn]ivel|[Gg]aranție|[Pp]lată|[Nn]ostru|[Nn]oastră|[Ee]ste|[Ss]unt|[Gg]ratuit|[Gg]ratuită|[Ll]ivrare|[Cc]erere|[Ss]olicită|[Ss]olicitare|[Zz]onă|[Pp]arteneri|[Cc]lienți|[Ii]nclus|[Aa]daugă|[Oo]rice|[Mm]inim|[Tt]arif|[Ll]ună|[Zz]ile|[Oo]ră|[Oo]re|[Mm]anoperă|[Ee]chipă|[Ii]ntervenție)|(?:și|sau|ți|tău|noi|din|cu|la|de|pe|în|un|al|ale))(?!\p{L})/u;
  const DIAC = /[ăâîșțşţĂÂÎȘȚŞŢ]/;
  const H = innerHeight, W = innerWidth;
  const vizibil = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sel = (el) => { const p = []; for (let e = el; e && e.nodeType === 1 && p.length < 4; e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) { s += '#' + e.id; p.unshift(s); break; } const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).filter((x) => x && !/[:\[\]/]/.test(x))[0]; if (c) s += '.' + c; p.unshift(s); } return p.join(' > '); };
  const eRo = (t) => {
    const cur = t.replace(EXCEPTII, ' ');
    if (limba === 'ro') return false;
    return DIAC.test(cur) || RO_CUV.test(cur);
  };
  const gasite = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => { const pe = n.parentElement; if (!pe || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(pe.tagName)) return NodeFilter.FILTER_REJECT; return n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
  while (w.nextNode()) {
    const n = w.currentNode, t = n.data.replace(/\s+/g, ' ').trim();
    if (!vizibil(n.parentElement)) continue;
    if (n.parentElement.closest('[translate="no"],.notranslate,[data-i18n-skip],code,pre,textarea')) continue;
    if (eRo(t)) gasite.push({ sel: sel(n.parentElement), text: t.slice(0, 160) });
    if (/^[a-z]+(\.[a-z_0-9]+){1,4}$/.test(t) && !/\.(com|ro|md|eu|net|org)$/.test(t)) gasite.push({ sel: sel(n.parentElement), text: 'CHEIE NETRADUSĂ: ' + t });
  }
  document.querySelectorAll('[placeholder],[title],[aria-label],img[alt]').forEach((el) => {
    if (!vizibil(el) && el.tagName !== 'IMG') return;
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) { const v = el.getAttribute(a); if (v && eRo(v)) gasite.push({ sel: sel(el) + '[' + a + ']', text: v.slice(0, 160) }); }
  });
  if (eRo(document.title)) gasite.push({ sel: 'title', text: document.title });
  const md = document.querySelector('meta[name="description"]'); if (md && eRo(md.content || '')) gasite.push({ sel: 'meta[description]', text: md.content.slice(0, 160) });
  // butoane / linkuri de meniu al căror text iese din chenar
  const rupte = [];
  // Caruselele și filele derulabile sunt tăiate intenționat la margine (pasul 11-A, 11-I1).
  const derulabil = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { if (e.hasAttribute('data-carusel')) return true; const ox = getComputedStyle(e).overflowX; if (ox === 'auto' || ox === 'scroll') return true; } return false; };
  document.querySelectorAll('button, a.sb-item, nav a, .nav-lnk, #mobile-bottom-nav a, #mobile-bottom-nav button').forEach((b) => {
    if (!vizibil(b)) return; const r = b.getBoundingClientRect(); if (r.width < 20) return;
    if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== 'visible') rupte.push(sel(b) + ' «' + b.innerText.trim().slice(0, 30) + '»');
    if (r.right > W + 1 && r.left < W - 1 && r.left >= 0 && !derulabil(b)) rupte.push('iese din ecran: ' + sel(b) + ' «' + b.innerText.trim().slice(0, 30) + '»');
  });
  // Elemente tăiate la dreapta ecranului (vezi antetul fișierului). Caruselele
  // animate (bandă care trece prin fereastră, marcate cu data-carusel) sunt
  // tăiate intenționat și nu se numără (pasul 11-A).
  let dreaptaMax = 0;
  const taiate = [];
  document.querySelectorAll('body *').forEach((el) => {
    if (!vizibil(el) || /^(SCRIPT|STYLE|svg|path|OPTION)$/i.test(el.tagName)) return;
    const r = el.getBoundingClientRect();
    if (r.right <= W + 1 || r.left >= W - 1 || r.right <= 0) return;
    if (derulabil(el)) return;
    dreaptaMax = Math.max(dreaptaMax, Math.round(r.right));
    if (taiate.length < 10 && !taiate.some((t) => el.closest(t.s))) taiate.push({ s: sel(el), t: (el.innerText || '').trim().slice(0, 30) });
  });
  // Pagina s-a randat: are limbă, text vizibil și nu a rămas la bariera de acces.
  const poarta = document.getElementById('auth-gate-overlay');
  const text = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim();
  const randata = !!document.documentElement.lang && text.length > 40 && !(poarta && vizibil(poarta));
  return { lang: document.documentElement.lang, sw: Math.max(document.documentElement.scrollWidth, dreaptaMax), W, gasite, rupte: [...new Set(rupte)].slice(0, 20),
    taiate: taiate.map((t) => t.s + ' «' + t.t + '»'), randata, text: text.length };
}

(async () => {
  const b = await chromium.launch();
  const total = [];
  for (const w of latimi) {
    for (const pg of pagini) {
      const cfg = w < 800 ? { ...devices['iPhone 13'], viewport: { width: w, height: 844 } } : { viewport: { width: w, height: 900 } };
      const ctx = await b.newContext({ ...cfg, locale: 'en-GB' });
      const stare = { eroare: false };
      await ctx.addInitScript((l) => { try { if (!sessionStorage.getItem('__init')) { localStorage.clear(); if (l !== 'en') localStorage.setItem('myd_lang_v1', l); sessionStorage.setItem('__init', '1'); } } catch (e) {} }, LIMBA);
      if (CU_CONT_MOD) {
        const profil = PROFILURI_SIMULATE[PROFIL];
        await ctx.addInitScript(sesiuneSimulata, { ...UTILIZATOR_SIMULAT, email: profil.email });
        // Contul e simulat: nicio cerere către Supabase sau către API-urile cu cont nu pleacă.
        await ctx.route(/\.supabase\.co\//, (r) => r.abort());
        await ctx.route(/\/api\/admin\/(ruta-incadrare|catalog)$/, (r) => {
          let corp = {};
          try { corp = JSON.parse(r.request().postData() || '{}'); } catch (e) { corp = {}; }
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RASPUNSURI_ADMIN[corp.action] || { ok: true }) });
        });
        await ctx.route(/\/api\/cont\/profil/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({}, profil, { api: undefined, pagini: undefined, panouri: undefined })) }));
        await ctx.route(/\/api\/(partener|client|investitori|marketplace)\//, (r) => {
          const cale = new URL(r.request().url()).pathname.replace(/\.js$/, '');
          // Faza „eroare” (pasul 11-T2): API-urile panourilor răspund cu eroarea în forma comună.
          if (stare.eroare && !CAI_FARA_EROARE.includes(cale)) {
            return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify(EROARE_SIMULATA) });
          }
          if (/\/api\/marketplace\//.test(cale)) return r.fallback();
          const raspunsuri = Object.assign({}, RASPUNSURI_SIMULATE, profil.api || {});
          const corp = r.request().method() === 'GET' ? (raspunsuri[cale] || { ok: true }) : { ok: true };
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corp) });
        });
      }
      const p = await ctx.newPage();
      const erori = []; p.on('pageerror', (e) => erori.push(e.message.slice(0, 120)));
      await p.route('**/api/comenzi/**', (r) => r.fulfill({ status: 599, body: '{}' }));
      // Încărcarea paginii: o eroare (server oprit, 404) nu mai trece neobservată.
      let incarcare = null;
      const raspunsPagina = await p.goto(BASE + '/' + pg + (/[?#]/.test(pg) ? '' : '.html'), { waitUntil: 'networkidle', timeout: 60000 })
        .catch((e) => { incarcare = e.message.split('\n')[0].slice(0, 120); return null; });
      if (!incarcare && raspunsPagina && raspunsPagina.status() >= 400) incarcare = 'HTTP ' + raspunsPagina.status();
      if (!incarcare && !raspunsPagina) incarcare = 'fără răspuns';
      await p.waitForTimeout(2500);
      await p.waitForFunction(() => !document.documentElement.classList.contains('myd-i18n-pending'), null, { timeout: 5000 }).catch(() => {});
      await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } scrollTo(0, 0); }).catch(() => {});
      await p.waitForTimeout(600);
      const r = await p.evaluate(detecteaza, LIMBA).catch((e) => ({ eroare: e.message }));
      if (incarcare) { r.randata = false; r.incarcare = incarcare; }
      // Captura paginii, înaintea stărilor ascunse.
      await p.screenshot({ path: path.join(OUT, `${LIMBA}${CU_CONT_MOD ? '_' + PROFIL : ''}_${pg.replace(/[?=&.]/g, '_')}_${w}.png`) }).catch(() => {});
      // Stări ascunse: meniul lateral, fereastra de cont, preferințele cookie.
      for (const [nume, deschide, inchide] of [
        ['meniu', 'typeof openSidebar==="function"&&(openSidebar(),true)', 'typeof closeSidebar==="function"&&closeSidebar()'],
        ['cont', 'typeof toggleAuthModal==="function"&&(toggleAuthModal(),true)', 'typeof toggleAuthModal==="function"&&toggleAuthModal()'],
        ['cookie', '(()=>{const b=[...document.querySelectorAll("#myd-consent-bar button")].find(x=>/Customise|Personalizează/.test(x.textContent));if(b){b.click();return true}return false})()', ''],
      ]) {
        const url0 = p.url();
        const ok = await p.evaluate(deschide).catch(() => false);
        if (!ok) continue;
        await p.waitForTimeout(700);
        // butonul a dus pe altă pagină (ex. „Cont” fără fereastră → index): nu e o stare a acestei pagini
        if (p.url() !== url0) { await p.goto(url0, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500); continue; }
        const s = await p.evaluate(detecteaza, LIMBA).catch(() => null);
        if (s && r.gasite) s.gasite.forEach((g) => r.gasite.push({ sel: '[' + nume + '] ' + g.sel, text: g.text }));
        if (inchide) await p.evaluate(inchide).catch(() => {});
        await p.waitForTimeout(300);
      }
      // Pasul 11-T2: panourile profilului (meniu, carduri, formulare), apoi
      // aceleași panouri cu API-urile în eroare — mesajul afișat e verificat și el.
      const panouri = CU_CONT_MOD ? PROFILURI_SIMULATE[PROFIL].panouri : null;
      if (panouri && await p.evaluate('typeof showPanel === "function"').catch(() => false)) {
        for (const faza of ['panou', 'eroare']) {
          if (faza === 'eroare') {
            stare.eroare = true;
            await p.reload({ waitUntil: 'networkidle' }).catch(() => {});
            await p.waitForTimeout(2500);
          }
          for (const id of panouri) {
            const ok = await p.evaluate((x) => { try { showPanel(x); return true; } catch (e) { return false; } }, id).catch(() => false);
            if (!ok) { r.gasite = (r.gasite || []).concat([{ sel: '[' + faza + ' ' + id + ']', text: 'PANOUL NU S-A DESCHIS' }]); continue; }
            await p.waitForTimeout(1200);
            const s = await p.evaluate(detecteaza, LIMBA).catch(() => null);
            if (s && r.gasite) s.gasite.forEach((g) => r.gasite.push({ sel: '[' + faza + ' ' + id + '] ' + g.sel, text: g.text }));
            if (faza === 'eroare' && s) r.mesajEroareVazut = r.mesajEroareVazut || await p.evaluate((t) => document.body.innerText.includes(t), EROARE_SIMULATA.mesaj.en).catch(() => false);
          }
        }
        if (!r.mesajEroareVazut) r.gasite.push({ sel: '[eroare]', text: 'MESAJUL EN DIN FORMA COMUNĂ NU APARE: ' + EROARE_SIMULATA.mesaj.en });
      }
      total.push({ pg, w, ...r, erori });
      await ctx.close();
    }
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, `detector-${LIMBA}${CU_CONT_MOD ? '-cu-cont-' + PROFIL : ''}.json`), JSON.stringify(total, null, 1));
  for (const r of total) {
    const unice = [...new Map((r.gasite || []).map((g) => [g.text, g])).values()];
    console.log(`${r.pg.padEnd(48)} ${String(r.w).padEnd(5)} randat=${r.randata ? 'da' : 'NU'} lang=${r.lang} romana=${unice.length} depasire=${r.sw > r.W ? r.sw + '/' + r.W : 0} rupte=${(r.rupte || []).length} erori=${r.erori.length}`);
    if (!r.randata) console.log(`    NERANDATĂ: ${r.incarcare || r.eroare || 'pagina e goală sau a rămas la bariera de acces'} (text vizibil: ${r.text || 0} caractere)`);
    (r.taiate || []).forEach((t) => console.log('    tăiat la dreapta: ' + t));
    r.erori.forEach((e) => console.log('    eroare JS: ' + e));
    unice.forEach((g) => console.log('    română: «' + g.text + '» ⟨' + g.sel + '⟩'));
  }
  const totalRo = total.reduce((s, r) => s + new Set((r.gasite || []).map((g) => g.text)).size, 0);
  console.log(`
TOTAL texte românești (${LIMBA}): ${totalRo} · pagini × lățimi: ${total.length}`);
  const nerandate = total.filter((r) => !r.randata).length;
  const depasiri = total.filter((r) => r.sw > r.W).length;
  const cuErori = total.filter((r) => r.erori.length).length;
  console.log(`nerandate: ${nerandate} · cu depășire: ${depasiri} · cu erori JS: ${cuErori}`);
  // Nerandată = rezultatul nu e valid: cod 1, ca la textele românești.
  process.exitCode = totalRo || nerandate ? 1 : 0;
})();

// /api/comenzi/creeaza.js
// Adăugat în audit 2026-07-11 — până acum nu exista NICIUN endpoint care
// să insereze efectiv un rând în `comenzi`; mydarrin-checkout.html salva
// „comanda" doar în sessionStorage (saveGuestOrder), niciodată în Supabase.
//
// FIX (Etapa 4, audit 2026-07-12): endpointul crăpa la fiecare cerere reală
// — coloanele inserate (`numar_comanda`, `deviz_id`, `tip_serviciu`,
// `valoare_totala`) nu există în tabelul `comenzi` din baza live (verificat
// direct în information_schema, nu presupus din schema.sql). Coloanele
// reale: `nr_comanda`, `suma_totala_platita`; `deviz_id`/`tip_serviciu` nu
// au niciun echivalent (catalog_serviciu_id există, dar checkout.html nu
// trimite încă un ID real de serviciu din catalog — gap separat, neatins
// aici). Query-ul de numerotare folosea și el `created_at` — coloana reală
// e `creat_la`.
//
// Status inițial: 'in_cautare_partener', conform ciclului de viață
// documentat în schema.sql. Notă: motorul de matching care ar trebui să
// populeze `alocari_fifo` pe baza acestui status nu există încă (vezi
// auditul extins, secțiunea 3) — comanda e persistată real, dar alocarea
// automată către un partener rămâne un pas separat, neconstruit.
//
// Body: { date_facturare | profil_facturare_id (+ adresa_facturare_id?), adresa_prestare_id?, salveaza_in_cont?, adresa_lucrare?, adresa, tara_cod?, regiune?, localitate?,
//         nivel_id + cantitate + addon_materiale?  (serviciu / închiriere)  SAU  produse_marketplace (materiale),
//         data_programata?, ora_inceput_programata?, ora_sfarsit_programata?, masa_totala_kg?, nivel_transport_marfa? }
//
// Pasul 11-C2 (3 nov. 2026, regula LM): prețul comenzii se calculează doar pe
// server — nivel_id → lib/pret-serviciu.js (rețeta sau prețul nivelului din
// catalog_preturi), produse_marketplace → lib/rezolva-addon-materiale.js; ambele
// cu formula din lib/calculeaza-pret.js. Câmpurile de preț din browser
// (valoare_totala, suma_asigurare, cost_*) se ignoră; căile vechi care le
// foloseau (descrise mai jos, istoric) au fost scoase. Fără nivel cu preț real →
// 409 FARA_PRET. Serviciul trebuie să aibă parteneri activi în zona adresei
// (lib/disponibilitate-adresa.js) → altfel 409 SERVICIU_INDISPONIBIL pe adresa.
//
// FIX (G2, audit Secțiunea 6/36, 30 Iulie 2026): masa_totala_kg/
// nivel_transport_marfa — acceptate și persistate DOAR ca informație
// logistică, fără niciun efect asupra suma_totala_platita. Nicio formulă de
// preț pentru transport-pe-greutate sau pentru rolul 'ajutor' nu există
// încă — ar fi necesitat inventarea unor tarife/trepte, decizie de business
// confirmată explicit ca separată (rămâne alături de G39, neînceput fără
// reguli reale). Rolurile 'ajutor'/'transportator' există acum în
// comanda_subcontractori.rol_tip (CHECK extins), dar nimic nu le alocă
// încă automat — lib/aloca-partener.js/aloca-subcontractori.js neatinse.
//
// FIX (G28, 28 Iulie 2026): `comenzi` nu avea nicio coloană de dată/oră
// programată — alegerea din calendarul mydarrin-produs.html (S.selDate/
// selTime) era reținută doar în sessionStorage, niciodată trimisă aici.
// Acum acceptate opțional (comenzile fără o programare aleasă, ex. acces
// direct la /cos, rămân neafectate — coloanele rămân NULL).
//
// FIX (T8, 2026-07-20): `comenzi.suma_asigurare` exista deja în schemă
// (proiectată corect pentru split-ul de asigurare), dar nu era scrisă
// niciodată — checkout.html calcula prima de asigurare doar în UI, iar
// suma se topea nediferențiat în valoare_totala. Acum se persistă separat,
// ca api/financiar/comision.js să poată calcula split-ul real pe 3 părți.
//
// FIX (Faza 3, 2026-07-21): `catalog_serviciu_id` exista deja în schemă,
// dar checkout.html nu-l trimitea niciodată — fără el, motorul de alocare
// (lib/aloca-partener.js) nu are ce serviciu să caute în
// partener_servicii_active. Acum e acceptat opțional (comenzile vechi/alte
// apeluri care nu-l trimit încă rămân neafectate, doar alocarea nu pornește
// pentru ele). După inserare, se încearcă o alocare automată sincron — nu
// există infrastructură de cronjob/coadă în acest proiect, deci "automat"
// înseamnă "imediat, în același request", nu în fundal.
//
// FIX (rețetă multi-partener, 2026-07-22): până acum se persista DOAR
// `valoare_totala` ca sumă unică (plus, separat, `suma_asigurare`) — nicio
// altă componentă de cost (manoperă/materiale/scule/curier) nu ajungea
// vreodată în `comenzi`, deși coloanele existau în schemă. Fără ele,
// eliberarea de escrow (lib/elibereaza-escrow.js) nu are cum să știe cât
// revine fiecărui tip de partener — putea doar presupune un singur
// beneficiar. Acum, DACĂ apelantul trimite componentele itemizate (`cost_*`),
// prețul e calculat cu aceeași formulă din lib/calculeaza-pret.js (identică
// celei din api/deviz/calculate.js) și sumele rezultate sunt ÎNGHEȚATE pe
// comandă — eliberarea de escrow le citește direct, nu le recalculează.
// Apelul vechi (doar `valoare_totala`, fără nicio componentă `cost_*`) rămâne
// neschimbat: comanda e persistată ca înainte, cu toate componentele noi la
// 0 — elibereaza-escrow.js tratează acest caz ca fallback cu un singur
// partener (comportamentul dinainte de acest audit), flagat explicit acolo.
//
// Pasul 11-P2b (25 oct. 2026): datele de facturare (`date_facturare`) sunt
// obligatorii pentru comenzile noi — persoană fizică (tip_client 'b2c') sau
// factură pe firmă ('b2b'); validarea în lib/date-facturare.js. Firma din RO
// se verifică la ANAF: inactivă / radiată → 400 FIRMA_INACTIVA; ANAF
// indisponibil → comanda trece, cu sursa 'manual'. CNP-ul (opțional) se
// salvează doar criptat (comenzi.client_cnp_criptat); pe comandă și în
// răspuns rămân doar cnp_furnizat și cnp_ultimele3. `adresa_lucrare`
// (opțional, pe câmpuri) e adresa copiată ca adresă de facturare când
// clientul nu dă alta; fără ea, se folosesc adresa / localitate / regiune.
// Fluxul B2G (api/comenzi/creeaza-b2g.js) nu trece pe aici.
//
// Pasul 11-P3a (26 oct. 2026): datele pot veni și din agenda contului —
// `adresa_prestare_id`, `profil_facturare_id` și, opțional,
// `adresa_facturare_id` (verificate că aparțin contului; altfel 404). Din ele
// se construiesc aceeași `adresa` și aceeași copie `date_facturare`; CNP-ul
// din profil se copiază criptat. `salveaza_in_cont: true` cu date noi →
// după crearea comenzii, adresa / profilul se salvează în agendă
// (lib/agenda-cont.js); dacă salvarea eșuează, comanda rămâne validă și
// răspunsul are `agenda_nesalvata: true`.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { incearcaAlocarePartener } = require('../../lib/aloca-partener');
// Pasul 11-C3: verificările comune și prețul comenzii, în același loc ca la B2G.
const { pregatesteRegiune, valideazaCorp, verificaTaraActiva, calculeazaSume, trimiteEroareComanda } = require('../../lib/comanda-pret');
const { genereazaProformaPDF } = require('../../lib/genereaza-proforma-pdf');
const { renderEmailComandaPrimita, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { incarcaContactPlatformaSigur } = require('../../lib/contact-platforma');
const { notificaAdminFaraPartener } = require('../../lib/notificari-comanda');
const { fromHeader } = require('../../lib/email-sender');
const { valideazaDateFacturare } = require('../../lib/date-facturare');
const { verificaFirmaRoLaAnaf, MESAJE_ANAF } = require('../../lib/cauta-firma');
const { trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const { adresaPrestareDinAgenda, dateFacturareDinAgenda, salveazaDinComanda, MESAJE: MESAJE_AGENDA } = require('../../lib/agenda-cont');

// Pasul 11-C1: mesajele verificărilor de checkout, RO + EN.
const MESAJE_CHECKOUT = {
  metoda_plata: {
    ro: 'Alege metoda de plată. Momentan se acceptă doar ordinul de plată (transfer bancar).',
    en: 'Choose the payment method. Only bank transfer is accepted for now.',
  },
};

function refuzAgenda(res, r) {
  return trimiteEroare(res, r.status || 400, r.cod || 'DATE_INVALIDE', r.error, r.error_en,
    [camp(r.camp, r.error, r.error_en)], { camp: r.camp });
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Adresa de prestare din agendă (pasul 11-P3a) înlocuiește adresa trimisă.
  // Corecția PR #36: țara, județul (`regiune`) și localitatea vin DOAR din
  // adresa salvată — prețul, verificarea zonei și alocarea partenerului
  // folosesc adresa aleasă, nu ce a trimis pagina.
  //   - altă țară decât cea trimisă de pagină → 409 ADRESA_ALTA_TARA (moneda și
  //     TVA-ul diferă; serviciul trebuie reconfigurat);
  //   - prețul se recalculează oricum aici, cu noua regiune (pasul 11-C2: nu mai
  //     există preț venit din pagină); produsele din marketplace nu depind de zonă.
  const corpCerere = { ...(req.body || {}) };
  if (corpCerere.adresa_prestare_id) {
    const r = await adresaPrestareDinAgenda(user.id, corpCerere.adresa_prestare_id);
    if (!r.ok) return refuzAgenda(res, r);
    const z = r.zona;
    const taraPagina = typeof corpCerere.tara_cod === 'string' && corpCerere.tara_cod.trim() ? corpCerere.tara_cod.trim().toUpperCase() : null;
    if (taraPagina && taraPagina !== z.tara_cod) {
      return trimiteEroare(res, 409, 'ADRESA_ALTA_TARA', MESAJE_AGENDA.adresa_alta_tara.ro, MESAJE_AGENDA.adresa_alta_tara.en,
        [camp('adresa_prestare_id', MESAJE_AGENDA.adresa_alta_tara.ro, MESAJE_AGENDA.adresa_alta_tara.en)],
        { camp: 'adresa_prestare_id', tara_adresa: z.tara_cod, tara_serviciu: taraPagina });
    }
    // Pasul 11-C2: ADRESA_SCHIMBATA_PRET (prețul din pagină calculat pentru altă
    // zonă) nu mai e posibil — prețul se calculează mereu aici, cu zona adresei.
    corpCerere.adresa = r.adresa;
    corpCerere.adresa_lucrare = r.adresa_lucrare;
    corpCerere.tara_cod = z.tara_cod;
    corpCerere.regiune = z.regiune;
    corpCerere.localitate = z.localitate;
  }

  // Pasul 11-P3b: județul comenzii → codul din geo_regiuni („Cluj”, „Cluj
  // County”, „Județul Cluj”, „CJ” → „CJ”), o singură dată, aici; pe comandă se
  // salvează codul (alocarea, sloturile și zonele compară coduri). Denumirea
  // rămâne pentru adresa copiată la facturare. Un județ nerecunoscut, pentru o
  // țară cu regiuni în geo_regiuni → 400, camp 'regiune'.
  const rg = await pregatesteRegiune(corpCerere);
  if (!rg.ok) return trimiteEroareComanda(res, rg.eroare);
  const regiuneDenumire = rg.regiuneDenumire;

  const {
    adresa, tara_cod = null, regiune = null, localitate = null,
    data_programata = null, ora_inceput_programata = null, ora_sfarsit_programata = null,
    masa_totala_kg = null, nivel_transport_marfa = null,
    metoda_plata = 'ordin_plata',
    date_facturare = null, adresa_lucrare = null,
    adresa_prestare_id = null, profil_facturare_id = null, adresa_facturare_id = null,
    salveaza_in_cont = false,
  } = corpCerere;

  // FIX (bug #23, audit 19 August 2026): selectorul din mydarrin-checkout.html
  // comuta doar o clasă CSS — alegerea clientului nu ajungea niciodată aici.
  // comenzi.metoda_plata există în schemă de la introducerea ei (nu era
  // niciodată scrisă). Validare minimă, nu presupune un enum DB strict.
  //
  // RESTRICȚIE (Etapa LANSARE, 27 august 2026): 'card' se accepta aici fără
  // nicio verificare de procesator real (spre deosebire de creeaza-b2g.js,
  // care cheamă verificaIntegrare('procesatori_carduri')) — un client putea
  // selecta "Card bancar" și comanda se crea normal, fără ca vreo plată să
  // fie procesată sau blocată. Cerere explicită a fondatorului: până la
  // integrarea unui procesator real, singura metodă acceptată e ordinul de
  // plată — închide gaura de integritate, nu doar restrânge opțiunile.
  const METODE_PLATA_VALIDE = ['ordin_plata'];
  if (!METODE_PLATA_VALIDE.includes(metoda_plata)) {
    const m = MESAJE_CHECKOUT.metoda_plata;
    return trimiteEroare(res, 400, 'METODA_PLATA_INVALIDA', m.ro, m.en, [camp('metoda_plata', m.ro, m.en)], { camp: 'metoda_plata' });
  }

  // Pasul 11-C3: aceeași validare ca la B2G (lib/comanda-pret.js): nivel +
  // cantitate SAU produse, date, adresă; fără preț real → 409 FARA_PRET.
  const valid = valideazaCorp(corpCerere);
  if (!valid.ok) return trimiteEroareComanda(res, valid.eroare);

  // Datele de facturare (pasul 11-P2b) — obligatorii.
  const adresaLucrare = adresa_lucrare && typeof adresa_lucrare === 'object'
    ? adresa_lucrare
    : { strada: adresa, localitate, judet: regiuneDenumire, tara: tara_cod };
  // Din agendă (profil_facturare_id) sau din formular (date_facturare).
  let facturare;
  let cnpCriptatProfil = null;
  if (profil_facturare_id) {
    const r = await dateFacturareDinAgenda(user.id, {
      profilId: profil_facturare_id, adresaFacturareId: adresa_facturare_id, taraComanda: tara_cod, adresaLucrare,
    });
    if (!r.ok) return refuzAgenda(res, r);
    facturare = { ok: true, tip_client: r.tip_client, date_facturare: r.date_facturare, cnp: null };
    cnpCriptatProfil = r.cnp_criptat;
  } else {
    facturare = valideazaDateFacturare(date_facturare, { taraComanda: tara_cod, adresaLucrare });
  }
  if (!facturare.ok) {
    return trimiteEroare(res, 400, 'DATE_FACTURARE_INVALIDE', facturare.error, facturare.error_en,
      [camp(facturare.camp, facturare.error, facturare.error_en)], { camp: facturare.camp });
  }

  // FIX (Etapa 4, audit 2026-07-12): "prima țară activă este România" —
  // verificare server-side, reală, nu doar bannerul din UI (ocolibil de
  // oricine trimite direct un POST). Blocăm doar dacă tara_cod e cunoscută
  // și explicit inactivă — nu blocăm cereri fără tara_cod (compatibil cu
  // orice apelant mai vechi care încă nu o trimite).
  const ta = await verificaTaraActiva(tara_cod);
  if (!ta.ok) return trimiteEroareComanda(res, ta.eroare);

  // Factură pe o firmă din RO: verificarea la ANAF (aceeași ca la parteneri).
  const df = facturare.date_facturare;
  if (df.tip === 'pj' && df.adresa.tara === 'RO') {
    const v = await verificaFirmaRoLaAnaf(df.cui);
    if (v.stare === 'inactiva') {
      const m = MESAJE_ANAF.firma_inactiva;
      return trimiteEroare(res, 400, 'FIRMA_INACTIVA', m.ro, m.en, [camp('cui', m.ro, m.en)], { camp: 'cui' });
    }
    if (v.stare === 'activa') {
      df.sursa = 'anaf';
      df.tva_activ = !!v.anaf.tva_activ;
    }
  }

  // Prețul comenzii, înainte de try-ul principal (un refuz întoarce 4xx clar):
  // lib/comanda-pret.js — nivel_id → lib/pret-serviciu.js + zona; produse →
  // lib/rezolva-addon-materiale.js. catalog_serviciu_id vine din nivel (server),
  // nu din client (Varianta 2 „Echipă”, 24 august 2026).
  const sume = await calculeazaSume(corpCerere, { cale: valid.cale, cantitate: valid.cantitate, adresaLucrare });
  if (!sume.ok) return trimiteEroareComanda(res, sume.eroare);
  const catalogServiciuIdEfectiv = sume.catalog_serviciu_id;
  const manoperaDefalcare = sume.manopera_defalcare;

  try {
    const year = new Date().getFullYear();
    const { count } = await supabaseAdmin
      .from('comenzi')
      .select('id', { count: 'exact', head: true })
      .gte('creat_la', `${year}-01-01`);

    const nr_comanda = `DA-${year}-${String((count || 0) + 1).padStart(5, '0')}`;

    // CNP-ul (opțional) doar criptat, înainte de inserare: fără criptare, nicio comandă.
    let clientCnpCriptat = null;
    if (facturare.cnp) {
      const { data: criptat, error: cryptErr } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: facturare.cnp });
      if (cryptErr || !criptat) throw cryptErr || new Error('cripteaza_camp nu a întors valoarea');
      clientCnpCriptat = criptat;
    } else if (cnpCriptatProfil) {
      clientCnpCriptat = cnpCriptatProfil;
    }

    const insertBase = {
      nr_comanda,
      client_id: user.id,
      status: 'in_cautare_partener',
      // Bug real găsit 31 august 2026 (cerere fondator — proforma trebuie să
      // arate locația reală de prestare): `adresa` era validată mai sus
      // (obligatorie, string) dar niciodată persistată — doar tara_cod/
      // regiune/localitate (geo larg) se salvau. Reparat.
      adresa,
      tara_cod: tara_cod ? String(tara_cod).toUpperCase() : null,
      regiune,
      localitate,
      catalog_serviciu_id: catalogServiciuIdEfectiv,
      data_programata,
      ora_inceput_programata,
      ora_sfarsit_programata,
      masa_totala_kg,
      nivel_transport_marfa,
      metoda_plata,
      tip_client: facturare.tip_client,
      date_facturare: df,
      ...(clientCnpCriptat ? { client_cnp_criptat: clientCnpCriptat } : {}),
      // 'neinitiat', nu 'blocat': acest endpoint nu procesează plăți reale
      // (niciun procesator de plăți nu e integrat — vezi api/financiar/comision.js),
      // deci ar fi incorect să pretindem că suma e deja blocată în escrow.
    };

    // Coloanele de preț vin doar din calculul de pe server (pasul 11-C2 / 11-C3).
    const insertPayload = { ...insertBase, ...sume.campuri };

    const { data, error } = await supabaseAdmin
      .from('comenzi')
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    // Separat de insert, ca o coloană încă neadăugată (migrarea 2026-10-09
    // neaplicată) să nu blocheze crearea comenzii.
    if (manoperaDefalcare) {
      const { error: defErr } = await supabaseAdmin.from('comenzi').update({ manopera_defalcare: manoperaDefalcare }).eq('id', data.id);
      if (defErr) console.warn('[comenzi/creeaza] manopera_defalcare nesalvată:', defErr.message);
    }

    // FIX (G6, audit Secțiunea 6/36, 29 Iulie 2026): `invoices` există din
    // prima trecere de audit (23 Iulie 2026), dar nimic nu insera vreodată o
    // proformă la creare comandă — tabela era complet goală (0 rânduri live,
    // verificat direct). Ciclul de viață real (proformă → fiscală) e deja
    // scris în api/accountancy.js (maybeConvert(), FV-${an}-${secvență} la
    // confirmarea încasării+livrării) — doar primul pas, emiterea proformei,
    // lipsea. Izolat în propriul try/catch: o eroare la proformă nu trebuie
    // să blocheze comanda deja înregistrată cu succes.
    // Notă 2 (29 august 2026) — hoist-uit în afara try-ului, ca emailul de
    // mai jos să poată menționa numărul real de proformă (sau nimic, dacă
    // emiterea eșuează — niciodată un număr fals).
    let numarProforma = null;
    let entitateEmitenta = null;
    try {
      const anProforma = new Date().getFullYear();
      const { count: countProforma } = await supabaseAdmin
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('tip', 'proforma')
        .gte('emisa_la', `${anProforma}-01-01`);
      numarProforma = `PF-${anProforma}-${String((countProforma || 0) + 1).padStart(6, '0')}`;

      // FIX (G1, audit Secțiunea 6/36, 30 Iulie 2026): tara_cod (denormalizat
      // de pe comandă — util dacă vreodată o proformă există fără comanda_id)
      // + entitate_emitenta. Singura mapare cunoscută azi, reală (nu
      // inventată): RO e singura țară cu checkout_activ=true — orice comandă
      // reală de azi e RO, deci emisă de Home Best Pal SRL (numele folosit
      // deja, public, în politica de confidențialitate). Pentru orice altă
      // țară, rămâne NULL până se confirmă entitatea reală (Home Best Pal
      // LTD sau alta) — nu presupunem.
      entitateEmitenta = insertBase.tara_cod === 'RO' ? 'Home Best Pal SRL' : null;

      await supabaseAdmin.from('invoices').insert({
        tip: 'proforma',
        numar_document: numarProforma,
        comanda_id: data.id,
        client_id: user.id,
        suma_totala: data.suma_totala_platita,
        tva: data.tva_suma || 0,
        moneda: data.moneda,
        tara_cod: insertBase.tara_cod,
        entitate_emitenta: entitateEmitenta,
      });
    } catch (invoiceErr) {
      console.error('[comenzi/creeaza] proformă', invoiceErr);
    }

    // Email „comandă primită” (Etapa 0 SLA, 9 oct. 2026, decizie LM) — la
    // plasare comanda NU e încă confirmată. Confirmarea (partener + cod de
    // verificare) pleacă separat, din lib/aloca-partener.js, doar dacă există
    // un partener alocat. Înlocuiește emailul „comandă confirmată” trimis
    // până acum la fiecare comandă, chiar și fără partener. Proforma rămâne
    // atașată. Izolat în propriul try/catch, nu blochează comanda.
    try {
      if (process.env.RESEND_API_KEY) {
        const { data: profilClient } = await supabaseAdmin
          .from('profiles')
          .select('email, tara, limba')
          .eq('id', user.id)
          .maybeSingle();
        if (profilClient?.email) {
          const limba = limbaProfilEmailComportamental(profilClient);
          await incarcaContactPlatformaSigur(); // footerul de dezabonare / GDPR din back-office
          const { subiect, html } = renderEmailComandaPrimita(limba, { numarComanda: data.nr_comanda || data.id, comandaId: data.id, numarProforma });

          // Cerere fondator (30 august 2026): factura proformă trebuie
          // ATAȘATĂ efectiv la email, nu doar menționată. Generată doar dacă
          // proforma chiar a fost emisă (numarProforma real) — izolat în
          // propriul try, o eroare de generare PDF nu trebuie să blocheze
          // trimiterea emailului (fallback: fără atașament, ca înainte).
          let attachments;
          if (numarProforma) {
            try {
              const [{ data: entitateJuridica }, { data: contBancar }, { data: serviciu }] = await Promise.all([
                supabaseAdmin.from('entitati_juridice_platforma').select('denumire, cui, nr_reg_com, adresa').eq('tara_cod', insertBase.tara_cod || 'RO').eq('activa', true).maybeSingle(),
                supabaseAdmin.from('bank_accounts').select('nume_afisat, banca, iban, swift').eq('tara_cod', insertBase.tara_cod || 'RO').eq('moneda', data.moneda).eq('tip', 'incasari').maybeSingle(),
                // Deviz complet (31 august 2026, cerere fondator) — descrierea
                // reală, etapele lucrării și instrucțiunile de întreținere ale
                // serviciului comandat, dacă au fost populate.
                data.catalog_serviciu_id
                  ? supabaseAdmin.from('catalog_servicii').select('titlu, descriere, etape_lucrare, instructiuni_intretinere').eq('id', data.catalog_serviciu_id).maybeSingle()
                  : Promise.resolve({ data: null }),
              ]);
              const pdfBuffer = await genereazaProformaPDF({
                invoice: { numar_document: numarProforma, emisa_la: new Date().toISOString(), suma_totala: data.suma_totala_platita, moneda: data.moneda, entitate_emitenta: entitateEmitenta },
                comanda: data, serviciu, clientEmail: profilClient.email, entitateJuridica, contBancar,
              });
              attachments = [{ filename: `${numarProforma}.pdf`, content: pdfBuffer.toString('base64') }];
            } catch (pdfErr) {
              console.error('[comenzi/creeaza] generare PDF proformă', pdfErr);
            }
          }

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: await fromHeader(limba), to: profilClient.email, subject: subiect, html, ...(attachments ? { attachments } : {}) }),
          });
        }
      }
    } catch (emailErr) {
      console.error('[comenzi/creeaza] email comandă primită', emailErr);
    }

    // Alocarea automată — după emailul „comandă primită”, ca acesta să ajungă
    // primul. Cu partener: lib/aloca-partener.js trimite clientului codul de
    // verificare (confirmarea) și partenerului emailul de alocare. Fără
    // partener: comanda rămâne in_cautare_partener și adminul e anunțat
    // imediat (Etapa 0 SLA).
    const alocare = catalogServiciuIdEfectiv
      ? await incearcaAlocarePartener(data.id)
      : { alocat: false, motiv: valid.cale === 'produse' ? 'comanda_produse_marketplace' : 'fara_serviciu_specificat' };
    if (!alocare.alocat) await notificaAdminFaraPartener(data, alocare.motiv);

    // „Salvează în contul meu” (pasul 11-P3a): best-effort, după comandă.
    let agendaNesalvata = false;
    const prestareNoua = !adresa_prestare_id && adresa_lucrare && typeof adresa_lucrare === 'object' ? adresa_lucrare : null;
    const facturareNoua = !profil_facturare_id ? df : null;
    if (salveaza_in_cont === true && (prestareNoua || facturareNoua)) {
      try {
        const r = await salveazaDinComanda(user.id, {
          adresaPrestare: prestareNoua,
          dateFacturare: facturareNoua,
          adresaFacturareSeparata: !!(date_facturare && date_facturare.adresa_alta === true),
          cnpCriptat: clientCnpCriptat,
        });
        if (!r.ok) { agendaNesalvata = true; console.warn('[comenzi/creeaza] agenda nesalvată:', r.cod, r.camp); }
      } catch (agendaErr) {
        agendaNesalvata = true;
        console.warn('[comenzi/creeaza] agenda nesalvată:', agendaErr.message);
      }
    }

    // CNP-ul criptat nu pleacă înapoi la client.
    const { client_cnp_criptat: _cnpCriptat, ...comandaPublica } = data;
    return res.status(200).json({ ok: true, comanda: comandaPublica, alocare, ...(agendaNesalvata ? { agenda_nesalvata: true } : {}) });
  } catch (err) {
    console.error('[comenzi/creeaza]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra comanda' });
  }
}

module.exports = requireAuth([], handler);

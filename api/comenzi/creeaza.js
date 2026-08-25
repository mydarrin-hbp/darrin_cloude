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
// Body: { valoare_totala, adresa, tara_cod?, regiune?, localitate?, suma_asigurare?, catalog_serviciu_id?, data_programata?, ora_inceput_programata?, ora_sfarsit_programata?, masa_totala_kg?, nivel_transport_marfa? }
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

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { incearcaAlocarePartener } = require('../../lib/aloca-partener');
const { calculeazaPret, citestePragMinimComanda } = require('../../lib/calculeaza-pret');
const { calculeazaCostNivel } = require('../../lib/calculeaza-cost-recipe');
const { renderEmailPrimaComanda, limbaProfilEmailComportamental } = require('../../lib/i18n');
const { fromHeader } = require('../../lib/email-sender');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    valoare_totala, adresa, tara_cod = null, regiune = null, localitate = null,
    suma_asigurare = 0, catalog_serviciu_id = null,
    cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare,
    data_programata = null, ora_inceput_programata = null, ora_sfarsit_programata = null,
    masa_totala_kg = null, nivel_transport_marfa = null,
    metoda_plata = 'card',
    nivel_id = null, cantitate = null,
  } = req.body || {};

  // „Preț per cantitate reală comandată", pașii 1-3 (22 august 2026, aprobat,
  // funcțional doar pe cele 5 servicii pilot cu rețetă tehnică legată —
  // devize_articole.catalog_nivel_id). Când apelantul trimite nivel_id,
  // prețul NU mai vine din client (cost_*/valoare_totala trimise sunt
  // ignorate pe această cale) — se calculează integral server-side, din
  // rețeta reală, la cantitatea cerută, exact ca /api/public/calculeaza-pret-nivel.js.
  const areNivelId = typeof nivel_id === 'string' && nivel_id.length > 0;
  if (nivel_id !== null && !areNivelId) {
    return res.status(400).json({ error: 'nivel_id trebuie să fie un uuid (text).' });
  }
  let cantitateNivel = 1;
  if (areNivelId) {
    cantitateNivel = cantitate === null ? 1 : Number(cantitate);
    if (!Number.isFinite(cantitateNivel) || cantitateNivel <= 0) {
      return res.status(400).json({ error: 'cantitate trebuie să fie un număr pozitiv.' });
    }
  }

  // FIX (bug #23, audit 19 August 2026): selectorul din mydarrin-checkout.html
  // comuta doar o clasă CSS — alegerea clientului nu ajungea niciodată aici.
  // comenzi.metoda_plata există în schemă de la introducerea ei (nu era
  // niciodată scrisă). Validare minimă, nu presupune un enum DB strict.
  const METODE_PLATA_VALIDE = ['card', 'ordin_plata', 'cash'];
  if (!METODE_PLATA_VALIDE.includes(metoda_plata)) {
    return res.status(400).json({ error: `metoda_plata trebuie să fie una din: ${METODE_PLATA_VALIDE.join(', ')}` });
  }

  if (masa_totala_kg !== null && !(typeof masa_totala_kg === 'number' && masa_totala_kg > 0)) {
    return res.status(400).json({ error: 'masa_totala_kg trebuie să fie un număr pozitiv' });
  }
  if (nivel_transport_marfa !== null && typeof nivel_transport_marfa !== 'string') {
    return res.status(400).json({ error: 'nivel_transport_marfa trebuie să fie text' });
  }

  if (data_programata !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data_programata)) {
    return res.status(400).json({ error: 'data_programata trebuie în format YYYY-MM-DD' });
  }
  for (const ora of [ora_inceput_programata, ora_sfarsit_programata]) {
    if (ora !== null && !/^\d{2}:\d{2}(:\d{2})?$/.test(ora)) {
      return res.status(400).json({ error: 'ora_inceput_programata/ora_sfarsit_programata trebuie în format HH:MM' });
    }
  }

  // G2, partea 2 — o greutate itemizată declanșează și ea calculul real
  // (lib/calculeaza-pret.js), chiar dacă niciun alt cost_* nu e trimis —
  // altfel formula de transport n-ar avea niciodată ocazia să ruleze.
  const areComponenteItemizate = [cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare]
    .some((v) => typeof v === 'number' && v > 0) || (typeof masa_totala_kg === 'number' && masa_totala_kg > 0);

  if (!areComponenteItemizate && !areNivelId) {
    if (typeof valoare_totala !== 'number' || !(valoare_totala > 0)) {
      return res.status(400).json({ error: 'valoare_totala (numeric, pozitiv) este obligatorie' });
    }
    if (typeof suma_asigurare !== 'number' || suma_asigurare < 0 || suma_asigurare > valoare_totala) {
      return res.status(400).json({ error: 'suma_asigurare trebuie să fie un număr între 0 și valoare_totala' });
    }
  }
  if (!adresa || typeof adresa !== 'string') {
    return res.status(400).json({ error: 'adresa este obligatorie' });
  }

  // FIX (Etapa 4, audit 2026-07-12): "prima țară activă este România" —
  // verificare server-side, reală, nu doar bannerul din UI (ocolibil de
  // oricine trimite direct un POST). Blocăm doar dacă tara_cod e cunoscută
  // și explicit inactivă — nu blocăm cereri fără tara_cod (compatibil cu
  // orice apelant mai vechi care încă nu o trimite).
  if (tara_cod) {
    const { data: config } = await supabaseAdmin
      .from('tax_configurations')
      .select('checkout_activ')
      .eq('tara_cod', String(tara_cod).toUpperCase())
      .maybeSingle();
    if (!config || !config.checkout_activ) {
      return res.status(403).json({
        error: 'Darrin inca nu este disponibil in zona ta. Imediat ce suntem live, te vom anunta cu email. Multumim pentru intelegere.',
        code: 'ZONA_INDISPONIBILA',
      });
    }
  }

  // Calculul de preț pe nivel_id se face ÎNAINTE de try-ul principal, ca un
  // refuz (rețetă incompletă) să întoarcă 400 clar, nu 500 generic — spre
  // deosebire de calea itemizată de mai jos, unde clientul deja a calculat
  // (greșit sau nu) sumele, aici serverul e singura sursă de adevăr.
  let nivelCalculat = null;
  // Varianta 2 "Echipă" (24 august 2026) — catalog_serviciu_id rezolvat
  // server-side din nivel_id (catalog_niveluri.serviciu_id), nu din client.
  // FIX conex, descoperit la implementarea asta: mydarrin-checkout.html NU
  // trimite niciodată catalog_serviciu_id pe calea nivel_id (comentariu
  // vechi în acel fișier, din era pre-pilot, când slug-ul din PRODUCTS_DB nu
  // era încă un uuid real) — însemna că lib/aloca-partener.js nu pornea
  // NICIODATĂ pentru comenzile reale pe cele 2 servicii pilot deja live
  // (Grădinărit, Service Moto), rămânând înghețate la 'in_cautare_partener'.
  // Rezolvarea server-side, din nivel_id (sursă de adevăr, nefalsificabilă
  // de client), repară acest gap și e precondiția ca esco-ul principal de
  // mai jos să poată fi determinat.
  let catalogServiciuIdEfectiv = catalog_serviciu_id;
  let manoperaEscoBreakdown = null;
  if (areNivelId) {
    const taraCalcul = tara_cod ? String(tara_cod).toUpperCase() : 'RO';
    const cost = await calculeazaCostNivel({ nivelId: nivel_id, taraCod: taraCalcul, cantitate: cantitateNivel });
    if (cost.resurse_fara_pret.length) {
      return res.status(400).json({
        error: 'Rețeta tehnică a acestui serviciu nu are toate resursele tarifate — comanda nu poate fi calculată automat.',
        code: 'RETETA_INCOMPLETA',
        resurse_fara_pret: cost.resurse_fara_pret.map((r) => ({ denumire: r.denumire, tip: r.tip, unitate: r.unitate })),
      });
    }
    const calc = await calculeazaPret({
      cost_baza_servicii: cost.cost_baza_servicii,
      cost_materiale: cost.cost_materiale,
      cost_chirie_scule: cost.cost_utilaj,
      tara: taraCalcul,
    });
    nivelCalculat = { cantitate: cantitateNivel, calc };

    const { data: nivelRow } = await supabaseAdmin
      .from('catalog_niveluri')
      .select('serviciu_id')
      .eq('id', nivel_id)
      .maybeSingle();
    catalogServiciuIdEfectiv = nivelRow?.serviciu_id || null;

    const escoIntrari = Object.entries(cost.manopera_per_esco || {});
    if (escoIntrari.length) {
      let escoPrincipal = null;
      if (catalogServiciuIdEfectiv) {
        const { data: servRow } = await supabaseAdmin
          .from('catalog_servicii')
          .select('cod_esco')
          .eq('id', catalogServiciuIdEfectiv)
          .maybeSingle();
        escoPrincipal = servRow?.cod_esco || null;
      }
      manoperaEscoBreakdown = escoIntrari.map(([cod_esco, suma]) => ({
        cod_esco,
        suma,
        principal: cod_esco === escoPrincipal,
      }));
      // Dacă niciun cod nu se potrivește cu esco-ul declarat al serviciului
      // (sau serviciul n-are unul setat), marchează primul ca principal —
      // trebuie mereu exact un rând principal pentru split-ul din
      // lib/elibereaza-escrow.js.
      if (!manoperaEscoBreakdown.some((b) => b.principal)) {
        manoperaEscoBreakdown[0].principal = true;
      }
    }
  }

  try {
    const year = new Date().getFullYear();
    const { count } = await supabaseAdmin
      .from('comenzi')
      .select('id', { count: 'exact', head: true })
      .gte('creat_la', `${year}-01-01`);

    const nr_comanda = `DA-${year}-${String((count || 0) + 1).padStart(5, '0')}`;

    const insertBase = {
      nr_comanda,
      client_id: user.id,
      status: 'in_cautare_partener',
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
      // 'neinitiat', nu 'blocat': acest endpoint nu procesează plăți reale
      // (niciun procesator de plăți nu e integrat — vezi api/financiar/comision.js),
      // deci ar fi incorect să pretindem că suma e deja blocată în escrow.
    };

    const insertPayload = areNivelId
      ? {
          ...insertBase,
          nivel_id,
          cantitate: nivelCalculat.cantitate,
          manopera_esco_breakdown: manoperaEscoBreakdown,
          suma_totala_platita: nivelCalculat.calc.pret_final,
          suma_manopera: nivelCalculat.calc.cost_baza_servicii,
          suma_materiale: nivelCalculat.calc.cost_materiale,
          suma_chirie_scule: nivelCalculat.calc.cost_chirie_scule,
          suma_transport: nivelCalculat.calc.cost_curier,
          suma_transport_greutate: nivelCalculat.calc.cost_transport_greutate,
          suma_ajutor: nivelCalculat.calc.cost_ajutor,
          suma_asigurare: nivelCalculat.calc.cost_asigurare,
          suma_marketing: nivelCalculat.calc.cost_marketing,
          suma_mentenanta: nivelCalculat.calc.cost_mentenanta,
          suma_comision_platforma: nivelCalculat.calc.comision_platforma,
          tva_pct: nivelCalculat.calc.tva_pct,
          tva_suma: nivelCalculat.calc.tva_suma,
        }
      : areComponenteItemizate
      ? await (async () => {
          const calc = await calculeazaPret({
            cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare,
            tara: insertBase.tara_cod || 'RO',
            masa_totala_kg, nivel_transport_marfa,
          });
          return {
            ...insertBase,
            suma_totala_platita: calc.pret_final,
            suma_manopera: calc.cost_baza_servicii,
            suma_materiale: calc.cost_materiale,
            suma_chirie_scule: calc.cost_chirie_scule,
            suma_transport: calc.cost_curier,
            suma_transport_greutate: calc.cost_transport_greutate,
            suma_ajutor: calc.cost_ajutor,
            suma_asigurare: calc.cost_asigurare,
            suma_marketing: calc.cost_marketing,
            suma_mentenanta: calc.cost_mentenanta,
            suma_comision_platforma: calc.comision_platforma,
            tva_pct: calc.tva_pct,
            tva_suma: calc.tva_suma,
          };
        })()
      // FIX (gaură de integritate, 22 august 2026): calea neitemizată nu
      // trece deloc prin lib/calculeaza-pret.js — valoare_totala vine direct
      // din body, neverificată. Același prag minim, citit acum dinamic per
      // țară (tax_configurations.prag_minim_comanda, ca la TVA — extensia
      // din aceeași zi), nu mai hardcodat, ca nicio comandă să nu ocolească
      // pragul doar alegând calea neitemizată.
      : { ...insertBase, suma_totala_platita: Math.max(valoare_totala, await citestePragMinimComanda(insertBase.tara_cod || 'RO')), suma_asigurare };

    const { data, error } = await supabaseAdmin
      .from('comenzi')
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    const alocare = catalogServiciuIdEfectiv
      ? await incearcaAlocarePartener(data.id)
      : { alocat: false, motiv: 'fara_serviciu_specificat' };

    // FIX (G6, audit Secțiunea 6/36, 29 Iulie 2026): `invoices` există din
    // prima trecere de audit (23 Iulie 2026), dar nimic nu insera vreodată o
    // proformă la creare comandă — tabela era complet goală (0 rânduri live,
    // verificat direct). Ciclul de viață real (proformă → fiscală) e deja
    // scris în api/accountancy.js (maybeConvert(), FV-${an}-${secvență} la
    // confirmarea încasării+livrării) — doar primul pas, emiterea proformei,
    // lipsea. Izolat în propriul try/catch: o eroare la proformă nu trebuie
    // să blocheze comanda deja înregistrată cu succes.
    try {
      const anProforma = new Date().getFullYear();
      const { count: countProforma } = await supabaseAdmin
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('tip', 'proforma')
        .gte('emisa_la', `${anProforma}-01-01`);
      const numarProforma = `PF-${anProforma}-${String((countProforma || 0) + 1).padStart(6, '0')}`;

      // FIX (G1, audit Secțiunea 6/36, 30 Iulie 2026): tara_cod (denormalizat
      // de pe comandă — util dacă vreodată o proformă există fără comanda_id)
      // + entitate_emitenta. Singura mapare cunoscută azi, reală (nu
      // inventată): RO e singura țară cu checkout_activ=true — orice comandă
      // reală de azi e RO, deci emisă de Home Best Pal SRL (numele folosit
      // deja, public, în politica de confidențialitate). Pentru orice altă
      // țară, rămâne NULL până se confirmă entitatea reală (Home Best Pal
      // LTD sau alta) — nu presupunem.
      const entitateEmitenta = insertBase.tara_cod === 'RO' ? 'Home Best Pal SRL' : null;

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

    // Email „prima comandă confirmată" (audit Secțiunea 39, 30 Iulie 2026,
    // gap real: nicio confirmare de comandă la creare). Trimis DOAR la
    // prima comandă reală a clientului — la fel cum spune textul cerut
    // explicit ("Mulțumim pentru prima ta comandă") — nu la fiecare comandă;
    // izolat în propriul try/catch, nu blochează comanda deja înregistrată.
    try {
      const { count: nrComenziClient } = await supabaseAdmin
        .from('comenzi')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', user.id);
      if (nrComenziClient === 1 && process.env.RESEND_API_KEY) {
        const { data: profilClient } = await supabaseAdmin
          .from('profiles')
          .select('email, tara, limba')
          .eq('id', user.id)
          .maybeSingle();
        if (profilClient?.email) {
          const limba = limbaProfilEmailComportamental(profilClient);
          const { subiect, html } = renderEmailPrimaComanda(limba, { nume: null, numarComanda: data.nr_comanda || data.id });
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: await fromHeader(limba), to: profilClient.email, subject: subiect, html }),
          });
        }
      }
    } catch (emailErr) {
      console.error('[comenzi/creeaza] email prima comandă', emailErr);
    }

    return res.status(200).json({ ok: true, comanda: data, alocare });
  } catch (err) {
    console.error('[comenzi/creeaza]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra comanda' });
  }
}

module.exports = requireAuth([], handler);

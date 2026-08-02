// /api/comenzi/creeaza-b2g.js
// Flux SECUNDAR, dedicat clienților B2G (companii/instituții guvernamentale)
// — audit Secțiunea 43, cerință explicită 31 Iulie 2026: "creează un flux
// secundar dedicat... fără să afectezi ce este implementat și actualizat
// pentru restul consumatorilor". Endpoint NOU, complet separat de
// api/comenzi/creeaza.js (neatins, neschimbat) — clienții B2C parcurg
// exact fluxul de azi, fără nicio modificare de comportament.
//
// Diferențe reale față de fluxul B2C:
// 1. Cere identificarea instituției (denumire + CUI) — nu doar adresa.
// 2. Cere metoda de plată explicit: 'card' sau 'ordin_plata' (nou — B2C nu
//    are azi acest concept, checkout.html îl arată doar decorativ).
// 3. NU declanșează alocarea către parteneri la creare (spre deosebire de
//    fluxul B2C, care încearcă imediat, sincron) — comanda e creată cu
//    status_plata='in_asteptare' și RĂMÂNE așa, fără nicio ofertă către
//    vreun partener, până când un admin certifică plata (vezi
//    api/admin/comenzi-b2g.js → action:'certifica_plata', care reia atunci
//    alocarea, exact fluxul "întrerupt, apoi continuă" cerut explicit).
// 4. Procentul de avans NU se stabilește aici, de client — se configurează
//    ulterior, de la caz la caz, de un admin dedicat (api/admin/comenzi-b2g.js).
//
// Onest despre scop: CUI-ul e validat doar ca format (cifre, lungime
// rezonabilă), NU verificat live la ANAF în acest pas — validarea reală
// (api/public/cui-lookup.js, deja existent) rămâne un pas separat, pe care
// admin-ul îl poate face manual la certificarea plății; a-l face obligatoriu
// sincron aici ar adăuga o dependență externă blocantă pe calea de creare a
// comenzii, neconfirmată ca cerință.
//
// Body: identic cu api/comenzi/creeaza.js, PLUS
//   { denumire_institutie_b2g, cui_client_b2g, metoda_plata, cont_trezorerie? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { calculeazaPret } = require('../../lib/calculeaza-pret');
const { verificaIntegrare } = require('../../lib/integrare-gate');

const METODE_VALIDE = ['card', 'ordin_plata'];

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    valoare_totala, adresa, tara_cod = null, regiune = null, localitate = null,
    suma_asigurare = 0, catalog_serviciu_id = null,
    cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare,
    data_programata = null, ora_inceput_programata = null, ora_sfarsit_programata = null,
    masa_totala_kg = null, nivel_transport_marfa = null,
    denumire_institutie_b2g, cui_client_b2g, metoda_plata, cont_trezorerie = false,
  } = req.body || {};

  if (!denumire_institutie_b2g || typeof denumire_institutie_b2g !== 'string') {
    return res.status(400).json({ error: 'denumire_institutie_b2g este obligatorie' });
  }
  if (!cui_client_b2g || !/^[A-Za-z]{0,2}\d{2,10}$/.test(String(cui_client_b2g).trim())) {
    return res.status(400).json({ error: 'cui_client_b2g invalid (format așteptat: cifre, opțional prefixate cu codul de țară, ex. RO12345678)' });
  }
  if (!METODE_VALIDE.includes(metoda_plata)) {
    return res.status(400).json({ error: `metoda_plata trebuie să fie una din: ${METODE_VALIDE.join(', ')}` });
  }
  if (!adresa || typeof adresa !== 'string') {
    return res.status(400).json({ error: 'adresa este obligatorie' });
  }

  // Plata cu cardul RĂMÂNE parte a fluxului de business (nu se elimină din
  // metode_plata_config / checkout) — ce lipsește azi e doar procesatorul
  // real (Secțiunea 40, TODO explicit). Poarta reutilizată aici e EXACT
  // aceeași folosită de api/plati/proceseaza-card.js (lib/integrare-gate.js,
  // categoria 'procesatori_carduri') — un singur loc de adevăr: în clipa în
  // care un admin activează un furnizor real din panoul „Platforme &
  // Integrări" (deja construit, dintr-o trecere anterioară), ambele căi se
  // deblochează simultan, fără nicio modificare de cod aici. Până atunci,
  // orice încercare de a plasa o comandă B2G cu card primește același mesaj
  // clar „nu este încă activă" — comanda NU se creează într-o stare ambiguă.
  if (metoda_plata === 'card') {
    const furnizorCard = await verificaIntegrare(res, 'procesatori_carduri', { tara_cod: tara_cod ? String(tara_cod).toUpperCase() : null });
    if (!furnizorCard) return; // răspunsul 503 a fost deja trimis de poartă
  }

  // G2, partea 2 — vezi nota identică din api/comenzi/creeaza.js.
  const areComponenteItemizate = [cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare]
    .some((v) => typeof v === 'number' && v > 0) || (typeof masa_totala_kg === 'number' && masa_totala_kg > 0);

  if (!areComponenteItemizate) {
    if (typeof valoare_totala !== 'number' || !(valoare_totala > 0)) {
      return res.status(400).json({ error: 'valoare_totala (numeric, pozitiv) este obligatorie' });
    }
    if (typeof suma_asigurare !== 'number' || suma_asigurare < 0 || suma_asigurare > valoare_totala) {
      return res.status(400).json({ error: 'suma_asigurare trebuie să fie un număr între 0 și valoare_totala' });
    }
  }

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

  try {
    const year = new Date().getFullYear();
    const { count } = await supabaseAdmin
      .from('comenzi')
      .select('id', { count: 'exact', head: true })
      .gte('creat_la', `${year}-01-01`);

    const nr_comanda = `DA-B2G-${year}-${String((count || 0) + 1).padStart(5, '0')}`;

    const insertBase = {
      nr_comanda,
      client_id: user.id,
      status: 'in_cautare_partener',
      tara_cod: tara_cod ? String(tara_cod).toUpperCase() : null,
      regiune,
      localitate,
      catalog_serviciu_id,
      data_programata,
      ora_inceput_programata,
      ora_sfarsit_programata,
      masa_totala_kg,
      nivel_transport_marfa,
      tip_client: 'b2g',
      metoda_plata,
      status_plata: 'in_asteptare',
      cui_client_b2g: String(cui_client_b2g).trim().toUpperCase(),
      denumire_institutie_b2g: denumire_institutie_b2g.trim(),
      cont_trezorerie: !!cont_trezorerie,
    };

    const insertPayload = areComponenteItemizate
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
            suma_asigurare: calc.cost_asigurare,
            suma_marketing: calc.cost_marketing,
            suma_mentenanta: calc.cost_mentenanta,
            suma_comision_platforma: calc.comision_platforma,
            tva_pct: calc.tva_pct,
            tva_suma: calc.tva_suma,
          };
        })()
      : { ...insertBase, suma_totala_platita: valoare_totala, suma_asigurare };

    const { data, error } = await supabaseAdmin
      .from('comenzi')
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    // DELIBERAT: nicio alocare către parteneri aici — spre deosebire de
    // api/comenzi/creeaza.js. Comanda rămâne "în așteptare de plată" până
    // un admin certifică plata (api/admin/comenzi-b2g.js), care reia atunci
    // fluxul (apelează incearcaAlocarePartener acolo, nu aici).

    // Proformă — necesară indiferent de statusul plății (proforma se emite
    // ÎNAINTE de plată, prin definiție). Aceeași logică ca la G6, izolată
    // în propriul try/catch.
    try {
      const anProforma = new Date().getFullYear();
      const { count: countProforma } = await supabaseAdmin
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('tip', 'proforma')
        .gte('emisa_la', `${anProforma}-01-01`);
      const numarProforma = `PF-${anProforma}-${String((countProforma || 0) + 1).padStart(6, '0')}`;
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
      console.error('[comenzi/creeaza-b2g] proformă', invoiceErr);
    }

    return res.status(200).json({
      ok: true,
      comanda: data,
      mesaj: metoda_plata === 'ordin_plata'
        ? 'Comanda a fost înregistrată și așteaptă confirmarea plății prin ordin de plată. Alocarea către un partener va începe după confirmare.'
        : 'Comanda a fost înregistrată și așteaptă confirmarea plății.',
    });
  } catch (err) {
    console.error('[comenzi/creeaza-b2g]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra comanda' });
  }
}

module.exports = requireAuth([], handler);

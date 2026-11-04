// /api/comenzi/creeaza-b2g.js
// Flux SECUNDAR, dedicat clienților B2G (companii/instituții guvernamentale)
// — audit Secțiunea 43, cerință explicită 31 Iulie 2026: "creează un flux
// secundar dedicat... fără să afectezi ce este implementat și actualizat
// pentru restul consumatorilor". Endpoint separat de api/comenzi/creeaza.js.
//
// Diferențe reale față de fluxul B2C (rămase neschimbate):
// 1. Cere identificarea instituției (denumire + CUI) — nu doar adresa.
// 2. Cere metoda de plată explicit: 'card' sau 'ordin_plata'.
// 3. NU declanșează alocarea către parteneri la creare — comanda e creată cu
//    status_plata='in_asteptare' și RĂMÂNE așa, fără nicio ofertă către vreun
//    partener, până când un admin certifică plata (api/admin/comenzi-b2g.js →
//    action:'certifica_plata', care reia atunci alocarea).
// 4. Procentul de avans NU se stabilește aici, de client — se configurează
//    ulterior, de la caz la caz, de un admin (api/admin/comenzi-b2g.js).
//
// Pasul 11-C3 (4 nov. 2026, regula LM): prețul se calculează doar pe server,
// în același loc ca la B2C (lib/comanda-pret.js): nivel_id + cantitate +
// materiale opționale → lib/pret-serviciu.js, cu verificarea zonei
// (lib/disponibilitate-adresa.js → 409 SERVICIU_INDISPONIBIL); produse_marketplace
// → lib/rezolva-addon-materiale.js. Fără nivel cu preț real → 409 FARA_PRET.
// `valoare_totala`, `suma_asigurare` și `cost_*` din cerere se ignoră (înainte:
// ramura areComponenteItemizate și valoare_totala luată direct). Aceleași
// verificări ca B2C: adresa, județul, țara activă; erorile în forma comună,
// RO + EN. Proforma primește suma calculată pe server (suma_totala_platita).
//
// Onest despre scop: CUI-ul e validat doar ca format (cifre, lungime
// rezonabilă), NU verificat live la ANAF în acest pas — admin-ul îl poate
// verifica manual la certificarea plății.
//
// Body: identic cu api/comenzi/creeaza.js (fără date_facturare), PLUS
//   { denumire_institutie_b2g, cui_client_b2g, metoda_plata, cont_trezorerie? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { verificaIntegrare } = require('../../lib/integrare-gate');
const { trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const { pregatesteRegiune, valideazaCorp, verificaTaraActiva, calculeazaSume, trimiteEroareComanda } = require('../../lib/comanda-pret');

const METODE_VALIDE = ['card', 'ordin_plata'];

const MESAJE = {
  denumire: {
    ro: 'Completează denumirea instituției.',
    en: "Fill in the institution's name.",
  },
  cui: {
    ro: 'CUI-ul instituției nu este valid: doar cifre, opțional cu prefixul țării (de exemplu RO12345678).',
    en: "The institution's tax ID (CUI) is not valid: digits only, optionally with the country prefix (for example RO12345678).",
  },
  metoda_plata: {
    ro: 'Alege metoda de plată: card sau ordin de plată.',
    en: 'Choose the payment method: card or bank transfer.',
  },
  ordin_plata: {
    ro: 'Comanda a fost înregistrată și așteaptă confirmarea plății prin ordin de plată. Alocarea către un partener va începe după confirmare.',
    en: 'The order has been registered and is waiting for the bank transfer to be confirmed. A partner will be assigned after confirmation.',
  },
  card: {
    ro: 'Comanda a fost înregistrată și așteaptă confirmarea plății.',
    en: 'The order has been registered and is waiting for the payment to be confirmed.',
  },
  server: {
    ro: 'Nu am putut înregistra comanda. Încearcă din nou.',
    en: 'We could not register the order. Please try again.',
  },
};

function refuz(res, status, cod, cheie, numeCamp) {
  const m = MESAJE[cheie];
  return trimiteEroare(res, status, cod, m.ro, m.en, [camp(numeCamp, m.ro, m.en)], { camp: numeCamp });
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const corp = { ...(req.body || {}) };
  const { denumire_institutie_b2g, cui_client_b2g, metoda_plata, cont_trezorerie = false } = corp;

  if (typeof denumire_institutie_b2g !== 'string' || !denumire_institutie_b2g.trim()) {
    return refuz(res, 400, 'DATE_INVALIDE', 'denumire', 'denumire_institutie_b2g');
  }
  if (!cui_client_b2g || !/^[A-Za-z]{0,2}\d{2,10}$/.test(String(cui_client_b2g).trim())) {
    return refuz(res, 400, 'DATE_INVALIDE', 'cui', 'cui_client_b2g');
  }
  if (!METODE_VALIDE.includes(metoda_plata)) {
    return refuz(res, 400, 'METODA_PLATA_INVALIDA', 'metoda_plata', 'metoda_plata');
  }

  // Plata cu cardul rămâne parte a fluxului; lipsește doar procesatorul real.
  // Aceeași poartă ca api/plati/proceseaza-card.js (lib/integrare-gate.js,
  // 'procesatori_carduri'): până la activarea unui furnizor, 503 clar.
  if (metoda_plata === 'card') {
    const tara = typeof corp.tara_cod === 'string' && corp.tara_cod.trim() ? corp.tara_cod.trim().toUpperCase() : null;
    const furnizorCard = await verificaIntegrare(res, 'procesatori_carduri', { tara_cod: tara });
    if (!furnizorCard) return; // răspunsul 503 a fost deja trimis de poartă
  }

  // Aceleași verificări și același preț ca la B2C (lib/comanda-pret.js).
  const rg = await pregatesteRegiune(corp);
  if (!rg.ok) return trimiteEroareComanda(res, rg.eroare);
  const valid = valideazaCorp(corp);
  if (!valid.ok) return trimiteEroareComanda(res, valid.eroare);
  const ta = await verificaTaraActiva(corp.tara_cod);
  if (!ta.ok) return trimiteEroareComanda(res, ta.eroare);

  const {
    adresa, tara_cod = null, regiune = null, localitate = null,
    data_programata = null, ora_inceput_programata = null, ora_sfarsit_programata = null,
    masa_totala_kg = null, nivel_transport_marfa = null,
  } = corp;
  const adresaLucrare = { strada: adresa, localitate, judet: rg.regiuneDenumire, tara: tara_cod };
  const sume = await calculeazaSume(corp, { cale: valid.cale, cantitate: valid.cantitate, adresaLucrare });
  if (!sume.ok) return trimiteEroareComanda(res, sume.eroare);

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
      adresa,
      tara_cod: tara_cod ? String(tara_cod).toUpperCase() : null,
      regiune,
      localitate,
      catalog_serviciu_id: sume.catalog_serviciu_id,
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

    // Coloanele de preț vin doar din calculul de pe server (pasul 11-C3).
    const { data, error } = await supabaseAdmin
      .from('comenzi')
      .insert({ ...insertBase, ...sume.campuri })
      .select()
      .single();

    if (error) throw error;

    // Separat de insert, ca la B2C: o coloană neadăugată nu blochează comanda.
    if (sume.manopera_defalcare) {
      const { error: defErr } = await supabaseAdmin.from('comenzi').update({ manopera_defalcare: sume.manopera_defalcare }).eq('id', data.id);
      if (defErr) console.warn('[comenzi/creeaza-b2g] manopera_defalcare nesalvată:', defErr.message);
    }

    // DELIBERAT: nicio alocare către parteneri aici — comanda rămâne „în
    // așteptare de plată” până un admin certifică plata (api/admin/comenzi-b2g.js).

    // Proforma — emisă înainte de plată, cu suma calculată pe server
    // (suma_totala_platita de pe comandă). Izolată în propriul try/catch.
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

    const m = metoda_plata === 'ordin_plata' ? MESAJE.ordin_plata : MESAJE.card;
    return res.status(200).json({ ok: true, comanda: data, mesaj: m.ro, mesaj_en: m.en });
  } catch (err) {
    console.error('[comenzi/creeaza-b2g]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', MESAJE.server.ro, MESAJE.server.en);
  }
}

module.exports = requireAuth([], handler);

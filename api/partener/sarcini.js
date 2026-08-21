// /api/partener/sarcini.js
// G-nou (26 Iulie 2026) — "Sarcini LIVE" din mydarrin-dashboard-partener.html
// era 100% machetă: 4 task-card-uri demo, butoane Accept/Refuz/Finalizează/
// Problemă fără niciun fetch. Lanțul real de acțiuni EXISTA deja, complet
// funcțional, doar niciodată conectat la această listă:
//   alocari_fifo (ofertă) -> accept-comanda.js (acceptata) ->
//   confirma-cod.js (in_executie, cod cerut clientului la sosire) ->
//   upload-imagine.js (before/after) -> finalizeaza-comanda.js (finalizata,
//   token trimis clientului) -> confirmare-livrare.html (client confirmă).
//
// Acest endpoint e doar CITIREA — lista de sarcini pe cele 3 stadii reale.
// NU expune comenzi.cod_verificare partenerului: codul e cunoscut clientului
// și verifică fizic prezența partenerului la adresă — expunerea lui aici
// ar anula exact scopul verificării.
//
// GET -> { ok, primite:[...], active:[...], finalizate:[...] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

const CAMPURI_COMANDA = 'id, nr_comanda, status, suma_totala_platita, moneda, tara_cod, regiune, localitate, creat_la, finalizat_la, nivel_id';

// D2a, Prioritate 1 (aprobat 21 august 2026, pe baza auditului "rețete
// simple") — partenerul lucra "orb" pe compoziția comenzii: nu vedea ce
// materiale/scule presupune rețeta tehnică legată de nivel_id (mecanismul
// de legare, construit și testat azi în api/admin/catalog.js). Aduce DOAR
// compoziția (denumire+cantitate+unitate), NICIODATĂ pret_unitar — costul
// rămâne informație de back-office. Filtrat strict pe tip_resursa M/U
// (materiale/scule/consumabile) — manopera (F) nu e "de adus", e munca
// partenerului însuși. Onest, nu inventează: dacă nivel_id lipsește sau
// nu are nicio rețetă legată, `disponibila:false` explicit, nu se omite
// tăcut secțiunea și nu se inventează conținut.
async function ataseazaReteteTehnice(comenzi) {
  const nivelIds = [...new Set((comenzi || []).map((c) => c.nivel_id).filter(Boolean))];
  let compunerePerNivel = {};

  if (nivelIds.length) {
    const { data: articole } = await supabaseAdmin
      .from('devize_articole')
      .select('articol_id, catalog_nivel_id')
      .in('catalog_nivel_id', nivelIds);

    const articolIds = (articole || []).map((a) => a.articol_id);
    if (articolIds.length) {
      const { data: retete } = await supabaseAdmin
        .from('devize_retete')
        .select('articol_id, resursa_id, consum_specific')
        .in('articol_id', articolIds);

      const resursaIds = [...new Set((retete || []).map((r) => r.resursa_id))];
      const { data: resurse } = resursaIds.length
        ? await supabaseAdmin
            .from('devize_resurse')
            .select('resursa_id, tip_resursa, denumire_resursa, unitate_masura')
            .in('resursa_id', resursaIds)
            .in('tip_resursa', ['M', 'U'])
        : { data: [] };

      const resursaById = new Map((resurse || []).map((r) => [r.resursa_id, r]));
      const articolToNivel = new Map((articole || []).map((a) => [a.articol_id, a.catalog_nivel_id]));

      for (const ret of retete || []) {
        const res = resursaById.get(ret.resursa_id);
        if (!res) continue; // resursă F (manoperă) sau fără tarif M/U relevant partenerului — exclusă deliberat
        const nivelId = articolToNivel.get(ret.articol_id);
        if (!compunerePerNivel[nivelId]) compunerePerNivel[nivelId] = [];
        compunerePerNivel[nivelId].push({
          denumire: res.denumire_resursa,
          cantitate: ret.consum_specific,
          unitate_masura: res.unitate_masura,
        });
      }
    }
  }

  return (comenzi || []).map((c) => {
    const { nivel_id, ...rest } = c;
    if (!nivel_id) {
      return { ...rest, reteta_tehnica: { disponibila: false, motiv: 'Serviciul nu are o rețetă tehnică legată încă.' } };
    }
    return { ...rest, reteta_tehnica: { disponibila: true, componente: compunerePerNivel[nivel_id] || [] } };
  });
}

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data: oferte } = await supabaseAdmin
    .from('alocari_fifo')
    .select('comanda_id, notificat_la')
    .eq('partener_id', user.id)
    .eq('raspuns', 'in_asteptare');

  const idPrimite = (oferte || []).map((o) => o.comanda_id);
  let primite = [];
  if (idPrimite.length) {
    const { data } = await supabaseAdmin
      .from('comenzi')
      .select(CAMPURI_COMANDA)
      .in('id', idPrimite)
      .eq('status', 'in_cautare_partener');
    primite = data || [];
  }

  const { data: active } = await supabaseAdmin
    .from('comenzi')
    .select(CAMPURI_COMANDA)
    .eq('partener_id', user.id)
    .in('status', ['acceptata', 'in_executie'])
    .order('creat_la', { ascending: false });

  const { data: finalizate } = await supabaseAdmin
    .from('comenzi')
    .select(CAMPURI_COMANDA)
    .eq('partener_id', user.id)
    .in('status', ['finalizata', 'confirmata_client'])
    .order('finalizat_la', { ascending: false })
    .limit(20);

  const idActive = (active || []).map((c) => c.id);
  let poze = [];
  if (idActive.length) {
    const { data } = await supabaseAdmin
      .from('comenzi_imagini')
      .select('comanda_id, tip')
      .in('comanda_id', idActive)
      .eq('partener_id', user.id);
    poze = data || [];
  }
  const activeCuPoze = (active || []).map((c) => ({
    ...c,
    are_poza_before: poze.some((p) => p.comanda_id === c.id && p.tip === 'before'),
    are_poza_after: poze.some((p) => p.comanda_id === c.id && p.tip === 'after'),
  }));

  // reteta_tehnica atașată uniform pe toate cele 3 liste (nu doar "active")
  // — CAMPURI_COMANDA include acum nivel_id pentru toate; ataseazaReteteTehnice
  // îl consumă și-l scoate din payload peste tot, ca să nu rămână un câmp
  // intern brut, neprocesat, pe primite/finalizate.
  const [primiteCuReteta, activeCuReteta, finalizateCuReteta] = await Promise.all([
    ataseazaReteteTehnice(primite),
    ataseazaReteteTehnice(activeCuPoze),
    ataseazaReteteTehnice(finalizate || []),
  ]);

  return res.status(200).json({ ok: true, primite: primiteCuReteta, active: activeCuReteta, finalizate: finalizateCuReteta });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);

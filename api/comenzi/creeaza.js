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
// Body: { valoare_totala, adresa, tara_cod?, regiune?, localitate?, suma_asigurare?, catalog_serviciu_id? }
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
const { calculeazaPret } = require('../../lib/calculeaza-pret');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    valoare_totala, adresa, tara_cod = null, regiune = null, localitate = null,
    suma_asigurare = 0, catalog_serviciu_id = null,
    cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare,
  } = req.body || {};

  const areComponenteItemizate = [cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare]
    .some((v) => typeof v === 'number' && v > 0);

  if (!areComponenteItemizate) {
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
      catalog_serviciu_id,
      // 'neinitiat', nu 'blocat': acest endpoint nu procesează plăți reale
      // (niciun procesator de plăți nu e integrat — vezi api/financiar/comision.js),
      // deci ar fi incorect să pretindem că suma e deja blocată în escrow.
    };

    const insertPayload = areComponenteItemizate
      ? await (async () => {
          const calc = await calculeazaPret({
            cost_baza_servicii, cost_materiale, cost_chirie_scule, cost_curier, cost_asigurare,
            tara: insertBase.tara_cod || 'RO',
          });
          return {
            ...insertBase,
            suma_totala_platita: calc.pret_final,
            suma_manopera: calc.cost_baza_servicii,
            suma_materiale: calc.cost_materiale,
            suma_chirie_scule: calc.cost_chirie_scule,
            suma_transport: calc.cost_curier,
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

    const alocare = catalog_serviciu_id
      ? await incearcaAlocarePartener(data.id)
      : { alocat: false, motiv: 'fara_serviciu_specificat' };

    return res.status(200).json({ ok: true, comanda: data, alocare });
  } catch (err) {
    console.error('[comenzi/creeaza]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra comanda' });
  }
}

module.exports = requireAuth([], handler);

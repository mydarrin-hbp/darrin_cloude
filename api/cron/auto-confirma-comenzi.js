// /api/cron/auto-confirma-comenzi.js
// Faza 5b — confirmare tacită: dacă în 24h de la finalizare clientul nu a
// confirmat și nu a deschis o contestație, comanda se consideră confirmată
// automat și escrow-ul se eliberează (regulă de business explicită).
//
// Exclude explicit comenzile cu o reclamație deschisă (nou/in_evaluare) —
// o contestație blochează eliberarea automată, indiferent de cât timp a
// trecut de la finalizare.
//
// Rulează pe Vercel Cron (vezi vercel.json → crons). Protejat cu
// CRON_SECRET — Vercel adaugă automat header-ul `Authorization: Bearer
// $CRON_SECRET` la invocările programate; fail-closed dacă secretul lipsește
// sau nu se potrivește, ca să nu poată fi declanșat public.
//
// NECESITĂ configurare manuală, în afara codului: variabila de mediu
// CRON_SECRET în Vercel (Project Settings → Environment Variables) — vezi
// nota din răspunsul final.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { elibereazaEscrow } = require('../../lib/elibereaza-escrow');

const FEREASTRA_TACITA_ORE = 24;

module.exports = async function handler(req, res) {
  const secretAsteptat = process.env.CRON_SECRET;
  const primit = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!secretAsteptat || primit !== secretAsteptat) {
    return res.status(401).json({ error: 'Neautorizat' });
  }

  const limita = new Date(Date.now() - FEREASTRA_TACITA_ORE * 60 * 60 * 1000).toISOString();

  const { data: candidati, error: candErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda')
    .eq('status', 'finalizata')
    .lte('finalizat_la', limita);
  if (candErr) {
    console.error('[cron/auto-confirma-comenzi]', candErr);
    return res.status(500).json({ error: 'Eroare la căutarea comenzilor eligibile' });
  }
  if (!candidati?.length) return res.status(200).json({ ok: true, procesate: 0, sarite: 0 });

  const { data: reclamatiiDeschise } = await supabaseAdmin
    .from('reclamatii')
    .select('comanda_id')
    .in('comanda_id', candidati.map((c) => c.id))
    .in('status', ['nou', 'in_evaluare']);
  const comenziContestate = new Set((reclamatiiDeschise || []).map((r) => r.comanda_id));

  let procesate = 0;
  let sarite = 0;
  const erori = [];

  for (const comanda of candidati) {
    if (comenziContestate.has(comanda.id)) {
      sarite++;
      continue;
    }
    const rezultat = await elibereazaEscrow(comanda.id);
    if (!rezultat.ok) {
      erori.push({ comanda_id: comanda.id, nr_comanda: comanda.nr_comanda, error: rezultat.error });
      continue;
    }
    await supabaseAdmin
      .from('comenzi')
      .update({ status: 'confirmata_client', confirmat_la: new Date().toISOString() })
      .eq('id', comanda.id);
    procesate++;
  }

  return res.status(200).json({ ok: true, procesate, sarite, contestate: comenziContestate.size, erori });
};

// /api/public/servicii-cu-reteta.js
// Lista serviciilor care au cel puțin un nivel legat la o rețetă tehnică
// (devize_articole.catalog_nivel_id). Pentru ele, mydarrin-produs.html cere
// prețul exclusiv de la /api/public/calculeaza-pret-nivel, în locul tabelului
// static TIER_DB. Înlocuiește harta scrisă de mână PILOT_SERVICII_MAP, care
// rămânea în urmă la fiecare serviciu nou legat (8 oct. 2026: 17 din 24).
//
// Public, fără autentificare. Întoarce doar identificatorii serviciilor —
// niciun cost, tarif sau articol de deviz.
//
// GET -> { ok:true, servicii: [{ id_serviciu, serviciu_id }] }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'servicii-cu-reteta', limit: 30, windowSeconds: 60 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  try {
    const { data: articole, error: artErr } = await supabaseAdmin
      .from('devize_articole')
      .select('catalog_nivel_id')
      .not('catalog_nivel_id', 'is', null);
    if (artErr) throw artErr;

    const nivelIds = [...new Set((articole || []).map((a) => a.catalog_nivel_id))];
    if (!nivelIds.length) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json({ ok: true, servicii: [] });
    }

    const { data: niveluri, error: nivErr } = await supabaseAdmin
      .from('catalog_niveluri')
      .select('serviciu_id')
      .in('id', nivelIds);
    if (nivErr) throw nivErr;

    const serviciuIds = [...new Set((niveluri || []).map((n) => n.serviciu_id).filter(Boolean))];
    if (!serviciuIds.length) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json({ ok: true, servicii: [] });
    }

    const { data: servicii, error: servErr } = await supabaseAdmin
      .from('catalog_servicii')
      .select('id, id_serviciu')
      .in('id', serviciuIds);
    if (servErr) throw servErr;

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({
      ok: true,
      servicii: (servicii || [])
        .filter((s) => s.id_serviciu)
        .map((s) => ({ id_serviciu: s.id_serviciu, serviciu_id: s.id })),
    });
  } catch (err) {
    console.error('[public/servicii-cu-reteta]', err);
    return res.status(500).json({ error: 'Nu am putut încărca lista serviciilor.' });
  }
};

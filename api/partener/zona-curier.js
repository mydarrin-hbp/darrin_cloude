// /api/partener/zona-curier.js
// Etapa CAT-3b (28 august 2026) — cerere fondator: curierii de cartier să
// poată configura reală oferta lor (zonă de acoperire + rază de livrare)
// înainte de campania de atragere parteneri. Auditat înainte de implementare
// (agent Explore): NU exista niciun mecanism pentru asta — "regiune_cod" de
// pe `partners` e un singur cod de zonă, nu adrese/raze reale, iar singurul
// loc unde conceptul era măcar SCHIȚAT era `mydarrin-auth-schema.html`
// (document de arhitectură, marcat explicit "Draft v1", fără implementare
// reală) — `specific_per_tip.curier: { vehicul, raza_livrare_km }`.
//
// Urmează exact tiparul deja stabilit pentru Echipă/Utilaje/Certificări/Cont
// bancar: POST = adaugă (nu înlocuiește, un curier poate acoperi mai multe
// zone), DELETE dedicat pe o singură zonă (dezactivare, nu ștergere fizică).
//
// GET    → zonele active
// POST   { tara_cod, regiune_cod?, localitate?, raza_livrare_km? } → adaugă o zonă nouă
// DELETE { id } → dezactivează o singură zonă

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_zona_curier')
      .select('id, tara_cod, regiune_cod, localitate, raza_livrare_km, created_at')
      .eq('partner_id', user.id)
      .eq('activ', true)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, zone: data || [] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const { data, error } = await supabaseAdmin
      .from('partner_zona_curier')
      .update({ activ: false })
      .eq('id', id)
      .eq('partner_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Zona nu există sau nu-ți aparține' });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tara_cod, regiune_cod, localitate, raza_livrare_km } = req.body || {};
  if (!tara_cod || typeof tara_cod !== 'string') {
    return res.status(400).json({ error: 'tara_cod este obligatoriu' });
  }
  if (raza_livrare_km != null && !(typeof raza_livrare_km === 'number' && raza_livrare_km > 0)) {
    return res.status(400).json({ error: 'raza_livrare_km trebuie să fie un număr pozitiv' });
  }

  try {
    const { data: zona, error: insErr } = await supabaseAdmin.from('partner_zona_curier').insert({
      partner_id: user.id,
      tara_cod: tara_cod.trim().toUpperCase().slice(0, 8),
      regiune_cod: regiune_cod ? String(regiune_cod).trim().slice(0, 20) : null,
      localitate: localitate ? String(localitate).trim().slice(0, 100) : null,
      raza_livrare_km: raza_livrare_km ?? null,
    }).select('id').single();
    if (insErr) throw insErr;
    return res.status(200).json({ ok: true, zona });
  } catch (err) {
    console.error('[zona-curier]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva zona de acoperire' });
  }
}

module.exports = requireAuth(['partener_curier'], handler);

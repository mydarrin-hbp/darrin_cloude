// /api/partener/heartbeat.js
// Adăugat în audit 2026-07-11 — parte din baza motorului de matching
// (secțiunea "status live" din cerința de audit). App-ul partener apelează
// periodic (recomandat: la 60-90s) ca să-și actualizeze last_seen_at și,
// opțional, poziția curentă — folosite de gaseste_parteneri_eligibili()
// din schema.sql pentru a exclude partenerii offline din matching.
//
// Body: { lat?, lng? }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lat, lng } = req.body || {};
  const update = { last_seen_at: new Date().toISOString() };

  if (lat !== undefined || lng !== undefined) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat și lng, dacă sunt trimise, trebuie să fie numerice' });
    }
    // POINT(lng lat) — PostGIS folosește ordinea longitudine/latitudine.
    update.locatie = `POINT(${lng} ${lat})`;
  }

  const { error } = await supabaseAdmin.from('profiles').update(update).eq('id', user.id);
  if (error) {
    console.error('[heartbeat]', error);
    return res.status(500).json({ error: 'Nu am putut actualiza statusul' });
  }

  return res.status(200).json({ ok: true, last_seen_at: update.last_seen_at });
}

module.exports = requireAuth([], handler);

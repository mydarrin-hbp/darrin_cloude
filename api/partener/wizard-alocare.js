// /api/partener/wizard-alocare.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 7: alocare
// angajați pe sarcini (competențe ESCO bifate) + clauza de acceptare a
// livrării comenzilor în zonă. Clauza are greutate legală (partenerul se
// angajează să onoreze comenzi alocate în zona lui) — timestamp-ul și IP-ul
// de acceptare se capturează server-side, nu se acceptă ce trimite clientul,
// exact ca la GDPR (conditii_acceptate_la/conditii_acceptate_ip pe comenzi).
//
// GET  → alocările curente
// POST { alocari: [{ angajat_id, cod_esco }, ...], zona_livrare_acceptata: true }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_alocari_sarcini')
      .select('id, angajat_id, cod_esco, zona_livrare_acceptata, clauza_acceptata_la')
      .eq('partner_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, alocari: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { alocari, zona_livrare_acceptata } = req.body || {};
  if (!Array.isArray(alocari) || !alocari.length) {
    return res.status(400).json({ error: 'Alocă cel puțin un angajat pe o competență' });
  }
  if (zona_livrare_acceptata !== true) {
    return res.status(400).json({ error: 'Trebuie să accepți clauza de livrare a comenzilor în zonă pentru a continua' });
  }
  for (const a of alocari) {
    if (!a.angajat_id) return res.status(400).json({ error: 'angajat_id este obligatoriu pentru fiecare alocare' });
  }

  try {
    const angajatIds = [...new Set(alocari.map((a) => a.angajat_id))];
    const { data: angajatiValizi, error: angErr } = await supabaseAdmin
      .from('partner_angajati').select('id').eq('partner_id', user.id).in('id', angajatIds).eq('activ', true);
    if (angErr) throw angErr;
    const idValidSet = new Set((angajatiValizi || []).map((a) => a.id));
    const invalizi = angajatIds.filter((id) => !idValidSet.has(id));
    if (invalizi.length) return res.status(400).json({ error: 'Unul sau mai mulți angajați nu aparțin acestui partener' });

    const { error: delErr } = await supabaseAdmin.from('partner_alocari_sarcini').delete().eq('partner_id', user.id);
    if (delErr) throw delErr;

    const acumIso = new Date().toISOString();
    const ip = getClientIp(req);
    const randuri = alocari.map((a) => ({
      partner_id: user.id,
      angajat_id: a.angajat_id,
      cod_esco: a.cod_esco || null,
      zona_livrare_acceptata: true,
      clauza_acceptata_la: acumIso,
      clauza_acceptata_ip: ip,
    }));
    const { error: insErr } = await supabaseAdmin.from('partner_alocari_sarcini').insert(randuri);
    if (insErr) throw insErr;

    // Marchează finalizarea auto-servire a wizard-ului (Pasul 8) — dosarul
    // rămâne oricum pending_review până la verificarea umană din backoffice.
    await supabaseAdmin.from('partners').update({ wizard_finalizat_la: acumIso }).eq('id', user.id);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[wizard-alocare]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva alocările' });
  }
}

module.exports = requireAuth([], handler);

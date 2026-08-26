// /api/client/cos.js
// Etapa 1 (26 august 2026) — backup server-side pentru configurația curentă
// de checkout (mydarrin-produs.html), pentru continuitate guest→autentificat
// și cross-device. Verificat live înainte de implementare: platforma NU are
// azi un coș multi-item — myd_checkout_config (sessionStorage) transportă
// o singură configurație de produs curentă. Acest endpoint persistă exact
// acel obiect, ca blob opac (`configurare` jsonb) — nu-l interpretează,
// nu-l validează câmp cu câmp. sessionStorage rămâne sursa principală
// pentru sesiunea activă; acest tabel e doar restaurare.
//
// Identitate: client_id (dacă autentificat) SAU sesiune_token (guest,
// generat client-side, persistat în localStorage — spre deosebire de
// sessionStorage, supraviețuiește închiderii tab-ului).
//
// GET    ?sesiune_token=...   → configurarea curentă (sau null)
// POST   { sesiune_token?, configurare }  → upsert (înlocuiește rândul unic)
// DELETE ?sesiune_token=...   → șterge rândul

const { getAuthenticatedUser } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  let user = null;
  try {
    user = await getAuthenticatedUser(req);
  } catch (e) {
    // guest — continuă fără user, identitatea vine din sesiune_token
  }

  const sesiuneToken = (req.query?.sesiune_token || req.body?.sesiune_token || '').trim() || null;
  if (!user && !sesiuneToken) {
    return res.status(400).json({ error: 'Necesită autentificare sau sesiune_token' });
  }
  const filtruIdentitate = user ? { client_id: user.id } : { sesiune_token: sesiuneToken };

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('cos_itemi')
      .select('configurare, actualizat_la')
      .match(filtruIdentitate)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, configurare: data?.configurare || null, actualizat_la: data?.actualizat_la || null });
  }

  if (req.method === 'POST') {
    const { configurare } = req.body || {};
    if (!configurare || typeof configurare !== 'object') {
      return res.status(400).json({ error: 'configurare (obiect) este obligatorie' });
    }
    const acum = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('cos_itemi')
      .upsert(
        { ...filtruIdentitate, configurare, actualizat_la: acum },
        { onConflict: user ? 'client_id' : 'sesiune_token' }
      );
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabaseAdmin.from('cos_itemi').delete().match(filtruIdentitate);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// /api/client/cos-multi.js
// Coș multi-serviciu (30 august 2026, cerere fondator): clientul poate
// configura mai multe servicii/materiale și le poate adăuga în coș, înainte
// de a trimite comanda finală (după plată). Distinct de api/client/cos.js
// (backup single-item al configurării curente, 26 august 2026, neatins) —
// aici fiecare rând din cos_multi_itemi e un item REAL, adăugat explicit.
//
// Model aprobat de fondator: fiecare item devine, la trimitere, o comandă
// SEPARATĂ (api/comenzi/creeaza.js, apelat o dată per item de pe front-end)
// — propriul escrow/alocare fiecare, ca azi. Acest endpoint nu creează
// niciodată comenzi — doar gestionează lista de configurări din coș.
//
// Identitate: client_id (dacă autentificat) SAU sesiune_token (guest,
// generat client-side, persistat în localStorage, la fel ca api/client/cos.js).
//
// GET    ?sesiune_token=...            → lista itemilor din coș
// POST   { sesiune_token?, configurare } → adaugă un item nou, întoarce { id, configurare }
// DELETE ?id=<uuid>&sesiune_token=...  → șterge un singur item
// DELETE ?clear=true&sesiune_token=... → golește tot coșul (după trimitere reușită)

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
      .from('cos_multi_itemi')
      .select('id, configurare, creat_la')
      .match(filtruIdentitate)
      .order('creat_la', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, itemi: data || [] });
  }

  if (req.method === 'POST') {
    const { configurare } = req.body || {};
    if (!configurare || typeof configurare !== 'object') {
      return res.status(400).json({ error: 'configurare (obiect) este obligatorie' });
    }
    const { data, error } = await supabaseAdmin
      .from('cos_multi_itemi')
      .insert({ ...filtruIdentitate, configurare })
      .select('id, configurare, creat_la')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, item: data });
  }

  if (req.method === 'DELETE') {
    if (req.query?.clear === 'true') {
      const { error } = await supabaseAdmin.from('cos_multi_itemi').delete().match(filtruIdentitate);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, cleared: true });
    }
    const id = req.query?.id;
    if (!id) return res.status(400).json({ error: 'id sau clear=true este obligatoriu' });
    const { error } = await supabaseAdmin.from('cos_multi_itemi').delete().match({ ...filtruIdentitate, id });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

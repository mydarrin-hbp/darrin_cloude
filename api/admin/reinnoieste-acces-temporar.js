// /api/admin/reinnoieste-acces-temporar.js
// Prelungește durata unui acces activ, fără să schimbe parola.
//
// Body: { email, ore_suplimentare } → { ok, expira_la }

const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna, trimiteEroare } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ORE_PERMISE = [1, 2, 8, 24, 48, 168];

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { email, ore_suplimentare } = req.body || {};
  if (!email || typeof email !== 'string') return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'Email obligatoriu.', 'Email is required.', ['email']);
  if (!ORE_PERMISE.includes(Number(ore_suplimentare))) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `Ore valabile: ${ORE_PERMISE.join(', ')}`, `Allowed hours: ${ORE_PERMISE.join(', ')}`, ['ore']);
  }
  const emailNorm = email.toLowerCase().trim();

  const { data: acces, error: accesErr } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, creat_de, expira_la')
    .eq('email', emailNorm)
    .eq('activ', true)
    .maybeSingle();
  if (accesErr) {
    console.error('[reinnoieste-acces-temporar]', accesErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare la căutarea accesului.', 'We could not look up the access.');
  }
  if (!acces) return trimiteEroare(res, 404, 'NU_EXISTA', 'Nu există acces activ pentru acest email.', 'There is no active access for this email.');

  const { data: profile } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).single();
  const esteSuperadmin = Array.isArray(profile?.roles) && profile.roles.includes('superadmin');
  if (!esteSuperadmin && acces.creat_de !== user.id) {
    return trimiteEroare(res, 403, 'FARA_DREPT', 'Nu poți reînnoi accese create de alți admini.', 'You cannot renew access created by other admins.');
  }

  // Baza de calcul e max(expira_la curent, acum) — o reînnoire pe un acces
  // deja expirat pornește de la momentul curent, nu adaugă ore la un termen
  // trecut de mult.
  const bazaCalcul = Math.max(new Date(acces.expira_la).getTime(), Date.now());
  const expira_la = new Date(bazaCalcul + Number(ore_suplimentare) * 3600 * 1000).toISOString();

  const { error: updErr } = await supabaseAdmin
    .from('accese_temporare')
    .update({ expira_la })
    .eq('id', acces.id);
  if (updErr) {
    console.error('[reinnoieste-acces-temporar] update', updErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut reînnoi accesul.', 'We could not renew the access.');
  }

  return res.status(200).json({ ok: true, expira_la });
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));

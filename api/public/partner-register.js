// /api/public/partner-register.js
// Endpoint PUBLIC — wizardul "Devino Partener" nu colectează parolă,
// deci trimitem o invitație reală (Supabase creează contul + email cu
// link de setare parolă), cu rolul corect deja alocat în metadate.
// Trigger-ul handle_new_user() citește acel rol și-l pune în profiles.role.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const TYPE_TO_ROLE = {
  servicii: 'partener_servicii',
  materiale: 'partener_materiale',
  inchirieri: 'partener_inchirieri',
  curier: 'partener_curier',
  asigurari: 'partener_asigurari',
};
const TYPE_TO_ENUM = {
  servicii: 'servicii_tehnice',
  materiale: 'furnizor_materiale',
  inchirieri: 'inchirieri_utilaje',
  curier: 'curier_utilitara',
  asigurari: 'asigurari',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nume, email, tip, nume_firma, cui } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email valid obligatoriu.' });
  }
  const role = TYPE_TO_ROLE[tip];
  const enumType = TYPE_TO_ENUM[tip];
  if (!role) {
    return res.status(400).json({ error: 'Tip de partener invalid.' });
  }

  try {
    // 1. Invitație reală — creează contul Supabase Auth cu rolul corect în metadate
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { role, nume: nume || '' },
    });
    if (inviteErr) throw inviteErr;

    // 2. Înregistrare în tabelul partners (documente/CUI se completează ulterior, la aprobare)
    const { error: partnerErr } = await supabaseAdmin.from('partners').insert({
      id: invited.user.id,
      partner_type: enumType,
      nume_firma: nume_firma || null,
      cui: cui || null,
      status_verificare: 'in_asteptare',
    });
    if (partnerErr) throw partnerErr;

    return res.status(200).json({ ok: true, user_id: invited.user.id });
  } catch (err) {
    console.error('[partner-register]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra partenerul.' });
  }
};


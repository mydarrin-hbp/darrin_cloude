// /api/public/partner-register.js
// Endpoint PUBLIC — wizardul "Devino Partener" nu colectează parolă,
// deci trimitem o invitație reală (Supabase creează contul + email cu
// link de setare parolă), cu rolul corect deja alocat în metadate.
// Trigger-ul handle_new_user() citește acel rol și-l pune în profiles.role/roles.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

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

  // FIX (audit 2026-07-11): fără rate-limit, endpointul putea fi folosit ca
  // trimițător de invitații Supabase (inviteUserByEmail) către adrese arbitrare.
  const allowed = await checkRateLimit(req, { key: 'partner-register', limit: 5, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { nume, email, tip, nume_firma, cui } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email valid obligatoriu.' });
  }
  const role = TYPE_TO_ROLE[tip];
  const enumType = TYPE_TO_ENUM[tip];
  if (!role) {
    return res.status(400).json({ error: 'Tip de partener invalid.' });
  }
  // FIX (audit 2026-07-12): nume_firma și cui sunt NOT NULL în tabelul
  // partners — fără această validare, invitația Auth se crea cu succes,
  // dar insertul din partners eșua mereu (formularul nu le trimitea deloc
  // înainte), lăsând un cont invitat fără rând corespunzător în partners.
  if (!nume_firma || !cui) {
    return res.status(400).json({ error: 'Denumirea firmei și CUI/CNP sunt obligatorii.' });
  }

  let invitedUserId = null;
  try {
    // 1. Invitație reală — creează contul Supabase Auth cu rolul corect în metadate
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { role, nume: nume || '' },
    });
    if (inviteErr) throw inviteErr;
    invitedUserId = invited.user.id;

    // 2. Înregistrare în tabelul partners (documente suplimentare se completează ulterior, la aprobare)
    const { error: partnerErr } = await supabaseAdmin.from('partners').insert({
      id: invited.user.id,
      partner_type: enumType,
      nume_firma,
      cui,
      status_verificare: 'in_asteptare',
    });
    if (partnerErr) throw partnerErr;

    return res.status(200).json({ ok: true, user_id: invited.user.id });
  } catch (err) {
    console.error('[partner-register]', err);
    // Dacă am apucat să creăm userul Auth dar insertul în partners a eșuat,
    // ștergem userul orfan — mai bine cerere respinsă curat decât un cont
    // invitat, fără rând corespunzător în partners, imposibil de administrat.
    if (invitedUserId) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(invitedUserId);
      } catch (cleanupErr) {
        console.error('[partner-register] curățare eșuată pentru user orfan', invitedUserId, cleanupErr);
      }
    }
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra partenerul.' });
  }
};

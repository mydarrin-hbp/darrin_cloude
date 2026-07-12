// /api/public/partner-register.js
// Endpoint PUBLIC — wizardul "Devino Partener" nu colectează parolă,
// deci trimitem o invitație reală (Supabase creează contul + email cu
// link de setare parolă), cu rolul corect deja alocat în metadate.
// Trigger-ul handle_new_user() citește acel rol și-l pune în profiles.role/roles.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { limbaDinTara, renderEmailBunVenitPartener } = require('../../lib/i18n');

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

// Etichetă tip partener, per limbă — folosită doar în emailul de bun venit.
// Traduceri generate, nu revizuite nativ (vezi notă în lib/i18n.js).
const TIP_LABELS = {
  servicii:   { ro:'furnizor de servicii',            en:'service provider',              it:'fornitore di servizi',                 fr:'prestataire de services',               de:'Dienstleister',                es:'proveedor de servicios' },
  materiale:  { ro:'furnizor de materiale',           en:'materials supplier',            it:'fornitore di materiali',               fr:'fournisseur de matériaux',              de:'Materiallieferant',            es:'proveedor de materiales' },
  inchirieri: { ro:'furnizor de închirieri utilaje',  en:'equipment rental supplier',     it:'fornitore di noleggio attrezzature',   fr:"fournisseur de location d'équipements", de:'Vermietungsanbieter',          es:'proveedor de alquiler de equipos' },
  curier:     { ro:'curier de cartier',               en:'neighborhood courier',          it:'corriere di quartiere',                fr:'coursier de quartier',                  de:'Nachbarschaftskurier',         es:'mensajero de barrio' },
  asigurari:  { ro:'furnizor de asigurări',           en:'insurance provider',            it:'fornitore di assicurazioni',           fr:"fournisseur d'assurances",              de:'Versicherungsanbieter',        es:'proveedor de seguros' },
};

async function trimiteEmailBunVenit({ email, nume, tip, limba }) {
  if (!process.env.RESEND_API_KEY) return;
  const tipLabel = (TIP_LABELS[tip] && TIP_LABELS[tip][limba]) || TIP_LABELS[tip]?.ro || tip;
  const { subiect, html } = renderEmailBunVenitPartener(limba, { nume, tipLabel });
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'noreply@homebestpal.com',
        to: email,
        subject: subiect,
        html,
      }),
    });
  } catch (emailErr) {
    // Best-effort — nu blocăm înregistrarea dacă emailul de bun venit eșuează.
    console.error('[partner-register] email bun venit eșuat:', emailErr);
  }
}

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

  const { nume, email, tip, nume_firma, cui, tara } = req.body || {};

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

  const limba = limbaDinTara(tara);
  let invitedUserId = null;
  try {
    // 1. Invitație reală — creează contul Supabase Auth cu rolul corect în metadate
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { role, nume: nume || '' },
    });
    if (inviteErr) throw inviteErr;
    invitedUserId = invited.user.id;

    // 2. Înregistrare în tabelul partners (documente suplimentare se completează ulterior, la aprobare)
    // FIX (audit 2026-07-12): constrângerea reală de pe partners.status_verificare
    // acceptă doar 'pending_review'|'approved'|'rejected' (engleză) — 'in_asteptare'
    // (românesc, ca restul convenției din schema.sql) o respingea mereu la nivel de DB.
    const { error: partnerErr } = await supabaseAdmin.from('partners').insert({
      id: invited.user.id,
      partner_type: enumType,
      nume_firma,
      cui,
      status_verificare: 'pending_review',
    });
    if (partnerErr) throw partnerErr;

    // 3. Setează țara + limba (adăugat 2026-07-12) — handle_new_user() nu le
    // cunoaște, deci le completăm separat pe rândul din profiles deja creat
    // de trigger. Limba determină ulterior în ce limbă primește partenerul
    // emailuri/notificări; utilizatorul o poate schimba oricând din cont.
    if (tara) {
      await supabaseAdmin.from('profiles').update({ tara, limba }).eq('id', invited.user.id);
    }

    // 4. Email de bun venit, în limba dedusă din țară — best-effort.
    await trimiteEmailBunVenit({ email, nume, tip, limba });

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

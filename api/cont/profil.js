// /api/cont/profil.js
// Profilul contului logat, pentru butonul de cont din antet și pentru paza
// dashboard-urilor (pasul 10b, 16 oct. 2026).
//
// GET, cu Authorization: Bearer <access_token>
// → { ok, email, nume, roles, roluri_dashboard, destinatie, tip_destinatie,
//     partener: null | { nume_firma, partner_type, rol, status_verificare,
//                        contract_semnat, cont_bancar, motiv_respingere } }
//
// roles vine din profiles.roles (singura sursă pentru acces). Fără date
// sensibile: fără IBAN (doar „are cont bancar activ: da / nu”), fără CNP,
// fără CUI. Paza din pagini e doar pentru experiența utilizatorului; accesul
// real îl verifică fiecare endpoint (lib/auth-middleware.js).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { destinatiePentru } = require('../../lib/destinatie-cont');
const { roluriCuDashboard } = require('../../lib/destinatie-rol');
const { rolPentruTipPartener } = require('../../lib/roluri-partener');

function numeAfisat(user) {
  const m = user.user_metadata || {};
  const nume = [m.prenume, m.nume].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  return nume || String(m.full_name || m.name || '').trim() || null;
}

// Motivul ultimei respingeri, dacă adminul l-a scris (audit_log, verifica-document).
async function motivRespingere(partnerId) {
  const { data } = await supabaseAdmin
    .from('audit_log')
    .select('detalii, creat_la')
    .eq('entitate', 'partners').eq('entitate_id', String(partnerId)).eq('actiune', 'partener_respins')
    .order('creat_la', { ascending: false })
    .limit(1);
  const motiv = data && data[0] && data[0].detalii && data[0].detalii.motiv;
  return motiv ? String(motiv).slice(0, 500) : null;
}

async function handler(req, res, user) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const { data: profil, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle();
    if (error) throw error;
    const roles = Array.isArray(profil?.roles) ? profil.roles : [];

    let partener = null;
    const { data: p, error: pErr } = await supabaseAdmin
      .from('partners')
      .select('nume_firma, partner_type, status_verificare, contract_semnat')
      .eq('id', user.id).maybeSingle();
    if (pErr) throw pErr;
    if (p) {
      const { data: conturi } = await supabaseAdmin
        .from('partner_conturi_bancare').select('id').eq('partner_id', user.id).eq('activ', true).limit(1);
      partener = {
        nume_firma: p.nume_firma || null,
        partner_type: p.partner_type,
        rol: rolPentruTipPartener(p.partner_type),
        status_verificare: p.status_verificare || 'pending_review',
        contract_semnat: !!p.contract_semnat,
        cont_bancar: Array.isArray(conturi) && conturi.length > 0,
        motiv_respingere: p.status_verificare === 'rejected' ? await motivRespingere(user.id) : null,
      };
    }

    const d = await destinatiePentru(user);
    return res.status(200).json({
      ok: true,
      email: user.email || null,
      nume: numeAfisat(user),
      roles,
      roluri_dashboard: roluriCuDashboard(roles),
      destinatie: d && d.destinatie ? d.destinatie : null,
      tip_destinatie: d ? d.tip : null,
      partener,
    });
  } catch (err) {
    console.error('[cont/profil]', err);
    return res.status(500).json({ error: 'Nu am putut încărca profilul.', error_en: 'Could not load your profile.' });
  }
}

module.exports = requireAuth([], handler);

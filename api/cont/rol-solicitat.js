// /api/cont/rol-solicitat.js
// Pasul 11-R3 (decizia LM, 2 nov. 2026): utilizatorul conectat alege un tip de
// partener (din „Devino partener” sau din „Rolurile mele” → „Adaugă acest
// rol”) și ajunge direct în dashboard-ul rolului, în modul activare (lista
// „Activează contul”).
//
// POST { rol } — rol ∈ partener_servicii | partener_materiale | partener_inchirieri |
//                      partener_curier | partener_asigurari
//   → { ok, rol, destinatie }   destinatie = dashboard-ul rolului (harta unică)
//
// Salvează doar alegerea (profiles.rol_solicitat), cu service role. Nu adaugă
// niciun rol în profiles.roles: rolul îl adaugă serverul la pasul „Firma”
// (api/partener/wizard-companie.js). Un cont are un singur tip de partener:
// alt tip decât partenerul existent → 409.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { dashboardPentruRol } = require('../../lib/destinatie-rol');
const { esteRolPartener } = require('../../lib/activare-partener');
const { ROL_DUPA_TIP_PARTENER } = require('../../lib/roluri-partener');
const v = require('../../lib/valideaza');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  rol: v.text({ max: 40, eticheta: ['Rolul', 'Role'] }),
};

const MESAJ = {
  rol: {
    ro: 'Tipul de partener nu e valid. Alege unul dintre: servicii, materiale, închirieri, curier, asigurări.',
    en: 'The partner type is not valid. Choose one of: services, materials, rentals, courier, insurance.',
  },
  alt_tip: {
    ro: 'Contul tău are deja un alt tip de partener. Un cont poate avea un singur tip de partener; pentru alt tip, scrie-ne din pagina Contact.',
    en: 'Your account already has another partner type. An account can have only one partner type; for another type, write to us from the Contact page.',
  },
  server: {
    ro: 'Nu am putut salva alegerea. Încearcă din nou peste câteva momente.',
    en: 'We could not save your choice. Please try again in a few moments.',
  },
};

async function handler(req, res, user) {
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');
  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const rol = req.body && req.body.rol;
  if (!esteRolPartener(rol)) return trimiteEroare(res, 400, 'ROL_INVALID', MESAJ.rol.ro, MESAJ.rol.en, [camp('rol', MESAJ.rol.ro, MESAJ.rol.en)]);

  try {
    const [{ data: partener, error: pErr }, { data: profil, error: prErr }] = await Promise.all([
      supabaseAdmin.from('partners').select('partner_type').eq('id', user.id).maybeSingle(),
      supabaseAdmin.from('profiles').select('roles').eq('id', user.id).maybeSingle(),
    ]);
    if (pErr) throw pErr;
    if (prErr) throw prErr;
    const roluri = Array.isArray(profil?.roles) ? profil.roles : [];
    const rolExistent = (partener && ROL_DUPA_TIP_PARTENER[partener.partner_type]) || roluri.find(esteRolPartener) || null;
    if (rolExistent && rolExistent !== rol) return trimiteEroare(res, 409, 'ALT_TIP_PARTENER', MESAJ.alt_tip.ro, MESAJ.alt_tip.en);

    if (!rolExistent) {
      const { error } = await supabaseAdmin.from('profiles').update({ rol_solicitat: rol }).eq('id', user.id);
      if (error) throw error;
    }
    return res.status(200).json({ ok: true, rol, destinatie: dashboardPentruRol(rol) });
  } catch (err) {
    console.error('[cont/rol-solicitat]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', MESAJ.server.ro, MESAJ.server.en);
  }
}

module.exports = formaComuna(requireAuth([], handler));

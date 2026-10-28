// /api/cont/agenda.js
// Pasul 11-P3a (26 oct. 2026): agenda contului logat — adresele și
// profilurile de facturare. Același API pentru dashboard-uri și pentru
// checkout / coș (componenta agenda-cont.js), deci o modificare făcută într-un
// loc apare și în celălalt. Doar pe contul propriu: orice `id` primit se
// verifică pe server (user_id = user.id); altfel 404. Regulile: lib/agenda-cont.js.
//
// GET  → { ok, adrese, profiluri, firma_partener }
//        (CNP doar mascat: cnp_furnizat + cnp_ultimele3; firma_partener = datele
//         firmei din `partners`, pentru „Folosește datele firmei mele”, sau null)
// POST { actiune, ... } → { ok, id, adrese, profiluri, ... }
//   adresa_salveaza   { id?, eticheta, folosire, strada, localitate, judet, cod_postal, tara,
//                       instructiuni_acces, implicita_prestare?, implicita_facturare? }
//   adresa_sterge     { id }   → și profiluri_fara_adresa: [id] (trebuie aleasă altă adresă)
//   profil_salveaza   { id?, eticheta, tip:'pf'|'pj', prenume, nume, cnp, sterge_cnp?,
//                       cui, denumire, nr_reg_com, adresa_facturare_id | adresa_noua:{...}, implicit? }
//   profil_sterge     { id }
//   seteaza_implicit  { tip:'adresa_prestare'|'adresa_facturare'|'profil', id }
// Erori: forma comună (lib/raspuns-eroare.js), RO + EN, cu `camp`; limitele
// de 10 adrese / 5 profiluri → 409.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare, camp } = require('../../lib/raspuns-eroare');
const A = require('../../lib/agenda-cont');

const ACTIUNI = {
  adresa_salveaza: (u, b) => A.salveazaAdresa(u, b),
  adresa_sterge: (u, b) => A.stergeAdresa(u, b.id),
  profil_salveaza: (u, b) => A.salveazaProfil(u, b),
  profil_sterge: (u, b) => A.stergeProfil(u, b.id),
  seteaza_implicit: (u, b) => A.seteazaImplicit(u, b),
};

// Datele firmei partenerului (partners.id = user.id), doar ca precompletare.
async function firmaPartener(userId) {
  try {
    const { data } = await supabaseAdmin
      .from('partners')
      .select('nume_firma, cui, nr_reg_com, adresa_sediu_social')
      .eq('id', userId)
      .maybeSingle();
    if (!data || !data.nume_firma) return null;
    return { denumire: data.nume_firma, cui: data.cui || null, nr_reg_com: data.nr_reg_com || null, sediu: data.adresa_sediu_social || null };
  } catch (e) {
    return null;
  }
}

function trimiteRefuz(res, r) {
  return trimiteEroare(res, r.status || 400, r.cod || 'DATE_INVALIDE', r.error, r.error_en,
    r.camp ? [camp(r.camp, r.error, r.error_en)] : [], r.camp ? { camp: r.camp } : undefined);
}

async function handler(req, res, user) {
  try {
    if (req.method === 'GET') {
      const [agenda, firma] = await Promise.all([A.agendaPublica(user.id), firmaPartener(user.id)]);
      return res.status(200).json({ ok: true, ...agenda, firma_partener: firma });
    }
    if (req.method !== 'POST') {
      return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
    }
    const corp = req.body && typeof req.body === 'object' ? req.body : {};
    const fn = ACTIUNI[corp.actiune];
    if (!fn) {
      return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Acțiune necunoscută.', 'Unknown action.', [], { camp: 'actiune' });
    }
    const r = await fn(user.id, corp);
    if (!r.ok) return trimiteRefuz(res, r);
    const { ok: _ok, ...detalii } = r;
    return res.status(200).json({ ok: true, ...detalii, ...(await A.agendaPublica(user.id)) });
  } catch (err) {
    console.error('[cont/agenda]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER',
      'Agenda nu poate fi încărcată sau salvată acum. Încearcă din nou peste câteva minute.',
      'Your address book cannot be loaded or saved right now. Try again in a few minutes.');
  }
}

module.exports = requireAuth([], handler);

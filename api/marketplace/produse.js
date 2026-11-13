// /api/marketplace/produse.js
// CRUD real pentru Marketplace (materiale + echipamente) — înlocuiește
// saveMaterial()/saveEchipament() 100% decorative din mydarrin-marketplace.html
// (audit 2 August 2026: zero schemă, zero backend, doar showToast()).
//
// Dualitate furnizor/admin într-un singur endpoint, nu două paralele —
// cerință explicită: „Superadmin & Admini... pot încărca, actualiza sau
// corecta orice tip de date... indiferent de proprietar". Furnizorul e
// forțat mereu pe propriul furnizor_id (izolare reală, în cod — nu doar UI);
// admin/superadmin poate trimite orice furnizor_id explicit.
//
// GET  ?tip=materiale|echipamente&furnizor_id=(doar admin)
// POST { action:'salveaza', tip, id?, furnizor_id?(doar admin), ...campuri }
// POST { action:'sterge', tip, id, furnizor_id?(doar admin) }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { valideazaMaterial, valideazaEchipament, incarcaContextValidare } = require('../../lib/valideaza-produs-marketplace');
const { trimiteEroare, trimiteEroareInterna } = require('../../lib/raspuns-eroare');

const ROLURI = ['partener_materiale', 'partener_inchirieri', 'admin', 'superadmin'];
const TABEL = { materiale: 'marketplace_materiale', echipamente: 'marketplace_echipamente' };

async function esteAdmin(userId) {
  const { data } = await supabaseAdmin.from('profiles').select('roles').eq('id', userId).maybeSingle();
  const roles = data?.roles || [];
  return roles.includes('admin') || roles.includes('superadmin');
}

function rezolvaFurnizorId(req, user, admin) {
  const dinBody = req.body?.furnizor_id;
  const dinQuery = req.query?.furnizor_id;
  if (admin && (dinBody || dinQuery)) return dinBody || dinQuery;
  return user.id; // partners.id === auth.users.id, confirmat în schema
}

async function handleGet(req, res, user, admin) {
  const tip = req.query.tip === 'echipamente' ? 'echipamente' : 'materiale';
  const tabel = TABEL[tip];

  let query = supabaseAdmin.from(tabel).select('*').order('creat_la', { ascending: false }).limit(500);
  if (admin && req.query.furnizor_id) {
    query = query.eq('furnizor_id', req.query.furnizor_id);
  } else if (!admin) {
    query = query.eq('furnizor_id', user.id);
  }
  // admin fără furnizor_id => vede tot (folosit de panoul de aprobări/corecție)

  const { data, error } = await query;
  if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
  return res.status(200).json({ ok: true, produse: data, tip });
}

async function handleSalveaza(req, res, user, admin) {
  const { tip, id } = req.body || {};
  if (!TABEL[tip]) return trimiteEroare(res, 400, 'DATE_INVALIDE', "tip trebuie să fie 'materiale' sau 'echipamente'", 'tip must be \'materiale\' or \'echipamente\'.', ['tip']);
  const tabel = TABEL[tip];

  // Rând existent — necesar pentru izolare (furnizorul nu poate corecta
  // produsul altui furnizor), pentru fluxul "resubmit după respingere" și
  // ca implicit pentru furnizor_id la UPDATE (vezi bug fixat mai jos).
  let randExistent = null;
  if (id) {
    const { data } = await supabaseAdmin.from(tabel).select('furnizor_id, status').eq('id', id).maybeSingle();
    randExistent = data;
    if (!randExistent) return trimiteEroare(res, 404, 'PRODUS_NU_EXISTA', 'Produsul nu există.', 'The product does not exist.');
    if (!admin && randExistent.furnizor_id !== user.id) {
      return trimiteEroare(res, 403, 'FARA_DREPT', 'Nu poți edita un produs care nu îți aparține.', 'You cannot edit a product that does not belong to you.');
    }
  }

  // FIX (testat live, 2 August 2026): la UPDATE, dacă admin-ul corectează
  // un produs FĂRĂ să specifice explicit furnizor_id, trebuie păstrat
  // proprietarul EXISTENT al rândului — altfel rezolvaFurnizorId() cădea pe
  // fallback-ul „user.id" (contul adminului, care nu e neapărat furnizor),
  // producând un fals „Furnizorul specificat nu există."
  const furnizorId = id
    ? ((admin && (req.body.furnizor_id || req.query.furnizor_id)) || randExistent.furnizor_id)
    : rezolvaFurnizorId(req, user, admin);
  const { data: furnizor } = await supabaseAdmin.from('partners').select('id').eq('id', furnizorId).maybeSingle();
  if (!furnizor) return trimiteEroare(res, 404, 'NU_EXISTA', 'Furnizorul specificat nu există.', 'The specified supplier does not exist.');

  const { data: profilFurnizor } = await supabaseAdmin.from('profiles').select('tara').eq('id', furnizorId).maybeSingle();
  const ctx = await incarcaContextValidare(profilFurnizor?.tara || 'RO');

  const rezultat = tip === 'materiale' ? valideazaMaterial(req.body, ctx) : valideazaEchipament(req.body, ctx);
  if (!rezultat.valid) {
    return trimiteEroare(res, 400, 'VALIDARE_ESUATA', 'Produsul nu îndeplinește condițiile de validare — nu a fost salvat.', 'The product does not meet the validation rules, so it was not saved.', null, { erori: rezultat.erori });
  }

  const payload = { ...rezultat.normalizat, furnizor_id: furnizorId, creat_de: user.id, actualizat_la: new Date().toISOString() };

  if (!id) {
    // Rând nou: admin publică direct (e deja autoritatea de aprobare);
    // furnizorul așteaptă aprobare.
    payload.status = admin ? 'live' : 'in_asteptare';
  } else if (!admin && randExistent.status === 'respins') {
    // Furnizorul corectează un produs respins -> reintră la coadă, curat.
    payload.status = 'in_asteptare';
    payload.motiv_respingere = null;
  }
  // Altfel (admin corectează un rând existent, sau furnizor editează un
  // rând deja live/in_asteptare): statusul nu se schimbă aici — decizia de
  // aprobare/respingere trece explicit prin api/admin/marketplace-aprobari.js.

  const query = id
    ? supabaseAdmin.from(tabel).update(payload).eq('id', id)
    : supabaseAdmin.from(tabel).insert(payload);
  const { data, error } = await query.select().single();

  if (error) {
    if (error.code === '23505') {
      return trimiteEroare(res, 409, 'EXISTA_DEJA', `Există deja un produs cu codul „${payload.cod_produs_furnizor}" pentru acest furnizor.`, `There is already a product with the code “${payload.cod_produs_furnizor}” for this supplier.`, ['cod_produs_furnizor']);
    }
    console.error('[marketplace/produse] salveaza', error);
    return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
  }
  return res.status(200).json({ ok: true, produs: data });
}

async function handleSterge(req, res, user, admin) {
  const { tip, id } = req.body || {};
  if (!TABEL[tip] || !id) return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'tip și id sunt obligatorii.', 'tip and id are required.');

  let query = supabaseAdmin.from(TABEL[tip]).delete().eq('id', id);
  if (!admin) query = query.eq('furnizor_id', user.id);
  const { data, error } = await query.select();
  if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
  if (!data || !data.length) return trimiteEroare(res, 404, 'PRODUS_NU_EXISTA', 'Produsul nu există sau nu îți aparține.', 'The product does not exist or does not belong to you.');
  return res.status(200).json({ ok: true });
}

// Faza 2 (30 sept. 2026): toggle live/offline din lista de produse a
// dashboardului — nu re-validează tot produsul (formularul complet nu e
// retrimis la un simplu switch), doar flipuiește `activ` pe un rând deja
// aprobat. Nu schimbă `status` (aprobare admin) — un produs respins rămâne
// respins indiferent de acest toggle.
async function handleToggleActiv(req, res, user, admin) {
  const { tip, id, activ } = req.body || {};
  if (!TABEL[tip] || !id || typeof activ !== 'boolean') {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', "tip, id și activ (boolean) sunt obligatorii.", 'tip, id and activ (boolean) are required.');
  }
  let query = supabaseAdmin.from(TABEL[tip]).update({ activ, actualizat_la: new Date().toISOString() }).eq('id', id);
  if (!admin) query = query.eq('furnizor_id', user.id);
  const { data, error } = await query.select();
  if (error) return trimiteEroareInterna(res, 500, 'EROARE_SERVER', null, null, error);
  if (!data || !data.length) return trimiteEroare(res, 404, 'PRODUS_NU_EXISTA', 'Produsul nu există sau nu îți aparține.', 'The product does not exist or does not belong to you.');
  return res.status(200).json({ ok: true, produs: data[0] });
}

async function handler(req, res, user) {
  const admin = await esteAdmin(user.id);

  if (req.method === 'GET') return handleGet(req, res, user, admin);
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { action } = req.body || {};
  if (action === 'salveaza') return handleSalveaza(req, res, user, admin);
  if (action === 'sterge') return handleSterge(req, res, user, admin);
  if (action === 'toggle_activ') return handleToggleActiv(req, res, user, admin);
  return trimiteEroare(res, 400, 'ACTIUNE_NECUNOSCUTA', `action necunoscută: ${action}`, `Unknown action: ${action}`, ['action']);
}

module.exports = requireAuth(ROLURI, handler);

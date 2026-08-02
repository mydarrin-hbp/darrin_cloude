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
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, produse: data, tip });
}

async function handleSalveaza(req, res, user, admin) {
  const { tip, id } = req.body || {};
  if (!TABEL[tip]) return res.status(400).json({ error: "tip trebuie să fie 'materiale' sau 'echipamente'" });
  const tabel = TABEL[tip];

  // Rând existent — necesar pentru izolare (furnizorul nu poate corecta
  // produsul altui furnizor), pentru fluxul "resubmit după respingere" și
  // ca implicit pentru furnizor_id la UPDATE (vezi bug fixat mai jos).
  let randExistent = null;
  if (id) {
    const { data } = await supabaseAdmin.from(tabel).select('furnizor_id, status').eq('id', id).maybeSingle();
    randExistent = data;
    if (!randExistent) return res.status(404).json({ error: 'Produsul nu există.' });
    if (!admin && randExistent.furnizor_id !== user.id) {
      return res.status(403).json({ error: 'Nu poți edita un produs care nu îți aparține.' });
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
  if (!furnizor) return res.status(404).json({ error: 'Furnizorul specificat nu există.' });

  const { data: profilFurnizor } = await supabaseAdmin.from('profiles').select('tara').eq('id', furnizorId).maybeSingle();
  const ctx = await incarcaContextValidare(profilFurnizor?.tara || 'RO');

  const rezultat = tip === 'materiale' ? valideazaMaterial(req.body, ctx) : valideazaEchipament(req.body, ctx);
  if (!rezultat.valid) {
    return res.status(400).json({ error: 'Produsul nu îndeplinește condițiile de validare — nu a fost salvat.', erori: rezultat.erori });
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
      return res.status(409).json({ error: `Există deja un produs cu codul „${payload.cod_produs_furnizor}" pentru acest furnizor.` });
    }
    console.error('[marketplace/produse] salveaza', error);
    return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({ ok: true, produs: data });
}

async function handleSterge(req, res, user, admin) {
  const { tip, id } = req.body || {};
  if (!TABEL[tip] || !id) return res.status(400).json({ error: 'tip și id sunt obligatorii.' });

  let query = supabaseAdmin.from(TABEL[tip]).delete().eq('id', id);
  if (!admin) query = query.eq('furnizor_id', user.id);
  const { data, error } = await query.select();
  if (error) return res.status(500).json({ error: error.message });
  if (!data || !data.length) return res.status(404).json({ error: 'Produsul nu există sau nu îți aparține.' });
  return res.status(200).json({ ok: true });
}

async function handler(req, res, user) {
  const admin = await esteAdmin(user.id);

  if (req.method === 'GET') return handleGet(req, res, user, admin);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};
  if (action === 'salveaza') return handleSalveaza(req, res, user, admin);
  if (action === 'sterge') return handleSterge(req, res, user, admin);
  return res.status(400).json({ error: `action necunoscută: ${action}` });
}

module.exports = requireAuth(ROLURI, handler);

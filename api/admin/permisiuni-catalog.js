// /api/admin/permisiuni-catalog.js
// Numirea adminilor de catalog (pasul 9, 15 oct. 2026): doar superadminul.
// Un admin de catalog are un rând în admin_permissions cu
//   sectiune = 'catalog_servicii', poate_scrie = true,
//   sectiune_specializata = '*' sau lista de capitole ('F,N'),
//   tara_cod = opțional, acordat_de = superadminul.
// Regula și capitolele: docs/regula-incadrare.md.
//
// POST { action: 'lista' }                              → admini + drepturi + capitole
// POST { action: 'acorda', admin_id, capitole: '*' | ['F','N'], tara_cod? }
// POST { action: 'revoca', admin_id }                    → șterge doar rândul de catalog, nu contul

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { requireAuth } = require('../../lib/auth-middleware');
const { formaComuna } = require('../../lib/raspuns-eroare');
const { inregistreazaAudit } = require('../../lib/audit-log');

const SECTIUNE = 'catalog_servicii';
const MIGRARE = { error: 'Migrarea ruta_incadrare nu e aplicată.', error_en: 'The ruta_incadrare migration is not applied.', cod: 'MIGRARE_NEAPLICATA' };
const lipsaSchema = (e) => !!e && (['42P01', '42703', 'PGRST205', 'PGRST204'].includes(e.code) || /does not exist|schema cache/i.test(e.message || ''));

async function capitole() {
  const { data, error } = await supabaseAdmin.from('meniu_capitole').select('cod, titlu_ro, titlu_en').order('ordine');
  if (error) return lipsaSchema(error) ? null : Promise.reject(error);
  return data || [];
}

async function actionLista(req, res) {
  const [caps, { data: admini, error }] = await Promise.all([
    capitole(),
    supabaseAdmin.from('profiles').select('id, email, roles').overlaps('roles', ['admin']).order('email'),
  ]);
  if (error) throw error;
  const ids = (admini || []).map((a) => a.id);
  const { data: randuri } = ids.length
    ? await supabaseAdmin.from('admin_permissions').select('admin_id, sectiune_specializata, tara_cod, poate_scrie').eq('sectiune', SECTIUNE).in('admin_id', ids)
    : { data: [] };
  const drept = new Map((randuri || []).filter((r) => r.poate_scrie).map((r) => [r.admin_id, r]));
  return res.status(200).json({
    ok: true,
    migrare_aplicata: caps !== null,
    capitole: caps || [],
    admini: (admini || []).map((a) => ({
      id: a.id, email: a.email, roles: a.roles,
      catalog: drept.has(a.id) ? { capitole: drept.get(a.id).sectiune_specializata, tara_cod: drept.get(a.id).tara_cod } : null,
    })),
  });
}

async function actionAcorda(req, res, superadmin) {
  const { admin_id, capitole: cerute, tara_cod } = req.body || {};
  if (!admin_id) return res.status(400).json({ error: 'admin_id obligatoriu.', error_en: 'admin_id is required.' });
  const caps = await capitole();
  if (caps === null) return res.status(409).json(MIGRARE);
  const coduri = caps.map((c) => c.cod);
  let valoare;
  if (cerute === '*') valoare = '*';
  else {
    const lista = [...new Set((Array.isArray(cerute) ? cerute : String(cerute || '').split(',')).map((c) => String(c).trim()).filter(Boolean))];
    if (!lista.length) return res.status(400).json({ error: 'Alege cel puțin un capitol sau * (toate).', error_en: 'Choose at least one chapter or * (all).' });
    const necunoscute = lista.filter((c) => !coduri.includes(c));
    if (necunoscute.length) return res.status(400).json({ error: `Capitole necunoscute: ${necunoscute.join(', ')}.`, error_en: `Unknown chapters: ${necunoscute.join(', ')}.` });
    valoare = coduri.filter((c) => lista.includes(c)).join(',');
  }
  const tara = tara_cod ? String(tara_cod).trim().toUpperCase() : null;
  if (tara && !/^[A-Z]{2}$/.test(tara)) return res.status(400).json({ error: 'Țara: cod de 2 litere (ex. RO).', error_en: 'Country: a 2-letter code (e.g. RO).' });

  const { data: profil } = await supabaseAdmin.from('profiles').select('roles').eq('id', admin_id).maybeSingle();
  if (!profil || !(profil.roles || []).includes('admin')) {
    return res.status(400).json({ error: 'Contul nu are rolul admin.', error_en: 'The account does not have the admin role.' });
  }
  const { error } = await supabaseAdmin.from('admin_permissions').upsert({
    admin_id, sectiune: SECTIUNE, poate_scrie: true, sectiune_specializata: valoare, tara_cod: tara, acordat_de: superadmin.id,
  }, { onConflict: 'admin_id,sectiune' });
  if (error) throw error;
  await inregistreazaAudit({ admin: superadmin, req, actiune: 'catalog_acorda_admin', entitate: 'admin_permissions', entitate_id: admin_id, detalii: { capitole: valoare, tara_cod: tara } });
  return res.status(200).json({ ok: true, capitole: valoare, tara_cod: tara });
}

async function actionRevoca(req, res, superadmin) {
  const { admin_id } = req.body || {};
  if (!admin_id) return res.status(400).json({ error: 'admin_id obligatoriu.', error_en: 'admin_id is required.' });
  const { error } = await supabaseAdmin.from('admin_permissions').delete().eq('admin_id', admin_id).eq('sectiune', SECTIUNE);
  if (error) throw error;
  await inregistreazaAudit({ admin: superadmin, req, actiune: 'catalog_revoca_admin', entitate: 'admin_permissions', entitate_id: admin_id, detalii: null });
  return res.status(200).json({ ok: true });
}

const ACTIUNI = { lista: actionLista, acorda: actionAcorda, revoca: actionRevoca };

async function handler(req, res, superadmin) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const fn = ACTIUNI[(req.body || {}).action];
  if (!fn) return res.status(400).json({ error: `action invalidă: ${Object.keys(ACTIUNI).join(', ')}` });
  try {
    return await fn(req, res, superadmin);
  } catch (e) {
    console.error('[admin/permisiuni-catalog]', e);
    // Constrângerea veche pe sectiune_specializata (înainte de migrarea ruta_incadrare)
    if (e && e.code === '23514') return res.status(409).json(MIGRARE);
    return res.status(500).json({ error: 'Nu am putut salva dreptul de catalog.', error_en: 'Could not save the catalogue right.' });
  }
}

module.exports = formaComuna(requireAuth(['superadmin'], handler));

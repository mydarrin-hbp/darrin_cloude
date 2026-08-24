// /api/partener/facturi.js
// Audit Secțiunea 41/42, 31 Iulie 2026 — confirmat de superadmin: pentru
// alocări reale deja eliberate din escrow (comanda_subcontractori, alimentat
// de lib/elibereaza-escrow.js la comandă finalizată + încasată), partenerul
// are acțiunea de a emite factura sa proprie către entitatea juridică a
// platformei din țara respectivă. Platforma NU generează factura fiscală a
// partenerului (ar necesita CUI-ul/seria lui de facturare) — doar
// înregistrează documentul urcat de el și urmărește plata.
//
// GET  -> { ok, facturabile: [alocări eliberate, fără factură încă],
//           facturi: [facturile deja emise de acest partener] }
// POST -> { comanda_subcontractor_id, numar_factura_partener, fisier_base64, mime_type }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;
const EXT_FOR_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

function base64Bytes(b64) {
  const padding = (b64.match(/=+$/) || [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function handleGet(req, res, user) {
  const { data: alocari, error: alocariErr } = await supabaseAdmin
    .from('comanda_subcontractori')
    .select('id, comanda_id, rol_tip, suma_neta_alocata, status, creat_la')
    .eq('actor_id', user.id)
    .eq('status', 'alocat');
  if (alocariErr) {
    console.error('[partener/facturi] alocari', alocariErr);
    return res.status(500).json({ error: 'Nu am putut încărca alocările' });
  }

  const { data: facturiExistente, error: facturiErr } = await supabaseAdmin
    .from('facturi_parteneri')
    .select('*')
    .eq('partener_id', user.id)
    .order('creat_la', { ascending: false });
  if (facturiErr) {
    console.error('[partener/facturi] facturi existente', facturiErr);
    return res.status(500).json({ error: 'Nu am putut încărca facturile' });
  }

  const idAlocariFacturate = new Set(facturiExistente.map((f) => f.comanda_subcontractor_id));
  const alocariFacturabile = (alocari || []).filter((a) => !idAlocariFacturate.has(a.id));

  const idComenzi = [...new Set(alocariFacturabile.map((a) => a.comanda_id))];
  let comenziIdx = {};
  if (idComenzi.length) {
    const { data: comenzi } = await supabaseAdmin
      .from('comenzi')
      .select('id, nr_comanda, moneda, tara_cod')
      .in('id', idComenzi);
    (comenzi || []).forEach((c) => { comenziIdx[c.id] = c; });
  }

  const idTari = [...new Set(Object.values(comenziIdx).map((c) => c.tara_cod).filter(Boolean))];
  let entitatiIdx = {};
  if (idTari.length) {
    const { data: entitati } = await supabaseAdmin
      .from('entitati_juridice_platforma')
      .select('id, tara_cod, denumire, cui, adresa')
      .in('tara_cod', idTari);
    (entitati || []).forEach((e) => { entitatiIdx[e.tara_cod] = e; });
  }

  const facturabile = alocariFacturabile.map((a) => {
    const c = comenziIdx[a.comanda_id] || {};
    return {
      comanda_subcontractor_id: a.id,
      comanda_id: a.comanda_id,
      nr_comanda: c.nr_comanda || null,
      rol_tip: a.rol_tip,
      suma: Number(a.suma_neta_alocata) || 0,
      moneda: c.moneda || null,
      entitate_beneficiara: entitatiIdx[c.tara_cod] || null,
    };
  });

  return res.status(200).json({ ok: true, facturabile, facturi: facturiExistente });
}

async function handlePost(req, res, user) {
  const { comanda_subcontractor_id, numar_factura_partener, fisier_base64, mime_type } = req.body || {};

  if (!comanda_subcontractor_id || !numar_factura_partener) {
    return res.status(400).json({ error: 'comanda_subcontractor_id și numar_factura_partener sunt obligatorii' });
  }
  if (!fisier_base64 || !ALLOWED_MIME.has(mime_type)) {
    return res.status(400).json({ error: `mime_type acceptat: ${[...ALLOWED_MIME].join(', ')}` });
  }
  if (base64Bytes(fisier_base64) > MAX_BYTES) {
    return res.status(400).json({ error: 'Fișierul depășește 5MB' });
  }

  const { data: alocare, error: alocareErr } = await supabaseAdmin
    .from('comanda_subcontractori')
    .select('id, comanda_id, actor_id, suma_neta_alocata, status')
    .eq('id', comanda_subcontractor_id)
    .maybeSingle();
  if (alocareErr) {
    console.error('[partener/facturi] alocare', alocareErr);
    return res.status(500).json({ error: 'Eroare la verificarea alocării' });
  }
  if (!alocare) return res.status(404).json({ error: 'Alocarea nu există' });
  if (alocare.actor_id !== user.id) return res.status(403).json({ error: 'Această alocare nu îți aparține' });
  if (alocare.status !== 'alocat') {
    return res.status(409).json({ error: `Alocarea nu e într-o stare facturabilă (status curent: ${alocare.status})` });
  }

  const { data: comanda } = await supabaseAdmin
    .from('comenzi')
    .select('moneda, tara_cod')
    .eq('id', alocare.comanda_id)
    .maybeSingle();

  const { data: entitate } = await supabaseAdmin
    .from('entitati_juridice_platforma')
    .select('id')
    .eq('tara_cod', comanda?.tara_cod || null)
    .maybeSingle();

  let buffer;
  try {
    buffer = Buffer.from(fisier_base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'fisier_base64 invalid' });
  }

  const ext = EXT_FOR_MIME[mime_type];
  const path = `${user.id}/${comanda_subcontractor_id}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('facturi-parteneri')
    .upload(path, buffer, { contentType: mime_type });
  if (uploadErr) {
    console.error('[partener/facturi] storage', uploadErr);
    return res.status(500).json({ error: 'Nu am putut încărca fișierul facturii' });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('facturi_parteneri')
    .insert({
      comanda_subcontractor_id,
      partener_id: user.id,
      entitate_beneficiara_id: entitate?.id || null,
      numar_factura_partener,
      fisier_storage_path: path,
      suma: alocare.suma_neta_alocata,
      moneda: comanda?.moneda || 'RON',
      status: 'emisa',
    })
    .select()
    .single();
  if (insertErr) {
    if (insertErr.code === '23505') return res.status(409).json({ error: 'Există deja o factură emisă pentru această alocare' });
    console.error('[partener/facturi] insert', insertErr);
    return res.status(500).json({ error: 'Nu am putut înregistra factura' });
  }

  // D2c (24 august 2026): status-ul de pe comanda_subcontractori trebuie să
  // reflecte LIVE starea reală — rândul rămânea blocat la 'alocat' pentru
  // totdeauna, deși schema permite alocat→executat→facturat→platit (verificat
  // live: toate rândurile reale erau stuck la 'alocat'). 'executat' rămâne
  // neatins aici — rândul se creează abia la eliberarea escrow-ului
  // (lib/elibereaza-escrow.js), moment care survine DUPĂ execuția fizică
  // reală, deci nu există niciun declanșator real pentru acea tranziție în
  // acest flux.
  const { error: statusErr } = await supabaseAdmin
    .from('comanda_subcontractori')
    .update({ status: 'facturat' })
    .eq('id', comanda_subcontractor_id);
  if (statusErr) console.error('[partener/facturi] status→facturat', statusErr);

  return res.status(200).json({ ok: true, factura: inserted });
}

async function handler(req, res, user) {
  if (req.method === 'GET') return handleGet(req, res, user);
  if (req.method === 'POST') return handlePost(req, res, user);
  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(ROLURI_PARTENER, handler);

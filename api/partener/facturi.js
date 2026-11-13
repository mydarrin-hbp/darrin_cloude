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
const { esteFurnizorPropriu, EROARE_FACTURA_FURNIZOR_PROPRIU, EROARE_FACTURA_FURNIZOR_PROPRIU_EN } = require('../../lib/furnizor-propriu');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const ROLURI_PARTENER = [
  'partener_curier', 'partener_servicii', 'partener_materiale',
  'partener_inchirieri', 'partener_asigurari',
];

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;
// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  comanda_subcontractor_id: v.id({ eticheta: ['Lucrarea', 'Job'] }),
  numar_factura_partener: v.text({ max: 60, eticheta: ['Numărul facturii', 'Invoice number'] }),
  fisier_base64: v.text({ max: Math.ceil(MAX_BYTES * 4 / 3) + 4, faraTrim: true, eticheta: ['Fișierul facturii', 'Invoice file'] }),
  mime_type: v.text({ max: 100, eticheta: ['Tipul fișierului', 'File type'] }),
};
const EXT_FOR_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

function base64Bytes(b64) {
  const padding = (b64.match(/=+$/) || [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function handleGet(req, res, user) {
  // Furnizorul propriu al platformei (16 oct. 2026) nu își facturează sieși:
  // nu are alocări facturabile; facturile vechi, dacă există, rămân vizibile.
  const propriu = await esteFurnizorPropriu(user.id);
  const { data: alocari, error: alocariErr } = await supabaseAdmin
    .from('comanda_subcontractori')
    .select('id, comanda_id, rol_tip, suma_neta_alocata, status, creat_la')
    .eq('actor_id', user.id)
    .eq('status', 'alocat');
  if (alocariErr) {
    console.error('[partener/facturi] alocari', alocariErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca alocările', 'We could not load the allocations.');
  }

  const { data: facturiExistente, error: facturiErr } = await supabaseAdmin
    .from('facturi_parteneri')
    .select('*')
    .eq('partener_id', user.id)
    .order('creat_la', { ascending: false });
  if (facturiErr) {
    console.error('[partener/facturi] facturi existente', facturiErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca facturile', 'We could not load the invoices.');
  }

  const idAlocariFacturate = new Set(facturiExistente.map((f) => f.comanda_subcontractor_id));
  const alocariFacturabile = propriu ? [] : (alocari || []).filter((a) => !idAlocariFacturate.has(a.id));

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
      .in('tara_cod', idTari)
      .eq('activa', true);
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

  return res.status(200).json({ ok: true, facturabile, facturi: facturiExistente, furnizor_propriu: propriu });
}

async function handlePost(req, res, user) {
  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora', limite: { exceptii: ['fisier_base64'] } })) return;
  const { comanda_subcontractor_id, numar_factura_partener, fisier_base64, mime_type } = req.body || {};

  if (!comanda_subcontractor_id || !numar_factura_partener) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_subcontractor_id și numar_factura_partener sunt obligatorii', 'comanda_subcontractor_id and numar_factura_partener are required.');
  }
  if (!fisier_base64 || !ALLOWED_MIME.has(mime_type)) {
    return trimiteEroare(res, 400, 'TIP_FISIER', `mime_type acceptat: ${[...ALLOWED_MIME].join(', ')}`, `Accepted mime_type: ${[...ALLOWED_MIME].join(', ')}`, ['mime_type']);
  }
  if (base64Bytes(fisier_base64) > MAX_BYTES) {
    return trimiteEroare(res, 400, 'PREA_MARE', 'Fișierul depășește 5MB', 'The file is larger than 5MB.');
  }
  if (await esteFurnizorPropriu(user.id)) {
    return trimiteEroare(res, 409, 'FURNIZOR_PROPRIU', EROARE_FACTURA_FURNIZOR_PROPRIU, EROARE_FACTURA_FURNIZOR_PROPRIU_EN, null, { code: 'FURNIZOR_PROPRIU' });
  }

  const { data: alocare, error: alocareErr } = await supabaseAdmin
    .from('comanda_subcontractori')
    .select('id, comanda_id, actor_id, suma_neta_alocata, status')
    .eq('id', comanda_subcontractor_id)
    .maybeSingle();
  if (alocareErr) {
    console.error('[partener/facturi] alocare', alocareErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare la verificarea alocării', 'Error while checking the allocation. Please try again.');
  }
  if (!alocare) return trimiteEroare(res, 404, 'NU_EXISTA', 'Alocarea nu există', 'The allocation does not exist.');
  if (alocare.actor_id !== user.id) return trimiteEroare(res, 403, 'FARA_DREPT', 'Această alocare nu îți aparține', 'This allocation does not belong to you.');
  if (alocare.status !== 'alocat') {
    return trimiteEroare(res, 409, 'STARE_GRESITA', `Alocarea nu e într-o stare facturabilă (status curent: ${alocare.status})`, `The allocation is not in a billable state (current status: ${alocare.status}).`);
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
    .eq('activa', true)
    .maybeSingle();

  let buffer;
  try {
    buffer = Buffer.from(fisier_base64, 'base64');
  } catch (e) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'fisier_base64 invalid', 'fisier_base64 is not valid.', ['fisier_base64']);
  }

  const ext = EXT_FOR_MIME[mime_type];
  const path = `${user.id}/${comanda_subcontractor_id}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('facturi-parteneri')
    .upload(path, buffer, { contentType: mime_type });
  if (uploadErr) {
    console.error('[partener/facturi] storage', uploadErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca fișierul facturii', 'We could not upload the invoice file. Please try again.');
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
    if (insertErr.code === '23505') return trimiteEroare(res, 409, 'EXISTA_DEJA', 'Există deja o factură emisă pentru această alocare', 'An invoice has already been issued for this allocation.');
    console.error('[partener/facturi] insert', insertErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra factura', 'We could not record the invoice. Please try again.');
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
  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

module.exports = requireAuth(ROLURI_PARTENER, handler);

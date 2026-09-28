// /api/client/dauna.js
// Dosare de daună deschise de client pe o comandă proprie (Etapa 5d, 28 sept. 2026).
// Fiecare dosar primește un ID Eveniment Corelat unic, CLAIM-YYYY-CMDxxxx-TIP,
// același pentru client și pentru asigurator.
//
// GET  ?comanda_id=<uuid> (opțional) -> { ok, dosare:[...] } doar dosarele clientului
// POST { comanda_id, tip: 'EXE'|'MAT'|'TRN', descriere, valoare_estimata? } -> { ok, dosar }
//   EXE = execuție (lucrare), MAT = material, TRN = transport.
//
// Un dosar se poate deschide doar pe o comandă a clientului, după ce partenerul
// a marcat lucrarea finalizată. Identitatea partenerului nu se expune aici.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const TIPURI = ['EXE', 'MAT', 'TRN'];
const STATUSURI_COMANDA_CU_DAUNA = ['finalizata', 'confirmata_client'];

function claimIdPentru(comanda, tip) {
  const an = new Date().getFullYear();
  const cifre = String(comanda.nr_comanda || '').match(/(\d+)\s*$/);
  const nr = cifre ? cifre[1] : String(comanda.id).slice(0, 6).toUpperCase();
  return `CLAIM-${an}-CMD${nr}-${tip}`;
}

function publica(d) {
  return {
    id: d.id, claim_id: d.claim_id, comanda_id: d.comanda_id, tip: d.tip,
    descriere: d.descriere, valoare_estimata: d.valoare_estimata,
    valoare_aprobata: d.valoare_aprobata, moneda: d.moneda, status: d.status,
    decizie_motiv: d.decizie_motiv, creat_la: d.creat_la, actualizat_la: d.actualizat_la,
  };
}

async function handler(req, res, user) {
  if (req.method === 'GET') {
    let q = supabaseAdmin.from('dosare_dauna').select('*').eq('deschis_de', user.id).order('creat_la', { ascending: false });
    const comandaId = req.query?.comanda_id;
    if (comandaId) q = q.eq('comanda_id', String(comandaId));
    const { data, error } = await q;
    if (error) {
      console.error('[client/dauna] GET', error);
      return res.status(500).json({ error: 'Nu am putut încărca dosarele.' });
    }
    return res.status(200).json({ ok: true, dosare: (data || []).map(publica) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { comanda_id, tip, descriere, valoare_estimata } = req.body || {};
  if (!comanda_id || typeof comanda_id !== 'string') return res.status(400).json({ error: 'comanda_id este obligatoriu.' });
  if (!TIPURI.includes(tip)) return res.status(400).json({ error: `tip trebuie să fie unul din: ${TIPURI.join(', ')}.` });
  const text = typeof descriere === 'string' ? descriere.trim() : '';
  if (text.length < 10 || text.length > 2000) {
    return res.status(400).json({ error: 'Descrierea trebuie să aibă între 10 și 2000 de caractere.' });
  }
  let valoare = null;
  if (valoare_estimata !== undefined && valoare_estimata !== null && valoare_estimata !== '') {
    valoare = Number(valoare_estimata);
    if (!Number.isFinite(valoare) || valoare < 0) return res.status(400).json({ error: 'valoare_estimata trebuie să fie un număr pozitiv.' });
  }

  const { data: comanda, error: errCom } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, client_id, status, moneda')
    .eq('id', comanda_id)
    .maybeSingle();
  if (errCom) {
    console.error('[client/dauna] comanda', errCom);
    return res.status(500).json({ error: 'Nu am putut verifica comanda.' });
  }
  if (!comanda || comanda.client_id !== user.id) return res.status(404).json({ error: 'Comanda nu există.' });
  if (!STATUSURI_COMANDA_CU_DAUNA.includes(comanda.status)) {
    return res.status(409).json({ error: 'Poți deschide un dosar de daună abia după ce lucrarea a fost finalizată.' });
  }

  const claimId = claimIdPentru(comanda, tip);
  const { data: existent } = await supabaseAdmin.from('dosare_dauna').select('claim_id').eq('claim_id', claimId).maybeSingle();
  if (existent) return res.status(409).json({ error: `Există deja un dosar ${claimId} pentru această comandă și acest tip.`, claim_id: claimId });

  const { data, error } = await supabaseAdmin
    .from('dosare_dauna')
    .insert({
      claim_id: claimId, comanda_id, tip, deschis_de: user.id, descriere: text,
      valoare_estimata: valoare, moneda: comanda.moneda || null,
    })
    .select()
    .single();
  if (error) {
    console.error('[client/dauna] insert', error);
    return res.status(500).json({ error: 'Nu am putut deschide dosarul.' });
  }
  return res.status(200).json({ ok: true, dosar: publica(data) });
}

module.exports = requireAuth([], handler);

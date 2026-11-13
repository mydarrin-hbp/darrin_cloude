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
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  comanda_id: v.id({ eticheta: ['Comanda', 'Order'] }),
  tip: v.text({ max: 40, eticheta: ['Tipul daunei', 'Damage type'] }),
  descriere: v.text({ max: 2000, eticheta: ['Descriere', 'Description'] }),
  valoare_estimata: v.numar({ min: 0, max: 1000000000, eticheta: ['Valoarea estimată', 'Estimated value'] }),
};

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
      return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca dosarele.', 'We could not load the claims. Please try again.');
    }
    return res.status(200).json({ ok: true, dosare: (data || []).map(publica) });
  }

  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
  const { comanda_id, tip, descriere, valoare_estimata } = req.body || {};
  if (!comanda_id || typeof comanda_id !== 'string') return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'comanda_id este obligatoriu.', 'comanda_id is required.', ['comanda_id']);
  if (!TIPURI.includes(tip)) return trimiteEroare(res, 400, 'DATE_INVALIDE', `tip trebuie să fie unul din: ${TIPURI.join(', ')}.`, `tip must be one of: ${TIPURI.join(', ')}.`, ['tip']);
  const text = typeof descriere === 'string' ? descriere.trim() : '';
  if (text.length < 10 || text.length > 2000) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Descrierea trebuie să aibă între 10 și 2000 de caractere.', 'The description must have between 10 and 2000 characters.', ['descriere']);
  }
  let valoare = null;
  if (valoare_estimata !== undefined && valoare_estimata !== null && valoare_estimata !== '') {
    valoare = Number(valoare_estimata);
    if (!Number.isFinite(valoare) || valoare < 0) return trimiteEroare(res, 400, 'DATE_INVALIDE', 'valoare_estimata trebuie să fie un număr pozitiv.', 'valoare_estimata must be a positive number.', ['valoare_estimata']);
  }

  const { data: comanda, error: errCom } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, client_id, status, moneda')
    .eq('id', comanda_id)
    .maybeSingle();
  if (errCom) {
    console.error('[client/dauna] comanda', errCom);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut verifica comanda.', 'We could not check the order. Please try again.');
  }
  if (!comanda || comanda.client_id !== user.id) return trimiteEroare(res, 404, 'COMANDA_NU_EXISTA', 'Comanda nu există.', 'The order does not exist.');
  if (!STATUSURI_COMANDA_CU_DAUNA.includes(comanda.status)) {
    return trimiteEroare(res, 409, 'STARE_GRESITA', 'Poți deschide un dosar de daună abia după ce lucrarea a fost finalizată.', 'You can open a claim only after the work has been completed.');
  }

  const claimId = claimIdPentru(comanda, tip);
  const { data: existent } = await supabaseAdmin.from('dosare_dauna').select('claim_id').eq('claim_id', claimId).maybeSingle();
  if (existent) return trimiteEroare(res, 409, 'EXISTA_DEJA', `Există deja un dosar ${claimId} pentru această comandă și acest tip.`, `There is already a claim ${claimId} for this order and this type.`, null, { claim_id: claimId });

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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut deschide dosarul.', 'We could not open the claim. Please try again.');
  }
  return res.status(200).json({ ok: true, dosar: publica(data) });
}

module.exports = requireAuth([], handler);

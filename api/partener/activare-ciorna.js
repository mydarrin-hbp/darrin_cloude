// /api/partener/activare-ciorna.js
// Pasul 11-R3, corecție (decizia LM, 2 nov. 2026): ciorna activării pe pași.
// Ce scrie utilizatorul într-un pas încă nesalvat se păstrează automat, ca
// să reia exact de unde a rămas, de pe orice dispozitiv (activare-pasi.js).
//
// GET    → { ok, ciorna: null | { pas_curent, date, actualizat_la } }   (doar a sa)
// PUT    { pas_curent, date } → { ok, actualizat_la }
//        - doar pentru contul cu rol de partener ales (profiles.rol_solicitat)
//          sau acordat (profiles.roles); altfel 403;
//        - date: obiect, cel mult 50 KB (altfel 413); fără fișiere — cheile
//          sensibile (IBAN, coduri) se scot pe server, oricum ar veni;
// DELETE → { ok }   (după pasul 6, „Contractul”)
//
// Ciorna e doar un ajutor: nu acordă nimic și nu înlocuiește salvarea pasului.
// Tabelul vine din docs/migrations-propuse/2026-11-02_activare_ciorna.sql;
// înainte de migrare răspunsul e 503 CIORNA_INDISPONIBILA, iar pagina oprește
// salvarea automată în tăcere.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { trimiteEroare, formaComuna } = require('../../lib/raspuns-eroare');
const { esteRolPartener } = require('../../lib/activare-partener');

const TABEL = 'partener_activare_ciorna';
const MAX_OCTETI = 50 * 1024;
// Valori care nu se păstrează în ciornă (se cer din nou la salvarea pasului).
const CHEI_SENSIBILE = /^(iban|cod|cod_otp|parola|cnp|fisier|document)$/i;

const MESAJ = {
  fara_rol: {
    ro: 'Ciorna activării e doar pentru conturile care au ales un rol de partener.',
    en: 'The activation draft is only for accounts that have chosen a partner role.',
  },
  prea_mare: {
    ro: 'Ciorna e prea mare (cel mult 50 KB). Salvează pasul ca să continui.',
    en: 'The draft is too large (at most 50 KB). Save the step to continue.',
  },
  invalid: {
    ro: 'Ciorna nu e validă: pasul trebuie să fie între 1 și 6, iar datele un obiect.',
    en: 'The draft is not valid: the step must be between 1 and 6 and the data an object.',
  },
  indisponibil: {
    ro: 'Salvarea automată nu e disponibilă acum. Pașii salvați rămân.',
    en: 'Automatic saving is not available right now. Saved steps remain.',
  },
  server: {
    ro: 'Nu am putut salva ciorna. Încearcă din nou.',
    en: 'We could not save the draft. Please try again.',
  },
};

function tabelLipsa(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /partener_activare_ciorna/.test(String(error.message || '')));
}

// Scoate cheile sensibile, la orice nivel.
function curata(v) {
  if (Array.isArray(v)) return v.map(curata);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { if (!CHEI_SENSIBILE.test(k)) o[k] = curata(v[k]); });
    return o;
  }
  return v;
}

async function areRolPartener(userId) {
  let { data, error } = await supabaseAdmin.from('profiles').select('roles, rol_solicitat').eq('id', userId).maybeSingle();
  if (error) ({ data, error } = await supabaseAdmin.from('profiles').select('roles').eq('id', userId).maybeSingle());
  if (error) throw error;
  const roluri = Array.isArray(data?.roles) ? data.roles : [];
  return esteRolPartener(data?.rol_solicitat) || roluri.some(esteRolPartener);
}

async function handler(req, res, user) {
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from(TABEL).select('pas_curent, date, actualizat_la').eq('user_id', user.id).maybeSingle();
      if (tabelLipsa(error)) return trimiteEroare(res, 503, 'CIORNA_INDISPONIBILA', MESAJ.indisponibil.ro, MESAJ.indisponibil.en);
      if (error) throw error;
      return res.status(200).json({ ok: true, ciorna: data || null });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabaseAdmin.from(TABEL).delete().eq('user_id', user.id);
      if (tabelLipsa(error)) return res.status(200).json({ ok: true });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'PUT') return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');

    const corp = req.body || {};
    if (Buffer.byteLength(JSON.stringify(corp), 'utf8') > MAX_OCTETI) {
      return trimiteEroare(res, 413, 'CIORNA_PREA_MARE', MESAJ.prea_mare.ro, MESAJ.prea_mare.en);
    }
    const pas = Number(corp.pas_curent);
    if (!Number.isInteger(pas) || pas < 1 || pas > 6 || !corp.date || typeof corp.date !== 'object' || Array.isArray(corp.date)) {
      return trimiteEroare(res, 400, 'CIORNA_INVALIDA', MESAJ.invalid.ro, MESAJ.invalid.en);
    }
    if (!(await areRolPartener(user.id))) return trimiteEroare(res, 403, 'FARA_ROL_PARTENER', MESAJ.fara_rol.ro, MESAJ.fara_rol.en);

    const actualizat_la = new Date().toISOString();
    const { error } = await supabaseAdmin.from(TABEL).upsert({ user_id: user.id, pas_curent: pas, date: curata(corp.date), actualizat_la }, { onConflict: 'user_id' });
    if (tabelLipsa(error)) return trimiteEroare(res, 503, 'CIORNA_INDISPONIBILA', MESAJ.indisponibil.ro, MESAJ.indisponibil.en);
    if (error) throw error;
    return res.status(200).json({ ok: true, actualizat_la });
  } catch (err) {
    console.error('[partener/activare-ciorna]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', MESAJ.server.ro, MESAJ.server.en);
  }
}

module.exports = formaComuna(requireAuth([], handler));

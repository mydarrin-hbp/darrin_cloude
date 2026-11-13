// /api/partener/program-lucru.js
// G28 — programul de lucru pe care partenerul îl declară singur, folosit
// de calculul real de sloturi disponibile (lib/calculeaza-sloturi-
// disponibile.js). Fără niciun rând salvat, partenerul e tratat cu
// fallback-ul implicit 08:00-20:00 în fiecare zi (vezi acel fișier) — GET-ul
// de mai jos întoarce explicit acest fallback dacă partenerul nu și-a
// declarat încă un program, ca panoul din dashboard să pornească pre-completat.
//
// GET  -> { ok, program: [{zi_saptamana, ora_inceput, ora_sfarsit, activ}] } (7 rânduri, 0=Duminică)
// POST { program: [...] } -> upsert toate cele 7 rânduri

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const v = require('../../lib/valideaza');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

// Pasul 11-S1: tipurile și lungimile câmpurilor primite (lib/valideaza.js).
const SCHEMA = {
  program: v.lista(null, { max: 7, eticheta: ['Programul de lucru', 'Working hours'] }),
};

const FALLBACK = { ora_inceput: '08:00:00', ora_sfarsit: '20:00:00', activ: true };

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('parteneri_program_lucru')
      .select('zi_saptamana, ora_inceput, ora_sfarsit, activ')
      .eq('partener_id', user.id);
    if (error) return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca programul de lucru', 'We could not load the working hours.');

    const perZi = new Map((data || []).map((r) => [r.zi_saptamana, r]));
    const program = [0, 1, 2, 3, 4, 5, 6].map((zi) => perZi.get(zi) || { zi_saptamana: zi, ...FALLBACK });
    return res.status(200).json({ ok: true, program, esteImplicit: !data?.length });
  }

  if (req.method === 'POST') {
    if (!v.valideazaSauTrimite(req, res, SCHEMA, { necunoscute: 'ignora' })) return;
    const { program } = req.body || {};
    if (!Array.isArray(program) || program.length !== 7) {
      return trimiteEroare(res, 400, 'DATE_INVALIDE', 'program trebuie să fie un array cu exact 7 zile', 'program must be an array with exactly 7 days.', ['program']);
    }
    for (const zi of program) {
      if (typeof zi.zi_saptamana !== 'number' || zi.zi_saptamana < 0 || zi.zi_saptamana > 6) {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', 'zi_saptamana invalidă', 'zi_saptamana is not valid.', ['zi_saptamana']);
      }
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(zi.ora_inceput || '') || !/^\d{2}:\d{2}(:\d{2})?$/.test(zi.ora_sfarsit || '')) {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', 'ora_inceput/ora_sfarsit trebuie în format HH:MM', 'ora_inceput/ora_sfarsit must be in HH:MM format.');
      }
    }

    const randuri = program.map((zi) => ({
      partener_id: user.id,
      zi_saptamana: zi.zi_saptamana,
      ora_inceput: zi.ora_inceput,
      ora_sfarsit: zi.ora_sfarsit,
      activ: !!zi.activ,
    }));

    const { error } = await supabaseAdmin
      .from('parteneri_program_lucru')
      .upsert(randuri, { onConflict: 'partener_id,zi_saptamana' });
    if (error) {
      console.error('[program-lucru]', error);
      return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut salva programul de lucru', 'We could not save the working hours. Please try again.');
    }
    return res.status(200).json({ ok: true });
  }

  return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
}

module.exports = requireAuth([], handler);

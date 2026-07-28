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

const FALLBACK = { ora_inceput: '08:00:00', ora_sfarsit: '20:00:00', activ: true };

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('parteneri_program_lucru')
      .select('zi_saptamana, ora_inceput, ora_sfarsit, activ')
      .eq('partener_id', user.id);
    if (error) return res.status(500).json({ error: 'Nu am putut încărca programul de lucru' });

    const perZi = new Map((data || []).map((r) => [r.zi_saptamana, r]));
    const program = [0, 1, 2, 3, 4, 5, 6].map((zi) => perZi.get(zi) || { zi_saptamana: zi, ...FALLBACK });
    return res.status(200).json({ ok: true, program, esteImplicit: !data?.length });
  }

  if (req.method === 'POST') {
    const { program } = req.body || {};
    if (!Array.isArray(program) || program.length !== 7) {
      return res.status(400).json({ error: 'program trebuie să fie un array cu exact 7 zile' });
    }
    for (const zi of program) {
      if (typeof zi.zi_saptamana !== 'number' || zi.zi_saptamana < 0 || zi.zi_saptamana > 6) {
        return res.status(400).json({ error: 'zi_saptamana invalidă' });
      }
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(zi.ora_inceput || '') || !/^\d{2}:\d{2}(:\d{2})?$/.test(zi.ora_sfarsit || '')) {
        return res.status(400).json({ error: 'ora_inceput/ora_sfarsit trebuie în format HH:MM' });
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
      return res.status(500).json({ error: 'Nu am putut salva programul de lucru' });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth([], handler);

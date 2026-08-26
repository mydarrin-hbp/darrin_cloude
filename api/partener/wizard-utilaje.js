// /api/partener/wizard-utilaje.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 4:
// declarație utilaje/echipamente.
//
// EXTINDERE (25 august 2026) — taxonomie flotă (Curier de cartier +
// Închirieri/Utilaje), cerută explicit: capacitate/dimensiuni/tip
// suprastructură structurate, în loc de text liber. Scop aprobat explicit:
// DOAR structura de date acum — fără catalog curatoriat marcă/model, fără
// extragere automată din CIV (ambele rămân itemi separați, neaprobați).
//
// GET    → utilajele declarate curent
// POST   { utilaje: [{ denumire, tip?, cantitate?, an_fabricatie?, marca?,
//                       model?, capacitate_kg?, lungime_utila_cm?,
//                       latime_utila_cm?, inaltime_utila_cm?,
//                       tip_suprastructura? }, ...] }  (ADAUGĂ — vezi FIX mai jos)
// DELETE { id }  (26 august 2026 — șterge un singur utilaj)
//
// FIX (26 august 2026, Etapa 2/2i) — aceeași corecție ca la wizard-angajati.js:
// POST înlocuia tot ce era declarat, potrivit doar pentru wizard-ul de 8
// pași (orfan, 0 apelanți reali) — devine acum strict adăugare, pentru noua
// secțiune de dashboard "Utilajele mele".

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const TIPURI_SUPRASTRUCTURA = [
  'bena_deschisa', 'bena_inchisa_carosata', 'prelata',
  'cisterna_alimentara', 'cisterna_chimica', 'cisterna_petroliera',
  'macara_pe_bena', 'autobetoniera', 'pompa_beton_sapa', 'nacela',
  'manitou_telehandler', 'electrostivuitor', 'utilaj_dezapezire_maturat', 'altul',
];

function numarPozitivSauNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined; // undefined = invalid, distinct de "lipsă"
}

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_utilaje')
      .select('*')
      .eq('partner_id', user.id)
      .order('creat_la', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, utilaje: data || [] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const { data, error } = await supabaseAdmin
      .from('partner_utilaje')
      .delete()
      .eq('id', id)
      .eq('partner_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Utilajul nu există sau nu-ți aparține' });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { utilaje } = req.body || {};
  if (!Array.isArray(utilaje) || !utilaje.length) {
    return res.status(400).json({ error: 'Declară cel puțin un utilaj/echipament' });
  }
  for (const u of utilaje) {
    if (!u.denumire || typeof u.denumire !== 'string') {
      return res.status(400).json({ error: 'Fiecare utilaj trebuie să aibă o denumire' });
    }
    if (u.tip_suprastructura && !TIPURI_SUPRASTRUCTURA.includes(u.tip_suprastructura)) {
      return res.status(400).json({ error: `Tip suprastructură necunoscut pentru „${u.denumire}": ${u.tip_suprastructura}` });
    }
    for (const camp of ['capacitate_kg', 'lungime_utila_cm', 'latime_utila_cm', 'inaltime_utila_cm']) {
      if (u[camp] !== undefined && u[camp] !== null && u[camp] !== '' && numarPozitivSauNull(u[camp]) === undefined) {
        return res.status(400).json({ error: `${camp} trebuie să fie un număr pozitiv pentru „${u.denumire}"` });
      }
    }
  }

  try {
    const randuri = utilaje.map((u) => ({
      partner_id: user.id,
      denumire: u.denumire,
      tip: u.tip || null,
      cantitate: Number.isFinite(u.cantitate) && u.cantitate > 0 ? u.cantitate : 1,
      an_fabricatie: Number.isFinite(u.an_fabricatie) ? u.an_fabricatie : null,
      marca: u.marca || null,
      model: u.model || null,
      capacitate_kg: numarPozitivSauNull(u.capacitate_kg) || null,
      lungime_utila_cm: numarPozitivSauNull(u.lungime_utila_cm) || null,
      latime_utila_cm: numarPozitivSauNull(u.latime_utila_cm) || null,
      inaltime_utila_cm: numarPozitivSauNull(u.inaltime_utila_cm) || null,
      tip_suprastructura: u.tip_suprastructura || null,
    }));
    const { error: insErr } = await supabaseAdmin.from('partner_utilaje').insert(randuri);
    if (insErr) throw insErr;

    return res.status(200).json({ ok: true, count: randuri.length });
  } catch (err) {
    console.error('[wizard-utilaje]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva utilajele' });
  }
}

module.exports = requireAuth([], handler);

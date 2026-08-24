// /api/partener/wizard-angajati.js
// Wizard partener în 8 pași (Etapa 4, audit 2026-07-13) — Pasul 5: registru
// angajați, legat de nomenclatorul ESCO (competente_esco.cod_esco). CNP-ul
// e criptat exact ca IBAN-ul (cripteaza_camp/decripteaza_camp, migrația
// partner_wizard_8_pasi_schema_si_criptare) — niciodată stocat în clar.
//
// GET   → angajații înregistrați (CNP mascat, nu decriptat integral)
// POST  { angajati: [{ nume, cnp, cod_esco }, ...] }  (înlocuire completă)
// PATCH { id, disponibil }  (24 august 2026, aprobat — toggle rapid tip
//         Uber/Bolt, distinct de POST-ul de mai sus care înlocuiește tot
//         roster-ul; folosit de lib/aloca-partener.js la alocare)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_angajati')
      .select('id, nume, cod_esco, cnp_criptat, disponibil, activ, creat_la')
      .eq('partner_id', user.id)
      .eq('activ', true);
    if (error) return res.status(500).json({ error: error.message });

    const angajati = await Promise.all((data || []).map(async (a) => {
      let cnp_mascat = null;
      if (a.cnp_criptat) {
        const { data: cnp } = await supabaseAdmin.rpc('decripteaza_camp', { valoare_criptata: a.cnp_criptat });
        cnp_mascat = cnp ? `${cnp.slice(0, 1)}••••••••${cnp.slice(-2)}` : null;
      }
      return { id: a.id, nume: a.nume, cod_esco: a.cod_esco, cnp_mascat, disponibil: a.disponibil, creat_la: a.creat_la };
    }));
    const totalDisponibili = angajati.filter((a) => a.disponibil).length;
    return res.status(200).json({ ok: true, angajati, total: angajati.length, total_disponibili: totalDisponibili });
  }

  if (req.method === 'PATCH') {
    const { id, disponibil } = req.body || {};
    if (!id || typeof disponibil !== 'boolean') {
      return res.status(400).json({ error: 'id și disponibil (boolean) sunt obligatorii' });
    }
    const { data, error } = await supabaseAdmin
      .from('partner_angajati')
      .update({ disponibil })
      .eq('id', id)
      .eq('partner_id', user.id) // gardă: doar propriul angajat
      .eq('activ', true)
      .select('id, nume, disponibil')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Angajatul nu există sau nu-ți aparține' });
    return res.status(200).json({ ok: true, angajat: data });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { angajati } = req.body || {};
  if (!Array.isArray(angajati) || !angajati.length) {
    return res.status(400).json({ error: 'Adaugă cel puțin un angajat' });
  }
  for (const a of angajati) {
    if (!a.nume || typeof a.nume !== 'string') return res.status(400).json({ error: 'Fiecare angajat trebuie să aibă un nume' });
    if (!a.cnp || !/^\d{13}$/.test(String(a.cnp))) return res.status(400).json({ error: `CNP invalid pentru ${a.nume} (trebuie 13 cifre)` });
  }

  try {
    if (angajati.some((a) => a.cod_esco)) {
      const coduri = [...new Set(angajati.map((a) => a.cod_esco).filter(Boolean))];
      const { data: valide, error: refErr } = await supabaseAdmin.from('competente_esco').select('cod_esco').in('cod_esco', coduri);
      if (refErr) throw refErr;
      const codValidSet = new Set((valide || []).map((r) => r.cod_esco));
      const invalide = coduri.filter((c) => !codValidSet.has(c));
      if (invalide.length) return res.status(400).json({ error: `Coduri ESCO necunoscute: ${invalide.join(', ')}` });
    }

    // Dezactivăm angajații existenți în loc să-i ștergem — partner_certificari
    // și partner_alocari_sarcini pot referenția deja angajat_id-uri existente.
    const { error: dezErr } = await supabaseAdmin.from('partner_angajati').update({ activ: false }).eq('partner_id', user.id);
    if (dezErr) throw dezErr;

    const randuri = [];
    for (const a of angajati) {
      const { data: cripted, error: cryptErr } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: String(a.cnp) });
      if (cryptErr) throw cryptErr;
      randuri.push({ partner_id: user.id, nume: a.nume, cnp_criptat: cripted, cod_esco: a.cod_esco || null });
    }
    const { data: inserati, error: insErr } = await supabaseAdmin.from('partner_angajati').insert(randuri).select('id');
    if (insErr) throw insErr;

    return res.status(200).json({ ok: true, angajati: inserati });
  } catch (err) {
    console.error('[wizard-angajati]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva angajații' });
  }
}

module.exports = requireAuth([], handler);

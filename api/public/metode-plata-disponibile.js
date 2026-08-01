// /api/public/metode-plata-disponibile.js
// Audit Secțiunea 43, 31 Iulie 2026 — ce metode de plată sunt acceptate,
// configurabil din backoffice (api/admin/metode-plata-config.js) pe țară/
// regiune/categorie de serviciu (fiecare opțională = wildcard). Folosit de
// checkout (B2C — doar informativ, azi implicit doar card) și de fluxul
// B2G (api/comenzi/creeaza-b2g.js — aici contează real, OP devine opțiune).
//
// GET ?tara_cod=&regiune=&categorie_serviciu_slug=
// -> { ok, metode_acceptate: ['card','ordin_plata'], permite_avans: bool }
//
// Rezoluție: dintre rândurile active care se potrivesc (NULL = wildcard pe
// acea dimensiune), alegem cea mai SPECIFICĂ (cele mai puține wildcard-uri).
// Fallback dacă nu există nicio configurare: doar card, fără avans — exact
// comportamentul implicit de azi, neschimbat.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const FALLBACK = { metode_acceptate: ['card'], permite_avans: false };

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tara_cod = req.query.tara_cod ? String(req.query.tara_cod).toUpperCase() : null;
  const regiune = req.query.regiune || null;
  const categorie_serviciu_slug = req.query.categorie_serviciu_slug || null;

  try {
    const { data, error } = await supabaseAdmin
      .from('metode_plata_config')
      .select('tara_cod, regiune, categorie_serviciu_slug, metode_acceptate, permite_avans')
      .eq('activ', true);
    if (error) throw error;

    const candidate = (data || []).filter((r) =>
      (r.tara_cod === null || r.tara_cod === tara_cod) &&
      (r.regiune === null || r.regiune === regiune) &&
      (r.categorie_serviciu_slug === null || r.categorie_serviciu_slug === categorie_serviciu_slug)
    );

    if (!candidate.length) return res.status(200).json({ ok: true, ...FALLBACK });

    candidate.sort((a, b) => {
      const specA = [a.tara_cod, a.regiune, a.categorie_serviciu_slug].filter((v) => v !== null).length;
      const specB = [b.tara_cod, b.regiune, b.categorie_serviciu_slug].filter((v) => v !== null).length;
      return specB - specA;
    });

    const cel_mai_specific = candidate[0];
    return res.status(200).json({
      ok: true,
      metode_acceptate: cel_mai_specific.metode_acceptate || FALLBACK.metode_acceptate,
      permite_avans: !!cel_mai_specific.permite_avans,
    });
  } catch (err) {
    console.error('[metode-plata-disponibile]', err);
    return res.status(200).json({ ok: true, ...FALLBACK }); // fail-safe: nu blocăm checkout-ul pentru o eroare de configurare
  }
};

// /api/admin/comenzi-globale.js
// Panoul „Comenzi Globale” din superadmin (Etapa 0 SLA, 9 oct. 2026). Până
// acum panoul era o machetă („247 active”, cifră inventată).
//
// GET → { ok, fara_partener: [...], recente: [...], total_fara_partener }
//   fara_partener: comenzile în in_cautare_partener, cele mai vechi primele,
//                  cu vechimea în minute (vechime_min) — de tratat manual;
//   recente:       ultimele 50 de comenzi în alte statusuri.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const CAMPURI = 'id, nr_comanda, status, creat_la, catalog_serviciu_id, localitate, regiune, tara_cod, data_programata, ora_inceput_programata, ora_sfarsit_programata, suma_totala_platita, moneda, partener_id';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const [{ data: faraPartener, error: e1 }, { data: recente, error: e2 }] = await Promise.all([
      supabaseAdmin.from('comenzi').select(CAMPURI).eq('status', 'in_cautare_partener').order('creat_la', { ascending: true }).limit(200),
      supabaseAdmin.from('comenzi').select(CAMPURI).neq('status', 'in_cautare_partener').order('creat_la', { ascending: false }).limit(50),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;

    const toate = [...(faraPartener || []), ...(recente || [])];
    const idServicii = [...new Set(toate.map((c) => c.catalog_serviciu_id).filter(Boolean))];
    let titluri = new Map();
    if (idServicii.length) {
      const { data } = await supabaseAdmin.from('catalog_servicii').select('id, titlu').in('id', idServicii);
      titluri = new Map((data || []).map((s) => [s.id, s.titlu]));
    }
    const acum = Date.now();
    const imbogateste = (c) => ({
      ...c,
      serviciu: titluri.get(c.catalog_serviciu_id) || null,
      vechime_min: c.creat_la ? Math.max(0, Math.floor((acum - new Date(c.creat_la).getTime()) / 60000)) : null,
    });

    return res.status(200).json({
      ok: true,
      total_fara_partener: (faraPartener || []).length,
      fara_partener: (faraPartener || []).map(imbogateste),
      recente: (recente || []).map(imbogateste),
    });
  } catch (e) {
    console.error('[admin/comenzi-globale]', e);
    return res.status(500).json({ error: 'Nu am putut încărca comenzile.' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);

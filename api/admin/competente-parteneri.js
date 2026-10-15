// /api/admin/competente-parteneri.js
// Competențele bifate de parteneri (Etapa 1, reguli flexibile, 9 oct. 2026),
// pentru back-office.
//
// GET ?cod_esco=7411.1 (opțional) →
//   { ok, parteneri: [{ partener_id, firma, status_verificare, coduri: [{ cod_esco, bifat_la }] }],
//     pe_cod: { '7411.1': 3, ... } }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let q = supabaseAdmin.from('partener_competente').select('partener_id, cod_esco, bifat_la').order('bifat_la', { ascending: false });
    if (req.query?.cod_esco) q = q.eq('cod_esco', String(req.query.cod_esco));
    const { data: rows, error } = await q;
    if (error) throw error;

    const idParteneri = [...new Set((rows || []).map((r) => r.partener_id))];
    let parteneri = [];
    if (idParteneri.length) {
      const { data } = await supabaseAdmin.from('partners').select('id, nume_firma, status_verificare').in('id', idParteneri);
      parteneri = data || [];
    }
    const info = new Map(parteneri.map((p) => [p.id, p]));
    const grupat = new Map();
    const peCod = {};
    for (const r of rows || []) {
      if (!grupat.has(r.partener_id)) {
        const p = info.get(r.partener_id);
        grupat.set(r.partener_id, { partener_id: r.partener_id, firma: p?.nume_firma || null, status_verificare: p?.status_verificare || null, coduri: [] });
      }
      grupat.get(r.partener_id).coduri.push({ cod_esco: r.cod_esco, bifat_la: r.bifat_la });
      peCod[r.cod_esco] = (peCod[r.cod_esco] || 0) + 1;
    }
    return res.status(200).json({ ok: true, parteneri: [...grupat.values()], pe_cod: peCod });
  } catch (e) {
    console.error('[admin/competente-parteneri]', e);
    return res.status(500).json({ error: 'Nu am putut încărca competențele partenerilor.' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);

// /api/admin/dashboard-stats.js
// Înlocuiește cifrele hardcodate din panel-dashboard (mydarrin-superadmin.html,
// audit 25 august 2026): "247 comenzi active"/"1.834 parteneri live"/
// "284K escrow blocat"/"48.2K venituri lună"/"4.87 rating"/tabelul "Comenzi
// live per țară" — toate literale în markup, zero fetch, deja documentate
// ca machetă într-un audit anterior (21 august 2026).
//
// "Rating mediu" NU e inclus — tabela `recenzii` nu există deloc în schemă
// (verificat live) — nu se poate calcula onest.
//
// GET → { comenzi_active, parteneri_live, escrow_blocat, venituri_luna,
//          comenzi_per_tara: [{tara_cod, comenzi, valoare, checkout_activ}] }

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

const STATUS_ACTIVE = ['in_cautare_partener', 'acceptata', 'in_executie'];

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const inceputLuna = new Date();
    inceputLuna.setUTCDate(1);
    inceputLuna.setUTCHours(0, 0, 0, 0);

    const [
      { count: comenziActive },
      { count: parteneriLive },
      { data: comenziEscrow },
      { data: comisioaneLuna },
      { data: taraConfig },
    ] = await Promise.all([
      supabaseAdmin.from('comenzi').select('id', { count: 'exact', head: true }).in('status', STATUS_ACTIVE),
      supabaseAdmin.from('partners').select('id', { count: 'exact', head: true }).eq('status_verificare', 'approved'),
      supabaseAdmin.from('comenzi').select('tara_cod, suma_totala_platita, escrow_eliberat'),
      supabaseAdmin.from('comisioane').select('comision_platforma').gte('escrow_eliberat_la', inceputLuna.toISOString()),
      supabaseAdmin.from('tax_configurations').select('tara_cod, checkout_activ'),
    ]);

    const escrowBlocat = (comenziEscrow || [])
      .filter((c) => !c.escrow_eliberat)
      .reduce((sum, c) => sum + (Number(c.suma_totala_platita) || 0), 0);

    const veniturLuna = (comisioaneLuna || []).reduce((sum, c) => sum + (Number(c.comision_platforma) || 0), 0);

    const activMap = new Map((taraConfig || []).map((t) => [t.tara_cod, t.checkout_activ]));
    const perTara = new Map();
    for (const c of comenziEscrow || []) {
      const cod = c.tara_cod || 'necunoscut';
      if (!perTara.has(cod)) perTara.set(cod, { tara_cod: cod, comenzi: 0, valoare: 0 });
      const r = perTara.get(cod);
      r.comenzi += 1;
      r.valoare += Number(c.suma_totala_platita) || 0;
    }
    const comenziPerTara = [...perTara.values()]
      .map((r) => ({ ...r, valoare: Math.round(r.valoare * 100) / 100, checkout_activ: activMap.get(r.tara_cod) ?? null }))
      .sort((a, b) => b.comenzi - a.comenzi);

    return res.status(200).json({
      ok: true,
      comenzi_active: comenziActive || 0,
      parteneri_live: parteneriLive || 0,
      escrow_blocat: Math.round(escrowBlocat * 100) / 100,
      venituri_luna: Math.round(veniturLuna * 100) / 100,
      comenzi_per_tara: comenziPerTara,
    });
  } catch (err) {
    console.error('[admin/dashboard-stats]', err);
    return res.status(500).json({ error: 'Nu am putut calcula statisticile' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);

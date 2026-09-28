// /api/partener/dosare-dauna.js
// Dosarele de daună văzute de asigurator (Etapa 5d, 28 sept. 2026). Un asigurator
// aprobat vede dosarele nepreluate și pe cele preluate de el. Nu vede identitatea
// clientului; același ID Eveniment Corelat (CLAIM-YYYY-CMDxxxx-TIP) apare și la client.
//
// GET  -> { ok, dosare:[{ ..., nr_comanda, ale_mele }] }
// POST { id, actiune: 'preia'|'aproba'|'respinge'|'inchide', motiv?, valoare_aprobata? }
//   preia    : deschis -> in_analiza, dosarul devine al asiguratorului
//   aproba   : in_analiza -> aprobat (valoare_aprobata obligatorie)
//   respinge : in_analiza -> respins (motiv obligatoriu, min. 5 caractere)
//   inchide  : aprobat|respins -> inchis
// Transferul efectiv al sumei către furnizorul imputat nu se face aici; se înregistrează doar decizia.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

async function asiguratorAprobat(userId) {
  const { data } = await supabaseAdmin
    .from('partners')
    .select('id, partner_type, status_verificare')
    .eq('id', userId)
    .maybeSingle();
  return !!data && data.partner_type === 'asigurari' && data.status_verificare === 'approved';
}

function pentruAsigurator(d, userId, nrComanda) {
  return {
    id: d.id, claim_id: d.claim_id, tip: d.tip, descriere: d.descriere,
    valoare_estimata: d.valoare_estimata, valoare_aprobata: d.valoare_aprobata,
    moneda: d.moneda, status: d.status, decizie_motiv: d.decizie_motiv,
    creat_la: d.creat_la, actualizat_la: d.actualizat_la,
    nr_comanda: nrComanda || null, ale_mele: d.asigurator_id === userId,
  };
}

async function handler(req, res, user) {
  if (!(await asiguratorAprobat(user.id))) {
    return res.status(403).json({ error: 'Doar asiguratorii aprobați au acces la dosarele de daună.' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('dosare_dauna')
      .select('*')
      .or(`asigurator_id.eq.${user.id},asigurator_id.is.null`)
      .order('creat_la', { ascending: false })
      .limit(200);
    if (error) {
      console.error('[partener/dosare-dauna] GET', error);
      return res.status(500).json({ error: 'Nu am putut încărca dosarele.' });
    }
    const comandaIds = [...new Set((data || []).map((d) => d.comanda_id))];
    const nrPeComanda = new Map();
    if (comandaIds.length) {
      const { data: comenzi } = await supabaseAdmin.from('comenzi').select('id, nr_comanda').in('id', comandaIds);
      (comenzi || []).forEach((c) => nrPeComanda.set(c.id, c.nr_comanda));
    }
    return res.status(200).json({ ok: true, dosare: (data || []).map((d) => pentruAsigurator(d, user.id, nrPeComanda.get(d.comanda_id))) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, actiune, motiv, valoare_aprobata } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id este obligatoriu.' });

  const acum = new Date().toISOString();
  let q;
  if (actiune === 'preia') {
    q = supabaseAdmin.from('dosare_dauna')
      .update({ asigurator_id: user.id, status: 'in_analiza', actualizat_la: acum })
      .eq('id', id).eq('status', 'deschis').is('asigurator_id', null);
  } else if (actiune === 'aproba') {
    const val = Number(valoare_aprobata);
    if (valoare_aprobata === undefined || valoare_aprobata === null || valoare_aprobata === '' || !Number.isFinite(val) || val < 0) {
      return res.status(400).json({ error: 'valoare_aprobata este obligatorie și trebuie să fie un număr pozitiv.' });
    }
    q = supabaseAdmin.from('dosare_dauna')
      .update({ status: 'aprobat', valoare_aprobata: val, decizie_motiv: typeof motiv === 'string' && motiv.trim() ? motiv.trim().slice(0, 1000) : null, actualizat_la: acum })
      .eq('id', id).eq('asigurator_id', user.id).eq('status', 'in_analiza');
  } else if (actiune === 'respinge') {
    const m = typeof motiv === 'string' ? motiv.trim() : '';
    if (m.length < 5) return res.status(400).json({ error: 'Motivul respingerii este obligatoriu (minimum 5 caractere).' });
    q = supabaseAdmin.from('dosare_dauna')
      .update({ status: 'respins', decizie_motiv: m.slice(0, 1000), actualizat_la: acum })
      .eq('id', id).eq('asigurator_id', user.id).eq('status', 'in_analiza');
  } else if (actiune === 'inchide') {
    q = supabaseAdmin.from('dosare_dauna')
      .update({ status: 'inchis', actualizat_la: acum })
      .eq('id', id).eq('asigurator_id', user.id).in('status', ['aprobat', 'respins']);
  } else {
    return res.status(400).json({ error: 'actiune trebuie să fie: preia, aproba, respinge sau inchide.' });
  }

  const { data, error } = await q.select();
  if (error) {
    console.error('[partener/dosare-dauna] POST', error);
    return res.status(500).json({ error: 'Nu am putut actualiza dosarul.' });
  }
  if (!data || !data.length) {
    return res.status(409).json({ error: 'Acțiunea nu se poate aplica: dosarul nu există, e al altui asigurator sau nu e în starea potrivită.' });
  }
  return res.status(200).json({ ok: true, dosar: pentruAsigurator(data[0], user.id, null) });
}

module.exports = requireAuth(['partener_asigurari'], handler);

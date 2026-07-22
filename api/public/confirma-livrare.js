// /api/public/confirma-livrare.js
// Faza 5 — acțiunea reală din spatele paginii publice de confirmare.
//
// actiune='confirma': eliberează escrow-ul (lib/elibereaza-escrow.js,
// aceeași logică folosită de ruta admin) și marchează comanda ca
// confirmata_client. Ordinea contează: eliberarea rulează CÂT TIMP
// statusul e încă 'finalizata' (precondiția neschimbată a funcției
// comune) — abia după succes trecem la 'confirmata_client'.
//
// actiune='contesta': NU eliberează escrow — deschide o reclamație reală
// (tabela reclamatii, Faza 1) legată de comandă. Regula de business:
// contestație înainte de eliberare blochează eliberarea automată; cron-ul
// de confirmare tacită (Faza 5b) exclude explicit comenzile cu reclamație
// deschisă.
//
// Body: { token, actiune: 'confirma'|'contesta', motiv? }

const crypto = require('crypto');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { elibereazaEscrow } = require('../../lib/elibereaza-escrow');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'confirma-livrare', limit: 10, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const { token, actiune, motiv } = req.body || {};
  if (!token || !['confirma', 'contesta'].includes(actiune)) {
    return res.status(400).json({ error: 'token și actiune (confirma|contesta) sunt obligatorii' });
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, client_id, status, token_expira_la')
    .eq('token_confirmare', token)
    .maybeSingle();
  if (comErr) {
    console.error('[public/confirma-livrare]', comErr);
    return res.status(500).json({ error: 'Eroare la căutarea comenzii' });
  }
  if (!comanda) return res.status(404).json({ error: 'Link invalid sau expirat' });
  if (comanda.token_expira_la && new Date(comanda.token_expira_la) < new Date()) {
    return res.status(410).json({ error: 'Linkul a expirat' });
  }
  if (comanda.status !== 'finalizata') {
    return res.status(409).json({ error: `Comanda nu mai poate fi confirmată/contestată (status curent: ${comanda.status})` });
  }

  if (actiune === 'confirma') {
    const rezultat = await elibereazaEscrow(comanda.id); // null => eliberare automată (confirmare client)
    if (!rezultat.ok) return res.status(rezultat.status || 500).json({ error: rezultat.error });

    const { data: updatat, error: updErr } = await supabaseAdmin
      .from('comenzi')
      .update({ status: 'confirmata_client', confirmat_la: new Date().toISOString() })
      .eq('id', comanda.id)
      .select()
      .single();
    if (updErr) {
      console.error('[public/confirma-livrare] update status', updErr);
      return res.status(500).json({ error: 'Escrow eliberat, dar actualizarea statusului a eșuat — verifică din backoffice' });
    }
    return res.status(200).json({ ok: true, comanda: updatat });
  }

  // actiune === 'contesta'
  if (!motiv || typeof motiv !== 'string' || !motiv.trim()) {
    return res.status(400).json({ error: 'motiv este obligatoriu pentru o contestație' });
  }

  const { data: clientAuth } = await supabaseAdmin.auth.admin.getUserById(comanda.client_id);
  const email = clientAuth?.user?.email || 'necunoscut@homebestpal.com';
  const ticketNr = `TKT-${Date.now().toString().slice(-6)}-${crypto.randomInt(100, 999)}`;

  const { data: reclamatie, error: recErr } = await supabaseAdmin
    .from('reclamatii')
    .insert({
      ticket_nr: ticketNr,
      actor: 'client',
      speta: 'serviciu',
      comanda_id: comanda.id,
      nr_comanda_text: comanda.nr_comanda,
      email,
      descriere: motiv.trim(),
      tc_acceptat: true,
      gdpr_acceptat: true,
      creat_de: comanda.client_id,
    })
    .select()
    .single();
  if (recErr) {
    console.error('[public/confirma-livrare] reclamatie', recErr);
    return res.status(500).json({ error: 'Nu am putut înregistra contestația' });
  }

  return res.status(200).json({ ok: true, reclamatie });
};

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
const v = require('../../lib/valideaza');

const SCHEMA = {
  token: v.text({ obligatoriu: true, max: 200, eticheta: ['Codul din link', 'Link code'] }),
  actiune: v.dinLista(['confirma', 'contesta'], { obligatoriu: true, eticheta: ['Acțiune', 'Action'] }),
  motiv: v.text({ max: 2000, eticheta: ['Motivul contestației', 'Reason for the dispute'] }),
};
const { elibereazaEscrow } = require('../../lib/elibereaza-escrow');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const allowed = await checkRateLimit(req, { key: 'confirma-livrare', limit: 10, windowSeconds: 600 });
  if (!allowed) return trimiteEroare(res, 429, 'PREA_MULTE_CERERI', 'Prea multe cereri. Încearcă din nou mai târziu.', 'Too many requests. Please try again later.');

  // Pasul 11-S1: tipuri, lungimi și câmpurile acceptate.
  if (!v.valideazaSauTrimite(req, res, SCHEMA)) return;

  const { token, actiune, motiv } = req.body || {};
  if (!token || !['confirma', 'contesta'].includes(actiune)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'token și actiune (confirma|contesta) sunt obligatorii', 'token and actiune (confirma|contesta) are required');
  }

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, client_id, status, token_expira_la')
    .eq('token_confirmare', token)
    .maybeSingle();
  if (comErr) {
    console.error('[public/confirma-livrare]', comErr);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare la căutarea comenzii', 'Error while looking up the order');
  }
  if (!comanda) return trimiteEroare(res, 404, 'NU_EXISTA', 'Link invalid sau expirat', 'Invalid or expired link');
  if (comanda.token_expira_la && new Date(comanda.token_expira_la) < new Date()) {
    return trimiteEroare(res, 410, 'EXPIRAT', 'Linkul a expirat', 'The link has expired');
  }
  if (comanda.status !== 'finalizata') {
    return trimiteEroare(res, 409, 'CONFLICT', `Comanda nu mai poate fi confirmată/contestată (status curent: ${comanda.status})`, `The order can no longer be confirmed or disputed (current status: ${comanda.status})`);
  }

  if (actiune === 'confirma') {
    const rezultat = await elibereazaEscrow(comanda.id); // null => eliberare automată (confirmare client)
    if (!rezultat.ok) return trimiteEroare(res, rezultat.status || 500, rezultat.cod || 'EROARE', rezultat.error, rezultat.error_en);

    const { data: updatat, error: updErr } = await supabaseAdmin
      .from('comenzi')
      .update({ status: 'confirmata_client', confirmat_la: new Date().toISOString() })
      .eq('id', comanda.id)
      .select()
      .single();
    if (updErr) {
      console.error('[public/confirma-livrare] update status', updErr);
      return trimiteEroare(res, 500, 'EROARE_SERVER', 'Escrow eliberat, dar actualizarea statusului a eșuat — verifică din backoffice', 'Escrow released, but the status update failed — check in the back office');
    }
    return res.status(200).json({ ok: true, comanda: updatat });
  }

  // actiune === 'contesta'
  if (!motiv || typeof motiv !== 'string' || !motiv.trim()) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'motiv este obligatoriu pentru o contestație', 'A reason is required for a dispute');
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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra contestația', 'We could not register the dispute');
  }

  return res.status(200).json({ ok: true, reclamatie });
};

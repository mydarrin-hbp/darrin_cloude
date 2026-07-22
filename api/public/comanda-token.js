// /api/public/comanda-token.js
// Faza 5 — pagina publică de confirmare (confirmare-livrare.html) citește
// aici detaliile comenzii + fotografiile, pe baza token-ului trimis pe
// email la finalizare (api/partener/finalizeaza-comanda.js). Fără
// autentificare — tokenul UUID e singura "cheie", exact ca la un link de
// resetare parolă. Rate-limitat ca să nu poată fi brute-forțat.
//
// GET ?token=...

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

const SEMNATURA_URL_VALABILA_SECUNDE = 600; // 10 min — suficient cât userul se uită la pagină

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'comanda-token', limit: 20, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  const token = String(req.query?.token || '');
  if (!token) return res.status(400).json({ error: 'token este obligatoriu' });

  const { data: comanda, error: comErr } = await supabaseAdmin
    .from('comenzi')
    .select('id, nr_comanda, status, partener_id, suma_totala_platita, suma_materiale, suma_manopera, suma_transport, suma_asigurare, moneda, token_expira_la, finalizat_la, confirmat_la')
    .eq('token_confirmare', token)
    .maybeSingle();
  if (comErr) {
    console.error('[public/comanda-token]', comErr);
    return res.status(500).json({ error: 'Eroare la căutarea comenzii' });
  }
  if (!comanda) return res.status(404).json({ error: 'Link invalid sau expirat' });

  if (comanda.token_expira_la && new Date(comanda.token_expira_la) < new Date()) {
    return res.status(410).json({ error: 'Linkul a expirat', expirat: true });
  }

  let partenerNume = null;
  if (comanda.partener_id) {
    const { data: partner } = await supabaseAdmin
      .from('partners')
      .select('nume_firma')
      .eq('id', comanda.partener_id)
      .maybeSingle();
    partenerNume = partner?.nume_firma || null;
  }

  const { data: imaginiRaw } = await supabaseAdmin
    .from('comenzi_imagini')
    .select('tip, url, created_at')
    .eq('comanda_id', comanda.id)
    .in('tip', ['before', 'after'])
    .order('created_at', { ascending: true });

  const imagini = [];
  for (const img of imaginiRaw || []) {
    const { data: semnat } = await supabaseAdmin.storage
      .from('comenzi-imagini')
      .createSignedUrl(img.url, SEMNATURA_URL_VALABILA_SECUNDE);
    imagini.push({ tip: img.tip, url: semnat?.signedUrl || null, creat_la: img.created_at });
  }

  return res.status(200).json({
    ok: true,
    comanda: {
      nr_comanda: comanda.nr_comanda,
      status: comanda.status,
      partener_nume: partenerNume,
      suma_totala_platita: comanda.suma_totala_platita,
      suma_materiale: comanda.suma_materiale,
      suma_manopera: comanda.suma_manopera,
      suma_transport: comanda.suma_transport,
      suma_asigurare: comanda.suma_asigurare,
      moneda: comanda.moneda,
      finalizat_la: comanda.finalizat_la,
      confirmat_la: comanda.confirmat_la,
      token_expira_la: comanda.token_expira_la,
    },
    imagini,
  });
};

// /api/public/verifica-acces-temporar.js
// PUBLIC, fără autentificare — apelat de acces-temporar.html înainte de
// signInWithPassword(). Confirmă doar că există un acces temporar ACTIV și
// neexpirat pentru email; parola în sine e verificată separat, client-side,
// direct de Supabase Auth (niciodată de acest endpoint).
//
// Body: { email } → { ok, ruta_url, expira_la } sau { error }

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const allowed = await checkRateLimit(req, { key: 'acces-temporar', limit: 5, windowSeconds: 300 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe încercări. Așteaptă 5 minute.' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Email invalid.' });
  }
  const emailNorm = email.toLowerCase().trim();

  const { data, error } = await supabaseAdmin
    .from('accese_temporare')
    .select('id, ruta_url, expira_la, nr_autentificari')
    .eq('email', emailNorm)
    .eq('activ', true)
    .maybeSingle();

  if (error) {
    console.error('[verifica-acces-temporar]', error);
    return res.status(500).json({ error: 'Eroare la verificarea accesului.' });
  }
  // Același mesaj pentru "nu există" ȘI pentru "a fost revocat" — nu dezvăluim
  // diferența către un apelant neautentificat.
  if (!data) return res.status(404).json({ error: 'Nu există acces temporar activ pentru acest email.' });

  if (new Date(data.expira_la) < new Date()) {
    return res.status(410).json({ error: 'Accesul temporar a expirat.' });
  }

  supabaseAdmin
    .from('accese_temporare')
    .update({
      ultima_autentificare: new Date().toISOString(),
      nr_autentificari: (data.nr_autentificari || 0) + 1,
    })
    .eq('id', data.id)
    .then(() => {}, (e) => console.error('[verifica-acces-temporar] update statistici', e));

  return res.status(200).json({ ok: true, ruta_url: data.ruta_url, expira_la: data.expira_la });
};

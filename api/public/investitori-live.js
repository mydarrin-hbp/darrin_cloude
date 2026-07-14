// /api/public/investitori-live.js
// Endpoint PUBLIC — flux LIVE al investițiilor, doar pentru rândurile unde
// investitorul a bifat explicit consimțământul de afișare publică
// (investitori_portofoliu.consimtamant_public = true; implicit FALS la
// crearea oricărui rând — nimeni nu apare public fără acord explicit).
//
// Afișare confidențială intenționat: prenume + prima literă din nume
// (ex: "Andrei C."), oraș, acțiuni, sumă investită, orizont exit estimat.
// Niciodată email, nume complet, IBAN.
//
// Asociat pe email (nu user_id) — fluxul de investitori
// (api/public/investitori-subscrie.js) nu cere o sesiune Supabase
// autentificată reală, investitorii sunt gestionați ca leads pe email.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabaseAdmin
      .from('investitori_portofoliu')
      .select('email, oras, actiuni, valoare_investita, exit_estimat_luni, created_at')
      .eq('consimtamant_public', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const emailuri = [...new Set((data || []).map((r) => r.email).filter(Boolean))];
    const numePeEmail = {};
    if (emailuri.length) {
      const { data: leads } = await supabaseAdmin.from('investitori_leads').select('email, prenume, nume').in('email', emailuri);
      (leads || []).forEach((l) => {
        numePeEmail[l.email] = `${l.prenume || 'Investitor'} ${(l.nume || '?').charAt(0).toUpperCase()}.`;
      });
    }

    const feed = (data || []).map((r) => ({
      nume_afisat: numePeEmail[r.email] || 'Investitor',
      oras: r.oras || null,
      actiuni: r.actiuni,
      valoare_investita: r.valoare_investita,
      exit_estimat_luni: r.exit_estimat_luni,
      data: r.created_at,
    }));

    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(200).json({ ok: true, investitii: feed });
  } catch (err) {
    console.error('[investitori-live]', err);
    return res.status(500).json({ error: 'Nu am putut încărca fluxul de investiții' });
  }
};

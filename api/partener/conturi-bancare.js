// /api/partener/conturi-bancare.js
// Secțiune nouă de dashboard "Cont bancar" (27 august 2026) — descoperit la
// pregătirea reminder-ului de 48h/email de finalizare (2i): dashboard-ul are
// deja un mesaj real, live, care spune partenerului "adaugă un cont activ
// din secțiunea Profil & KYC" (mydarrin-dashboard-partener.html:1682) — dar
// acea secțiune e 100% machetă (date hardcodate în JS), fără niciun input
// real. Singurul endpoint care poate scrie un cont bancar e
// wizard-companie.js, parte a wizard-ului de 8 pași — confirmat orfan (0
// apelanți reali) în auditul Etapa 2. Niciun partener real n-are azi cum să
// adauge un cont bancar după înregistrare — blochează atât semnarea
// contractului (contract-trimite-otp.js cere cont activ) cât și definiția
// de "profil 100% complet" confirmată de fondator.
//
// Endpoint nou, dedicat, care NU atinge wizard-companie.js (rămâne
// neschimbat, pentru wizard-ul orfan) — urmează exact tiparul deja stabilit
// pentru Echipa/Utilaje/Certificări: POST = adaugă (nu înlocuiește), DELETE
// dedicat pe un singur cont. IBAN criptat exact ca în wizard-companie.js
// (aceeași funcție RPC, cripteaza_camp/decripteaza_camp).
//
// GET    → conturile active, cu IBAN mascat (niciodată în clar)
// POST   { nume_titular, iban, swift?, banca, moneda } → adaugă un cont nou
// DELETE { id } → dezactivează un singur cont (nu șterge fizic, activ=false)

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { validateIBAN } = require('../../lib/iban');
const { verificaSiNotificaProfilComplet } = require('../../lib/verifica-profil-complet-partener');

async function handler(req, res, user) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('partner_conturi_bancare')
      .select('id, nume_titular, banca, moneda, swift, iban_criptat, creat_la')
      .eq('partner_id', user.id)
      .eq('activ', true)
      .order('creat_la', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const conturi = await Promise.all((data || []).map(async (c) => {
      const { data: iban } = await supabaseAdmin.rpc('decripteaza_camp', { valoare_criptata: c.iban_criptat });
      return {
        id: c.id, nume_titular: c.nume_titular, banca: c.banca, moneda: c.moneda, swift: c.swift,
        iban_mascat: iban ? `${iban.slice(0, 4)}••••••••${iban.slice(-4)}` : null,
        creat_la: c.creat_la,
      };
    }));
    return res.status(200).json({ ok: true, conturi });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id este obligatoriu' });
    const { data, error } = await supabaseAdmin
      .from('partner_conturi_bancare')
      .update({ activ: false })
      .eq('id', id)
      .eq('partner_id', user.id)
      .select('id')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Contul nu există sau nu-ți aparține' });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nume_titular, iban, swift, banca, moneda } = req.body || {};
  if (!nume_titular || !iban || !banca || !moneda) {
    return res.status(400).json({ error: 'nume_titular, iban, banca și moneda sunt obligatorii' });
  }
  if (!validateIBAN(iban)) {
    return res.status(400).json({ error: 'IBAN invalid (checksum incorect)' });
  }

  try {
    const { data: cripted, error: cryptErr } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: iban });
    if (cryptErr) throw cryptErr;
    const { data: cont, error: insErr } = await supabaseAdmin.from('partner_conturi_bancare').insert({
      partner_id: user.id, nume_titular, iban_criptat: cripted, swift: swift || null, banca, moneda,
    }).select('id').single();
    if (insErr) throw insErr;
    // Așteptat (nu fire-and-forget): serverless functions pot fi înghețate
    // imediat după ce răspunsul e trimis — un apel neașteptat ar risca să nu
    // apuce să trimită emailul de finalizare. Funcția e best-effort intern
    // (nu aruncă niciodată), deci nu întârzie răspunsul cu vreo eroare reală.
    await verificaSiNotificaProfilComplet(user.id);
    return res.status(200).json({ ok: true, cont });
  } catch (err) {
    console.error('[conturi-bancare]', err);
    return res.status(500).json({ error: err.message || 'Nu am putut salva contul bancar' });
  }
}

module.exports = requireAuth([], handler);

// /api/admin/creeaza-acces-temporar.js
// Acces temporar cu parolă unică per email, gestionat de admin/superadmin
// (2026-07-23). Folosește Supabase Auth real (nu o parolă custom stocată în
// clar) — testerul primește o sesiune Supabase reală, validă doar pentru
// pagina whitelist-uită de admin.
//
// Body: { email, ore_valabilitate, ruta_url, descriere?, parola_custom? }
// → { ok, email, parola, expira_la, link_acces }
//
// FIX de siguranță față de propunerea inițială: dacă emailul aparține unui
// cont REAL, preexistent, care NU a fost creat vreodată prin acest
// mecanism (nicio linie în accese_temporare), endpointul REFUZĂ să-i
// resetteze parola — altfel un admin ar putea, din greșeală sau abuz,
// prelua parola unui client/partener real doar tastând emailul lui.
// Doar conturile deja marcate ca „de test" prin acest tool pot fi refolosite.
//
// FIX 2: whitelist-ul de rute exclude deliberat mydarrin-superadmin.html și
// mydarrin-backoffice-serviciu.html — acces temporar/demo nu trebuie să
// poată ajunge NICIODATĂ în unelte interne de backoffice, indiferent cine
// îl generează.

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

// Marcaj special pentru "acces complet" — toate paginile PUBLICE ale
// site-ului (nu doar una singură). Verificat explicit în middleware.js
// (treceBarieraPlatforma) — NU ocolește niciodată bariera STRICTĂ separată
// (PAGINI_STRICTE: superadmin/backoffice/deviz-engine etc.), care rămâne
// exclusiv admin/superadmin, indiferent de acces temporar.
const RUTA_ACCES_COMPLET = '*';

const RUTE_PERMISE = [
  RUTA_ACCES_COMPLET,
  '/mydarrin-v3.html',
  '/mydarrin-catalog.html',
  '/mydarrin-investitori.html',
  '/mydarrin-serviciu.html',
  '/mydarrin-produs.html',
  '/mydarrin-marketplace.html',
  '/mydarrin-checkout.html',
  '/mydarrin-dashboard-client.html',
  '/mydarrin-dashboard-partener.html',
  '/mydarrin-dashboard-furnizor.html',
];
const ORE_PERMISE = [1, 2, 8, 24, 48, 168]; // 168h = 7 zile

const ADJ = ['rapid', 'verde', 'albastru', 'sigur', 'clar', 'calm', 'auriu', 'agil', 'ferm', 'vesel'];
const SUB = ['darrin', 'access', 'preview', 'demo', 'review', 'guest', 'vizita', 'sesiune'];

function genParola() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const s = SUB[Math.floor(Math.random() * SUB.length)];
  const nr = Math.floor(10000 + Math.random() * 90000); // 5 cifre
  return `${a}-${s}-${nr}`;
}

async function handler(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, ore_valabilitate = 24, ruta_url, descriere, parola_custom, nume, prenume } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Email valid obligatoriu.' });
  }
  // Nume + prenume identifică real persoana care semnează acordul de
  // confidențialitate (NDA) — vezi acord-confidentialitate.html. Fără ele,
  // NDA-ul nu poate identifica cine a acceptat.
  if (!nume || typeof nume !== 'string' || !nume.trim() || !prenume || typeof prenume !== 'string' || !prenume.trim()) {
    return res.status(400).json({ error: 'Nume și prenume obligatorii — sunt folosite în acordul de confidențialitate.' });
  }
  const numeNorm = nume.trim().slice(0, 100);
  const prenumeNorm = prenume.trim().slice(0, 100);
  const emailNorm = email.toLowerCase().trim();
  if (!RUTE_PERMISE.includes(ruta_url)) {
    return res.status(400).json({ error: 'Ruta nu este permisă.' });
  }
  if (!ORE_PERMISE.includes(Number(ore_valabilitate))) {
    return res.status(400).json({ error: `Ore valabile: ${ORE_PERMISE.join(', ')}` });
  }

  const parola = parola_custom ? String(parola_custom).trim().slice(0, 50) : genParola();
  if (parola.length < 6) {
    return res.status(400).json({ error: 'Parola trebuie să aibă cel puțin 6 caractere.' });
  }

  const expira_la = new Date(Date.now() + Number(ore_valabilitate) * 3600 * 1000).toISOString();

  try {
    const { data: profileExistent } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', emailNorm)
      .maybeSingle();

    let userId;

    if (profileExistent) {
      // Contul există deja — permis SĂ i se reseteze parola doar dacă a mai
      // trecut prin acest mecanism (are cel puțin o linie în accese_temporare,
      // indiferent de status). Altfel, ar putea fi un client/partener real.
      const { data: istoricAcces } = await supabaseAdmin
        .from('accese_temporare')
        .select('id')
        .eq('email', emailNorm)
        .limit(1)
        .maybeSingle();
      if (!istoricAcces) {
        return res.status(409).json({
          error: 'Acest email aparține unui cont existent, negenerat de acest instrument. Alege alt email pentru acces temporar — nu se resetează parola conturilor reale.',
        });
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(profileExistent.id, {
        password: parola,
        email_confirm: true,
      });
      if (updErr) {
        console.error('[creeaza-acces-temporar] updateUserById', updErr);
        return res.status(500).json({ error: 'Nu am putut actualiza parola.' });
      }
      userId = profileExistent.id;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: emailNorm,
        password: parola,
        email_confirm: true,
        user_metadata: { role: 'client' },
      });
      if (createErr) {
        console.error('[creeaza-acces-temporar] createUser', createErr);
        return res.status(500).json({ error: 'Nu am putut crea utilizatorul.' });
      }
      userId = created.user.id;

      // handle_new_user() setează status='pending_otp' pentru orice signup cu
      // provider 'email' (presupune fluxul normal de verificare telefon) —
      // un cont de test generat de admin nu trece niciodată prin acel pas,
      // deci l-ar bloca. Îl marcăm explicit 'active'.
      await supabaseAdmin.from('profiles').update({ status: 'active' }).eq('id', userId);
    }

    // Invalidează orice acces activ anterior pentru același email — un email,
    // un singur acces activ simultan (întărit și de indexul unic parțial).
    await supabaseAdmin
      .from('accese_temporare')
      .update({ activ: false, motiv_revocare: 'Înlocuit de acces nou generat' })
      .eq('email', emailNorm)
      .eq('activ', true);

    const { error: accesErr } = await supabaseAdmin
      .from('accese_temporare')
      .insert({
        email: emailNorm,
        user_id: userId,
        ruta_url,
        descriere: descriere ? String(descriere).slice(0, 200) : null,
        creat_de: user.id,
        expira_la,
        nume: numeNorm,
        prenume: prenumeNorm,
      });
    if (accesErr) {
      console.error('[creeaza-acces-temporar] insert accese_temporare', accesErr);
      return res.status(500).json({ error: 'Nu am putut înregistra accesul.' });
    }

    return res.status(200).json({
      ok: true,
      email: emailNorm,
      parola,
      expira_la,
      link_acces: 'https://mydarrin.homebestpal.com/acces-temporar',
    });
  } catch (err) {
    console.error('[creeaza-acces-temporar]', err);
    return res.status(500).json({ error: 'Eroare neașteptată la crearea accesului.' });
  }
}

module.exports = requireAuth(['admin', 'superadmin'], handler);

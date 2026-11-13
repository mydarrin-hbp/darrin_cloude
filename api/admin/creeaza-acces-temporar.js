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
const { formaComuna, trimiteEroare } = require('../../lib/raspuns-eroare');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

// Marcaj special pentru "acces complet" — toate paginile PUBLICE ale
// site-ului (nu doar una singură). Verificat explicit în middleware.js
// (treceBarieraPlatforma) — NU ocolește niciodată bariera STRICTĂ separată
// (PAGINI_STRICTE: superadmin/backoffice/deviz-engine etc.), care rămâne
// exclusiv admin/superadmin, indiferent de acces temporar.
const RUTA_ACCES_COMPLET = '*';

const RUTE_PERMISE = [
  RUTA_ACCES_COMPLET,
  '/index.html',
  '/mydarrin-catalog.html',
  '/mydarrin-investitori.html',
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
  if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');

  const { email, ore_valabilitate = 24, ruta_url, descriere, parola_custom, nume, prenume } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'Email valid obligatoriu.', 'A valid email is required.', ['email']);
  }
  // Nume + prenume identifică real persoana care semnează acordul de
  // confidențialitate (NDA) — vezi acord-confidentialitate.html. Fără ele,
  // NDA-ul nu poate identifica cine a acceptat.
  if (!nume || typeof nume !== 'string' || !nume.trim() || !prenume || typeof prenume !== 'string' || !prenume.trim()) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'Nume și prenume obligatorii — sunt folosite în acordul de confidențialitate.', 'First and last name are required: they are used in the confidentiality agreement.');
  }
  const numeNorm = nume.trim().slice(0, 100);
  const prenumeNorm = prenume.trim().slice(0, 100);
  const emailNorm = email.toLowerCase().trim();
  if (!RUTE_PERMISE.includes(ruta_url)) {
    return trimiteEroare(res, 400, 'RUTA_NEPERMISA', 'Ruta nu este permisă.', 'This route is not allowed.', ['ruta']);
  }
  if (!ORE_PERMISE.includes(Number(ore_valabilitate))) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `Ore valabile: ${ORE_PERMISE.join(', ')}`, `Allowed hours: ${ORE_PERMISE.join(', ')}`, ['ore']);
  }

  const parola = parola_custom ? String(parola_custom).trim().slice(0, 50) : genParola();
  if (parola.length < 6) {
    return trimiteEroare(res, 400, 'PAROLA_SCURTA', 'Parola trebuie să aibă cel puțin 6 caractere.', 'The password must have at least 6 characters.', ['parola']);
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
        return trimiteEroare(res, 409, 'CONT_EXISTENT', 'Acest email aparține unui cont existent, negenerat de acest instrument. Alege alt email pentru acces temporar — nu se resetează parola conturilor reale.', 'This email belongs to an existing account that was not created by this tool. Choose another email for temporary access: real account passwords are not reset.', ['email']);
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(profileExistent.id, {
        password: parola,
        email_confirm: true,
      });
      if (updErr) {
        console.error('[creeaza-acces-temporar] updateUserById', updErr);
        return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut actualiza parola.', 'We could not update the password.');
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
        return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut crea utilizatorul.', 'We could not create the user.');
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
      return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut înregistra accesul.', 'We could not record the access.');
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
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare neașteptată la crearea accesului.', 'Unexpected error while creating the access.');
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));

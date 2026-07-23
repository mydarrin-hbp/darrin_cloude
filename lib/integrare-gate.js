// lib/integrare-gate.js
// "Ușa" pentru orice integrare externă opțională (2026-07-23) — un helper
// comun, reutilizabil pentru TOATE categoriile din integrari_furnizori
// (asigurari, marketplace_bricolaj, marketplace_general, procesatori_carduri,
// curieri, inchirieri, date_companii_ro, date_companii_eu, vat,
// geolocalizare, contabilitate, altele — vezi CHECK-ul real de pe tabelă).
//
// Problemă rezolvată: până acum, orice cod care ar fi avut nevoie de un
// furnizor extern configurabil din backoffice (integrari_furnizori, deja
// construit, dar cu 0 rânduri azi) ar fi trebuit fie să presupună orbește
// că furnizorul există (crash/500 quand nu există), fie să reinventeze de
// fiecare dată aceeași verificare. Acest fișier o face o singură dată:
// caută un furnizor ACTIV pentru categoria cerută; dacă nu găsește, trimite
// direct un răspuns HTTP curat, previzibil — „integrare în așteptare" — în
// loc de o eroare brută sau, mai rău, un fals succes.
//
// NU decide NICIODATĂ să simuleze un răspuns de succes când integrarea
// lipsește — un apelant care primește `null` de la verificaIntegrare() știe
// sigur că răspunsul 503 a fost deja trimis către client și trebuie doar să
// oprească execuția (return).

const { supabaseAdmin } = require('./supabaseAdmin');

const MESAJE_CATEGORIE = {
  procesatori_carduri: 'Plata cu cardul nu este încă activă pe My Darrin. Lucrăm la activarea acestei opțiuni.',
  asigurari: 'Emiterea automată de poliță de asigurare nu este încă activă pentru zona ta.',
  curieri: 'Curieratul de cartier automat nu este încă activ pentru zona ta.',
  inchirieri: 'Rezervarea automată de echipamente/scule nu este încă activă pentru zona ta.',
  marketplace_bricolaj: 'Comanda automată de materiale de la un marketplace partener nu este încă activă.',
  marketplace_general: 'Această integrare de marketplace nu este încă activă.',
  date_companii_ro: 'Validarea automată a datelor de firmă (CUI) nu este încă activă.',
  date_companii_eu: 'Validarea automată a datelor de firmă (VAT UE) nu este încă activă.',
  vat: 'Declararea automată a TVA nu este încă activă pentru țara ta.',
  geolocalizare: 'Detectarea automată a locației nu este încă activă.',
  contabilitate: 'Raportarea externă către un provider de contabilitate nu este încă activă.',
  altele: 'Această integrare externă nu este încă activă.',
};

/**
 * Caută un furnizor ACTIV pentru o categorie, opțional filtrat pe țară.
 * Un furnizor fără tara_cod (NULL) e tratat ca activ global, pentru orice țară.
 * @returns {Promise<object|null>}
 */
async function gasesteFurnizorActiv(categorie, { tara_cod = null } = {}) {
  const { data, error } = await supabaseAdmin
    .from('integrari_furnizori')
    .select('*')
    .eq('categorie', categorie)
    .eq('status', 'activ');
  if (error) {
    console.error('[integrare-gate] eroare la citirea integrari_furnizori:', error);
    return null;
  }
  if (!data?.length) return null;
  if (!tara_cod) return data[0];
  return data.find((r) => !r.tara_cod || r.tara_cod === tara_cod) || null;
}

/**
 * Verifică poarta și, dacă nu există furnizor activ, trimite DIRECT un
 * răspuns 503 curat pe `res` și returnează null — apelantul trebuie doar să
 * facă `return` imediat ce primește null, fără să mai atingă `res`.
 * Dacă există furnizor activ, îl returnează, fără să atingă `res`.
 * @returns {Promise<object|null>}
 */
async function verificaIntegrare(res, categorie, opts = {}) {
  const furnizor = await gasesteFurnizorActiv(categorie, opts);
  if (!furnizor) {
    res.status(503).json({
      ok: false,
      error: MESAJE_CATEGORIE[categorie] || MESAJE_CATEGORIE.altele,
      code: 'INTEGRARE_IN_ASTEPTARE',
      categorie,
    });
    return null;
  }
  return furnizor;
}

module.exports = { gasesteFurnizorActiv, verificaIntegrare, MESAJE_CATEGORIE };

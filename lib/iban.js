// lib/iban.js
// Validare IBAN reală (checksum MOD-97, ISO 7064) — înlocuiește lipsa
// completă de validare din wizard-companie.js/partner-register.js (până
// acum orice string ajungea criptat și salvat, indiferent dacă era un IBAN
// valid). Fără API extern — algoritmul e determinist, definit de standard.

function validateIBAN(ibanRaw) {
  const iban = String(ibanRaw || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;

  const rearranjat = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranjat.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));

  // mod 97 pe un număr uriaș — calculat pe bucăți, ca să nu depășim precizia Number.
  let rest = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    rest = Number(String(rest) + numeric.slice(i, i + 7)) % 97;
  }
  return rest === 1;
}

module.exports = { validateIBAN };

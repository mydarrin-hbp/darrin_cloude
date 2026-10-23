// /api/public/pitch-deck.js
// Pitch deck-ul public (pasul 11-K, 22 oct. 2026; decizia LM C3 și cerința
// LM din 22 oct.). Doar versiunea APROBATĂ a limbii cerute: `ro` → deck-ul
// RO; orice altă limbă (en, bg, de, el, fr, tr) → deck-ul EN. Fără versiune
// aprobată → { stare: 'in_pregatire' } („Pitch deck în pregătire”). Nu există
// conținut de rezervă: nici aici, nici în pagină.
//
// Vizibilitatea (backoffice_config.pitch_deck_vizibilitate) se verifică AICI,
// pe server: cu `investitori_aprobati`, deck-ul complet se trimite doar unui
// investitor cu verificarea identității aprobată (sesiunea din
// Authorization); ceilalți primesc rezumatul (titlul și slide-urile 1–3).
//
// GET ?limba=ro|en|de|…            → { ok, stare: 'in_pregatire' | 'rezumat' | 'complet',
//                                      limba, vizibilitate, deck?, runda?, contact?, qr_svg? }
// GET ?limba=…&doar_stare=1        → { ok, stare: 'in_pregatire' | 'disponibil', limba, vizibilitate }
//                                      (butonul de pe pagina Investitori)

const { getAuthenticatedUser } = require('../../lib/auth-middleware');
const { trimiteEroare } = require('../../lib/raspuns-eroare');
const P = require('../../lib/pitch-deck');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');

  const q = req.query || {};
  const limba = P.limbaDeck(q.limba);
  try {
    const [v, vizibilitate] = await Promise.all([P.versiuneAprobata(limba), P.citesteVizibilitate()]);
    const areSesiune = !!(req.headers && req.headers.authorization);
    // Răspunsul depinde de sesiune când vizibilitatea e restrânsă: fără cache comun.
    res.setHeader('Vary', 'Authorization');
    res.setHeader('Cache-Control', vizibilitate === 'public' && !areSesiune ? 'public, max-age=300, s-maxage=300' : 'private, no-store');

    if (!v) return res.status(200).json({ ok: true, stare: 'in_pregatire', limba, vizibilitate });
    if (q.doar_stare) return res.status(200).json({ ok: true, stare: 'disponibil', limba, vizibilitate });

    let complet = vizibilitate === 'public';
    if (!complet && areSesiune) {
      const user = await getAuthenticatedUser(req).catch(() => null);
      complet = await P.esteInvestitorAprobat(user).catch(() => false);
    }
    const corp = await P.construiestePayload(v, { rezumat: !complet });
    return res.status(200).json({ ok: true, vizibilitate, ...corp });
  } catch (err) {
    console.error('[public/pitch-deck]', err);
    res.setHeader('Cache-Control', 'no-store');
    return trimiteEroare(res, 503, 'INDISPONIBIL', 'Pitch deck-ul nu se poate încărca acum. Încercați din nou.', 'The pitch deck cannot be loaded right now. Please try again.');
  }
};

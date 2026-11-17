// /api/cont/profil.js
// Profilul contului logat, pentru butonul de cont din antet și pentru paza
// dashboard-urilor (pasul 10b, 16 oct. 2026).
//
// GET, cu Authorization: Bearer <access_token>
// → { ok, email, nume, prenume, nume_familie, telefon, tara, roles, roluri_dashboard,
//     destinatie, tip_destinatie, are_comenzi, rol_solicitat, activare, furnizor_propriu,
//     partener: null | { nume_firma, partner_type, rol, status_verificare,
//                        contract_semnat, cont_bancar, motiv_respingere,
//                        poate_vinde, motiv_nu_poate_vinde },
//     investitor: null | { status, pas_curent, trimis_la, motiv_respingere,
//                          motiv_respingere_en } }
//
// Pasul 11-L: prenume / nume_familie / telefon / tara precompletează
// formularul rolului nou („Rolurile mele”: un cont, mai multe roluri);
// investitor e starea rutei de investitor (lib/investitori-kyc.js).
//
// poate_vinde / motiv_nu_poate_vinde vin din regula unică
// lib/eligibilitate-partener.js (pasul 10c): dacă produsele furnizorului pot
// apărea public și, dacă nu, de ce (in_verificare, respins, fara_cont_bancar,
// fara_contract, suspendat). furnizor_propriu (true / false): contul e
// furnizorul propriu al platformei (partners.entitate_platforma_id setat);
// fără alte date despre entitate.
//
// Pasul 11-R2: are_comenzi (true / false / null = necunoscut) — clientul fără
// comenzi nu are dashboard, deci roluri_dashboard nu conține „client”, iar
// antetul și meniul lateral nu arată „Comenzile mele”. rol_solicitat = rolul
// ales la înscriere (doar o alegere, nu un drept).
// Pasul 11-R3: activare = lista „Activează contul” (lib/activare-partener.js),
// cu starea fiecărui punct; null dacă nu e partener și n-a ales un rol de partener.
//
// Pasul 11-I3 (16 nov. 2026): viteza. Rândul din profiles se citește o singură
// dată (înainte: de două ori, și în contextCont), eligibilitatea partenerului
// la fel (înainte: și în stareActivare), iar citirile independente rulează în
// paralel: ~5 runde spre Supabase în loc de ~10. Câmpurile răspunsului și
// regulile sunt aceleași; în plus, limba = profiles.limba (ro / en / null).
// PATCH { limba: 'ro' | 'en' } — selectorul de limbă de pe paginile de cont
// salvează limba aleasă pe cont (profiles.limba); orice altă valoare → 400.
//
// roles vine din profiles.roles (singura sursă pentru acces). Fără date
// sensibile: fără IBAN (doar „are cont bancar activ: da / nu”), fără CNP,
// fără CUI. Paza din pagini e doar pentru experiența utilizatorului; accesul
// real îl verifică fiecare endpoint (lib/auth-middleware.js).

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { destinatiePentru, contextCont } = require('../../lib/destinatie-cont');
const { roluriCuDashboard } = require('../../lib/destinatie-rol');
const { rolPentruTipPartener } = require('../../lib/roluri-partener');
const { eligibilitatePartener } = require('../../lib/eligibilitate-partener');
const { citesteKyc, starePublica } = require('../../lib/investitori-kyc');
const { stareActivare } = require('../../lib/activare-partener');
const { inregistreazaActivare, inregistreazaEmailConfirmat } = require('../../lib/palnie');
const { trimiteEroare } = require('../../lib/raspuns-eroare');
const v = require('../../lib/valideaza');

function numeAfisat(user) {
  const m = user.user_metadata || {};
  const nume = [m.prenume, m.nume].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  return nume || String(m.full_name || m.name || '').trim() || null;
}

// Motivul ultimei respingeri, dacă adminul l-a scris (audit_log, verifica-document).
async function motivRespingere(partnerId) {
  const { data } = await supabaseAdmin
    .from('audit_log')
    .select('detalii, creat_la')
    .eq('entitate', 'partners').eq('entitate_id', String(partnerId)).eq('actiune', 'partener_respins')
    .order('creat_la', { ascending: false })
    .limit(1);
  const motiv = data && data[0] && data[0].detalii && data[0].detalii.motiv;
  return motiv ? String(motiv).slice(0, 500) : null;
}

// Pasul 11-I3: limbile platformei (bilingv RO + EN, decizia LM din 9 oct. 2026).
const LIMBI_CONT = ['ro', 'en'];
const SCHEMA_LIMBA = { limba: v.text({ max: 5, eticheta: ['Limba', 'Language'] }) };
const EROARE_LIMBA = ['Nu am putut salva limba pe cont. Încearcă din nou.', 'We could not save the language on your account. Please try again.'];

async function salveazaLimba(req, res, user) {
  if (!v.valideazaSauTrimite(req, res, SCHEMA_LIMBA, { necunoscute: 'ignora' })) return null;
  const limba = String((req.body || {}).limba || '').toLowerCase();
  if (!LIMBI_CONT.includes(limba)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'Alege limba: română (ro) sau engleză (en).', 'Choose the language: Romanian (ro) or English (en).', ['limba']);
  }
  const { error } = await supabaseAdmin.from('profiles').update({ limba }).eq('id', user.id);
  if (error) {
    console.error('[cont/profil] limba:', error.message || error);
    return trimiteEroare(res, 500, 'EROARE_SERVER', EROARE_LIMBA[0], EROARE_LIMBA[1]);
  }
  return res.status(200).json({ ok: true, limba });
}

async function handler(req, res, user) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'PATCH') {
    try { return await salveazaLimba(req, res, user); } catch (err) {
      console.error('[cont/profil] limba:', err);
      return trimiteEroare(res, 500, 'EROARE_SERVER', EROARE_LIMBA[0], EROARE_LIMBA[1]);
    }
  }
  if (req.method !== 'GET') return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  try {
    // select('*'): coloana telefonului diferă între medii (phone / telefon).
    const { data: profil, error } = await supabaseAdmin.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    const roles = Array.isArray(profil?.roles) ? profil.roles : [];

    // Citirile independente, în paralel: eligibilitatea partenerului, dosarul
    // de investitor (o eroare nu oprește profilul) și contextul contului (din
    // rândul de mai sus; doar comenzile, pentru client, sunt o citire nouă).
    const [p, investitor, ctx] = await Promise.all([
      eligibilitatePartener(user.id),
      citesteKyc(user.id).then(starePublica).catch((e) => { console.warn('[cont/profil] KYC:', e.message || e); return null; }),
      contextCont(user, profil ? { roles, rol_solicitat: profil.rol_solicitat || null } : null),
    ]);

    // Apoi, tot în paralel: motivul respingerii (doar la respins), destinația
    // și lista de activare (cu eligibilitatea de mai sus; o eroare nu oprește profilul).
    const [motiv, d, activare] = await Promise.all([
      p && p.status_verificare === 'rejected' ? motivRespingere(user.id) : null,
      destinatiePentru(user, ctx),
      stareActivare(user.id, ctx, { partener: p }).catch((e) => { console.warn('[cont/profil] activare:', e.message || e); return null; }),
    ]);

    // Pasul 12-P1: motivul respingerii firmei, în starea contului („Necesită completări”).
    if (activare && activare.stare_cont && activare.stare_cont.stare === 'necesita_completari' && !activare.stare_cont.motiv && motiv) {
      activare.stare_cont.motiv = motiv;
    }

    let partener = null;
    if (p) {
      partener = {
        nume_firma: p.nume_firma || null,
        partner_type: p.partner_type,
        rol: rolPentruTipPartener(p.partner_type),
        status_verificare: p.status_verificare || 'pending_review',
        contract_semnat: p.contract_semnat,
        cont_bancar: p.cont_bancar,
        motiv_respingere: motiv,
        poate_vinde: p.poate_vinde,
        motiv_nu_poate_vinde: p.motiv,
      };
    }

    const m = user.user_metadata || {};
    // Pasul 11-A1: momentele pâlniei, pentru raportul intern (fără date personale).
    await Promise.all([inregistreazaEmailConfirmat(user), inregistreazaActivare(user.id, activare)]);
    return res.status(200).json({
      ok: true,
      email: user.email || null,
      nume: numeAfisat(user),
      prenume: String(m.prenume || '').trim() || null,
      nume_familie: String(m.nume || '').trim() || null,
      telefon: (profil && (profil.phone || profil.telefon)) || null,
      tara: (profil && profil.tara) || null,
      limba: profil && LIMBI_CONT.includes(profil.limba) ? profil.limba : null,
      roles,
      roluri_dashboard: roluriCuDashboard(roles, ctx.areComenzi === false ? { areComenzi: false } : null),
      destinatie: d && d.destinatie ? d.destinatie : null,
      tip_destinatie: d ? d.tip : null,
      are_comenzi: ctx.areComenzi,
      rol_solicitat: ctx.rolSolicitat,
      activare,
      furnizor_propriu: !!(p && p.furnizor_propriu),
      partener,
      investitor,
    });
  } catch (err) {
    console.error('[cont/profil]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca profilul.', 'Could not load your profile.');
  }
}

module.exports = requireAuth([], handler);

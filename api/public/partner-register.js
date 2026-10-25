// /api/public/partner-register.js
// Endpoint PUBLIC — wizardul "Devino Partener" nu colectează parolă,
// deci trimitem o invitație reală (Supabase creează contul + email cu
// link de setare parolă), cu rolul corect deja alocat în metadate.
// Rolul de partener se scrie explicit în profiles.roles după createUser
// (pasul 10b): trigger-ul handle_new_user() rulează la inserare, înainte ca
// app_metadata să fie scrisă, deci pune 'client'.

const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { checkRateLimit } = require('../../lib/rate-limit');
const { getAuthenticatedUser } = require('../../lib/auth-middleware');
const { limbaDinTara, renderEmailBunVenitPartener } = require('../../lib/i18n');
const { incarcaContactPlatformaSigur } = require('../../lib/contact-platforma');
const { validateIBAN } = require('../../lib/iban');
const { fromHeader } = require('../../lib/email-sender');
const { ROL_DUPA_TIP_PARTENER, TIP_PARTENER_DUPA_FORMULAR, asiguraRolInProfil } = require('../../lib/roluri-partener');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { verificaFirmaPartener, marcheazaVerificareManuala } = require('../../lib/verifica-firma-partener');

// Etichetă tip partener, per limbă — folosită doar în emailul de bun venit.
// Traduceri generate, nu revizuite nativ (vezi notă în lib/i18n.js).
const TIP_LABELS = {
  servicii:   { ro:'furnizor de servicii',            en:'service provider',              it:'fornitore di servizi',                 fr:'prestataire de services',               de:'Dienstleister',                es:'proveedor de servicios' },
  materiale:  { ro:'furnizor de materiale',           en:'materials supplier',            it:'fornitore di materiali',               fr:'fournisseur de matériaux',              de:'Materiallieferant',            es:'proveedor de materiales' },
  inchirieri: { ro:'furnizor de închirieri utilaje',  en:'equipment rental supplier',     it:'fornitore di noleggio attrezzature',   fr:"fournisseur de location d'équipements", de:'Vermietungsanbieter',          es:'proveedor de alquiler de equipos' },
  curier:     { ro:'curier de cartier',               en:'neighborhood courier',          it:'corriere di quartiere',                fr:'coursier de quartier',                  de:'Nachbarschaftskurier',         es:'mensajero de barrio' },
  asigurari:  { ro:'furnizor de asigurări',           en:'insurance provider',            it:'fornitore di assicurazioni',           fr:"fournisseur d'assurances",              de:'Versicherungsanbieter',        es:'proveedor de seguros' },
};

const SITE_URL = process.env.SITE_URL || 'https://mydarrin.homebestpal.com';

// Link de setare a parolei, generat de noi și trimis prin Resend. Nu depinde de
// mailerul Supabase Auth și nici de lista de URL-uri permise: token-ul e consumat
// de pagina reset-password.html prin verifyOtp, nu de un redirect Supabase.
async function genereazaLinkParola(email) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('[partner-register] generateLink a eșuat:', error?.message || 'fără hashed_token');
    return null;
  }
  return `${SITE_URL}/reset-password.html?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

async function stareMesajResend(id) {
  const asteapta = (ms) => new Promise((r) => setTimeout(r, ms));
  const FINALE = ['delivered', 'bounced', 'complained', 'suppressed', 'failed', 'delivery_delayed'];
  let ultima = null;
  for (let i = 0; i < 3; i++) {
    await asteapta(i === 0 ? 1200 : 1100);
    try {
      const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (!r.ok) continue;
      const j = await r.json();
      ultima = j.last_event || ultima;
      if (FINALE.includes(ultima)) break;
    } catch (e) { /* ignorăm: starea e informativă */ }
  }
  return ultima;
}

// Întoarce { ok, motiv }. Înainte, răspunsul Resend nu era verificat deloc: un
// refuz (domeniu, cheie, destinatar) trecea nevăzut, iar formularul afirma
// „Email trimis".
async function trimiteEmailBunVenit({ email, nume, tip, limba, linkParola }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, motiv: 'resend_neconfigurat' };
  const tipLabel = (TIP_LABELS[tip] && TIP_LABELS[tip][limba]) || TIP_LABELS[tip]?.ro || tip;
  await incarcaContactPlatformaSigur(); // footerul de dezabonare / GDPR din back-office
  const { subiect, html } = renderEmailBunVenitPartener(limba, { nume, tipLabel, linkParola });
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: await fromHeader(limba), to: email, subject: subiect, html }),
    });
    if (!res.ok) {
      const corp = await res.text().catch(() => '');
      console.error('[partner-register] Resend a refuzat emailul:', res.status, corp.slice(0, 300));
      return { ok: false, motiv: `resend_${res.status}` };
    }
    const trimis = await res.json().catch(() => ({}));
    // „Acceptat" de Resend nu înseamnă „livrat": interogăm starea reală a mesajului
    // (max. ~3,5 s). Un bounce, o reclamație sau o adresă suprimată se raportează.
    const stare = trimis.id ? await stareMesajResend(trimis.id) : null;
    console.log('[partner-register] Resend id=', trimis.id, 'stare=', stare);
    if (stare && ['bounced', 'complained', 'suppressed', 'failed'].includes(stare)) {
      return { ok: false, motiv: `resend_${stare}`, resend_id: trimis.id || null, stare };
    }
    return { ok: true, motiv: null, resend_id: trimis.id || null, stare };
  } catch (emailErr) {
    console.error('[partner-register] email bun venit eșuat:', emailErr);
    return { ok: false, motiv: 'retea' };
  }
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // FIX (audit 2026-07-11): fără rate-limit, endpointul putea fi folosit ca
  // trimițător de invitații Supabase (inviteUserByEmail) către adrese arbitrare.
  const allowed = await checkRateLimit(req, { key: 'partner-register', limit: 5, windowSeconds: 600 });
  if (!allowed) return res.status(429).json({ error: 'Prea multe cereri. Încearcă din nou mai târziu.' });

  // Pasul 11-L: un utilizator deja autentificat nu primește alt cont. Își
  // adaugă rolul de partener pe contul lui, prin ruta autentificată
  // (api/partener/wizard-companie.js), din „Devino partener” sau „Rolurile mele”.
  if (await getAuthenticatedUser(req)) {
    return res.status(409).json({
      error: 'Ești autentificat: adaugă rolul de partener pe contul tău, din „Rolurile mele”.',
      error_en: 'You are signed in: add the partner role to your account from "My roles".',
      cod: 'cont_existent_autentificat',
    });
  }

  const {
    nume, prenume, telefon, email, tip, tara,
    is_treasury_account, regiune_cod, iban, banca,
    nr_reg_com, adresa_sediu_social,
  } = req.body || {};
  const nrRegCom = typeof nr_reg_com === 'string' ? nr_reg_com.trim().slice(0, 40) : '';
  const adresaSediu = typeof adresa_sediu_social === 'string' ? adresa_sediu_social.trim().slice(0, 300) : '';

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email valid obligatoriu.' });
  }
  const enumType = TIP_PARTENER_DUPA_FORMULAR[tip];
  const role = enumType ? ROL_DUPA_TIP_PARTENER[enumType] : null;
  if (!role) {
    return res.status(400).json({ error: 'Tip de partener invalid.' });
  }
  // FIX (audit 2026-07-12): nume_firma și cui sunt NOT NULL în tabelul
  // partners — fără această validare, invitația Auth se crea cu succes,
  // dar insertul din partners eșua mereu (formularul nu le trimitea deloc
  // înainte), lăsând un cont invitat fără rând corespunzător în partners.
  // Pasul 11-P1: partener poate fi doar o entitate cu statut juridic; forma
  // juridică e obligatorie, CUI-ul românesc are cifra de control corectă, iar
  // o firmă inactivă sau radiată la ANAF e refuzată (lib/verifica-firma-partener.js).
  const firma = await verificaFirmaPartener(req.body, tara);
  if (!firma.ok) {
    return trimiteEroare(res, firma.status, firma.cod, firma.error, firma.error_en, [camp(firma.camp, firma.error, firma.error_en)]);
  }
  const { tip_entitate_legala, forma_juridica_locala } = firma.date;
  // FIX (T7, 2026-07-20): pagina publică colecta IBAN și-l arunca — nu
  // ajungea niciodată la backend. Acum, dacă e trimis, e validat (checksum
  // MOD-97) și salvat criptat — la fel ca în wizard-companie.js.
  if (iban !== undefined && iban !== null && iban !== '' && !validateIBAN(iban)) {
    return res.status(400).json({ error: 'IBAN invalid (checksum incorect).' });
  }
  if (iban && !banca) {
    return res.status(400).json({ error: 'banca este obligatorie dacă trimiți IBAN.' });
  }

  const limba = limbaDinTara(tara);
  let invitedUserId = null;
  try {
    // 1. Contul Supabase Auth, cu rolul corect în metadate (îl citește trigger-ul
    // handle_new_user). Nu trimitem invitația Supabase: livrarea ei nu a fost
    // niciodată dovedită (niciun partener n-a confirmat vreodată un cont), iar
    // fără ea partenerul nu putea seta parola. Parola se setează cu linkul din
    // emailul trimis mai jos, prin Resend.
    // Rolul rămâne și în user_metadata (îl citește trigger-ul, limitat la
    // rolurile de partener) și se scrie în app_metadata, pe care doar
    // serverul o poate scrie (securitate, 14 oct. 2026).
    const { data: invited, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { role, nume: nume || '', prenume: prenume || '' },
      app_metadata: { role },
    });
    if (createErr) {
      if (createErr.status === 422 || /already|registered|exists/i.test(createErr.message || '')) {
        // Cont creat anterior și niciodată folosit (ex.: emailul inițial nu a ajuns):
        // retrimitem linkul de setare a parolei către proprietarul adresei, ca la
        // „Am uitat parola". Nu se creează și nu se șterge nimic.
        const { data: prof } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
        if (prof) {
          const { data: existent } = await supabaseAdmin.auth.admin.getUserById(prof.id);
          if (existent?.user && !existent.user.last_sign_in_at) {
            const linkExistent = await genereazaLinkParola(email);
            const st = await trimiteEmailBunVenit({ email, nume, tip, limba, linkParola: linkExistent });
            return res.status(200).json({
              ok: true, reprimit: true, user_id: prof.id,
              email_trimis: st.ok, email_motiv: st.motiv, email_stare: st.stare || null, link_parola: !!linkExistent,
            });
          }
        }
        return res.status(409).json({ error: 'Există deja un cont cu această adresă de email. Autentifică-te sau folosește „Am uitat parola”.' });
      }
      throw createErr;
    }
    invitedUserId = invited.user.id;

    // 1b. Rolul de partener în profiles.roles (singura sursă pentru acces),
    // adăugat lângă rolurile existente. Contul e creat de server cu emailul
    // confirmat, deci profilul e activ, nu 'pending_otp'.
    await asiguraRolInProfil(invited.user.id, role, { email, activeaza: true });

    // 2. Înregistrare în tabelul partners (documente suplimentare se completează ulterior, la aprobare)
    // FIX (audit 2026-07-12): constrângerea reală de pe partners.status_verificare
    // acceptă doar 'pending_review'|'approved'|'rejected' (engleză) — 'in_asteptare'
    // (românesc, ca restul convenției din schema.sql) o respingea mereu la nivel de DB.
    const { error: partnerErr } = await supabaseAdmin.from('partners').insert({
      id: invited.user.id,
      partner_type: enumType,
      nume_firma: firma.date.nume_firma,
      cui: firma.date.cui,
      status_verificare: 'pending_review',
      tip_entitate_legala,
      ...(forma_juridica_locala ? { forma_juridica_locala } : {}),
      ...(regiune_cod ? { regiune_cod } : {}),
      ...(nrRegCom ? { nr_reg_com: nrRegCom } : {}),
      ...(adresaSediu ? { adresa_sediu_social: adresaSediu } : {}),
      ...(is_treasury_account !== undefined ? { is_treasury_account: Boolean(is_treasury_account) } : {}),
    });
    if (partnerErr) throw partnerErr;
    await marcheazaVerificareManuala({ partenerId: invited.user.id, motiv: firma.verificare_manuala, cui: firma.date.cui, req });

    // 2b. Cont bancar (T7, 2026-07-20) — colectat legitim înainte de
    // autentificare (spre deosebire de CNP-uri de angajați/documente, care
    // cer o sesiune reală pentru path-ul scoped pe user.id în Storage).
    // Criptat exact ca în wizard-companie.js — nicio cale nouă, doar
    // aceeași logică mutată aici, ca pagina publică să nu mai arunce IBAN-ul.
    if (iban) {
      const { data: cripted, error: cryptErr } = await supabaseAdmin.rpc('cripteaza_camp', { valoare: iban });
      if (cryptErr) throw cryptErr;
      const { error: contErr } = await supabaseAdmin.from('partner_conturi_bancare').insert({
        partner_id: invited.user.id,
        nume_titular: firma.date.nume_firma,
        iban_criptat: cripted,
        banca,
        moneda: { RO: 'RON', MD: 'MDL', DE: 'EUR', FR: 'EUR', BG: 'BGN' }[tara] || 'RON',
      });
      if (contErr) throw contErr;
    }

    // 3. Setează țara + limba (adăugat 2026-07-12) — handle_new_user() nu le
    // cunoaște, deci le completăm separat pe rândul din profiles deja creat
    // de trigger. Limba determină ulterior în ce limbă primește partenerul
    // emailuri/notificări; utilizatorul o poate schimba oricând din cont.
    if (tara || telefon) {
      const profileUpdate = {};
      if (tara) { profileUpdate.tara = tara; profileUpdate.limba = limba; }
      if (telefon) profileUpdate.phone = telefon;
      await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', invited.user.id);
    }

    // 4. Email de bun venit cu linkul de setare a parolei, în limba dedusă din
    // țară. Contul rămâne creat chiar dacă emailul eșuează; răspunsul spune
    // sincer ce s-a întâmplat, ca formularul să nu afirme ce n-a avut loc.
    const linkParola = await genereazaLinkParola(email);
    const emailStatus = await trimiteEmailBunVenit({ email, nume, tip, limba, linkParola });

    return res.status(200).json({
      ok: true,
      user_id: invited.user.id,
      email_trimis: emailStatus.ok,
      email_stare: emailStatus.stare || null,
      email_motiv: emailStatus.motiv,
      link_parola: !!linkParola,
    });
  } catch (err) {
    console.error('[partner-register]', err);
    // Dacă am apucat să creăm userul Auth dar insertul în partners a eșuat,
    // ștergem userul orfan — mai bine cerere respinsă curat decât un cont
    // invitat, fără rând corespunzător în partners, imposibil de administrat.
    if (invitedUserId) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(invitedUserId);
      } catch (cleanupErr) {
        console.error('[partner-register] curățare eșuată pentru user orfan', invitedUserId, cleanupErr);
      }
    }
    return res.status(500).json({ error: err.message || 'Nu am putut înregistra partenerul.' });
  }
}

// Erorile ies în forma comună (lib/raspuns-eroare.js), cu `error` / `error_en` păstrate.
module.exports = formaComuna(handler);

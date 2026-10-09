// lib/notificari-comanda.js
// Etapa 0 SLA (9 oct. 2026, decizie LM) — notificările care lipseau la
// plasarea comenzii:
//  - partenerul alocat automat (lib/aloca-partener.js) află imediat, pe
//    email, ce comandă i s-a alocat (serviciu, dată, interval, localitate —
//    fără adresa completă, ca în api/partener/sarcini.js);
//  - adminul află imediat, la `suport_email` din back-office (secțiunea
//    contact), de orice comandă rămasă fără partener (in_cautare_partener).
// Ambele prin Resend, ca restul emailurilor; o eroare de trimitere se
// loghează și nu blochează comanda.

const { supabaseAdmin } = require('./supabaseAdmin');
const { fromHeader } = require('./email-sender');
const { renderEmailComandaAlocataPartener, limbaProfilEmailComportamental } = require('./i18n');

const SUPERADMIN_COMENZI_URL = 'https://mydarrin.homebestpal.com/mydarrin-superadmin?panel=comenzi';

const MOTIVE = {
  fara_serviciu_specificat: 'comanda nu are un serviciu din catalog (catalog_serviciu_id lipsă)',
  status_neeligibil: 'statusul comenzii nu permite alocarea',
  niciun_partener_cu_acest_serviciu: 'niciun partener nu are acest serviciu activ în portofoliu',
  niciun_partener_cu_competenta_esco: 'niciun partener nu are competența ESCO cerută',
  niciun_partener_disponibil_in_zona: 'niciun partener disponibil în zona comenzii',
  echipa_indisponibila: 'echipele partenerilor din zonă sunt indisponibile',
  eroare_actualizare: 'eroare la salvarea alocării',
  comanda_negasita: 'comanda nu a fost găsită',
};

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function trimite({ to, subject, html, limba = 'ro', eticheta }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[notificari-comanda] RESEND_API_KEY lipsă — ${eticheta} netrimis către ${to}`);
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: await fromHeader(limba), to, subject, html }),
    });
    if (!r.ok) console.error(`[notificari-comanda] ${eticheta}: Resend ${r.status}`, await r.text());
    return r.ok;
  } catch (err) {
    console.error(`[notificari-comanda] ${eticheta}: trimitere eșuată`, err);
    return false;
  }
}

async function titluServiciu(catalogServiciuId) {
  if (!catalogServiciuId) return null;
  const { data } = await supabaseAdmin.from('catalog_servicii').select('titlu').eq('id', catalogServiciuId).maybeSingle();
  return data?.titlu || null;
}

/**
 * Emailul către partenerul alocat automat.
 * @param {object} comanda - are nevoie de nr_comanda, catalog_serviciu_id, data_programata, ora_*_programata, localitate
 * @param {string} partenerId
 */
async function notificaPartenerAlocat(comanda, partenerId) {
  try {
    const { data: auth } = await supabaseAdmin.auth.admin.getUserById(partenerId);
    const email = auth?.user?.email;
    if (!email) { console.warn('[notificari-comanda] partener fără email', partenerId); return false; }
    const { data: profil } = await supabaseAdmin.from('profiles').select('limba, tara').eq('id', partenerId).maybeSingle();
    const limba = limbaProfilEmailComportamental(profil);
    const { subiect, html } = renderEmailComandaAlocataPartener(limba, {
      numarComanda: comanda.nr_comanda || comanda.id,
      serviciu: await titluServiciu(comanda.catalog_serviciu_id),
      data: comanda.data_programata,
      oraInceput: comanda.ora_inceput_programata,
      oraSfarsit: comanda.ora_sfarsit_programata,
      localitate: comanda.localitate || comanda.regiune,
    });
    return await trimite({ to: email, subject: subiect, html, limba, eticheta: 'email partener alocat' });
  } catch (err) {
    console.error('[notificari-comanda] notificaPartenerAlocat', err);
    return false;
  }
}

async function suportEmail() {
  const { data } = await supabaseAdmin
    .from('backoffice_config')
    .select('valoare')
    .eq('sectiune', 'contact')
    .eq('cheie', 'suport_email')
    .eq('tara_cod', 'ALL')
    .maybeSingle();
  return data?.valoare ? String(data.valoare).trim() : null;
}

/**
 * Emailul către admin pentru o comandă rămasă fără partener.
 * @param {object} comanda
 * @param {string} motiv - codul întors de incearcaAlocarePartener
 */
async function notificaAdminFaraPartener(comanda, motiv) {
  try {
    const to = await suportEmail();
    if (!to) { console.warn('[notificari-comanda] suport_email lipsește din backoffice_config — admin nenotificat', comanda.id); return false; }
    const ora = (v) => (v ? String(v).slice(0, 5) : '');
    const interval = comanda.ora_inceput_programata ? `${ora(comanda.ora_inceput_programata)}–${ora(comanda.ora_sfarsit_programata)}` : 'neprogramat';
    const rand = (e, v) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${e}</td><td style="padding:4px 0;font-weight:700">${esc(v)}</td></tr>`;
    const html = `
      <p><strong>Comanda #${esc(comanda.nr_comanda || comanda.id)} a rămas fără partener</strong> (status <code>in_cautare_partener</code>). Clientul a primit doar emailul „comandă primită”.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:8px 0 16px">
        ${rand('Motiv', MOTIVE[motiv] || motiv || 'necunoscut')}
        ${rand('Serviciu', (await titluServiciu(comanda.catalog_serviciu_id)) || '—')}
        ${rand('Data / interval', `${comanda.data_programata || 'neprogramată'} · ${interval}`)}
        ${rand('Localitate / regiune', [comanda.localitate, comanda.regiune, comanda.tara_cod].filter(Boolean).join(', ') || '—')}
        ${rand('Valoare', comanda.suma_totala_platita != null ? `${comanda.suma_totala_platita} ${comanda.moneda || ''}` : '—')}
        ${rand('Plasată la', comanda.creat_la || '—')}
      </table>
      <p><a href="${SUPERADMIN_COMENZI_URL}" style="display:inline-block;background:#FF8C00;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">Deschide Comenzi Globale</a></p>
    `;
    return await trimite({ to, subject: `Comandă fără partener — #${comanda.nr_comanda || comanda.id}`, html, eticheta: 'email admin fără partener' });
  } catch (err) {
    console.error('[notificari-comanda] notificaAdminFaraPartener', err);
    return false;
  }
}

module.exports = { notificaPartenerAlocat, notificaAdminFaraPartener, MOTIVE };

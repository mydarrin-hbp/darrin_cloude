// /api/email/webhook-primire.js
// Webhook Resend unic pentru DOUĂ familii de evenimente (audit Secțiunea 38
// — construit inițial doar pentru dezabonare; extins la audit Secțiunea 39,
// 30 Iulie 2026, cu logarea evenimentelor de livrare, ca să nu ținem 2
// webhook-uri/secrete separate pentru același domeniu):
//
// A. "email.received" — mesaj primit pe domeniul de recepție configurat:
//    1. Către contact@homebestpal.com → cerere de dezabonare (Secțiunea 38):
//       adresa expeditorului (+ orice adresă menționată explicit în subiect)
//       e adăugată automat în lib/email-suppression.js.
//    2. Către noreply@homebestpal.com (sau orice altă adresă de pe domeniu)
//       → auto-responder de îndrumare (Secțiunea 39, cerință explicită:
//       "sistem de fallback pentru răspunsuri") — adresele noreply@ resping
//       nativ interacțiunea; expeditorul primește un răspuns automat,
//       bilingv RO/EN (nu putem detecta limba reală a unui expeditor
//       necunoscut, care ne scrie din senin — bilingv e alegerea onestă,
//       nu o presupunere de limbă), care îl direcționează spre suport real.
//
// B. Evenimente de status livrare ("email.sent", "email.delivered",
//    "email.delivery_delayed", "email.complained", "email.bounced",
//    "email.opened", "email.clicked", "email.failed") — logate în
//    email_events_log (tabelă nouă), bază pentru panoul de backoffice
//    „Noreply & Transactional Gateway Manager" (api/admin/email-gateway.js).
//
// DEPENDINȚĂ EXTERNĂ, necesară din partea superadmin (Secțiunea 38, actualizată):
// 1. Resend Dashboard → Domains → Receiving — MX pentru homebestpal.com.
// 2. Resend Dashboard → Webhooks → un singur webhook, URL-ul acestui
//    endpoint, abonat la TOATE evenimentele de mai sus (nu doar email.received).
// 3. RESEND_WEBHOOK_SECRET în Vercel (fail-closed fără el — verificat live).

const { Resend } = require('resend');
const { adaugaSuprimare } = require('../../lib/email-suppression');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { fromHeader } = require('../../lib/email-sender');

const EVENIMENTE_LIVRARE = new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.complained',
  'email.bounced', 'email.opened', 'email.clicked', 'email.failed',
]);

function citesteBodyRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function extrageAdresa(dupaFormat) {
  const m = String(dupaFormat || '').match(/<([^>]+)>/);
  const adresa = m ? m[1] : String(dupaFormat || '');
  return adresa.trim().toLowerCase();
}

function extrageAdreseDinSubiect(subiect) {
  const regex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  return (String(subiect || '').match(regex) || []).map((a) => a.toLowerCase());
}

function areDestinatarCuLocalPart(listaTo, localPart) {
  return (listaTo || []).some((adr) => extrageAdresa(adr).startsWith(`${localPart}@`));
}

async function trimiteAutoResponder(adresaExpeditor) {
  if (!process.env.RESEND_API_KEY || !adresaExpeditor) return;
  const html = `
    <p><b>RO:</b> Adresa noreply@homebestpal.com este folosită exclusiv pentru trimiterea de notificări automate și nu poate primi răspunsuri. Pentru orice întrebare, scrie-ne la <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
    <p><b>EN:</b> The noreply@homebestpal.com address is used only to send automated notifications and cannot receive replies. For any question, please write to us at <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
  `;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: await fromHeader('ro'),
      to: adresaExpeditor,
      subject: 'Această adresă nu primește răspunsuri / This address does not accept replies',
      html,
    }),
  });
}

async function proceseazaEmailPrimit(data) {
  const toate = data.to || [];

  if (areDestinatarCuLocalPart(toate, 'contact')) {
    const adreseDeSuprimat = new Set();
    adreseDeSuprimat.add(extrageAdresa(data.from));
    extrageAdreseDinSubiect(data.subject).forEach((a) => adreseDeSuprimat.add(a));
    for (const adresa of adreseDeSuprimat) {
      if (!adresa) continue;
      await adaugaSuprimare(adresa, 'cerere primită pe contact@homebestpal.com');
    }
    return { ok: true, ruta: 'contact_suprimare', suprimate: Array.from(adreseDeSuprimat) };
  }

  if (areDestinatarCuLocalPart(toate, 'noreply')) {
    const expeditor = extrageAdresa(data.from);
    await trimiteAutoResponder(expeditor);
    return { ok: true, ruta: 'noreply_auto_responder', catre: expeditor };
  }

  return { ok: true, ruta: 'ignorat_adresa_necunoscuta' };
}

async function logheazaEvenimentLivrare(tip, data) {
  try {
    await supabaseAdmin.from('email_events_log').insert({
      resend_email_id: data.email_id || null,
      tip,
      destinatar: Array.isArray(data.to) ? data.to.join(', ') : (data.to || null),
      subiect: data.subject || null,
      detalii: data,
    });
  } catch (err) {
    console.error('[webhook-primire] eroare la logarea evenimentului de livrare', err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodă nepermisă' });

  if (!process.env.RESEND_WEBHOOK_SECRET) {
    console.error('[webhook-primire] RESEND_WEBHOOK_SECRET lipsă — refuz orice request (fail-closed)');
    return res.status(500).json({ error: 'Webhook neconfigurat' });
  }

  const payload = await citesteBodyRaw(req);
  const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy');

  let event;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: req.headers['svix-id'],
        timestamp: req.headers['svix-timestamp'],
        signature: req.headers['svix-signature'],
      },
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    });
  } catch (err) {
    console.error('[webhook-primire] semnătură invalidă', err.message);
    return res.status(401).json({ error: 'Semnătură invalidă' });
  }

  if (event.type === 'email.received') {
    const rezultat = await proceseazaEmailPrimit(event.data);
    return res.status(200).json(rezultat);
  }

  if (EVENIMENTE_LIVRARE.has(event.type)) {
    await logheazaEvenimentLivrare(event.type, event.data);
    return res.status(200).json({ ok: true, logat: event.type });
  }

  return res.status(200).json({ ok: true, ignorat: event.type });
};

// Body parser dezactivat — verificarea semnăturii Svix (via SDK-ul oficial
// `resend`) necesită corpul RAW al request-ului, nu JSON deja parsat. Trebuie
// atașat DUPĂ reasignarea module.exports de mai sus (nu înainte — altfel
// reasignarea îl pierde, era exact bug-ul prins de testul dinamic).
module.exports.config = { api: { bodyParser: false } };

// Expuse doar pentru testare directă (nu afectează comportamentul pe Vercel).
module.exports._extrageAdresa = extrageAdresa;
module.exports._extrageAdreseDinSubiect = extrageAdreseDinSubiect;
module.exports._areDestinatarCuLocalPart = areDestinatarCuLocalPart;

// /api/email/webhook-primire.js
// Webhook Resend Inbound (evenimentul "email.received") pentru
// contact@homebestpal.com — implementează literal cerința de business
// (audit Secțiunea 38, 30 Iulie 2026): un utilizator care nu mai vrea
// email-uri comportamentale (cont/coș abandonat) scrie la contact@,
// iar sistemul preia AUTOMAT adresa în lib/email-suppression.js, fără
// intervenție manuală.
//
// Ce NU face (deliberat, scop redus): nu citește corpul emailului (necesită
// un apel API separat, resend.emails.receiving.get() — payload-ul webhook
// conține doar metadate). Adresa suprimată e (a) adresa EXPEDITORULUI
// mesajului primit — cazul standard, cineva scrie de la propria adresă
// cerând să nu mai primească email-uri — și, suplimentar, (b) orice altă
// adresă de email menționată explicit în SUBIECTUL mesajului (ex. subiect
// "Dezabonare: altcineva@exemplu.com"), dacă diferă de expeditor.
//
// DEPENDINȚĂ EXTERNĂ, necesară din partea superadmin (Secțiunea 38):
// 1. Resend Dashboard → Domains → configurare domeniu de RECEPȚIE (MX)
//    pentru homebestpal.com/contact@ — schimbare DNS, nu se poate face din
//    cod. 2. Resend Dashboard → Webhooks → creează un webhook nou pe
//    evenimentul "email.received", cu URL-ul acestui endpoint. 3. Secretul
//    de semnare generat acolo trebuie pus în variabila de mediu Vercel
//    RESEND_WEBHOOK_SECRET (fără el, orice request e respins — fail-closed).
//
const { Resend } = require('resend');
const { adaugaSuprimare } = require('../../lib/email-suppression');

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

  if (event.type !== 'email.received') {
    return res.status(200).json({ ok: true, ignorat: event.type });
  }

  const adreseDeSuprimat = new Set();
  adreseDeSuprimat.add(extrageAdresa(event.data.from));
  extrageAdreseDinSubiect(event.data.subject).forEach((a) => adreseDeSuprimat.add(a));

  for (const adresa of adreseDeSuprimat) {
    if (!adresa) continue;
    await adaugaSuprimare(adresa, 'cerere primită pe contact@homebestpal.com');
  }

  return res.status(200).json({ ok: true, suprimate: Array.from(adreseDeSuprimat) });
};

// Body parser dezactivat — verificarea semnăturii Svix (via SDK-ul oficial
// `resend`) necesită corpul RAW al request-ului, nu JSON deja parsat. Trebuie
// atașat DUPĂ reasignarea module.exports de mai sus (nu înainte — altfel
// reasignarea îl pierde, era exact bug-ul prins de testul dinamic).
module.exports.config = { api: { bodyParser: false } };

// Expuse doar pentru testare directă (nu afectează comportamentul pe Vercel).
module.exports._extrageAdresa = extrageAdresa;
module.exports._extrageAdreseDinSubiect = extrageAdreseDinSubiect;

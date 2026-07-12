// lib/i18n.js
// Adăugat 2026-07-12 — bază pentru localizarea emailurilor/notificărilor
// tranzacționale (NU traducere completă a interfeței site-ului — scop
// limitat, discutat explicit: doar mesaje automate, pentru început).
//
// Harta țară→limbă oglindește myd-geo.js (client-side) — ține-le sincron
// dacă adaugi o țară nouă acolo.

const TARA_LA_LIMBA = {
  RO: 'ro', MD: 'ro',
  DE: 'de', AT: 'de', CH: 'de',
  FR: 'fr', BE: 'fr',
  BG: 'bg',
  ES: 'es',
  IT: 'it',
  GB: 'en', US: 'en', IE: 'en',
  HU: 'hu',
  PL: 'pl',
};
const LIMBA_IMPLICITA = 'ro';
const LIMBI_DISPONIBILE = ['ro', 'en', 'it', 'fr', 'de', 'es'];

function limbaDinTara(codTara) {
  if (!codTara) return LIMBA_IMPLICITA;
  const limba = TARA_LA_LIMBA[String(codTara).toUpperCase()];
  return LIMBI_DISPONIBILE.includes(limba) ? limba : LIMBA_IMPLICITA;
}

function limbaValida(limba) {
  return LIMBI_DISPONIBILE.includes(limba) ? limba : LIMBA_IMPLICITA;
}

// ── Email de bun venit — partener nou (invitat prin wizard-ul public) ──
// Notă onestă: traducerile IT/EN/FR/DE/ES de mai jos sunt generate, nu
// revizuite de un vorbitor nativ — recomandat control înainte de folosire
// susținută pentru comunicare comercială/legală.
const BUN_VENIT_PARTENER = {
  ro: {
    subiect: (nume) => `Bine ai venit pe My Darrin, ${nume}!`,
    corp: (nume, tipLabel) => `
      <p>Bună, ${nume},</p>
      <p>Îți mulțumim că te-ai înscris ca <strong>${tipLabel}</strong> pe platforma My Darrin! Contul tău de partener este <strong>gratuit</strong>.</p>
      <p>Ce urmează:</p>
      <ul>
        <li>Vei primi actualizări pe măsură ce adăugăm servicii noi în catalog, corelate cu competențele pe care le-ai declarat (ESCO / NACE / CAEN / Uniclass) — le poți confirma direct, iar ele intră automat în portofoliul tău.</li>
        <li>Dacă ai sugestii de servicii care ar trebui create și integrate în catalog, ne poți scrie oricând.</li>
        <li>Te anunțăm imediat ce aplicația mobilă dedicată e gata și testată, ca s-o descarci și să începi să preiei comenzi.</li>
      </ul>
      <p>Pentru întrebări sau sugestii: <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
      <p style="font-size:12px;color:#666">Prelucrăm datele tale conform GDPR, exclusiv pentru administrarea contului de partener și comunicări legate de platformă. Poți solicita oricând ștergerea sau rectificarea datelor scriind la adresa de mai sus.</p>
      <p style="font-size:12px;color:#666">My Darrin este operată de Home Best Pal SRL (România) și Home Best Pal LTD.</p>
    `,
  },
  en: {
    subiect: (nume) => `Welcome to My Darrin, ${nume}!`,
    corp: (nume, tipLabel) => `
      <p>Hi ${nume},</p>
      <p>Thank you for signing up as a <strong>${tipLabel}</strong> on the My Darrin platform! Your partner account is <strong>free of charge</strong>.</p>
      <p>What happens next:</p>
      <ul>
        <li>You'll receive updates as we add new services to the catalog that match the competencies you declared (ESCO / NACE / CAEN / Uniclass) — you can confirm them directly and they'll be added to your portfolio automatically.</li>
        <li>If you have suggestions for services that should be created and added to the catalog, feel free to write to us anytime.</li>
        <li>We'll notify you as soon as the dedicated mobile app is ready and tested, so you can download it and start receiving orders.</li>
      </ul>
      <p>Questions or suggestions: <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
      <p style="font-size:12px;color:#666">We process your data under GDPR, solely to manage your partner account and for platform-related communication. You can request deletion or correction of your data anytime at the address above.</p>
      <p style="font-size:12px;color:#666">My Darrin is operated by Home Best Pal SRL (Romania) and Home Best Pal LTD.</p>
    `,
  },
  it: {
    subiect: (nume) => `Benvenuto/a su My Darrin, ${nume}!`,
    corp: (nume, tipLabel) => `
      <p>Ciao ${nume},</p>
      <p>Grazie per esserti registrato/a come <strong>${tipLabel}</strong> sulla piattaforma My Darrin! Il tuo account partner è <strong>gratuito</strong>.</p>
      <p>Cosa succede ora:</p>
      <ul>
        <li>Riceverai aggiornamenti man mano che aggiungiamo nuovi servizi al catalogo, in base alle competenze dichiarate (ESCO / NACE / CAEN / Uniclass) — potrai confermarle direttamente e verranno aggiunte automaticamente al tuo portfolio.</li>
        <li>Se hai suggerimenti su servizi da creare e integrare nel catalogo, scrivici quando vuoi.</li>
        <li>Ti avviseremo non appena l'app mobile dedicata sarà pronta e testata, così potrai scaricarla e iniziare a ricevere ordini.</li>
      </ul>
      <p>Domande o suggerimenti: <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
      <p style="font-size:12px;color:#666">Trattiamo i tuoi dati in conformità al GDPR, esclusivamente per la gestione del tuo account partner e per comunicazioni relative alla piattaforma. Puoi richiedere in qualsiasi momento la cancellazione o la rettifica dei tuoi dati scrivendo all'indirizzo sopra indicato.</p>
      <p style="font-size:12px;color:#666">My Darrin è gestita da Home Best Pal SRL (Romania) e Home Best Pal LTD.</p>
    `,
  },
  fr: {
    subiect: (nume) => `Bienvenue sur My Darrin, ${nume} !`,
    corp: (nume, tipLabel) => `
      <p>Bonjour ${nume},</p>
      <p>Merci de vous être inscrit(e) en tant que <strong>${tipLabel}</strong> sur la plateforme My Darrin ! Votre compte partenaire est <strong>gratuit</strong>.</p>
      <p>Prochaines étapes :</p>
      <ul>
        <li>Vous recevrez des mises à jour à mesure que nous ajoutons de nouveaux services au catalogue, correspondant aux compétences que vous avez déclarées (ESCO / NACE / CAEN / Uniclass) — vous pourrez les confirmer directement et elles seront ajoutées automatiquement à votre portefeuille.</li>
        <li>Si vous avez des suggestions de services à créer et intégrer au catalogue, écrivez-nous à tout moment.</li>
        <li>Nous vous informerons dès que l'application mobile dédiée sera prête et testée, afin que vous puissiez la télécharger et commencer à recevoir des commandes.</li>
      </ul>
      <p>Questions ou suggestions : <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
      <p style="font-size:12px;color:#666">Nous traitons vos données conformément au RGPD, uniquement pour la gestion de votre compte partenaire et les communications liées à la plateforme. Vous pouvez demander à tout moment la suppression ou la rectification de vos données à l'adresse ci-dessus.</p>
      <p style="font-size:12px;color:#666">My Darrin est exploitée par Home Best Pal SRL (Roumanie) et Home Best Pal LTD.</p>
    `,
  },
  de: {
    subiect: (nume) => `Willkommen bei My Darrin, ${nume}!`,
    corp: (nume, tipLabel) => `
      <p>Hallo ${nume},</p>
      <p>Vielen Dank für deine Anmeldung als <strong>${tipLabel}</strong> auf der My Darrin Plattform! Dein Partnerkonto ist <strong>kostenlos</strong>.</p>
      <p>Wie es weitergeht:</p>
      <ul>
        <li>Du erhältst Updates, sobald wir neue Dienstleistungen zum Katalog hinzufügen, die deinen angegebenen Kompetenzen entsprechen (ESCO / NACE / CAEN / Uniclass) — du kannst sie direkt bestätigen, und sie werden automatisch zu deinem Portfolio hinzugefügt.</li>
        <li>Wenn du Vorschläge für Dienstleistungen hast, die erstellt und in den Katalog aufgenommen werden sollten, schreib uns jederzeit.</li>
        <li>Wir informieren dich, sobald die dedizierte mobile App bereit und getestet ist, damit du sie herunterladen und Aufträge annehmen kannst.</li>
      </ul>
      <p>Fragen oder Vorschläge: <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
      <p style="font-size:12px;color:#666">Wir verarbeiten deine Daten gemäß DSGVO, ausschließlich zur Verwaltung deines Partnerkontos und für plattformbezogene Kommunikation. Du kannst jederzeit die Löschung oder Berichtigung deiner Daten unter obiger Adresse beantragen.</p>
      <p style="font-size:12px;color:#666">My Darrin wird von Home Best Pal SRL (Rumänien) und Home Best Pal LTD betrieben.</p>
    `,
  },
  es: {
    subiect: (nume) => `¡Bienvenido/a a My Darrin, ${nume}!`,
    corp: (nume, tipLabel) => `
      <p>Hola ${nume},</p>
      <p>¡Gracias por registrarte como <strong>${tipLabel}</strong> en la plataforma My Darrin! Tu cuenta de socio es <strong>gratuita</strong>.</p>
      <p>Qué sigue:</p>
      <ul>
        <li>Recibirás actualizaciones a medida que añadamos nuevos servicios al catálogo, en función de las competencias que declaraste (ESCO / NACE / CAEN / Uniclass) — podrás confirmarlas directamente y se añadirán automáticamente a tu portafolio.</li>
        <li>Si tienes sugerencias de servicios que deberían crearse e integrarse en el catálogo, escríbenos cuando quieras.</li>
        <li>Te avisaremos en cuanto la aplicación móvil dedicada esté lista y probada, para que puedas descargarla y empezar a recibir pedidos.</li>
      </ul>
      <p>Preguntas o sugerencias: <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
      <p style="font-size:12px;color:#666">Tratamos tus datos conforme al RGPD, únicamente para gestionar tu cuenta de socio y para comunicaciones relacionadas con la plataforma. Puedes solicitar la eliminación o rectificación de tus datos en cualquier momento escribiendo a la dirección anterior.</p>
      <p style="font-size:12px;color:#666">My Darrin está operada por Home Best Pal SRL (Rumanía) y Home Best Pal LTD.</p>
    `,
  },
};

function renderEmailBunVenitPartener(limba, { nume, tipLabel }) {
  const l = BUN_VENIT_PARTENER[limbaValida(limba)] || BUN_VENIT_PARTENER[LIMBA_IMPLICITA];
  const numeAfisat = nume || (limba === 'ro' ? 'partenerule' : 'there');
  return {
    subiect: l.subiect(numeAfisat),
    html: l.corp(numeAfisat, tipLabel),
  };
}

module.exports = {
  TARA_LA_LIMBA,
  LIMBA_IMPLICITA,
  LIMBI_DISPONIBILE,
  limbaDinTara,
  limbaValida,
  renderEmailBunVenitPartener,
};

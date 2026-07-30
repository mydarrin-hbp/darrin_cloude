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
  GR: 'el',
  TR: 'tr',
  UA: 'uk',
  FI: 'fi',
};
const LIMBA_IMPLICITA = 'ro';
// FIX (audit Secțiunea 31/36, G35, 29 Iulie 2026): 'tr' lipsea de aici, deși
// TARA_LA_LIMBA mapează TR→tr mai sus, existent dintotdeauna — un partener
// turc primea emailul de bun venit în română, silențios, fără nicio eroare
// (limbaValida('tr') cădea pe fallback-ul implicit). Reparat izolat, ca fix
// concret — unificarea completă a celor 3 surse (myd-geo.js/i18n-loader.js/
// acest fișier) rămâne G35, o trecere separată, mai amplă.
const LIMBI_DISPONIBILE = ['ro', 'en', 'it', 'fr', 'de', 'es', 'tr'];

// FIX (audit Secțiunea 36, 29 Iulie 2026): țară/limbă nerecunoscută cădea pe
// LIMBA_IMPLICITA (română) — cerință de business explicită: limbile
// dedicate (cele din LIMBI_DISPONIBILE) rămân corecte, dar orice altceva
// trebuie să cadă pe engleză, nu pe piața de bază RO. RO/MD rămân neatinse —
// se rezolvă direct din TARA_LA_LIMBA, fără să treacă prin acest fallback.
const LIMBA_FALLBACK = 'en';

function limbaDinTara(codTara) {
  if (!codTara) return LIMBA_FALLBACK;
  const limba = TARA_LA_LIMBA[String(codTara).toUpperCase()];
  return LIMBI_DISPONIBILE.includes(limba) ? limba : LIMBA_FALLBACK;
}

function limbaValida(limba) {
  return LIMBI_DISPONIBILE.includes(limba) ? limba : LIMBA_FALLBACK;
}

// Limbă efectivă pentru email-uri comportamentale (cont/coș abandonat),
// pornind de la profiles.tara/limba (audit Secțiunea 38, 30 Iulie 2026).
// Distincție importantă, NU aceeași regulă ca limbaDinTara(): un cont VECHI,
// creat înainte de captura tara/limba (ambele NULL azi), nu are niciun
// semnal — cade pe RO (piața de bază istorică a platformei), NU pe EN.
// Regula "necunoscut → EN" (limbaDinTara) se aplică DOAR când țara e
// efectiv detectată și e în afara limbilor dedicate — nu când lipsește
// complet informația despre cont.
function limbaProfilEmailComportamental(profil) {
  if (profil?.limba && LIMBI_DISPONIBILE.includes(profil.limba)) return profil.limba;
  if (profil?.tara) return limbaDinTara(profil.tara);
  return 'ro';
}

// ── Email de bun venit — partener nou (invitat prin wizard-ul public) ──
// Notă onestă: traducerile IT/EN/FR/DE/ES/TR de mai jos sunt generate, nu
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
  tr: {
    subiect: (nume) => `My Darrin'e hoş geldiniz, ${nume}!`,
    corp: (nume, tipLabel) => `
      <p>Merhaba ${nume},</p>
      <p>My Darrin platformunda <strong>${tipLabel}</strong> olarak kaydolduğunuz için teşekkür ederiz! Partner hesabınız <strong>ücretsizdir</strong>.</p>
      <p>Sırada ne var:</p>
      <ul>
        <li>Beyan ettiğiniz yetkinliklere (ESCO / NACE / CAEN / Uniclass) uygun yeni hizmetler kataloğa eklendikçe güncellemeler alacaksınız — bunları doğrudan onaylayabilirsiniz ve otomatik olarak portföyünüze eklenir.</li>
        <li>Kataloğa eklenmesi gereken hizmetlerle ilgili önerileriniz varsa, bize istediğiniz zaman yazabilirsiniz.</li>
        <li>Özel mobil uygulama hazır ve test edildiğinde sizi hemen bilgilendireceğiz, böylece indirip sipariş almaya başlayabilirsiniz.</li>
      </ul>
      <p>Sorular veya öneriler için: <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a>.</p>
      <p style="font-size:12px;color:#666">Verilerinizi GDPR uyarınca, yalnızca partner hesabınızın yönetimi ve platformla ilgili iletişim amacıyla işliyoruz. Verilerinizin silinmesini veya düzeltilmesini yukarıdaki adrese yazarak her zaman talep edebilirsiniz.</p>
      <p style="font-size:12px;color:#666">My Darrin, Home Best Pal SRL (Romanya) ve Home Best Pal LTD tarafından işletilmektedir.</p>
    `,
  },
};

function renderEmailBunVenitPartener(limba, { nume, tipLabel }) {
  const l = BUN_VENIT_PARTENER[limbaValida(limba)] || BUN_VENIT_PARTENER[LIMBA_FALLBACK];
  const numeAfisat = nume || (limba === 'ro' ? 'partenerule' : 'there');
  return {
    subiect: l.subiect(numeAfisat),
    html: l.corp(numeAfisat, tipLabel),
  };
}

// ── Email comportamental — cont abandonat (G24), diferențiat client/partener ──
// Notă onestă, ca la BUN_VENIT_PARTENER: traducerile IT/EN/FR/DE/ES/TR sunt
// generate, nu revizuite de un vorbitor nativ.
//
// Footer de dezabonare, comun ambelor texte — mecanism REAL (nu doar text):
// adresa scrisă către contact@homebestpal.com e capturată automat de
// api/email/webhook-primire.js (webhook Resend Inbound → email_suppression_list),
// verificată de lib/email-suppression.js înainte de orice trimitere ulterioară.
const FOOTER_DEZABONARE = {
  ro: 'Dacă nu mai vrei să primești acest tip de email, scrie-ne la <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> cu adresa de email pe care vrei să o dezabonăm — sistemul o preia automat și nu vei mai primi acest tip de comunicare.',
  en: "If you no longer want to receive this type of email, write to us at <a href=\"mailto:contact@homebestpal.com\">contact@homebestpal.com</a> with the email address you'd like to unsubscribe — the system captures it automatically and you won't receive this type of communication again.",
  it: "Se non desideri più ricevere questo tipo di email, scrivici a <a href=\"mailto:contact@homebestpal.com\">contact@homebestpal.com</a> indicando l'indirizzo email da disiscrivere — il sistema lo acquisisce automaticamente e non riceverai più questo tipo di comunicazione.",
  fr: "Si vous ne souhaitez plus recevoir ce type d'email, écrivez-nous à <a href=\"mailto:contact@homebestpal.com\">contact@homebestpal.com</a> avec l'adresse email à désabonner — le système la prend en compte automatiquement et vous ne recevrez plus ce type de communication.",
  de: 'Wenn du diese Art von E-Mail nicht mehr erhalten möchtest, schreib uns an <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> mit der E-Mail-Adresse, die abgemeldet werden soll — das System erfasst sie automatisch, und du erhältst diese Art von Mitteilung nicht mehr.',
  es: 'Si ya no deseas recibir este tipo de correo, escríbenos a <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> con la dirección de correo que deseas dar de baja — el sistema la registra automáticamente y no volverás a recibir este tipo de comunicación.',
  tr: 'Bu tür e-postaları almak istemiyorsan, abonelikten çıkarılmasını istediğin e-posta adresiyle birlikte <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> adresine yaz — sistem bunu otomatik olarak kaydeder ve bu tür bir iletişim bir daha almazsın.',
};

const CATALOG_URL = 'https://mydarrin.homebestpal.com/mydarrin-catalog';
const DASHBOARD_PARTENER_URL = 'https://mydarrin.homebestpal.com/mydarrin-dashboard-partener';
const BTN_STYLE = 'display:inline-block;background:#FF8C00;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700';

const CONT_ABANDONAT = {
  ro: {
    client: {
      subiect: (nume) => `Ai rămas la jumătatea drumului${nume ? ', ' + nume : ''} — prima ta comandă My Darrin`,
      corp: (nume) => `
        <p>Salut, ${nume},</p>
        <p>Am văzut că ți-ai făcut cont pe My Darrin, dar încă nu ai plasat nicio comandă.</p>
        <p>Catalogul are servicii, materiale și închirieri gata de comandat, cu deviz instant generat de Darrin AI și plată garantată prin escrow — banii ajung la partener doar după ce confirmi tu că lucrarea e făcută.</p>
        <p><a href="${CATALOG_URL}" style="${BTN_STYLE}">Vezi catalogul</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.ro}</p>
      `,
    },
    partener: {
      subiect: (nume) => `Contul tău de partener My Darrin te așteaptă${nume ? ', ' + nume : ''}`,
      corp: (nume) => `
        <p>Salut, ${nume},</p>
        <p>Ai fost aprobat ca partener pe My Darrin, dar încă nu ai primit nicio comandă alocată.</p>
        <p>Câteva lucruri care te pot ajuta să primești prima comandă mai repede:</p>
        <ul>
          <li>Confirmă-ți zona de acoperire și programul de lucru din contul tău — alocarea comenzilor ține cont direct de ele.</li>
          <li>Completează portofoliul de servicii/competențe declarate — cu cât e mai complet, cu atât ești eligibil pentru mai multe comenzi.</li>
          <li>Verifică datele de contact și contul bancar, ca plata prin escrow să ajungă fără întârziere după fiecare lucrare confirmată.</li>
        </ul>
        <p><a href="${DASHBOARD_PARTENER_URL}" style="${BTN_STYLE}">Deschide contul de partener</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.ro}</p>
      `,
    },
  },
  en: {
    client: {
      subiect: (nume) => `You're halfway there${nume ? ', ' + nume : ''} — your first My Darrin order`,
      corp: (nume) => `
        <p>Hi ${nume},</p>
        <p>We noticed you created a My Darrin account, but haven't placed an order yet.</p>
        <p>The catalog has services, materials and rentals ready to order, with an instant quote generated by Darrin AI and payment guaranteed through escrow — the partner only gets paid after you confirm the work is done.</p>
        <p><a href="${CATALOG_URL}" style="${BTN_STYLE}">See the catalog</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.en}</p>
      `,
    },
    partener: {
      subiect: (nume) => `Your My Darrin partner account is waiting${nume ? ', ' + nume : ''}`,
      corp: (nume) => `
        <p>Hi ${nume},</p>
        <p>You were approved as a partner on My Darrin, but haven't received any assigned order yet.</p>
        <p>A few things that can help you get your first order faster:</p>
        <ul>
          <li>Confirm your coverage area and working hours in your account — order allocation depends directly on them.</li>
          <li>Complete your declared services/competencies portfolio — the more complete it is, the more orders you're eligible for.</li>
          <li>Check your contact details and bank account, so escrow payment arrives without delay after each confirmed job.</li>
        </ul>
        <p><a href="${DASHBOARD_PARTENER_URL}" style="${BTN_STYLE}">Open your partner account</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.en}</p>
      `,
    },
  },
  it: {
    client: {
      subiect: (nume) => `Sei a metà strada${nume ? ', ' + nume : ''} — il tuo primo ordine My Darrin`,
      corp: (nume) => `
        <p>Ciao ${nume},</p>
        <p>Abbiamo notato che hai creato un account su My Darrin, ma non hai ancora effettuato nessun ordine.</p>
        <p>Il catalogo ha servizi, materiali e noleggi pronti da ordinare, con preventivo istantaneo generato da Darrin AI e pagamento garantito tramite escrow — il partner viene pagato solo dopo che confermi che il lavoro è stato svolto.</p>
        <p><a href="${CATALOG_URL}" style="${BTN_STYLE}">Vedi il catalogo</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.it}</p>
      `,
    },
    partener: {
      subiect: (nume) => `Il tuo account partner My Darrin ti aspetta${nume ? ', ' + nume : ''}`,
      corp: (nume) => `
        <p>Ciao ${nume},</p>
        <p>Sei stato approvato come partner su My Darrin, ma non hai ancora ricevuto nessun ordine assegnato.</p>
        <p>Alcune cose che possono aiutarti a ricevere il primo ordine più velocemente:</p>
        <ul>
          <li>Conferma la tua zona di copertura e l'orario di lavoro nel tuo account — l'assegnazione degli ordini dipende direttamente da questi dati.</li>
          <li>Completa il portfolio dei servizi/competenze dichiarate — più è completo, più ordini sei idoneo a ricevere.</li>
          <li>Verifica i tuoi dati di contatto e il conto bancario, in modo che il pagamento tramite escrow arrivi senza ritardi dopo ogni lavoro confermato.</li>
        </ul>
        <p><a href="${DASHBOARD_PARTENER_URL}" style="${BTN_STYLE}">Apri il tuo account partner</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.it}</p>
      `,
    },
  },
  fr: {
    client: {
      subiect: (nume) => `Vous êtes à mi-chemin${nume ? ', ' + nume : ''} — votre première commande My Darrin`,
      corp: (nume) => `
        <p>Bonjour ${nume},</p>
        <p>Nous avons remarqué que vous avez créé un compte My Darrin, mais que vous n'avez pas encore passé de commande.</p>
        <p>Le catalogue propose des services, des matériaux et des locations prêts à commander, avec un devis instantané généré par Darrin AI et un paiement garanti par séquestre (escrow) — le partenaire n'est payé qu'après votre confirmation que le travail est terminé.</p>
        <p><a href="${CATALOG_URL}" style="${BTN_STYLE}">Voir le catalogue</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.fr}</p>
      `,
    },
    partener: {
      subiect: (nume) => `Votre compte partenaire My Darrin vous attend${nume ? ', ' + nume : ''}`,
      corp: (nume) => `
        <p>Bonjour ${nume},</p>
        <p>Vous avez été approuvé(e) en tant que partenaire sur My Darrin, mais vous n'avez encore reçu aucune commande attribuée.</p>
        <p>Quelques éléments qui peuvent vous aider à recevoir votre première commande plus rapidement :</p>
        <ul>
          <li>Confirmez votre zone de couverture et vos horaires de travail dans votre compte — l'attribution des commandes en dépend directement.</li>
          <li>Complétez le portefeuille des services/compétences déclarés — plus il est complet, plus vous êtes éligible à des commandes.</li>
          <li>Vérifiez vos coordonnées et votre compte bancaire, afin que le paiement par séquestre arrive sans délai après chaque travail confirmé.</li>
        </ul>
        <p><a href="${DASHBOARD_PARTENER_URL}" style="${BTN_STYLE}">Ouvrir votre compte partenaire</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.fr}</p>
      `,
    },
  },
  de: {
    client: {
      subiect: (nume) => `Du bist auf halbem Weg${nume ? ', ' + nume : ''} — deine erste My Darrin Bestellung`,
      corp: (nume) => `
        <p>Hallo ${nume},</p>
        <p>Wir haben festgestellt, dass du ein My Darrin Konto erstellt hast, aber noch keine Bestellung aufgegeben hast.</p>
        <p>Der Katalog bietet Dienstleistungen, Materialien und Vermietungen zur sofortigen Bestellung, mit einem sofortigen Kostenvoranschlag von Darrin AI und garantierter Zahlung über Escrow — der Partner wird erst bezahlt, nachdem du bestätigt hast, dass die Arbeit erledigt ist.</p>
        <p><a href="${CATALOG_URL}" style="${BTN_STYLE}">Katalog ansehen</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.de}</p>
      `,
    },
    partener: {
      subiect: (nume) => `Dein My Darrin Partnerkonto wartet auf dich${nume ? ', ' + nume : ''}`,
      corp: (nume) => `
        <p>Hallo ${nume},</p>
        <p>Du wurdest als Partner auf My Darrin genehmigt, hast aber noch keinen zugewiesenen Auftrag erhalten.</p>
        <p>Ein paar Dinge, die dir helfen können, deinen ersten Auftrag schneller zu bekommen:</p>
        <ul>
          <li>Bestätige deinen Einsatzbereich und deine Arbeitszeiten in deinem Konto — die Auftragsvergabe hängt direkt davon ab.</li>
          <li>Vervollständige dein Portfolio der angegebenen Dienstleistungen/Kompetenzen — je vollständiger es ist, desto mehr Aufträge kommen für dich infrage.</li>
          <li>Überprüfe deine Kontaktdaten und dein Bankkonto, damit die Escrow-Zahlung nach jedem bestätigten Auftrag ohne Verzögerung ankommt.</li>
        </ul>
        <p><a href="${DASHBOARD_PARTENER_URL}" style="${BTN_STYLE}">Partnerkonto öffnen</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.de}</p>
      `,
    },
  },
  es: {
    client: {
      subiect: (nume) => `Estás a mitad de camino${nume ? ', ' + nume : ''} — tu primer pedido en My Darrin`,
      corp: (nume) => `
        <p>Hola ${nume},</p>
        <p>Hemos visto que creaste una cuenta en My Darrin, pero aún no has realizado ningún pedido.</p>
        <p>El catálogo tiene servicios, materiales y alquileres listos para pedir, con presupuesto instantáneo generado por Darrin AI y pago garantizado mediante depósito en garantía (escrow) — el socio solo cobra después de que confirmes que el trabajo está hecho.</p>
        <p><a href="${CATALOG_URL}" style="${BTN_STYLE}">Ver el catálogo</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.es}</p>
      `,
    },
    partener: {
      subiect: (nume) => `Tu cuenta de socio en My Darrin te está esperando${nume ? ', ' + nume : ''}`,
      corp: (nume) => `
        <p>Hola ${nume},</p>
        <p>Has sido aprobado/a como socio en My Darrin, pero aún no has recibido ningún pedido asignado.</p>
        <p>Algunas cosas que pueden ayudarte a recibir tu primer pedido más rápido:</p>
        <ul>
          <li>Confirma tu zona de cobertura y tu horario de trabajo en tu cuenta — la asignación de pedidos depende directamente de ellos.</li>
          <li>Completa el portafolio de servicios/competencias declaradas — cuanto más completo esté, más pedidos serás elegible para recibir.</li>
          <li>Verifica tus datos de contacto y tu cuenta bancaria, para que el pago mediante escrow llegue sin demora tras cada trabajo confirmado.</li>
        </ul>
        <p><a href="${DASHBOARD_PARTENER_URL}" style="${BTN_STYLE}">Abrir tu cuenta de socio</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.es}</p>
      `,
    },
  },
  tr: {
    client: {
      subiect: (nume) => `Yarı yoldasın${nume ? ', ' + nume : ''} — ilk My Darrin siparişin`,
      corp: (nume) => `
        <p>Merhaba ${nume},</p>
        <p>My Darrin'de hesap oluşturduğunu ama henüz sipariş vermediğini fark ettik.</p>
        <p>Katalogda hemen sipariş verilebilecek hizmetler, malzemeler ve kiralamalar var; Darrin AI tarafından anında oluşturulan teklif ve emanet (escrow) yoluyla garanti edilen ödeme ile — ortak, ancak işin yapıldığını onayladıktan sonra ödeme alır.</p>
        <p><a href="${CATALOG_URL}" style="${BTN_STYLE}">Kataloğu görüntüle</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.tr}</p>
      `,
    },
    partener: {
      subiect: (nume) => `My Darrin partner hesabın seni bekliyor${nume ? ', ' + nume : ''}`,
      corp: (nume) => `
        <p>Merhaba ${nume},</p>
        <p>My Darrin'de partner olarak onaylandın, ancak henüz sana atanmış bir sipariş yok.</p>
        <p>İlk siparişini daha hızlı almana yardımcı olabilecek birkaç şey:</p>
        <ul>
          <li>Hesabındaki hizmet bölgeni ve çalışma saatlerini onayla — sipariş ataması doğrudan bunlara bağlıdır.</li>
          <li>Beyan ettiğin hizmet/yetkinlik portföyünü tamamla — ne kadar eksiksiz olursa, o kadar çok sipariş için uygun olursun.</li>
          <li>Her onaylanan iş sonrası emanet (escrow) ödemesinin gecikmeden ulaşması için iletişim bilgilerini ve banka hesabını kontrol et.</li>
        </ul>
        <p><a href="${DASHBOARD_PARTENER_URL}" style="${BTN_STYLE}">Partner hesabını aç</a></p>
        <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.tr}</p>
      `,
    },
  },
};

function renderEmailContAbandonat(limba, rol, { nume }) {
  const l = limbaValida(limba);
  const set = (CONT_ABANDONAT[l] || CONT_ABANDONAT[LIMBA_FALLBACK])[rol === 'partener' ? 'partener' : 'client'];
  const numeAfisat = nume || (l === 'ro' ? 'acolo' : 'there');
  return {
    subiect: set.subiect(numeAfisat),
    html: set.corp(numeAfisat),
  };
}

module.exports = {
  TARA_LA_LIMBA,
  LIMBA_IMPLICITA,
  LIMBI_DISPONIBILE,
  limbaDinTara,
  limbaValida,
  limbaProfilEmailComportamental,
  renderEmailBunVenitPartener,
  renderEmailContAbandonat,
};

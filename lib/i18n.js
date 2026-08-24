// lib/i18n.js
// Adăugat 2026-07-12 — bază pentru localizarea emailurilor/notificărilor
// tranzacționale (NU traducere completă a interfeței site-ului — scop
// limitat, discutat explicit: doar mesaje automate, pentru început).
//
// FIX (audit Secțiunea 35/36, G35, unificare 31 Iulie 2026): TARA_LA_LIMBA
// era un literal hardcodat aici, aproape duplicat cu myd-geo.js COUNTRIES
// (client-side) — risc constant de dezacord (exact ce s-a întâmplat cu 'tr',
// reparat izolat mai jos în trecut). Sursă unică acum: tari-config.json, la
// rădăcina site-ului — citit aici sincron (server pornește o singură dată,
// fs.readFileSync e sigur), și client-side prin fetch (myd-geo.js).
const fs = require('fs');
const path = require('path');

const TARA_LA_LIMBA = {};
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tari-config.json'), 'utf8'));
  Object.keys(cfg.tari || {}).forEach((cc) => { TARA_LA_LIMBA[cc] = cfg.tari[cc].limba; });
} catch (e) {
  console.error('[lib/i18n] nu am putut citi tari-config.json — fallback pe hartă minimă', e);
  Object.assign(TARA_LA_LIMBA, { RO: 'ro', MD: 'ro' });
}

const LIMBA_IMPLICITA = 'ro';
// Limbile cu conținut de email efectiv scris/tradus (BUN_VENIT_PARTENER,
// CONT_ABANDONAT etc., mai jos) — distinct de setul de țări din
// tari-config.json, care poate include țări cu o limbă pentru care NU
// există încă niciun șablon (ex. bg/pl/hu/el/uk/fi — vezi G20/G37, tracker
// separat pentru fișierele de traducere ale interfeței).
// EXTINDERE (24 august 2026) — bg/el/hu/sr adăugate, cerință explicită
// pentru emailurile de comandă/verificare partener (PRIMA_COMANDA,
// COD_PARTENER_*). Restul șabloanelor mai vechi din acest fișier NU au
// încă text propriu pe aceste 4 limbi — cad corect pe LIMBA_FALLBACK (en)
// prin tiparul `X[limbaValida(limba)] || X[LIMBA_FALLBACK]` deja folosit
// peste tot, nu pe eroare.
const LIMBI_DISPONIBILE = ['ro', 'en', 'it', 'fr', 'de', 'es', 'tr', 'bg', 'el', 'hu', 'sr'];

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
  bg: 'Ако не желаете повече да получавате този тип имейли, пишете ни на <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> с имейл адреса, който искате да отпишете — системата го обработва автоматично и няма да получавате повече този тип съобщения.',
  el: 'Αν δεν θέλετε πλέον να λαμβάνετε αυτόν τον τύπο email, γράψτε μας στο <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> με τη διεύθυνση email που θέλετε να διαγράψετε — το σύστημα την καταγράφει αυτόματα και δεν θα λαμβάνετε πλέον αυτού του είδους την επικοινωνία.',
  hu: 'Ha nem szeretnél többé ilyen típusú e-mailt kapni, írj nekünk a <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> címre azzal az e-mail címmel, amelyet le szeretnél iratkozni — a rendszer automatikusan rögzíti, és többé nem fogsz ilyen jellegű üzenetet kapni.',
  sr: 'Ако више не желите да примате овај тип имејла, пишите нам на <a href="mailto:contact@homebestpal.com">contact@homebestpal.com</a> са адресом е-поште коју желите да одјавите — систем је аутоматски региструје и нећете више примати овај тип комуникације.',
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

// ── Newsletter — email de confirmare (dublu opt-in, audit Secțiunea 39, 30 Iulie 2026) ──
const NEWSLETTER_CONFIRMARE = {
  ro: {
    subiect: 'Bun venit în comunitate! Confirmă abonarea la newsletter',
    corp: (link) => `
      <p>Salut,</p>
      <p>Ai solicitat abonarea la alertele tehnice și campaniile noastre de pe My Darrin. Pentru a valida adresa ta de email în conformitate cu protocoalele noastre de securitate, te rugăm să apeși pe butonul de mai jos:</p>
      <p><a href="${link}" style="${BTN_STYLE}">Confirmă Abonarea</a></p>
      <p style="font-size:12px;color:#666">Dacă nu ai solicitat acest lucru, poți ignora în siguranță acest mesaj — adresa ta nu va fi abonată fără această confirmare.</p>
    `,
  },
  en: {
    subiect: 'Welcome to the community! Please confirm your newsletter subscription',
    corp: (link) => `
      <p>Hi,</p>
      <p>You requested to subscribe to our technical alerts and campaigns on My Darrin. To validate your email address in line with our security protocols, please click the button below:</p>
      <p><a href="${link}" style="${BTN_STYLE}">Confirm Subscription</a></p>
      <p style="font-size:12px;color:#666">If you didn't request this, you can safely ignore this message — your address won't be subscribed without this confirmation.</p>
    `,
  },
  it: {
    subiect: 'Benvenuto/a nella community! Conferma l\'iscrizione alla newsletter',
    corp: (link) => `
      <p>Ciao,</p>
      <p>Hai richiesto di iscriverti agli avvisi tecnici e alle campagne di My Darrin. Per convalidare il tuo indirizzo email in conformità con i nostri protocolli di sicurezza, clicca sul pulsante qui sotto:</p>
      <p><a href="${link}" style="${BTN_STYLE}">Conferma Iscrizione</a></p>
      <p style="font-size:12px;color:#666">Se non hai richiesto questo, puoi ignorare tranquillamente questo messaggio — il tuo indirizzo non sarà iscritto senza questa conferma.</p>
    `,
  },
  fr: {
    subiect: 'Bienvenue dans la communauté ! Confirmez votre abonnement à la newsletter',
    corp: (link) => `
      <p>Bonjour,</p>
      <p>Vous avez demandé à vous abonner à nos alertes techniques et campagnes sur My Darrin. Pour valider votre adresse email conformément à nos protocoles de sécurité, veuillez cliquer sur le bouton ci-dessous :</p>
      <p><a href="${link}" style="${BTN_STYLE}">Confirmer l'abonnement</a></p>
      <p style="font-size:12px;color:#666">Si vous n'avez pas demandé cela, vous pouvez ignorer ce message en toute sécurité — votre adresse ne sera pas abonnée sans cette confirmation.</p>
    `,
  },
  de: {
    subiect: 'Willkommen in der Community! Bestätige dein Newsletter-Abonnement',
    corp: (link) => `
      <p>Hallo,</p>
      <p>Du hast dich für unsere technischen Hinweise und Kampagnen auf My Darrin angemeldet. Um deine E-Mail-Adresse gemäß unseren Sicherheitsprotokollen zu bestätigen, klicke bitte auf die Schaltfläche unten:</p>
      <p><a href="${link}" style="${BTN_STYLE}">Abonnement bestätigen</a></p>
      <p style="font-size:12px;color:#666">Wenn du dies nicht angefordert hast, kannst du diese Nachricht ignorieren — deine Adresse wird ohne diese Bestätigung nicht abonniert.</p>
    `,
  },
  es: {
    subiect: '¡Bienvenido/a a la comunidad! Confirma tu suscripción al newsletter',
    corp: (link) => `
      <p>Hola,</p>
      <p>Has solicitado suscribirte a nuestras alertas técnicas y campañas en My Darrin. Para validar tu dirección de correo conforme a nuestros protocolos de seguridad, haz clic en el botón de abajo:</p>
      <p><a href="${link}" style="${BTN_STYLE}">Confirmar Suscripción</a></p>
      <p style="font-size:12px;color:#666">Si no has solicitado esto, puedes ignorar este mensaje con tranquilidad — tu dirección no será suscrita sin esta confirmación.</p>
    `,
  },
  tr: {
    subiect: 'Topluluğa hoş geldiniz! Bülten aboneliğini onayla',
    corp: (link) => `
      <p>Merhaba,</p>
      <p>My Darrin'deki teknik uyarılara ve kampanyalara abone olmayı talep ettin. Güvenlik protokollerimize uygun olarak e-posta adresini doğrulamak için lütfen aşağıdaki düğmeye tıkla:</p>
      <p><a href="${link}" style="${BTN_STYLE}">Aboneliği Onayla</a></p>
      <p style="font-size:12px;color:#666">Bunu talep etmediysen, bu mesajı güvenle yok sayabilirsin — bu onay olmadan adresin abone edilmeyecek.</p>
    `,
  },
};

function renderEmailNewsletterConfirmare(limba, link) {
  const l = (NEWSLETTER_CONFIRMARE[limbaValida(limba)] || NEWSLETTER_CONFIRMARE[LIMBA_FALLBACK]);
  return { subiect: l.subiect, html: l.corp(link) };
}

// ── Bun venit — client nou (audit Secțiunea 39, 30 Iulie 2026, gap real: clienții nu primeau niciun email echivalent celui de partener) ──
const DASHBOARD_CLIENT_URL = 'https://mydarrin.homebestpal.com/mydarrin-dashboard-client';

const BUN_VENIT_CLIENT = {
  ro: {
    subiect: () => 'Contul tău de client a fost creat cu succes!',
    corp: (nume) => `
      <p>Salut ${nume},</p>
      <p>Accesul tău pe My Darrin a fost activat. Îți poți gestiona comenzile, favoritele și datele de profil direct din dashboard-ul tău dedicat.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Accesează Dashboard-ul</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.ro}</p>
    `,
  },
  en: {
    subiect: () => 'Your client account has been successfully created!',
    corp: (nume) => `
      <p>Hi ${nume},</p>
      <p>Your access to My Darrin has been activated. You can manage your orders, favorites and profile details directly from your dedicated dashboard.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Open your dashboard</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.en}</p>
    `,
  },
  it: {
    subiect: () => 'Il tuo account cliente è stato creato con successo!',
    corp: (nume) => `
      <p>Ciao ${nume},</p>
      <p>Il tuo accesso a My Darrin è stato attivato. Puoi gestire i tuoi ordini, preferiti e dati di profilo direttamente dalla tua dashboard dedicata.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Apri la dashboard</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.it}</p>
    `,
  },
  fr: {
    subiect: () => 'Votre compte client a été créé avec succès !',
    corp: (nume) => `
      <p>Bonjour ${nume},</p>
      <p>Votre accès à My Darrin a été activé. Vous pouvez gérer vos commandes, favoris et données de profil directement depuis votre tableau de bord dédié.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Ouvrir le tableau de bord</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.fr}</p>
    `,
  },
  de: {
    subiect: () => 'Dein Kundenkonto wurde erfolgreich erstellt!',
    corp: (nume) => `
      <p>Hallo ${nume},</p>
      <p>Dein Zugang zu My Darrin wurde aktiviert. Du kannst deine Bestellungen, Favoriten und Profildaten direkt in deinem eigenen Dashboard verwalten.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Dashboard öffnen</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.de}</p>
    `,
  },
  es: {
    subiect: () => '¡Tu cuenta de cliente se ha creado con éxito!',
    corp: (nume) => `
      <p>Hola ${nume},</p>
      <p>Tu acceso a My Darrin ha sido activado. Puedes gestionar tus pedidos, favoritos y datos de perfil directamente desde tu panel dedicado.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Abrir tu panel</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.es}</p>
    `,
  },
  tr: {
    subiect: () => 'Müşteri hesabın başarıyla oluşturuldu!',
    corp: (nume) => `
      <p>Merhaba ${nume},</p>
      <p>My Darrin'e erişimin etkinleştirildi. Siparişlerini, favorilerini ve profil bilgilerini doğrudan kendi panelinden yönetebilirsin.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Paneli aç</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.tr}</p>
    `,
  },
};

function renderEmailBunVenitClient(limba, { nume }) {
  const l = (BUN_VENIT_CLIENT[limbaValida(limba)] || BUN_VENIT_CLIENT[LIMBA_FALLBACK]);
  const numeAfisat = nume || (limbaValida(limba) === 'ro' ? 'acolo' : 'there');
  return { subiect: l.subiect(), html: l.corp(numeAfisat) };
}

// ── Prima comandă confirmată (audit Secțiunea 39, 30 Iulie 2026, gap real: nicio confirmare de comandă la creare) ──
// Text ajustat 24 august 2026, cerință explicită a utilizatorului — copy nou,
// mai scurt, pe 11 limbi (adăugate bg/el/hu/sr față de setul anterior de 7).
// Corpul nou nu mai personalizează cu numele clientului (textul cerut nu-l
// include) — parametrul `nume` rămâne în semnătura renderEmailPrimaComanda
// pentru compatibilitate cu apelantul, doar neutilizat în body.
const PRIMA_COMANDA = {
  ro: {
    subiect: (nr) => `Comanda ta #${nr} a fost înregistrată cu succes! 🎉`,
    corp: (_nume, nr) => `
      <p>Mulțumim pentru prima comandă! Plata ta este securizată prin escrow până la finalizarea livrării și poți urmări statusul în timp real din contul tău.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Vezi Detalii Comandă</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.ro}</p>
    `,
  },
  en: {
    subiect: (nr) => `Your order #${nr} has been successfully placed! 🎉`,
    corp: (_nume, nr) => `
      <p>Thank you for your first order! Your payment is secured via escrow until delivery is complete, and you can track the status in real-time from your account.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">View Order Details</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.en}</p>
    `,
  },
  it: {
    subiect: (nr) => `Il tuo ordine #${nr} è stato registrato con successo! 🎉`,
    corp: (_nume, nr) => `
      <p>Grazie per il tuo primo ordine! Il tuo pagamento è protetto tramite escrow fino al completamento della consegna e puoi monitorare lo stato in tempo reale dal tuo account.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Vedi i dettagli dell'ordine</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.it}</p>
    `,
  },
  fr: {
    subiect: (nr) => `Votre commande #${nr} a été enregistrée avec succès ! 🎉`,
    corp: (_nume, nr) => `
      <p>Merci pour votre première commande ! Votre paiement est sécurisé par séquestre jusqu'à la fin de la livraison, et vous pouvez suivre le statut en temps réel depuis votre compte.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Voir les détails de la commande</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.fr}</p>
    `,
  },
  de: {
    subiect: (nr) => `Deine Bestellung #${nr} wurde erfolgreich aufgegeben! 🎉`,
    corp: (_nume, nr) => `
      <p>Vielen Dank für Ihre erste Bestellung! Ihre Zahlung ist bis zum Abschluss der Lieferung über ein Treuhandkonto abgesichert, und Sie können den Status in Echtzeit in Ihrem Konto verfolgen.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Bestelldetails ansehen</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.de}</p>
    `,
  },
  es: {
    subiect: (nr) => `¡Tu pedido #${nr} se ha registrado con éxito! 🎉`,
    corp: (_nume, nr) => `
      <p>¡Gracias por tu primer pedido! Tu pago está protegido mediante depósito en garantía hasta que se complete la entrega, y puedes seguir el estado en tiempo real desde tu cuenta.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Ver detalles del pedido</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.es}</p>
    `,
  },
  tr: {
    subiect: (nr) => `#${nr} numaralı siparişin başarıyla alındı! 🎉`,
    corp: (_nume, nr) => `
      <p>İlk siparişiniz için teşekkür ederiz! Teslimat tamamlanana kadar ödemeniz emanet (escrow) sistemiyle güvence altındadır ve durumu hesabınızdan gerçek zamanlı olarak takip edebilirsiniz.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Sipariş Detaylarını Gör</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.tr}</p>
    `,
  },
  bg: {
    subiect: (nr) => `Поръчката ви #${nr} беше регистрирана успешно! 🎉`,
    corp: (_nume, nr) => `
      <p>Благодарим ви за първата ви поръчка! Плащането ви е защитено чрез ескроу до завършване на доставката и можете да следите статуса в реално време от профила си.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Виж детайлите на поръчката</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.bg}</p>
    `,
  },
  el: {
    subiect: (nr) => `Η παραγγελία σας #${nr} καταχωρίστηκε με επιτυχία! 🎉`,
    corp: (_nume, nr) => `
      <p>Ευχαριστούμε για την πρώτη σας παραγγελία! Η πληρωμή σας είναι ασφαλισμένη μέσω escrow έως την ολοκλήρωση της παράδοσης και μπορείτε να παρακολουθείτε την κατάσταση σε πραγματικό χρόνο από τον λογαριασμό σας.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Δείτε τις λεπτομέρειες της παραγγελίας</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.el}</p>
    `,
  },
  hu: {
    subiect: (nr) => `A(z) #${nr} rendelésed sikeresen rögzítve! 🎉`,
    corp: (_nume, nr) => `
      <p>Köszönjük az első rendelésed! A fizetésed letéti (escrow) számlán van biztonságban a teljesítésig, és a státuszt valós időben követheted a fiókodból.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Rendelés részleteinek megtekintése</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.hu}</p>
    `,
  },
  sr: {
    subiect: (nr) => `Ваша поруџбина #${nr} је успешно регистрована! 🎉`,
    corp: (_nume, nr) => `
      <p>Хвала вам на првој поруџбини! Ваша уплата је обезбеђена путем ескроу система до завршетка испоруке, а статус можете пратити у реалном времену са свог налога.</p>
      <p><a href="${DASHBOARD_CLIENT_URL}" style="${BTN_STYLE}">Погледајте детаље поруџбине</a></p>
      <p style="font-size:12px;color:#666">${FOOTER_DEZABONARE.sr}</p>
    `,
  },
};

function renderEmailPrimaComanda(limba, { nume, numarComanda }) {
  const l = (PRIMA_COMANDA[limbaValida(limba)] || PRIMA_COMANDA[LIMBA_FALLBACK]);
  const numeAfisat = nume || (limbaValida(limba) === 'ro' ? 'acolo' : 'there');
  return { subiect: l.subiect(numarComanda), html: l.corp(numeAfisat, numarComanda) };
}

// ── Coduri de verificare partener, pe scenariu (24 august 2026) ──
// Subiectul e identic pe toate cele 3 scenarii (același tipar cerut explicit
// de utilizator, ca și azi pe scenariul de manoperă) — doar corpul diferă,
// după actorul/rolul care ajunge la client.
function subiectCodPartener(nr, limba) {
  const map = {
    ro: `Cod de verificare partener — comanda ${nr}`,
    en: `Partner verification code — order ${nr}`,
    it: `Codice di verifica del partner — ordine ${nr}`,
    fr: `Code de vérification du partenaire — commande ${nr}`,
    de: `Partner-Verifizierungscode — Bestellung ${nr}`,
    es: `Código de verificación del socio — pedido ${nr}`,
    tr: `Partner doğrulama kodu — sipariş ${nr}`,
    bg: `Код за верификация на партньора — поръчка ${nr}`,
    el: `Κωδικός επαλήθευσης συνεργάτη — παραγγελία ${nr}`,
    hu: `Partner ellenőrző kód — rendelés ${nr}`,
    sr: `Верификациони код партнера — поруџбина ${nr}`,
  };
  return map[limbaValida(limba)] || map[LIMBA_FALLBACK];
}

const COD_STYLE = 'font-size:28px;font-weight:800;letter-spacing:4px';

// Textul scurt sub QR-ul de verificare (G34, 30 iulie 2026) — mutat aici ca
// să rămână alături de restul textelor de cod partener, tradus pe toate
// cele 11 limbi.
const QR_CAPTION = {
  ro: 'Sau arată acest QR partenerului — îl poate scana direct, fără să tasteze codul.',
  en: 'Or show this QR to your partner — they can scan it directly instead of typing the code.',
  it: "Oppure mostra questo QR al partner — può scansionarlo direttamente invece di digitare il codice.",
  fr: 'Ou montrez ce QR à votre partenaire — il peut le scanner directement sans taper le code.',
  de: 'Oder zeigen Sie diesen QR-Code Ihrem Partner — er kann ihn direkt scannen, statt den Code einzutippen.',
  es: 'O muestra este QR a tu socio — puede escanearlo directamente en lugar de escribir el código.',
  tr: 'Ya da bu QR kodunu partnerine göster — kodu yazmak yerine doğrudan tarayabilir.',
  bg: 'Или покажете този QR код на партньора — може да го сканира директно, вместо да въвежда кода.',
  el: 'Ή δείξτε αυτόν τον κωδικό QR στον συνεργάτη σας — μπορεί να τον σαρώσει απευθείας αντί να πληκτρολογήσει τον κωδικό.',
  hu: 'Vagy mutasd meg ezt a QR-kódot a partnerednek — beolvashatja, ahelyett hogy begépelné a kódot.',
  sr: 'Или покажите овај QR код партнеру — може га скенирати директно, уместо да укуца код.',
};
function textQrCaptionCod(limba) {
  return QR_CAPTION[limbaValida(limba)] || QR_CAPTION[LIMBA_FALLBACK];
}

// Scenariul 1 (manoperă/servicii) — cel deja live, folosit de
// lib/aloca-partener.js::trimiteEmailCod. Text ajustat 24 august 2026:
// numele real al partenerului (din metadata Auth) înlocuiește azi mesajul
// generic „Am găsit un partener".
const COD_PARTENER_SERVICII = {
  ro: (nume, nr, cod) => `<p>${nume} a preluat comanda ta de servicii (${nr}). Când ajunge la adresa declarată, comunică-i codul <span style="${COD_STYLE}">${cod}</span> pentru a confirma identitatea și a începe lucrarea.</p>`,
  en: (nume, nr, cod) => `<p>${nume} has accepted your service order (${nr}). When he arrives at your address, provide code <span style="${COD_STYLE}">${cod}</span> to confirm his identity and start the work.</p>`,
  it: (nume, nr, cod) => `<p>${nume} ha preso in carico il tuo ordine di servizio (${nr}). Quando arriva al tuo indirizzo, comunicagli il codice <span style="${COD_STYLE}">${cod}</span> per confermare la sua identità e iniziare i lavori.</p>`,
  fr: (nume, nr, cod) => `<p>${nume} a pris en charge votre commande de service (${nr}). À son arrivée à votre adresse, communiquez-lui le code <span style="${COD_STYLE}">${cod}</span> pour confirmer son identité et commencer les travaux.</p>`,
  de: (nume, nr, cod) => `<p>${nume} hat Ihren Serviceauftrag (${nr}) übernommen. Wenn er an Ihrer Adresse eintrifft, teilen Sie ihm den Code <span style="${COD_STYLE}">${cod}</span> mit, um seine Identität zu bestätigen und mit der Arbeit zu beginnen.</p>`,
  es: (nume, nr, cod) => `<p>${nume} ha tomado tu pedido de servicio (${nr}). Cuando llegue a tu dirección, comunícale el código <span style="${COD_STYLE}">${cod}</span> para confirmar su identidad y comenzar el trabajo.</p>`,
  tr: (nume, nr, cod) => `<p>${nume}, hizmet siparişinizi (${nr}) üstlendi. Adresinize ulaştığında, kimliğini doğrulamak ve çalışmaya başlamak için kendisine <span style="${COD_STYLE}">${cod}</span> kodunu bildirin.</p>`,
  bg: (nume, nr, cod) => `<p>${nume} пое вашата заявка за услуга (${nr}). Когато пристигне на адреса ви, съобщете му кода <span style="${COD_STYLE}">${cod}</span>, за да потвърди самоличността си и да започне работата.</p>`,
  el: (nume, nr, cod) => `<p>Ο ${nume} ανέλαβε την παραγγελία υπηρεσίας σας (${nr}). Όταν φτάσει στη διεύθυνσή σας, δώστε του τον κωδικό <span style="${COD_STYLE}">${cod}</span> για να επιβεβαιώσει την ταυτότητά του και να ξεκινήσει την εργασία.</p>`,
  hu: (nume, nr, cod) => `<p>${nume} átvette a szolgáltatási rendelésed (${nr}). Amikor megérkezik a megadott címre, add meg neki a <span style="${COD_STYLE}">${cod}</span> kódot a személyazonossága megerősítéséhez és a munka megkezdéséhez.</p>`,
  sr: (nume, nr, cod) => `<p>${nume} је преузео вашу поруџбину услуге (${nr}). Када стигне на вашу адресу, саопштите му код <span style="${COD_STYLE}">${cod}</span> да потврди идентитет и почне са радом.</p>`,
};

// Scenariul 2 (curier/materiale) — text pregătit 24 august 2026, la cererea
// explicită a utilizatorului. NECONECTAT la niciun trigger — alocarea reală
// de curier/materiale (lib/aloca-subcontractori.js) rulează azi doar la
// eliberarea escrow-ului (după finalizarea lucrării, vezi D2c), mult prea
// târziu pentru un mesaj „curierul e pe drum"; conectarea reală necesită
// mutarea acelei alocări mai devreme + un cod de verificare distinct per rol
// (comanda_subcontractori nu are azi coloană cod_verificare) — decizie de
// arhitectură separată (Etapa 5g), neaprobată încă. Funcția de render
// exportată mai jos, gata de folosit când acel trigger va exista.
const COD_PARTENER_CURIER = {
  ro: (nume, nr, cod) => `<p>${nume} (curierul de cartier) a preluat livrarea comenzii tale (${nr}). La sosirea la adresă, comunică-i codul <span style="${COD_STYLE}">${cod}</span> pentru a confirma predarea produselor.</p>`,
  en: (nume, nr, cod) => `<p>${nume} (your local courier) is delivering your order (${nr}). Upon arrival at your address, provide code <span style="${COD_STYLE}">${cod}</span> to confirm the handover of the items.</p>`,
  it: (nume, nr, cod) => `<p>${nume} (il corriere di quartiere) ha preso in carico la consegna del tuo ordine (${nr}). All'arrivo, comunicagli il codice <span style="${COD_STYLE}">${cod}</span> per confermare la consegna dei prodotti.</p>`,
  fr: (nume, nr, cod) => `<p>${nume} (votre livreur de quartier) prend en charge la livraison de votre commande (${nr}). À son arrivée, communiquez-lui le code <span style="${COD_STYLE}">${cod}</span> pour confirmer la remise des articles.</p>`,
  de: (nume, nr, cod) => `<p>${nume} (Ihr Kurier vor Ort) liefert Ihre Bestellung (${nr}) aus. Geben Sie bei der Ankunft an Ihrer Adresse den Code <span style="${COD_STYLE}">${cod}</span> an, um die Übergabe zu bestätigen.</p>`,
  es: (nume, nr, cod) => `<p>${nume} (tu repartidor local) va a entregar tu pedido (${nr}). Al llegar a tu dirección, comunícale el código <span style="${COD_STYLE}">${cod}</span> para confirmar la entrega de los productos.</p>`,
  tr: (nume, nr, cod) => `<p>${nume} (mahalle kuryeniz) siparişinizin (${nr}) teslimatını yapıyor. Adresinize ulaştığında, teslimatı onaylamak için kendisine <span style="${COD_STYLE}">${cod}</span> kodunu bildirin.</p>`,
  bg: (nume, nr, cod) => `<p>${nume} (местният куриер) извършва доставката на вашата поръчка (${nr}). При пристигане на адреса, съобщете му кода <span style="${COD_STYLE}">${cod}</span>, за да потвърдите получаването.</p>`,
  el: (nume, nr, cod) => `<p>Ο ${nume} (ο τοπικός σας courier) παραδίδει την παραγγελία σας (${nr}). Κατά την άφιξή του στη διεύθυνσή σας, δώστε του τον κωδικό <span style="${COD_STYLE}">${cod}</span> για να επιβεβαιώσετε την παράδοση.</p>`,
  hu: (nume, nr, cod) => `<p>${nume} (a helyi futár) szállítja ki a rendelésed (${nr}). A címre érkezéskor add meg neki a <span style="${COD_STYLE}">${cod}</span> kódot az átvétel megerősítéséhez.</p>`,
  sr: (nume, nr, cod) => `<p>${nume} (локални курир) допрема вашу поруџбину (${nr}). По доласку на адресу, саопштите му код <span style="${COD_STYLE}">${cod}</span> како бисте потврдили примопредају.</p>`,
};

// Scenariul 3 (închiriere echipamente) — aceeași notă ca la Scenariul 2:
// text pregătit, NECONECTAT la niciun trigger, aceeași dependință de
// arhitectură neaprobată încă.
const COD_PARTENER_INCHIRIERE = {
  ro: (nume, nr, cod) => `<p>${nume} se ocupă de livrarea echipamentului tău închiriat (${nr}). Când ajunge la adresă, comunică-i codul <span style="${COD_STYLE}">${cod}</span> pentru a valida predarea bunului.</p>`,
  en: (nume, nr, cod) => `<p>${nume} is bringing your rented equipment (${nr}). When he arrives at your address, provide code <span style="${COD_STYLE}">${cod}</span> to validate the handover.</p>`,
  it: (nume, nr, cod) => `<p>${nume} sta consegnando l'attrezzatura a noleggio (${nr}). All'arrivo, comunicagli il codice <span style="${COD_STYLE}">${cod}</span> per convalidare la consegna.</p>`,
  fr: (nume, nr, cod) => `<p>${nume} s'occupe de la livraison de votre équipement loué (${nr}). À son arrivée, communiquez-lui le code <span style="${COD_STYLE}">${cod}</span> pour valider la remise.</p>`,
  de: (nume, nr, cod) => `<p>${nume} liefert Ihre Mieterausrüstung (${nr}). Geben Sie bei der Ankunft den Code <span style="${COD_STYLE}">${cod}</span> an, um die Übergabe zu bestätigen.</p>`,
  es: (nume, nr, cod) => `<p>${nume} está trayendo tu equipo alquilado (${nr}). Al llegar, comunícale el código <span style="${COD_STYLE}">${cod}</span> para validar la entrega.</p>`,
  tr: (nume, nr, cod) => `<p>${nume}, kiralık ekipmanınızın (${nr}) teslimatını yapıyor. Adrese ulaştığında, teslimatı onaylamak için kendisine <span style="${COD_STYLE}">${cod}</span> kodunu bildirin.</p>`,
  bg: (nume, nr, cod) => `<p>${nume} доставя вашето наето оборудване (${nr}). При пристигане на адреса, съобщете му кода <span style="${COD_STYLE}">${cod}</span>, за да потвърдите предаването.</p>`,
  el: (nume, nr, cod) => `<p>Ο ${nume} παραδίδει τον ενοικιαζόμενο εξοπλισμό σας (${nr}). Κατά την άφιξη, δώστε του τον κωδικό <span style="${COD_STYLE}">${cod}</span> για να επικυρώσετε την παράδοση.</p>`,
  hu: (nume, nr, cod) => `<p>${nume} szállítja a bérelt felszerelésed (${nr}). A címre érkezéskor add meg neki a <span style="${COD_STYLE}">${cod}</span> kódot az átadás érvényesítéséhez.</p>`,
  sr: (nume, nr, cod) => `<p>${nume} допрема вашу изнајмљену опрему (${nr}). По доласку на адресу, саопштите му код <span style="${COD_STYLE}">${cod}</span> ради потврде преузимања.</p>`,
};

const FALLBACK_NUME_PARTENER = {
  ro: 'Partenerul tău', en: 'Your partner', it: 'Il tuo partner', fr: 'Votre partenaire',
  de: 'Ihr Partner', es: 'Tu socio', tr: 'Partneriniz', bg: 'Вашият партньор',
  el: 'συνεργάτης σας', hu: 'A partnered', sr: 'Ваш партнер',
};
function _numeAfisatPartener(nume, limba) {
  return nume || FALLBACK_NUME_PARTENER[limbaValida(limba)] || FALLBACK_NUME_PARTENER[LIMBA_FALLBACK];
}

function renderEmailCodPartenerServicii(limba, { nume, numarComanda, cod }) {
  const l = limbaValida(limba);
  const set = COD_PARTENER_SERVICII[l] || COD_PARTENER_SERVICII[LIMBA_FALLBACK];
  return { subiect: subiectCodPartener(numarComanda, l), html: set(_numeAfisatPartener(nume, l), numarComanda, cod) };
}

function renderEmailCodPartenerCurier(limba, { nume, numarComanda, cod }) {
  const l = limbaValida(limba);
  const set = COD_PARTENER_CURIER[l] || COD_PARTENER_CURIER[LIMBA_FALLBACK];
  return { subiect: subiectCodPartener(numarComanda, l), html: set(_numeAfisatPartener(nume, l), numarComanda, cod) };
}

function renderEmailCodPartenerInchiriere(limba, { nume, numarComanda, cod }) {
  const l = limbaValida(limba);
  const set = COD_PARTENER_INCHIRIERE[l] || COD_PARTENER_INCHIRIERE[LIMBA_FALLBACK];
  return { subiect: subiectCodPartener(numarComanda, l), html: set(_numeAfisatPartener(nume, l), numarComanda, cod) };
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
  renderEmailNewsletterConfirmare,
  renderEmailBunVenitClient,
  renderEmailPrimaComanda,
  renderEmailCodPartenerServicii,
  renderEmailCodPartenerCurier,
  renderEmailCodPartenerInchiriere,
  textQrCaptionCod,
};

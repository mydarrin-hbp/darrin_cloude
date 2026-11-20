// lib/landing-pagini.js — paginile de destinație (pasul 12-L1, 19 nov. 2026; macheta L1, LM)
//
// Sursa unică a celor 7 pagini de destinație: /parteneri, cele 5 categorii de
// partener (același șablon) și /investitori. Pentru fiecare pagină:
//   - categoria (pentru /parteneri/inscriere?categorie=…) sau investitor;
//   - conținutul implicit al primului ecran, RO + EN (eticheta, titlul,
//     subtitlul, 3 beneficii, textul butonului, textul de sub buton) — scris și
//     în HTML (RO) și în dicționarele EN (i18n/en/<fișier>.json), de
//     scripts/genereaza-pagini-destinatie.js; testul verifică că sunt la zi;
//   - conținutul de sub primul ecran (pașii, cardurile de categorie), RO + EN.
// Plus regulile câmpurilor editabile din back-office (SEO → Pagini de
// destinație): limitele de caractere, validarea, numele variantei din
// utm_campaign. Aceleași reguli în browser (window.MYD_LANDING_PAGINI), în
// api/admin/seo-landing.js și în api/public/landing.js.
//
// Fără dependențe, forma UMD (Node + browser), ca lib/adrese-curate.js.

(function (radacina, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else radacina.MYD_LANDING_PAGINI = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMBI = ['ro', 'en'];
  var IMPLICITA = 'implicita';

  // Câmpurile editabile, cu limita de caractere (verificată și pe server, și în baza de date).
  var CAMPURI = [
    { cheie: 'eticheta', eticheta: 'Eticheta', max: 40, obligatoriu: true },
    { cheie: 'titlu', eticheta: 'Titlul', max: 60, obligatoriu: true },
    { cheie: 'subtitlu', eticheta: 'Subtitlul', max: 140, obligatoriu: true },
    { cheie: 'beneficiu_1', eticheta: 'Beneficiul 1', max: 60, obligatoriu: true },
    { cheie: 'beneficiu_2', eticheta: 'Beneficiul 2', max: 60, obligatoriu: true },
    { cheie: 'beneficiu_3', eticheta: 'Beneficiul 3', max: 60, obligatoriu: true },
    { cheie: 'buton', eticheta: 'Textul butonului', max: 24, obligatoriu: true },
    { cheie: 'sub_buton', eticheta: 'Textul de sub buton', max: 60, obligatoriu: true },
    { cheie: 'imagine_alt', eticheta: 'Textul alternativ al imaginii', max: 140, obligatoriu: false },
  ];
  var CAMPURI_TEXT = CAMPURI.map(function (c) { return c.cheie; });
  var MAXIM = {};
  CAMPURI.forEach(function (c) { MAXIM[c.cheie] = c.max; });

  // Imaginea principală: WebP, latura mare ≤ 1600 px, ≤ 300 KB (convertită în browser).
  var IMAGINE = { mime: 'image/webp', laturaMaxima: 1600, marimeMaxima: 300 * 1024, latimi: [480, 800, 1600] };

  // ── Paginile ───────────────────────────────────────────────────────
  // fisier = fișierul servit (lib/adrese-curate.js); categorie = valoarea pentru
  // /parteneri/inscriere?categorie= (null pe /parteneri: categoria se alege acolo).
  var PAGINI = [
    {
      cale: '/parteneri', fisier: 'cum-devii-partenerul-nostru', tip: 'hub', categorie: null, partenerTip: 'general',
      implicit: {
        ro: {
          eticheta: 'Parteneri My Darrin',
          titlu: 'Lucrează cu My Darrin',
          subtitlu: 'Clienții comandă în platformă, iar comenzile ajung la partenerii din zona lor. Alegi ce faci și unde lucrezi.',
          beneficiu_1: 'Comenzi prin platformă, fără să cauți clienți',
          beneficiu_2: 'Plata e păstrată ca garanție până la confirmare',
          beneficiu_3: 'Înscriere gratuită pentru firme și PFA',
          buton: 'Devino partener',
          sub_buton: 'Gratuit · contul în 60 de secunde',
        },
        en: {
          eticheta: 'My Darrin partners',
          titlu: 'Work with My Darrin',
          subtitlu: 'Clients order on the platform and the orders go to partners in their area. You choose what you do and where you work.',
          beneficiu_1: 'Orders through the platform, no client hunting',
          beneficiu_2: 'Payment held as a guarantee until confirmation',
          beneficiu_3: 'Free sign-up for companies and sole traders',
          buton: 'Become a partner',
          sub_buton: 'Free · account in 60 seconds',
        },
      },
    },
    {
      cale: '/parteneri/servicii', fisier: 'cum-devii-furnizor-servicii', tip: 'categorie', categorie: 'servicii', partenerTip: 'services',
      implicit: {
        ro: {
          eticheta: 'Parteneri de servicii',
          titlu: 'Meseriaș? Primește comenzi în zona ta.',
          subtitlu: 'Clienții comandă și plătesc în platformă. Tu vezi suma ta înainte să accepți.',
          beneficiu_1: 'Comenzi alocate automat în orașul tău',
          beneficiu_2: 'Plata e păstrată ca garanție până termini lucrarea',
          beneficiu_3: '100% din manoperă rămâne la tine',
          buton: 'Devino partener',
          sub_buton: 'Gratuit · contul în 60 de secunde · firma o adaugi după',
        },
        en: {
          eticheta: 'Service partners',
          titlu: 'Tradesperson? Get jobs in your area.',
          subtitlu: 'Clients order and pay on the platform. You see your amount before you accept.',
          beneficiu_1: 'Jobs assigned automatically in your city',
          beneficiu_2: 'Payment held as a guarantee until the job is done',
          beneficiu_3: '100% of the labour stays with you',
          buton: 'Become a partner',
          sub_buton: 'Free · account in 60 seconds · add your company later',
        },
      },
      pasi: {
        ro: ['Primești comanda și vezi suma ta', 'Accepți, mergi la client, faci lucrarea', 'Clientul confirmă, tu încasezi'],
        en: ['You get the job and see your amount', 'You accept, visit the client, do the work', 'The client confirms, you get paid'],
      },
    },
    {
      cale: '/parteneri/materiale', fisier: 'cum-devii-furnizor-materiale', tip: 'categorie', categorie: 'materiale', partenerTip: 'materials',
      implicit: {
        ro: {
          eticheta: 'Furnizori de materiale',
          titlu: 'Vinzi materiale? Primește comenzi prin platformă.',
          subtitlu: 'Clienții comandă materialele odată cu lucrarea și plătesc în platformă. Tu pregătești marfa, curierul o ridică.',
          beneficiu_1: 'Clienți care comandă odată cu serviciul',
          beneficiu_2: 'Produsele tale, recomandate la servicii',
          beneficiu_3: 'Livrarea o fac Curierii de Cartier',
          buton: 'Devino partener',
          sub_buton: 'Gratuit · contul în 60 de secunde · firma o adaugi după',
        },
        en: {
          eticheta: 'Materials suppliers',
          titlu: 'Selling materials? Get orders through the platform.',
          subtitlu: 'Clients order materials together with the job and pay on the platform. You prepare the goods, the courier collects them.',
          beneficiu_1: 'Clients who order together with the service',
          beneficiu_2: 'Your products, recommended with services',
          beneficiu_3: 'Delivery by Neighbourhood Couriers',
          buton: 'Become a partner',
          sub_buton: 'Free · account in 60 seconds · add your company later',
        },
      },
      pasi: {
        ro: ['Listezi produsele din dashboard', 'Primești comanda și pregătești marfa', 'Curierul livrează, tu încasezi'],
        en: ['You list your products from the dashboard', 'You get the order and prepare the goods', 'The courier delivers, you get paid'],
      },
    },
    {
      cale: '/parteneri/inchirieri', fisier: 'cum-devii-operator-inchirieri', tip: 'categorie', categorie: 'inchirieri', partenerTip: 'rentals',
      implicit: {
        ro: {
          eticheta: 'Parteneri de închirieri',
          titlu: 'Ai utilaje? Închiriază-le prin platformă.',
          subtitlu: 'Clienții rezervă și plătesc în platformă. Tu stabilești prețul pe zi, săptămână sau lună și condițiile.',
          beneficiu_1: 'Utilajele tale lucrează și între proiecte',
          beneficiu_2: 'Fotografii la predare și la returnare',
          beneficiu_3: 'Plata e păstrată ca garanție până la retur',
          buton: 'Devino partener',
          sub_buton: 'Gratuit · contul în 60 de secunde · firma o adaugi după',
        },
        en: {
          eticheta: 'Rental partners',
          titlu: 'Own equipment? Rent it out through the platform.',
          subtitlu: 'Clients book and pay on the platform. You set the price per day, week or month and your conditions.',
          beneficiu_1: 'Your equipment earns between your projects',
          beneficiu_2: 'Photos at handover and at return',
          beneficiu_3: 'Payment held as a guarantee until return',
          buton: 'Become a partner',
          sub_buton: 'Free · account in 60 seconds · add your company later',
        },
      },
      pasi: {
        ro: ['Listezi echipamentele și prețurile', 'Clientul rezervă, tu predai echipamentul', 'La retur se eliberează plata'],
        en: ['You list your equipment and prices', 'The client books, you hand over the equipment', 'At return, the payment is released'],
      },
    },
    {
      cale: '/parteneri/curieri', fisier: 'cum-devii-curier-de-cartier', tip: 'categorie', categorie: 'curier', partenerTip: 'courier',
      implicit: {
        ro: {
          eticheta: 'Curieri de cartier',
          titlu: 'Ai vehicul? Livrează în cartierul tău.',
          subtitlu: 'Livrezi materiale și produse din platformă clienților din zona ta, când ai timp.',
          beneficiu_1: 'Program flexibil: tu alegi când lucrezi',
          beneficiu_2: 'Livrări în zona pe care o alegi tu',
          beneficiu_3: 'Tariful de transport îți revine 100%',
          buton: 'Devino partener',
          sub_buton: 'Gratuit · contul în 60 de secunde · firma o adaugi după',
        },
        en: {
          eticheta: 'Neighbourhood couriers',
          titlu: 'Have a vehicle? Deliver in your neighbourhood.',
          subtitlu: 'You deliver materials and products from the platform to clients in your area, when you have time.',
          beneficiu_1: 'Flexible hours: you choose when you work',
          beneficiu_2: 'Deliveries in the area you choose',
          beneficiu_3: '100% of the delivery fee is yours',
          buton: 'Become a partner',
          sub_buton: 'Free · account in 60 seconds · add your company later',
        },
      },
      pasi: {
        ro: ['Îți activezi disponibilitatea', 'Primești livrarea și ridici marfa', 'Clientul confirmă, tu încasezi'],
        en: ['You switch on your availability', 'You get the delivery and collect the goods', 'The client confirms, you get paid'],
      },
    },
    {
      cale: '/parteneri/asigurari', fisier: 'ghidul-asiguratorului', tip: 'categorie', categorie: 'asigurari', partenerTip: 'insurance',
      implicit: {
        ro: {
          eticheta: 'Parteneri de asigurări',
          titlu: 'Asigurător? Primește cereri de poliță.',
          subtitlu: 'Fiecare comandă din platformă poate genera o cerere de poliță. O emite asigurătorul care o acceptă.',
          beneficiu_1: 'Cereri de poliță din comenzile platformei',
          beneficiu_2: 'Tu stabilești polițele, valorile și condițiile',
          beneficiu_3: 'Dosarul de daună, deja în platformă',
          buton: 'Devino partener',
          sub_buton: 'Gratuit · contul în 60 de secunde · firma o adaugi după',
        },
        en: {
          eticheta: 'Insurance partners',
          titlu: 'Insurer? Receive policy requests.',
          subtitlu: 'Every order on the platform can generate a policy request. The insurer who accepts it issues the policy.',
          beneficiu_1: 'Policy requests from platform orders',
          beneficiu_2: 'You set the policies, values and conditions',
          beneficiu_3: 'The claim file, already on the platform',
          buton: 'Become a partner',
          sub_buton: 'Free · account in 60 seconds · add your company later',
        },
      },
      pasi: {
        ro: ['Îți creezi contul și trimiți licențele', 'Configurezi polițele și condițiile', 'Primești cererile și emiți polița'],
        en: ['You create your account and send your licences', 'You set up your policies and conditions', 'You get the requests and issue the policy'],
      },
    },
    {
      cale: '/investitori', fisier: 'mydarrin-investitori', tip: 'investitori', categorie: null, partenerTip: null,
      implicit: {
        ro: {
          eticheta: 'Investitori',
          titlu: 'Investește în My Darrin',
          subtitlu: 'Platforma care leagă clienții de parteneri verificați pentru servicii, materiale, închirieri și livrări, cu plata păstrată ca garanție.',
          beneficiu_1: 'Contul fără date de identitate: email și parolă',
          beneficiu_2: 'Pitch deck-ul și runda curentă, în panoul tău',
          beneficiu_3: 'Identificarea (KYC) doar când alegi să investești',
          buton: 'Creează cont de investitor',
          sub_buton: 'Investițiile implică riscuri, inclusiv pierderea capitalului.',
        },
        en: {
          eticheta: 'Investors',
          titlu: 'Invest in My Darrin',
          subtitlu: 'The platform that connects clients with verified partners for services, materials, rentals and deliveries, with payment held as a guarantee.',
          beneficiu_1: 'No identity data for the account: email and password',
          beneficiu_2: 'The pitch deck and the current round, in your dashboard',
          beneficiu_3: 'Identity check (KYC) only when you choose to invest',
          buton: 'Create investor account',
          sub_buton: 'Investments involve risks, including loss of capital.',
        },
      },
      pasi: {
        ro: ['Îți faci contul și intri în panoul tău', 'Citești pitch deck-ul și detaliile rundei', 'Apeși „Investește”, apoi completezi identificarea'],
        en: ['You create your account and open your dashboard', 'You read the pitch deck and the round details', 'You press “Invest”, then complete the identity check'],
      },
    },
  ];

  // Cardurile celor 5 categorii, pe /parteneri (macheta L1.3).
  var CATEGORII = [
    { cale: '/parteneri/servicii', categorie: 'servicii', ico: 'servicii',
      ro: ['Parteneri de servicii', 'Lucrări la clienți, 100% din manoperă'], en: ['Service partners', 'Jobs for clients, 100% of the labour'] },
    { cale: '/parteneri/materiale', categorie: 'materiale', ico: 'materiale',
      ro: ['Furnizori de materiale', 'Vinzi materiale prin comenzile platformei'], en: ['Materials suppliers', 'Sell materials through platform orders'] },
    { cale: '/parteneri/inchirieri', categorie: 'inchirieri', ico: 'inchirieri',
      ro: ['Parteneri de închirieri', 'Închiriezi echipamente pe zi, săptămână sau lună'], en: ['Rental partners', 'Rent out equipment by the day, week or month'] },
    { cale: '/parteneri/curieri', categorie: 'curier', ico: 'curier',
      ro: ['Curieri de cartier', 'Livrezi în zona ta, cu vehiculul tău'], en: ['Neighbourhood couriers', 'Deliver in your area, with your vehicle'] },
    { cale: '/parteneri/asigurari', categorie: 'asigurari', ico: 'asigurari',
      ro: ['Parteneri de asigurări', 'Polițe pentru lucrările din platformă'], en: ['Insurance partners', 'Policies for the jobs on the platform'] },
  ];

  var PE_CALE = {};
  PAGINI.forEach(function (p) { PE_CALE[p.cale] = p; });

  function pagina(cale) { return PE_CALE[String(cale || '')] || null; }
  function esteCunoscuta(cale) { return !!pagina(cale); }

  // Numele variantei: utm_campaign, cu litere mici; doar a-z 0-9 . _ - (max. 60).
  var RE_VARIANTA = /^[a-z0-9][a-z0-9._-]{0,59}$/;
  function numeVarianta(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return RE_VARIANTA.test(s) ? s : null;
  }
  // utm_campaign din adresă → numele variantei (null = implicita).
  function variantaDinCampanie(v) {
    var n = numeVarianta(v);
    return n && n !== IMPLICITA ? n : null;
  }
  // profesie din linkul pentru reclamă: slug (ca în /api/public/profesii).
  var RE_PROFESIE = /^[a-z0-9][a-z0-9-]{0,59}$/;
  function profesieValida(v) { return v == null || v === '' || RE_PROFESIE.test(String(v)); }

  function lungime(s) { return Array.from(String(s == null ? '' : s)).length; }
  function curat(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // Erorile unei limbi: [{ camp, ro, en }]. opt.publicare = câmpurile obligatorii completate.
  function valideazaLimba(c, limba, opt) {
    opt = opt || {};
    var erori = [];
    var L = String(limba || '').toUpperCase();
    c = c || {};
    CAMPURI.forEach(function (f) {
      var v = curat(c[f.cheie]);
      if (lungime(v) > f.max) {
        erori.push({ camp: limba + '.' + f.cheie, ro: f.eticheta + ' (' + L + ') are ' + lungime(v) + ' de caractere; maximum ' + f.max + '. Scurtați textul.',
          en: f.eticheta + ' (' + L + ') has ' + lungime(v) + ' characters; the maximum is ' + f.max + '. Shorten the text.' });
      } else if (opt.publicare && f.obligatoriu && !v) {
        erori.push({ camp: limba + '.' + f.cheie, ro: f.eticheta + ' (' + L + ') lipsește. Completați-l înainte de publicare.',
          en: f.eticheta + ' (' + L + ') is missing. Fill it in before publishing.' });
      }
    });
    if (opt.publicare && c.imagine_url && !curat(c.imagine_alt)) {
      erori.push({ camp: limba + '.imagine_alt', ro: 'Textul alternativ al imaginii (' + L + ') lipsește. Descrieți imaginea în câteva cuvinte.',
        en: 'The image alt text (' + L + ') is missing. Describe the image in a few words.' });
    }
    return erori;
  }
  function textePublicabile(c) { return valideazaLimba(c, 'ro', { publicare: true }).length === 0; }

  // Linkul pentru reclamă (relativ): /parteneri/servicii?utm_campaign=…&profesie=…
  function linkReclama(cale, varianta, profesie) {
    var p = [];
    if (varianta && varianta !== IMPLICITA) p.push('utm_campaign=' + encodeURIComponent(varianta));
    if (profesie) p.push('profesie=' + encodeURIComponent(profesie));
    return cale + (p.length ? '?' + p.join('&') : '');
  }

  // Parametrii transmiși de la pagina de destinație spre înscriere (pasul 12-L1).
  var PARAMETRI_TRANSMISI = ['profesie', 'lang', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  // Destinația butonului principal (fără parametrii adresei; aceia se adaugă în pagină).
  function destinatie(p) {
    if (!p) return '/parteneri/inscriere';
    if (p.tip === 'investitori') return '/investitori?ruta=investitor';
    return '/parteneri/inscriere' + (p.categorie ? '?categorie=' + p.categorie : '');
  }

  return {
    LIMBI: LIMBI, IMPLICITA: IMPLICITA, CAMPURI: CAMPURI, CAMPURI_TEXT: CAMPURI_TEXT, MAXIM: MAXIM, IMAGINE: IMAGINE,
    PAGINI: PAGINI, CATEGORII: CATEGORII, PARAMETRI_TRANSMISI: PARAMETRI_TRANSMISI,
    pagina: pagina, esteCunoscuta: esteCunoscuta, numeVarianta: numeVarianta, variantaDinCampanie: variantaDinCampanie,
    profesieValida: profesieValida, valideazaLimba: valideazaLimba, textePublicabile: textePublicabile, lungime: lungime, curat: curat,
    linkReclama: linkReclama, destinatie: destinatie,
  };
});

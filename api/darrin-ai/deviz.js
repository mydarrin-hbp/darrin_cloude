// api/darrin-ai/deviz.js
// Darrin AI — motor public de deviz (Varianta 1: Evaluare Instantă Servicii,
// Varianta 2 redusă: punct de intrare "Deviz Sumar" pentru proiecte).
//
// Pasul 12-D1 (18 nov. 2026, regula LM din 17 nov.): Darrin AI interpretează
// și propune DOAR din datele My Darrin. Modelul Claude primește lista
// categoriilor reale (`categorii`) și lista serviciilor publicate din catalog
// (`catalog_servicii`, stare = 'publicat', status_public = true) și poate
// alege doar din ele (tool use cu enum): o categorie și 1–3 servicii, plus
// încrederea și o explicație scurtă. Nu mai cere și nu mai primește nicio
// sumă: vechiul câmp cost_brut_estimat_lei („prețuri tipice de piață”) a fost
// scos complet (schema tool-ului, răspuns, stocare, pagini).
//
// Serverul verifică tot ce vine de la model: ID-urile trebuie să existe și să
// fie publicate (celelalte se resping); o explicație cu sume de bani (lei, RON,
// EUR, cifre urmate de monedă) se înlocuiește cu un text fix RO / EN. La
// încredere mică sau fără niciun serviciu valid, răspunsul recomandă
// „Consultanță Darrin” (dacă serviciul e publicat).
//
// Prețul: niciodată de la model. Pentru fiecare serviciu propus, serverul
// calculează prețul „de la” al primului nivel (Bronze → Silver → Gold →
// Platinum) pentru țara clientului, cu lib/pret-serviciu.js (rețetă sau
// catalog_preturi, apoi formula publică din lib/calculeaza-pret.js). Dacă nu
// se poate calcula, pret_de_la = null și pagina scrie „Vezi prețul pe pagina
// serviciului”.
//
// Funcționează și pentru vizitatori neautentificați (estimarea e liber
// accesibilă) — de-aia nu folosește requireAuth, doar getAuthenticatedUser
// opțional, ca să lege cererea de un cont dacă unul e logat.
//
// Fișierele (imagini/PDF) vin ca base64 direct în body-ul JSON, nu ca path
// pre-încărcat în Storage: Claude oricum are nevoie de conținutul base64 ca
// să "vadă" imaginea, iar un upload direct din client ar necesita o policy
// RLS de scriere anonimă pe bucket (suprafață de atac inutilă pentru fișiere
// citite o singură dată de AI). Serverul (service_role) urcă o copie în
// bucket-ul privat `deviz-ai-uploads` doar pentru audit trail, după apel.
//
// LIMITĂ IMPORTANTĂ: Vercel Serverless Functions au o limită hard de request
// body de 4.5MB — encodarea base64 umflă dimensiunea reală cu ~33%. De-aia
// totalul decodat al fișierelor e de cel mult 3MB (≈ 4MB în base64).
//
// Pasul 12-D2 (18 nov. 2026):
// - pozele: cel mult 5 fișiere (poze sau PDF); pagina micșorează pozele
//   înainte de trimitere (darrin-ai-fisiere.js), serverul verifică totalul
//   (≤ 3MB decodat), PDF ≤ 2MB, tipurile JPEG / PNG / WebP / PDF (fără HEIC)
//   și șterge metadatele (EXIF, GPS, XMP, IPTC) cu lib/sterge-metadate-imagine.js;
//   imaginea curățată e cea trimisă modelului și cea salvată în Storage;
// - rutele răspunsului: modelul spune și `relevanta` (potrivit / neclar /
//   fara_legatura) și, la `neclar`, o întrebare de clarificare. Serverul aplică
//   regulile: fără legătură → fără servicii, fără consultanță, explicație fixă;
//   neclar → întrebarea și cel mult 3 servicii posibile, consultanța abia la a
//   doua încercare (`incercare: 2`) tot neclară; potrivit → ca înainte;
// - limita de cereri: 10 / 10 min pe IP pentru vizitatori, 20 pe cont pentru
//   conturile autentificate, 60 pentru superadmin (rol citit din profiles.roles).

const { getAuthenticatedUser, hasRole } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const crypto = require('crypto');
const v = require('../../lib/valideaza');
const { limiteazaCererea } = require('../../lib/rate-limit');
const { trimiteEroare } = require('../../lib/raspuns-eroare');
const { citesteTot } = require('../../lib/citeste-tot');
const { calculeazaPretServiciu } = require('../../lib/pret-serviciu');
const { stergeMetadateImagine } = require('../../lib/sterge-metadate-imagine');

const ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_TEXT_LEN = 4000;
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024; // 3MB decodat, toate fișierele — vezi nota de limită de mai sus
const MAX_PDF_BYTES = 2 * 1024 * 1024; // un PDF nu se micșorează
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
// Limita de cereri (pasul 12-D2): vizitator pe IP, cont autentificat, superadmin.
const LIMITE_CERERI = { vizitator: 10, cont: 20, superadmin: 60 };
const FEREASTRA_CERERI = 600;
// Mesajul 429 al lui Darrin AI: în câte minute se poate încerca din nou (cu „tu”).
function mesajLimita(minute) {
  return {
    ro: `Ai trimis multe cereri la Darrin AI într-un timp scurt. Poți încerca din nou peste ${minute} ${minute === 1 ? 'minut' : 'minute'}.`,
    en: `You sent many requests to Darrin AI in a short time. You can try again in ${minute} ${minute === 1 ? 'minute' : 'minutes'}.`,
  };
}
// Rutele răspunsului (pasul 12-D2).
const RELEVANTE = ['potrivit', 'neclar', 'fara_legatura'];
const MAX_INTREBARE = 200;
const MODURI = new Set(['servicii', 'proiect']);
const LIMBI = ['ro', 'en'];

// Pasul 12-D1: câte servicii poate propune modelul și pragul de încredere sub
// care se recomandă consultanța (același prag ca în paginile de dinainte).
const MAX_SERVICII = 3;
const PRAG_INCREDERE = 0.5;
const MAX_EXPLICATIE = 600;
// Serviciul de consultanță din catalog, recomandat când nimic nu se potrivește.
const ID_CONSULTANTA = 'consultanta-darrin';
// Ordinea nivelurilor: „primul nivel” e cel mai de jos dintre cele existente.
const ORDINE_NIVELURI = ['Bronze', 'Silver', 'Gold', 'Platinum'];

// Explicația pusă de server: când modelul scrie totuși sume de bani sau când
// niciun serviciu propus nu e valid.
const EXPLICATIE_FIXA = {
  ro: 'Am ales din catalogul My Darrin serviciile care se potrivesc cel mai bine cu descrierea ta. Prețul fiecărui serviciu îl vezi pe pagina lui.',
  en: 'We picked the services from the My Darrin catalogue that best match your description. You can see the price of each service on its page.',
};
// Pasul 12-D2: răspunsul pentru ce nu are legătură cu serviciile My Darrin
// (nu repetăm conținutul documentului clientului).
const EXPLICATIE_FARA_LEGATURA = {
  ro: 'Nu am găsit în ce ai trimis o lucrare pe care o face My Darrin. Descrie problema în câteva cuvinte sau trimite o poză cu ea.',
  en: 'We couldn\'t find a job My Darrin does in what you sent. Describe the problem in a few words or send a photo of it.',
};
// Întrebarea pusă de server când modelul spune „neclar” fără o întrebare folosibilă.
const INTREBARE_IMPLICITA = {
  ro: 'Poți descrie mai exact ce se întâmplă și unde? De exemplu: ce nu funcționează, de când și ce ai observat.',
  en: 'Can you describe more exactly what is happening and where? For example: what isn\'t working, since when and what you noticed.',
};
const EXPLICATIE_LIPSA = {
  ro: 'Nu am găsit în catalogul My Darrin un serviciu care să se potrivească sigur cu descrierea ta. Îți recomandăm Consultanța Darrin.',
  en: 'We could not find a service in the My Darrin catalogue that clearly matches your description. We recommend a Darrin Consultancy.',
};

// Pasul 11-S1: câmpurile acceptate; orice alt câmp e refuzat. Regulile de
// conținut (ce e obligatoriu pentru fiecare mod, mărimea fișierelor) rămân mai jos.
const SCHEMA = {
  mod: v.dinLista([...MODURI], { implicit: 'servicii', eticheta: ['Tipul estimării', 'Estimate type'] }),
  text: v.text({ max: MAX_TEXT_LEN, eticheta: ['Descriere', 'Description'] }),
  files: v.lista(v.obiect({
    mime: v.dinLista([...ALLOWED_MIME], { obligatoriu: true, eticheta: ['Tipul fișierului', 'File type'] }),
    data_base64: v.text({ obligatoriu: true, max: Math.ceil(MAX_TOTAL_BYTES * 4 / 3) + 4, faraTrim: true, eticheta: ['Conținutul fișierului', 'File content'] }),
  }, { eticheta: ['Fișier', 'File'] }), { max: MAX_FILES, eticheta: ['Fișiere', 'Files'] }),
  // Pasul 12-D2: a câta încercare din aceeași conversație (1 sau 2): la a doua,
  // clientul răspunde la întrebarea de clarificare.
  incercare: v.numar({ min: 1, max: 2, intreg: true, eticheta: ['Încercarea', 'Attempt'] }),
  tip_constructie: v.text({ max: 200, eticheta: ['Tip construcție', 'Construction type'] }),
  suprafata_mp: v.numar({ min: 0, max: 1000000, eticheta: ['Suprafață (m²)', 'Area (m²)'] }),
  locatie: v.text({ max: 200, eticheta: ['Locație', 'Location'] }),
  // Pasul 12-D1: limba explicației și țara pentru prețul „de la”.
  lang: v.dinLista(LIMBI, { implicit: 'en', eticheta: ['Limba', 'Language'] }),
  tara: v.text({ max: 2, eticheta: ['Țara', 'Country'] }),
};

// Sume de bani: cifre urmate de monedă („250 lei”, „1.200 de RON”, „90€”) sau
// moneda înaintea cifrelor („RON 300”, „€ 90”, „$40”).
const MONEDE = '(?:lei|leu|ron|eur|euro|euros|€|\\$|usd|gbp|£|bgn|mdl)';
const RE_SUMA = new RegExp(
  `\\d[\\d.,\\s]*\\s*(?:de\\s+|of\\s+)?${MONEDE}(?![a-zăâîșț])|(?<![a-zăâîșț])${MONEDE}\\s*\\d`,
  'i'
);
function continutSume(text) {
  return RE_SUMA.test(String(text || ''));
}

function base64Bytes(b64) {
  // lungime base64 → octeți decodați, fără să decodăm efectiv (evită alocare inutilă)
  const padding = (b64.match(/=+$/) || [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

async function incarcaSluguriServicii() {
  const { data, error } = await supabaseAdmin
    .from('categorii')
    .select('slug, title')
    .eq('category_type', 'servicii')
    .order('display_order', { ascending: true });
  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error(`nu am putut încărca categoriile reale din DB: ${error?.message || 'listă goală'}`);
  }
  return data;
}

// Serviciile publicate din catalog: singurele pe care modelul le poate propune.
async function incarcaServiciiPublicate() {
  const { data, error } = await citesteTot(() => supabaseAdmin
    .from('catalog_servicii')
    .select('id, id_serviciu, titlu, traduceri, unitate_masura')
    .eq('categorie', 'servicii')
    .eq('stare', 'publicat')
    .eq('status_public', true)
    .order('titlu')
    .order('id'));
  if (error) throw new Error(`nu am putut încărca serviciile publicate: ${error.message}`);
  const lista = (data || []).filter((s) => s.id_serviciu);
  if (!lista.length) throw new Error('nu există servicii publicate în catalog');
  return lista;
}

function titluServiciu(s) {
  const en = s.traduceri && s.traduceri.en && s.traduceri.en.titlu;
  return { ro: s.titlu, en: en || s.titlu };
}

function construiestePrompt(mod, { text, tipConstructie, suprafataMp, locatie, lang, servicii, sluguri, areConsultanta, incercare = 1 }) {
  const linii = [
    'Ești Darrin AI, asistentul platformei My Darrin (servicii pentru locuință și construcții).',
    'Rolul tău: interpretezi nevoia clientului și alegi DOAR din datele My Darrin de mai jos — o categorie din lista CATEGORII și 1–3 servicii din lista SERVICII, prin ID-ul lor exact.',
    'Reguli obligatorii:',
    '- Alegi numai ID-uri din listele primite. Nu inventezi servicii, soluții tehnice sau surse externe.',
    '- Nu scrii prețuri, sume de bani, costuri, tarife, durate sau termene — nici estimative. Prețul îl calculează exclusiv platforma, pe pagina serviciului.',
    '- Spui cât de relevantă e cererea (câmpul relevanta):',
    '  • „potrivit” — e o lucrare din catalog și descrierea ajunge ca să alegi serviciile;',
    '  • „neclar” — pare o lucrare din catalog, dar descrierea nu ajunge (de exemplu un singur cuvânt, ca „calorifer”): pui o singură întrebare de clarificare (câmpul intrebare, cel mult 200 de caractere, fără sume) și propui cel mult 3 servicii posibile;',
    '  • „fara_legatura” — textul sau fișierele nu au legătură cu serviciile My Darrin (de exemplu un document fiscal, o factură, o poză fără nicio lucrare): servicii_ids rămâne gol și nu repeți conținutul documentului.',
    '- Dacă e o lucrare din catalog, dar nimic din listă nu se potrivește sigur, dai o încredere mică (sub 0.5)' + (areConsultanta ? ` și propui serviciul „${ID_CONSULTANTA}” (Consultanță Darrin).` : '.'),
    '- Clientul poate trimite până la 5 poze sau PDF-uri. Descrii doar ce vezi legat de serviciile din listă; nu identifici persoane și nu comentezi alte lucruri din imagine (persoane, documente, obiecte personale, adrese).',
    `- Explicația are 1–3 propoziții, în limba ${lang === 'ro' ? 'română' : 'engleză'}: ce ai înțeles din descriere și de ce ai ales serviciile.`,
    ...(lang === 'ro' ? ['- În română te adresezi clientului cu „tu” (ca interfața My Darrin): „ai menționat”, „îți recomandăm”, niciodată „ați menționat” sau „dumneavoastră”.'] : []),
    ...(incercare === 2 ? ['- Aceasta e a doua încercare: textul conține descrierea de la început, întrebarea ta și răspunsul clientului. Dacă tot nu e clar, răspunzi „neclar” fără o nouă întrebare.'] : []),
    '',
    'CATEGORII (slug: titlu):',
    ...sluguri.map((c) => `- ${c.slug}: ${c.title}`),
    '',
    'SERVICII (ID: titlu RO / titlu EN):',
    ...servicii.map((s) => { const t = titluServiciu(s); return `- ${s.id_serviciu}: ${t.ro} / ${t.en}`; }),
    '',
  ];
  if (mod === 'proiect') {
    linii.push(
      'Clientul descrie un proiect de construcție/renovare la scară mai mare (nu o reparație punctuală).',
      `Tip construcție/proiect: ${tipConstructie || '(nespecificat)'}`,
      `Suprafață: ${suprafataMp ? `${suprafataMp} m²` : '(nespecificată)'}`,
      `Locație: ${locatie || '(nespecificată)'}`,
      text ? `Descriere suplimentară a clientului: ${text}` : '',
      'Dacă informația e insuficientă, reflectă asta printr-o încredere scăzută, nu printr-un refuz.'
    );
  } else {
    linii.push(
      'Clientul descrie o nevoie punctuală (reparație, instalație, finisaj) prin text și, opțional, imagini/PDF.',
      text ? `Descrierea clientului: ${text}` : 'Clientul nu a scris text — bazează-te doar pe fișierele atașate.'
    );
  }
  return linii.filter((l, i) => l !== '' || linii[i - 1] !== '').join('\n');
}

function construiesteTool(sluguri, servicii) {
  return {
    name: 'identifica_serviciu',
    description:
      'Alege din catalogul My Darrin categoria și 1–3 servicii publicate care se potrivesc nevoii clientului. Fără prețuri sau sume: prețul îl calculează platforma.',
    input_schema: {
      type: 'object',
      properties: {
        categorie_slug: {
          type: 'string',
          enum: sluguri.map((s) => s.slug),
          description: 'Slug-ul categoriei din lista CATEGORII care se potrivește cel mai bine.',
        },
        relevanta: {
          type: 'string',
          enum: RELEVANTE,
          description: 'potrivit = lucrare din catalog, descriere suficientă; neclar = lucrare din catalog, descriere insuficientă; fara_legatura = nu are legătură cu serviciile My Darrin.',
        },
        servicii_ids: {
          type: 'array',
          minItems: 0,
          maxItems: MAX_SERVICII,
          items: { type: 'string', enum: servicii.map((s) => s.id_serviciu) },
          description: 'ID-urile a 1–3 servicii din lista SERVICII, în ordinea potrivirii; gol la fara_legatura.',
        },
        intrebare: {
          type: 'string',
          maxLength: MAX_INTREBARE,
          description: 'Doar la neclar: o singură întrebare de clarificare pentru client, cel mult 200 de caractere, fără sume.',
        },
        incredere: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Cât de sigur ești de alegere, 0–1. Scade pentru input vag, ambiguu sau insuficient — nu inventa certitudine.',
        },
        explicatie: {
          type: 'string',
          description: 'Explicație scurtă (1–3 propoziții) pentru client: ce ai înțeles și de ce ai ales serviciile. Fără prețuri, sume, durate sau surse externe.',
        },
      },
      required: ['relevanta', 'categorie_slug', 'servicii_ids', 'incredere', 'explicatie'],
    },
  };
}

async function apeleazaAnthropic({ apiKey, promptSistem, contentBlocks, tool }) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: promptSistem,
      messages: [{ role: 'user', content: contentBlocks }],
      tools: [tool],
      tool_choice: { type: 'tool', name: 'identifica_serviciu' },
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic API a răspuns ${res.status}: ${json?.error?.message || 'eroare necunoscută'}`);
  }
  const toolUse = (json.content || []).find((b) => b.type === 'tool_use' && b.name === 'identifica_serviciu');
  if (!toolUse) {
    throw new Error('Anthropic API nu a returnat blocul tool_use așteptat');
  }
  return { input: toolUse.input || {}, raw: json };
}

// Verifică răspunsul modelului față de datele reale (funcție pură, testată
// direct în scripts/test-darrin-ai-date-proprii.js).
function valideazaRezultatAI(input, { sluguri, servicii, lang, incercare = 1 }) {
  const l = lang === 'ro' ? 'ro' : 'en';
  // Pasul 12-D2: fără câmpul relevanta (răspunsuri vechi) → „potrivit”, ca înainte.
  const relevanta = RELEVANTE.includes(input && input.relevanta) ? input.relevanta : 'potrivit';
  if (relevanta === 'fara_legatura') {
    return {
      relevanta, alese: [], respinse: [], categorie: null, incredere: 0,
      explicatie: EXPLICATIE_FARA_LEGATURA[l], explicatieInlocuita: true,
      intrebare: null, consultanta: null, recomandaConsultanta: false,
    };
  }
  const peId = new Map(servicii.map((s) => [s.id_serviciu, s]));
  const cerute = Array.isArray(input && input.servicii_ids) ? input.servicii_ids : [];
  const alese = [];
  const respinse = [];
  for (const id of cerute) {
    const s = typeof id === 'string' ? peId.get(id) : null;
    if (!s) { respinse.push(String(id).slice(0, 80)); continue; }
    if (!alese.includes(s) && alese.length < MAX_SERVICII) alese.push(s);
  }

  const categorie = sluguri.find((c) => c.slug === (input && input.categorie_slug)) || null;
  let incredere = Number(input && input.incredere);
  if (!Number.isFinite(incredere)) incredere = 0;
  incredere = Math.min(1, Math.max(0, incredere));
  if (!alese.length) incredere = 0;

  let explicatie = typeof (input && input.explicatie) === 'string' ? input.explicatie.trim().slice(0, MAX_EXPLICATIE) : '';
  let explicatieInlocuita = false;
  if (!alese.length) {
    explicatie = EXPLICATIE_LIPSA[l];
    explicatieInlocuita = true;
  } else if (!explicatie || continutSume(explicatie)) {
    explicatie = EXPLICATIE_FIXA[l];
    explicatieInlocuita = true;
  }

  const consultanta = peId.get(ID_CONSULTANTA) || null;
  if (relevanta === 'neclar') {
    // Prima încercare: întrebarea, fără consultanță. A doua, tot neclară: consultanța.
    let intrebare = null;
    let recomandaConsultanta = false;
    if (incercare >= 2) {
      recomandaConsultanta = true;
    } else {
      intrebare = typeof (input && input.intrebare) === 'string' ? input.intrebare.trim() : '';
      if (!intrebare || intrebare.length > MAX_INTREBARE || continutSume(intrebare)) intrebare = INTREBARE_IMPLICITA[l];
      // Fără servicii posibile, explicația „recomandăm consultanța” nu se potrivește aici.
      if (!alese.length) explicatie = '';
    }
    // Consultanța nu apare printre serviciile posibile la prima încercare.
    const posibile = recomandaConsultanta ? alese : alese.filter((s) => s.id_serviciu !== ID_CONSULTANTA);
    return { relevanta, alese: posibile, respinse, categorie, incredere, explicatie, explicatieInlocuita, intrebare, consultanta, recomandaConsultanta };
  }
  const recomandaConsultanta = incredere < PRAG_INCREDERE;
  return { relevanta, alese, respinse, categorie, incredere, explicatie, explicatieInlocuita, intrebare: null, consultanta, recomandaConsultanta };
}

// Prețul „de la” al primului nivel, pentru țară; null dacă nu se poate calcula.
async function pretDeLa(serviciuId, tara) {
  try {
    const { data: niveluri } = await supabaseAdmin
      .from('catalog_niveluri').select('id, nivel').eq('serviciu_id', serviciuId);
    const rang = (n) => { const i = ORDINE_NIVELURI.indexOf(n); return i < 0 ? 99 : i; };
    const lista = (niveluri || []).slice().sort((a, b) => rang(a.nivel) - rang(b.nivel));
    if (!lista.length) return null;
    const r = await calculeazaPretServiciu({ nivelId: lista[0].id, cantitate: 1, taraCod: tara });
    if (!r || !r.ok || !(r.calc && r.calc.pret_final > 0)) return null;
    return { pret: r.calc.pret_final, nivel: lista[0].nivel };
  } catch (e) {
    console.warn('[darrin-ai/deviz] prețul „de la” nu s-a putut calcula:', e.code || e.message);
    return null;
  }
}

async function monedaTara(tara) {
  try {
    const { data } = await supabaseAdmin.from('tax_configurations').select('moneda').eq('tara_cod', tara).maybeSingle();
    return (data && data.moneda) || null;
  } catch (e) { return null; }
}

async function formaServiciu(s, tara, moneda) {
  const pret = await pretDeLa(s.id, tara);
  return {
    id: s.id,
    id_serviciu: s.id_serviciu,
    titlu: titluServiciu(s),
    unitate_masura: s.unitate_masura || null,
    // Pasul 12-U1: adresa curată a serviciului.
    url: `/servicii/${encodeURIComponent(s.id_serviciu)}`,
    pret_de_la: pret ? pret.pret : null,
    nivel: pret ? pret.nivel : null,
    moneda: pret ? (moneda || 'RON') : null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[darrin-ai/deviz] cheia Anthropic lipsește din mediu');
    return trimiteEroare(res, 500, 'INDISPONIBIL', 'Serviciul Darrin AI nu este configurat încă. Contactează suportul.', 'The Darrin AI service is not set up yet. Please contact support.');
  }

  const date = v.valideazaSauTrimite(req, res, SCHEMA);
  if (!date) return;
  const { mod = 'servicii', text, files, tip_constructie, suprafata_mp, locatie } = date;
  const incercare = date.incercare === 2 ? 2 : 1;
  const lang = date.lang === 'ro' ? 'ro' : 'en';
  const taraCeruta = String(date.tara || '').trim().toUpperCase();
  const tara = /^[A-Z]{2}$/.test(taraCeruta) ? taraCeruta : 'RO';

  // Contul (opțional): leagă cererea de cont și alege limita de cereri.
  let user = null;
  try {
    user = await getAuthenticatedUser(req);
  } catch (e) {
    // vizitator anonim — nu e o eroare, doar continuăm fără user
  }

  // Pasul 11-S1 / 12-D2: fiecare cerere apelează un model AI plătit — cel mult
  // 10 cereri în 10 minute pe IP pentru vizitatori, 20 pe cont pentru un cont
  // autentificat și 60 pentru superadmin (rolul verificat din profiles.roles).
  let limita = LIMITE_CERERI.vizitator;
  if (user && user.id) limita = (await hasRole(user, ['superadmin'])) ? LIMITE_CERERI.superadmin : LIMITE_CERERI.cont;
  if (!(await limiteazaCererea(req, res, { key: 'darrin-ai-deviz', limit: limita, windowSeconds: FEREASTRA_CERERI, cont: user && user.id ? user.id : undefined, mesaj: mesajLimita }))) return;

  if (!MODURI.has(mod)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `mod invalid. Valori acceptate: ${[...MODURI].join(', ')}`, `Invalid mode. Accepted values: ${[...MODURI].join(', ')}`, ['mod']);
  }
  if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT_LEN)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', `text trebuie să fie string, max ${MAX_TEXT_LEN} caractere`, `text must be a string of at most ${MAX_TEXT_LEN} characters.`, ['text']);
  }
  if (files !== undefined) {
    if (!Array.isArray(files) || files.length > MAX_FILES) {
      return trimiteEroare(res, 400, 'DATE_INVALIDE', `files trebuie să fie un array de max ${MAX_FILES} elemente`, `files must be an array of at most ${MAX_FILES} items.`, ['files']);
    }
    for (const f of files) {
      if (!f || typeof f.mime !== 'string' || typeof f.data_base64 !== 'string') {
        return trimiteEroare(res, 400, 'DATE_INVALIDE', 'fiecare fișier necesită { mime, data_base64 }', 'Each file needs { mime, data_base64 }.', ['files']);
      }
      if (!ALLOWED_MIME.has(f.mime)) {
        return trimiteEroare(res, 400, 'TIP_FISIER', `mime tip nepermis: ${f.mime}. Acceptate: ${[...ALLOWED_MIME].join(', ')}`, `File type not allowed: ${f.mime}. Accepted: ${[...ALLOWED_MIME].join(', ')}`, ['files']);
      }
      if (f.mime === 'application/pdf' && base64Bytes(f.data_base64) > MAX_PDF_BYTES) {
        return trimiteEroare(res, 400, 'PDF_PREA_MARE', 'Un PDF poate avea cel mult 2 MB. Alege un PDF mai mic sau trimite o poză a paginii.', 'A PDF can be at most 2 MB. Choose a smaller PDF or send a photo of the page.', ['files']);
      }
    }
    const total = files.reduce((n, f) => n + base64Bytes(f.data_base64), 0);
    if (total > MAX_TOTAL_BYTES) {
      return trimiteEroare(res, 400, 'FISIERE_PREA_MARI', 'Fișierele atașate au împreună mai mult de 3 MB. Scoate un fișier sau alege unul mai mic.', 'The attached files add up to more than 3 MB. Remove a file or choose a smaller one.', ['files']);
    }
  }

  // Pasul 12-D2: metadatele (EXIF, GPS, XMP, IPTC) se șterg pe server; imaginea
  // curățată e cea trimisă modelului și cea salvată în Storage.
  const fisiere = [];
  for (const f of files || []) {
    const buffer = Buffer.from(f.data_base64, 'base64');
    if (f.mime === 'application/pdf') {
      if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        return trimiteEroare(res, 400, 'FISIER_INVALID', 'Un fișier nu e un PDF valid. Alege alt fișier.', 'One of the files is not a valid PDF. Choose another file.', ['files']);
      }
      fisiere.push({ mime: f.mime, buffer, data_base64: f.data_base64 });
      continue;
    }
    const curat = stergeMetadateImagine(buffer, f.mime);
    if (!curat.ok) {
      return trimiteEroare(res, 400, 'FISIER_INVALID', 'Nu putem citi una dintre poze. Fă poza direct din cameră sau alege una JPG / PNG.', 'We can\'t read one of the photos. Take it with the camera or choose a JPG / PNG.', ['files']);
    }
    fisiere.push({ mime: f.mime, buffer: curat.buffer, data_base64: curat.buffer.toString('base64') });
  }

  if (mod === 'servicii' && !text && (!files || files.length === 0)) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'text sau files (cel puțin unul) este obligatoriu pentru mod=servicii', 'Send a text or at least one file for mod=servicii.');
  }
  if (mod === 'proiect' && !tip_constructie && !text) {
    return trimiteEroare(res, 400, 'CAMP_OBLIGATORIU', 'tip_constructie sau text este obligatoriu pentru mod=proiect', 'tip_constructie or text is required for mod=proiect.');
  }
  if (suprafata_mp !== undefined && (typeof suprafata_mp !== 'number' || suprafata_mp < 0 || suprafata_mp > 1_000_000)) {
    return trimiteEroare(res, 400, 'DATE_INVALIDE', 'suprafata_mp trebuie să fie un număr valid', 'suprafata_mp must be a valid number.', ['suprafata_mp']);
  }

  let sluguri;
  let servicii;
  try {
    [sluguri, servicii] = await Promise.all([incarcaSluguriServicii(), incarcaServiciiPublicate()]);
  } catch (e) {
    console.error('[darrin-ai/deviz]', e.message);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca catalogul My Darrin. Încearcă din nou.', 'We could not load the My Darrin catalogue. Please try again.');
  }

  const contentBlocks = [];
  if (text) contentBlocks.push({ type: 'text', text });
  for (const f of fisiere) {
    if (f.mime === 'application/pdf') {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: f.mime, data: f.data_base64 } });
    } else {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.data_base64 } });
    }
  }
  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: 'text', text: '(fără text sau fișiere — vezi restul promptului de sistem)' });
  }

  const areConsultanta = servicii.some((s) => s.id_serviciu === ID_CONSULTANTA);
  const promptSistem = construiestePrompt(mod, { text, tipConstructie: tip_constructie, suprafataMp: suprafata_mp, locatie, lang, servicii, sluguri, areConsultanta, incercare });
  const tool = construiesteTool(sluguri, servicii);

  let rezultatAI;
  try {
    rezultatAI = await apeleazaAnthropic({ apiKey, promptSistem, contentBlocks, tool });
  } catch (e) {
    console.error('[darrin-ai/deviz]', e.message);
    return trimiteEroare(res, 502, 'SERVICIU_EXTERN', 'Darrin AI nu a putut procesa cererea momentan. Încearcă din nou sau vorbește cu un specialist.', 'Darrin AI could not process the request right now. Please try again or talk to a specialist.');
  }

  const rez = valideazaRezultatAI(rezultatAI.input, { sluguri, servicii, lang, incercare });
  if (rez.respinse.length) {
    console.warn('[darrin-ai/deviz] ID-uri respinse (inexistente sau nepublicate):', rez.respinse.join(', '));
  }

  const moneda = await monedaTara(tara);
  const serviciiRaspuns = await Promise.all(rez.alese.map((s) => formaServiciu(s, tara, moneda)));
  let consultanta = null;
  if (rez.recomandaConsultanta && rez.consultanta) {
    consultanta = serviciiRaspuns.find((s) => s.id_serviciu === ID_CONSULTANTA) || await formaServiciu(rez.consultanta, tara, moneda);
  }

  // Copie în Storage pentru audit trail — best-effort, nu blochează răspunsul
  // dacă eșuează (conținutul relevant a ajuns deja la Claude ca base64).
  const cererePrefix = crypto.randomUUID();
  const inputFiles = [];
  for (let i = 0; i < fisiere.length; i++) {
    const f = fisiere[i];
    const ext = f.mime === 'application/pdf' ? 'pdf' : f.mime.split('/')[1] || 'bin';
    const path = `${user ? user.id : 'anon'}/${cererePrefix}/${i}.${ext}`;
    try {
      const { error: uploadErr } = await supabaseAdmin.storage
        .from('deviz-ai-uploads')
        .upload(path, f.buffer, { contentType: f.mime, upsert: false });
      if (uploadErr) throw uploadErr;
      inputFiles.push({ path, mime: f.mime });
    } catch (e) {
      console.warn('[darrin-ai/deviz] upload audit trail eșuat pentru fișier', i, ':', e.message);
    }
  }

  // Pasul 12-D1: nicio sumă nu se mai salvează (coloana ai_cost_brut_estimat
  // rămâne goală pentru cererile noi; schema nu se schimbă).
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('devize_ai_requests')
    .insert({
      client_id: user ? user.id : null,
      input_text: text || null,
      input_files: inputFiles,
      ai_model: ANTHROPIC_MODEL,
      ai_categorie_slug: rez.categorie ? rez.categorie.slug : null,
      ai_incredere: rez.incredere,
      ai_explicatie: rez.explicatie,
      // Pasul 12-D2: ruta aplicată de server, lângă răspunsul brut (fără migrare).
      ai_raw_response: { ...rezultatAI.raw, myd: { relevanta: rez.relevanta, intrebare: rez.intrebare, incercare } },
    })
    .select('id')
    .single();

  if (insertErr) {
    // Nu blocăm răspunsul către client pentru o eroare de audit trail — dar o logăm cu prioritate mare.
    console.error('[darrin-ai/deviz] nu am putut salva devize_ai_requests:', insertErr.message || insertErr);
  }

  return res.status(200).json({
    ok: true,
    request_id: inserted?.id || null,
    lang,
    tara,
    categorie_slug: rez.categorie ? rez.categorie.slug : null,
    titlu_categorie: rez.categorie ? rez.categorie.title : null,
    relevanta: rez.relevanta,
    intrebare: rez.intrebare,
    incercare,
    servicii: serviciiRaspuns,
    incredere: rez.incredere,
    explicatie: rez.explicatie,
    explicatie_inlocuita: rez.explicatieInlocuita,
    recomanda_consultanta: rez.recomandaConsultanta,
    consultanta,
  });
};

module.exports.valideazaRezultatAI = valideazaRezultatAI;
module.exports.continutSume = continutSume;
module.exports.construiestePrompt = construiestePrompt;
module.exports.EXPLICATIE_FIXA = EXPLICATIE_FIXA;
module.exports.EXPLICATIE_LIPSA = EXPLICATIE_LIPSA;
module.exports.EXPLICATIE_FARA_LEGATURA = EXPLICATIE_FARA_LEGATURA;
module.exports.INTREBARE_IMPLICITA = INTREBARE_IMPLICITA;
module.exports.LIMITE_CERERI = LIMITE_CERERI;

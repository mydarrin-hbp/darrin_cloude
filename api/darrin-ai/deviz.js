// api/darrin-ai/deviz.js
// Darrin AI — motor public de deviz (Varianta 1: Evaluare Instantă Servicii,
// Varianta 2 redusă: punct de intrare "Deviz Sumar" pentru proiecte).
//
// Spre deosebire de restul modalului "Darrin AI" din mydarrin-catalog.html
// (matching determinist pe cuvinte-cheie împotriva unui PRODUCTS_DB static),
// acest endpoint apelează un model Claude real. Siguranța nu vine din
// interzicerea AI-ului, ci din constrângerea output-ului: categoria e
// obligatoriu una din cele reale din `categorii` (tool use cu enum), nu text
// liber — modelul nu poate "inventa" un serviciu în afara catalogului.
//
// Acest endpoint NU calculează prețul final — doar o estimare de cost brut +
// categorie + încredere. Prețul oficial rămâne exclusiv la
// /api/deviz/calculate.js (server-side, VMC/TVA/zonă/urgență pe țară),
// nemodificat, apelat separat de front-end la pasul de confirmare.
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
// limitele de mai jos (2MB/fișier decodat, max 3 fișiere) sunt mult sub
// limita de 10MB a bucket-ului de Storage (aceea e doar plafonul propriu al
// bucket-ului, nu garantează că cererea trece de Vercel).

const { getAuthenticatedUser } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const crypto = require('crypto');
const v = require('../../lib/valideaza');
const { limiteazaCererea } = require('../../lib/rate-limit');
const { trimiteEroare } = require('../../lib/raspuns-eroare');

const ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_TEXT_LEN = 4000;
const MAX_FILES = 3;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB decodat/fișier — vezi nota de limită de mai sus
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
const MODURI = new Set(['servicii', 'proiect']);

// Pasul 11-S1: câmpurile acceptate; orice alt câmp e refuzat. Regulile de
// conținut (ce e obligatoriu pentru fiecare mod, mărimea fișierelor) rămân mai jos.
const SCHEMA = {
  mod: v.dinLista([...MODURI], { implicit: 'servicii', eticheta: ['Tipul estimării', 'Estimate type'] }),
  text: v.text({ max: MAX_TEXT_LEN, eticheta: ['Descriere', 'Description'] }),
  files: v.lista(v.obiect({
    mime: v.dinLista([...ALLOWED_MIME], { obligatoriu: true, eticheta: ['Tipul fișierului', 'File type'] }),
    data_base64: v.text({ obligatoriu: true, max: Math.ceil(MAX_FILE_BYTES * 4 / 3) + 4, faraTrim: true, eticheta: ['Conținutul fișierului', 'File content'] }),
  }, { eticheta: ['Fișier', 'File'] }), { max: MAX_FILES, eticheta: ['Fișiere', 'Files'] }),
  tip_constructie: v.text({ max: 200, eticheta: ['Tip construcție', 'Construction type'] }),
  suprafata_mp: v.numar({ min: 0, max: 1000000, eticheta: ['Suprafață (m²)', 'Area (m²)'] }),
  locatie: v.text({ max: 200, eticheta: ['Locație', 'Location'] }),
};

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

function construiestePrompt(mod, { text, tipConstructie, suprafataMp, locatie }) {
  if (mod === 'proiect') {
    return [
      'Ești motorul de estimare pentru My Darrin, o platformă românească de servicii pentru locuință și construcții.',
      'Clientul descrie un proiect de construcție/renovare la scară mai mare (nu o reparație punctuală).',
      `Tip construcție/proiect: ${tipConstructie || '(nespecificat)'}`,
      `Suprafață: ${suprafataMp ? `${suprafataMp} m²` : '(nespecificată)'}`,
      `Locație: ${locatie || '(nespecificată)'}`,
      text ? `Descriere suplimentară a clientului: ${text}` : '',
      '',
      'Aceasta este doar o estimare preliminară ("Deviz Sumar") pe baza informațiilor date — NU o ofertă tehnică detaliată (nu ai planșe, nu ai extras de materiale). Dacă informația e insuficientă pentru o estimare rezonabilă, reflectă asta printr-o încredere (incredere) scăzută, nu printr-un refuz.',
    ].filter(Boolean).join('\n');
  }
  return [
    'Ești motorul de estimare pentru My Darrin, o platformă românească de servicii pentru locuință.',
    'Clientul descrie o nevoie punctuală (reparație, instalație, finisaj) prin text și, opțional, imagini/PDF.',
    text ? `Descrierea clientului: ${text}` : 'Clientul nu a scris text — bazează-te doar pe fișierele atașate.',
  ].join('\n');
}

async function apeleazaAnthropic({ apiKey, promptSistem, contentBlocks, sluguri }) {
  const tool = {
    name: 'identifica_serviciu',
    description:
      'Clasifică nevoia clientului într-o categorie reală din catalogul My Darrin și oferă o estimare de cost BRUT (înainte de comisioane, marketing, platformă, coeficient de zonă/urgență și TVA — acestea se aplică separat, server-side).',
    input_schema: {
      type: 'object',
      properties: {
        categorie_slug: {
          type: 'string',
          enum: sluguri.map((s) => s.slug),
          description: 'Slug-ul categoriei din catalogul real My Darrin care se potrivește cel mai bine.',
        },
        cost_brut_estimat_lei: {
          type: 'number',
          minimum: 0,
          description: 'Estimare de cost brut în RON, pe baza prețurilor tipice de piață din România pentru acest tip de lucrare (manoperă + materiale uzuale), înainte de orice comision My Darrin.',
        },
        incredere: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Cât de sigur ești de estimare, 0–1. Scade pentru input vag, ambiguu sau insuficient — nu inventa certitudine.',
        },
        explicatie: {
          type: 'string',
          description: 'Explicație scurtă (2-3 propoziții), în română, pentru client: ce ai înțeles și pe ce s-a bazat estimarea.',
        },
      },
      required: ['categorie_slug', 'cost_brut_estimat_lei', 'incredere', 'explicatie'],
    },
  };

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
  return { input: toolUse.input, raw: json };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return trimiteEroare(res, 405, 'METODA_NEPERMISA', 'Metodă nepermisă.', 'Method not allowed.');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[darrin-ai/deviz] ANTHROPIC_API_KEY lipsește din mediu');
    return trimiteEroare(res, 500, 'INDISPONIBIL', 'Serviciul Darrin AI nu este configurat încă. Contactează suportul.', 'The Darrin AI service is not set up yet. Please contact support.');
  }

  const date = v.valideazaSauTrimite(req, res, SCHEMA);
  if (!date) return;
  const { mod = 'servicii', text, files, tip_constructie, suprafata_mp, locatie } = date;

  // Pasul 11-S1: fiecare cerere apelează un model AI plătit — cel mult 10
  // estimări în 10 minute de pe același IP.
  if (!(await limiteazaCererea(req, res, { key: 'darrin-ai-deviz', limit: 10, windowSeconds: 600 }))) return;

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
      if (base64Bytes(f.data_base64) > MAX_FILE_BYTES) {
        return trimiteEroare(res, 400, 'PREA_MARE', `fișier prea mare — max ${MAX_FILE_BYTES / (1024 * 1024)}MB per fișier`, `The file is too large: at most ${MAX_FILE_BYTES / (1024 * 1024)}MB per file.`, ['files']);
      }
    }
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

  let user = null;
  try {
    user = await getAuthenticatedUser(req);
  } catch (e) {
    // vizitator anonim — nu e o eroare, doar continuăm fără user
  }

  let sluguri;
  try {
    sluguri = await incarcaSluguriServicii();
  } catch (e) {
    console.error('[darrin-ai/deviz]', e);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Nu am putut încărca lista de categorii din catalog', 'We could not load the catalogue categories. Please try again.');
  }

  const contentBlocks = [];
  if (text) contentBlocks.push({ type: 'text', text });
  for (const f of files || []) {
    if (f.mime === 'application/pdf') {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: f.mime, data: f.data_base64 } });
    } else {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.mime, data: f.data_base64 } });
    }
  }
  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: 'text', text: '(fără text sau fișiere — vezi restul promptului de sistem)' });
  }

  const promptSistem = construiestePrompt(mod, { text, tipConstructie: tip_constructie, suprafataMp: suprafata_mp, locatie });

  let rezultatAI;
  try {
    rezultatAI = await apeleazaAnthropic({ apiKey, promptSistem, contentBlocks, sluguri });
  } catch (e) {
    console.error('[darrin-ai/deviz]', e);
    return trimiteEroare(res, 502, 'SERVICIU_EXTERN', 'Darrin AI nu a putut procesa cererea momentan. Încearcă din nou sau vorbește cu un specialist.', 'Darrin AI could not process the request right now. Please try again or talk to a specialist.');
  }

  const { categorie_slug, cost_brut_estimat_lei, incredere, explicatie } = rezultatAI.input;
  const categorieValida = sluguri.find((s) => s.slug === categorie_slug);
  if (!categorieValida) {
    // apărare suplimentară, deși enum-ul din tool_schema ar trebui să prevină asta deja
    console.error('[darrin-ai/deviz] categorie_slug în afara catalogului real:', categorie_slug);
    return trimiteEroare(res, 502, 'SERVICIU_EXTERN', 'Darrin AI a răspuns cu o categorie neașteptată. Încearcă din nou sau vorbește cu un specialist.', 'Darrin AI answered with an unexpected category. Please try again or talk to a specialist.');
  }

  // Copie în Storage pentru audit trail — best-effort, nu blochează răspunsul
  // dacă eșuează (conținutul relevant a ajuns deja la Claude ca base64).
  const cererePrefix = crypto.randomUUID();
  const inputFiles = [];
  for (let i = 0; i < (files || []).length; i++) {
    const f = files[i];
    const ext = f.mime === 'application/pdf' ? 'pdf' : f.mime.split('/')[1] || 'bin';
    const path = `${user ? user.id : 'anon'}/${cererePrefix}/${i}.${ext}`;
    try {
      const buffer = Buffer.from(f.data_base64, 'base64');
      const { error: uploadErr } = await supabaseAdmin.storage
        .from('deviz-ai-uploads')
        .upload(path, buffer, { contentType: f.mime, upsert: false });
      if (uploadErr) throw uploadErr;
      inputFiles.push({ path, mime: f.mime });
    } catch (e) {
      console.warn('[darrin-ai/deviz] upload audit trail eșuat pentru fișier', i, ':', e.message);
    }
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('devize_ai_requests')
    .insert({
      client_id: user ? user.id : null,
      input_text: text || null,
      input_files: inputFiles,
      ai_model: ANTHROPIC_MODEL,
      ai_categorie_slug: categorie_slug,
      ai_cost_brut_estimat: cost_brut_estimat_lei,
      ai_incredere: incredere,
      ai_explicatie: explicatie,
      ai_raw_response: rezultatAI.raw,
    })
    .select('id')
    .single();

  if (insertErr) {
    // Nu blocăm răspunsul către client pentru o eroare de audit trail — dar o logăm cu prioritate mare.
    console.error('[darrin-ai/deviz] nu am putut salva devize_ai_requests:', insertErr);
  }

  return res.status(200).json({
    ok: true,
    request_id: inserted?.id || null,
    categorie_slug,
    titlu_categorie: categorieValida.title,
    cost_brut_estimat: cost_brut_estimat_lei,
    incredere,
    explicatie,
  });
};

// /api/admin/seo-campanii.js
// Campaniile social media ale unei pagini publice (pasul 11-S, 23 oct. 2026),
// din tabul „Social media & campanii” al editorului SEO (seo-panou-campanii.js).
// NU publică reclame și nu se leagă de conturile Meta / TikTok / Google: LM
// descarcă materialele (exportul) și le încarcă manual în platformele de reclame.
//
// Acces (lib/permisiuni-seo.js): citirea — superadmin sau admin cu rând pe
// secțiunea `seo`; orice scriere (inclusiv ciornă → activă) — superadmin sau
// admin cu poate_scrie. Fiecare acțiune se auditează (inregistreazaAudit);
// erorile au forma comună (lib/raspuns-eroare.js), RO + EN, cu câmpul greșit.
// Validarea: lib/seo-campanii.js (aceleași reguli ca în panou), cu limitele
// din backoffice_config (campanii_limite_*).
//
// GET ?page_path=&limba=        → { ok, campanii, limite, poate_scrie }   (limba opțională)
// GET ?id=                      → { ok, campanie, media_urls }  (adrese semnate de 10 min, pentru previzualizare)
// GET ?export=1&id=             → { ok, export: { nume_arhiva, fisiere:[{ nume, url, mime, marime_bytes }], txt, expira_in_s } }
//                                  (arhiva .zip o face browserul din adresele semnate: un răspuns
//                                  Vercel are cel mult 4,5 MB, iar materialele video au până la 50 MB)
// POST { actiune:'creeaza', page_path, limba, nume_campanie, ... }   → ciornă nouă
// POST { actiune:'salveaza', id, ... }                               → editare (fără stare)
// POST { actiune:'stare', id, stare }                                → ciorna ↔ activa, → arhivata, arhivata → ciorna
// POST { actiune:'duplica', id, limba? }                             → ciornă nouă; în altă limbă (RO → EN), textele goale
// POST { actiune:'sterge', id }                                      → doar ciornele (și materialele lor)
// POST { actiune:'url_incarcare', id, tip, mime, marime, latime, inaltime, durata_s } → adresă semnată (campanii-media)
// POST { actiune:'confirma_media', id, tip, cale, latime, inaltime, durata_s }       → verificarea conținutului, media[tip]
// POST { actiune:'sterge_media', id, tip }                                           → scoate materialul

const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { nivelSeo, refuzaFaraDrept, refuzaFaraScriere } = require('../../lib/permisiuni-seo');
const { esteCunoscuta } = require('../../lib/seo-pagini');
const R = require('../../lib/seo-campanii');
const VF = require('../../lib/verifica-fisier');

const TABEL = 'seo_campanii_social';
const BUCKET = 'campanii-media';
const EXPIRA_S = 600;
const COLOANE_EDITABILE = ['nume_campanie', 'platforme', 'titlu_reclama', 'text_principal', 'descriere_link', 'cta', 'url_destinatie',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'note_interne'];
const TEXTE_TRADUSE = ['titlu_reclama', 'text_principal', 'descriere_link'];

function migrareLipsa(err) {
  return !!err && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST205' || err.code === 'PGRST204');
}
function refuzMigrare(res) {
  return trimiteEroare(res, 409, 'MIGRARE_LIPSA',
    'Tabela campaniilor nu există încă: aplicați migrarea docs/migrations-propuse/2026-10-23_seo_social_campanii.sql.',
    'The campaigns table does not exist yet: apply the migration docs/migrations-propuse/2026-10-23_seo_social_campanii.sql.');
}
function refuzLipsa(res) {
  return trimiteEroare(res, 404, 'CAMPANIE_LIPSA', 'Campania nu există.', 'The campaign does not exist.');
}
function refuzValidare(res, erori) {
  return trimiteEroare(res, 400, 'CAMPANIE_INVALIDA',
    `Campania are ${erori.length} ${erori.length === 1 ? 'problemă' : 'probleme'}: ${erori[0].ro}`,
    `The campaign has ${erori.length} ${erori.length === 1 ? 'problem' : 'problems'}: ${erori[0].en}`,
    erori.slice(0, 30).map((e) => camp(e.camp, e.ro, e.en)));
}
class EroareDb extends Error { constructor(e) { super(e && e.message); this.db = e; } }

// Limitele de text: backoffice_config (campanii_limite_*, ALL) peste valorile implicite.
async function limite() {
  const L = Object.assign({}, R.LIMITE_IMPLICITE);
  const { data, error } = await supabaseAdmin.from('backoffice_config').select('cheie, valoare, tara_cod').eq('tara_cod', 'ALL');
  if (error || !Array.isArray(data)) return L;
  data.forEach((r) => {
    const m = /^campanii_limite_(.+)$/.exec(r.cheie || '');
    const n = Number(r.valoare);
    if (m && Number.isFinite(n) && n >= 0) L[m[1]] = Math.floor(n);
  });
  return L;
}

// Segmentul paginii în calea materialelor: '/despre-noi' → 'despre-noi', '/' → 'index'.
function segmentPagina(pagePath) {
  return String(pagePath || '/').replace(/^\/+/, '').replace(/[^a-z0-9._-]+/gi, '-') || 'index';
}
function prefixMedia(c) { return `${segmentPagina(c.page_path)}/${c.limba}/${c.id}/`; }

function curata(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
// Câmpurile editabile din corpul cererii (doar cele trimise).
function dinCorp(b) {
  const r = {};
  COLOANE_EDITABILE.forEach((k) => {
    if (!(k in b)) return;
    if (k === 'platforme') r.platforme = Array.isArray(b.platforme) ? [...new Set(b.platforme.map(String))] : b.platforme;
    else if (k === 'cta') r.cta = b.cta ? String(b.cta) : null;
    else r[k] = curata(b[k], 5000);
  });
  return r;
}

async function citeste(id) {
  if (typeof id !== 'string' || !id) return null;
  const { data, error } = await supabaseAdmin.from(TABEL).select('*').eq('id', id).maybeSingle();
  if (error) throw new EroareDb(error);
  return data || null;
}
async function numeLiber(c, nume, exceptId) {
  const { data, error } = await supabaseAdmin.from(TABEL).select('id, nume_campanie').eq('page_path', c.page_path).eq('limba', c.limba);
  if (error) throw new EroareDb(error);
  return !(data || []).some((x) => x.id !== exceptId && String(x.nume_campanie).trim().toLowerCase() === String(nume).trim().toLowerCase());
}
function refuzNume(res) {
  return trimiteEroare(res, 409, 'NUME_EXISTENT', 'Există deja o campanie cu acest nume pe pagină, în aceeași limbă.', 'A campaign with this name already exists on the page, in the same language.',
    [camp('nume_campanie', 'Alegeți alt nume.', 'Choose another name.')]);
}
async function emailuri(ids) {
  const unice = [...new Set(ids.filter(Boolean))];
  if (!unice.length) return {};
  const { data } = await supabaseAdmin.from('profiles').select('id, email').in('id', unice);
  return Object.fromEntries((data || []).map((p) => [p.id, p.email]));
}

async function lista(req, res, poateScrie) {
  const pagePath = req.query.page_path;
  if (!pagePath || !esteCunoscuta(pagePath)) {
    return trimiteEroare(res, 400, 'PAGINA_INVALIDA', 'Pagina nu e în lista paginilor publice.', 'The page is not in the list of public pages.');
  }
  let q = supabaseAdmin.from(TABEL).select('*').eq('page_path', pagePath);
  if (R.LIMBI.includes(req.query.limba)) q = q.eq('limba', req.query.limba);
  const { data, error } = await q.order('updated_at', { ascending: false });
  if (error) throw new EroareDb(error);
  const mail = await emailuri((data || []).map((c) => c.actualizat_de));
  const campanii = (data || []).map((c) => Object.assign({}, c, { actualizat_de_email: mail[c.actualizat_de] || null }));
  return res.status(200).json({ ok: true, campanii, limite: await limite(), poate_scrie: poateScrie });
}

async function adreseMedia(c, cuDescarcare) {
  const media = c.media && typeof c.media === 'object' ? c.media : {};
  const r = {};
  for (const tip of R.TIPURI_MEDIA) {
    const m = media[tip];
    if (!m || !m.cale || !String(m.cale).startsWith(prefixMedia(c))) continue;   // doar materialele acestei campanii
    const ext = String(m.cale).split('.').pop();
    const nume = `${tip}.${ext}`;
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(m.cale, EXPIRA_S, cuDescarcare ? { download: nume } : undefined);
    if (!error && data && data.signedUrl) r[tip] = { url: data.signedUrl, nume, mime: m.mime || null, marime_bytes: m.marime_bytes || null };
  }
  return r;
}

function textExport(c) {
  const cta = R.ETICHETE_CTA[c.cta];
  const rand = (et, v) => `${et}: ${v == null || v === '' ? '—' : v}`;
  const linii = [
    `Campanie / Campaign: ${c.nume_campanie}`,
    `Pagina / Page: ${c.page_path}`,
    `Limba / Language: ${String(c.limba).toUpperCase()}`,
    `Stare / Status: ${c.stare}`,
    `Platforme / Platforms: ${(c.platforme || []).map((p) => R.ETICHETE_PLATFORME[p] || p).join(', ') || '—'}`,
    '',
    rand('Titlul reclamei / Headline', c.titlu_reclama),
    '',
    'Textul principal / Primary text:',
    c.text_principal || '—',
    '',
    rand('Descrierea linkului / Link description', c.descriere_link),
    rand('Butonul (CTA) / Call to action', cta ? `${cta.ro} / ${cta.en} (${c.cta})` : null),
    rand('Linkul final (cu UTM) / Final link (with UTM)', R.linkFinal(c)),
    '',
    'Materiale / Assets: ' + (R.TIPURI_MEDIA.filter((t) => c.media && c.media[t] && c.media[t].cale)
      .map((t) => `${t} (${R.MEDIA[t].eticheta}, ${c.media[t].latime} × ${c.media[t].inaltime})`).join('; ') || '—'),
    '',
    'Încărcare manuală în Ads Manager / TikTok Ads / Google Ads. Upload manually into Ads Manager / TikTok Ads / Google Ads.',
  ];
  return linii.join('\r\n') + '\r\n';
}

function numeArhiva(c) {
  const sigur = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
  return `campanie-${sigur(segmentPagina(c.page_path))}-${c.limba}-${sigur(c.nume_campanie) || c.id}.zip`;
}

async function creeaza(req, res, admin) {
  const b = req.body || {};
  if (!b.page_path || !esteCunoscuta(b.page_path)) {
    return trimiteEroare(res, 400, 'PAGINA_INVALIDA', 'Pagina nu e în lista paginilor publice.', 'The page is not in the list of public pages.', [camp('page_path', 'Alegeți o pagină din listă.', 'Choose a page from the list.')]);
  }
  const c = Object.assign({ page_path: b.page_path, limba: b.limba, platforme: [], stare: 'ciorna', media: {} }, dinCorp(b));
  const lim = await limite();
  const erori = R.valideaza(c, lim);
  if (erori.length) return refuzValidare(res, erori);
  if (!(await numeLiber(c, c.nume_campanie))) return refuzNume(res);
  const acum = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from(TABEL).insert(Object.assign({}, c, { creat_de: admin.id, actualizat_de: admin.id, created_at: acum, updated_at: acum })).select().single();
  if (error) { if (error.code === '23505') return refuzNume(res); throw new EroareDb(error); }
  await inregistreazaAudit({ admin, req, actiune: 'campanie_creata', entitate: TABEL, entitate_id: data.id, detalii: { page_path: c.page_path, limba: c.limba, nume: c.nume_campanie } });
  return res.status(200).json({ ok: true, campanie: data });
}

async function salveaza(req, res, admin) {
  const b = req.body || {};
  const v = await citeste(b.id);
  if (!v) return refuzLipsa(res);
  if (v.stare === 'arhivata') return trimiteEroare(res, 409, 'CAMPANIE_ARHIVATA', 'Campania e arhivată: readuceți-o la ciornă ca s-o editați.', 'The campaign is archived: bring it back to draft to edit it.');
  const modificari = dinCorp(b);
  const c = Object.assign({}, v, modificari);
  const erori = R.valideaza(c, await limite(), { activare: v.stare === 'activa' });
  if (erori.length) return refuzValidare(res, erori);
  if ('nume_campanie' in modificari && !(await numeLiber(c, c.nume_campanie, v.id))) return refuzNume(res);
  const { data, error } = await supabaseAdmin.from(TABEL).update(Object.assign({}, modificari, { actualizat_de: admin.id, updated_at: new Date().toISOString() })).eq('id', v.id).select().single();
  if (error) { if (error.code === '23505') return refuzNume(res); throw new EroareDb(error); }
  await inregistreazaAudit({ admin, req, actiune: 'campanie_salvata', entitate: TABEL, entitate_id: v.id, detalii: { campuri: Object.keys(modificari) } });
  return res.status(200).json({ ok: true, campanie: data });
}

const TRANZITII = { ciorna: ['activa', 'arhivata'], activa: ['ciorna', 'arhivata'], arhivata: ['ciorna'] };
async function schimbaStare(req, res, admin) {
  const b = req.body || {};
  const v = await citeste(b.id);
  if (!v) return refuzLipsa(res);
  const noua = b.stare;
  if (!R.STARI.includes(noua) || !(TRANZITII[v.stare] || []).includes(noua)) {
    return trimiteEroare(res, 409, 'TRANZITIE_INVALIDA', `Campania nu poate trece din „${v.stare}” în „${noua}”.`, `The campaign cannot go from “${v.stare}” to “${noua}”.`, [camp('stare', 'Alegeți altă stare.', 'Choose another status.')]);
  }
  if (noua === 'activa') {
    const erori = R.valideaza(v, await limite(), { activare: true });
    if (erori.length) return refuzValidare(res, erori);
  }
  const { data, error } = await supabaseAdmin.from(TABEL).update({ stare: noua, actualizat_de: admin.id, updated_at: new Date().toISOString() }).eq('id', v.id).select().single();
  if (error) throw new EroareDb(error);
  await inregistreazaAudit({ admin, req, actiune: noua === 'arhivata' ? 'campanie_arhivata' : 'campanie_stare', entitate: TABEL, entitate_id: v.id, detalii: { din: v.stare, in: noua } });
  return res.status(200).json({ ok: true, campanie: data });
}

async function duplica(req, res, admin) {
  const b = req.body || {};
  const v = await citeste(b.id);
  if (!v) return refuzLipsa(res);
  const limba = b.limba == null ? v.limba : b.limba;
  if (!R.LIMBI.includes(limba)) return trimiteEroare(res, 400, 'LIMBA_INVALIDA', 'Limba trebuie să fie „ro” sau „en”.', 'The language must be “ro” or “en”.', [camp('limba', 'Alegeți RO sau EN.', 'Choose RO or EN.')]);
  const traducere = limba !== v.limba;
  const baza = String(v.nume_campanie).replace(/\s+\((RO|EN|copie)( \d+)?\)$/i, '');
  const sufix = traducere ? ` (${limba.toUpperCase()})` : ' (copie)';
  const tinta = { page_path: v.page_path, limba };
  let nume = baza + sufix;
  for (let i = 2; !(await numeLiber(tinta, nume)) && i < 100; i++) nume = `${baza}${sufix.replace(')', ` ${i})`)}`;
  const nou = { page_path: v.page_path, limba, nume_campanie: nume.slice(0, R.MAXIM.nume_campanie), stare: 'ciorna', media: {} };
  COLOANE_EDITABILE.forEach((k) => { if (k !== 'nume_campanie') nou[k] = v[k] == null ? null : v[k]; });
  // În altă limbă, textele pornesc goale: se traduc, nu se copiază.
  if (traducere) TEXTE_TRADUSE.forEach((k) => { nou[k] = null; });
  const acum = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from(TABEL).insert(Object.assign(nou, { creat_de: admin.id, actualizat_de: admin.id, created_at: acum, updated_at: acum })).select().single();
  if (error) { if (error.code === '23505') return refuzNume(res); throw new EroareDb(error); }
  await inregistreazaAudit({ admin, req, actiune: 'campanie_duplicata', entitate: TABEL, entitate_id: data.id, detalii: { sursa: v.id, din: v.limba, in: limba } });
  return res.status(200).json({ ok: true, campanie: data });
}

async function sterge(req, res, admin) {
  const v = await citeste(req.body && req.body.id);
  if (!v) return refuzLipsa(res);
  if (v.stare !== 'ciorna') {
    return trimiteEroare(res, 409, 'DOAR_CIORNE', 'Se pot șterge doar ciornele. Campaniile active se arhivează.', 'Only drafts can be deleted. Active campaigns are archived.');
  }
  const cai = R.TIPURI_MEDIA.map((t) => v.media && v.media[t] && v.media[t].cale).filter((c) => c && String(c).startsWith(prefixMedia(v)));
  if (cai.length) {
    const { error: eS } = await supabaseAdmin.storage.from(BUCKET).remove(cai);
    if (eS) console.error('[admin/seo-campanii sterge] materialele nu s-au șters din stocare:', eS);
  }
  const { error } = await supabaseAdmin.from(TABEL).delete().eq('id', v.id);
  if (error) throw new EroareDb(error);
  await inregistreazaAudit({ admin, req, actiune: 'campanie_stearsa', entitate: TABEL, entitate_id: v.id, detalii: { page_path: v.page_path, limba: v.limba, nume: v.nume_campanie, materiale: cai.length } });
  return res.status(200).json({ ok: true });
}

// ── Materialele (pasul 2.5): încărcare directă din browser, pe adresă semnată ──
// Fișierul nu trece prin funcțiile Vercel. Serverul verifică înainte tipul,
// mărimea și dimensiunile declarate, iar după încărcare conținutul real
// (primii octeți), mărimea și calea: <pagina>/<limba>/<id>/<tip>.<ext>.
function refuzMaterial(res, tip, ro, en, cod) {
  return trimiteEroare(res, 400, cod || 'MATERIAL_INVALID', ro, en, [camp('media.' + tip, ro, en)]);
}
function dimensiuni(b) {
  const latime = Number(b.latime), inaltime = Number(b.inaltime);
  const durata = b.durata_s == null || b.durata_s === '' ? null : Number(b.durata_s);
  return { latime, inaltime, durata, ok: Number.isInteger(latime) && Number.isInteger(inaltime) && latime > 0 && inaltime > 0 && latime <= 20000 && inaltime <= 20000
    && (durata == null || (Number.isFinite(durata) && durata >= 0 && durata <= 36000)) };
}
// Verificările comune (înainte și după încărcare): tipul, mărimea, raportul, rezoluția.
function verificaMaterial(res, tip, mime, marime, d) {
  if (!R.MEDIA[tip]) return trimiteEroare(res, 400, 'TIP_MATERIAL', 'Tip de material necunoscut.', 'Unknown asset type.');
  const video = R.MEDIA[tip].tip === 'video';
  if (!R.mimePermis(tip, mime)) {
    return refuzMaterial(res, tip, video ? 'Videoclipul trebuie să fie MP4, MOV sau WebM.' : 'Imaginea trebuie să fie JPG, PNG sau WebP.',
      video ? 'The video must be MP4, MOV or WebM.' : 'The image must be JPG, PNG or WebP.', 'TIP_FISIER');
  }
  const max = R.marimeMaxima(tip);
  if (!(marime > 0) || marime > max) {
    const mb = Math.round(max / 1048576);
    return refuzMaterial(res, tip, `Fișierul are mai mult de ${mb} MB. Exportați din nou, sub ${mb} MB.`, `The file is larger than ${mb} MB. Export it again, under ${mb} MB.`, 'FISIER_PREA_MARE');
  }
  if (!d.ok) return refuzMaterial(res, tip, 'Dimensiunile materialului lipsesc sau nu sunt valide.', 'The asset dimensions are missing or not valid.');
  const v = R.verificaDimensiuni(tip, d.latime, d.inaltime);
  if (!v.ok) return refuzMaterial(res, tip, v.ro, v.en, 'DIMENSIUNI');
  return null;
}

async function urlIncarcare(req, res, admin) {
  const b = req.body || {};
  const c = await citeste(b.id);
  if (!c) return refuzLipsa(res);
  if (c.stare === 'arhivata') return trimiteEroare(res, 409, 'CAMPANIE_ARHIVATA', 'Campania e arhivată.', 'The campaign is archived.');
  const marime = Number(b.marime);
  const refuz = verificaMaterial(res, b.tip, b.mime, marime, dimensiuni(b));
  if (refuz) return refuz;
  const cale = prefixMedia(c) + b.tip + '.' + R.mimePermis(b.tip, b.mime);
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(cale, { upsert: true });
  if (error || !data) {
    console.error('[admin/seo-campanii url_incarcare]', error);
    return trimiteEroare(res, 503, 'BUCKET_INDISPONIBIL', 'Nu am putut pregăti încărcarea. Verificați că bucket-ul campanii-media există (migrarea 2026-10-23).',
      'We could not prepare the upload. Check that the campanii-media bucket exists (the 2026-10-23 migration).');
  }
  await inregistreazaAudit({ admin, req, actiune: 'campanie_material_incarcare', entitate: 'storage', entitate_id: `${BUCKET}/${cale}`, detalii: { campanie: c.id, tip: b.tip, mime: b.mime, marime } });
  return res.status(200).json({ ok: true, bucket: BUCKET, cale: data.path || cale, token: data.token, url_semnat: data.signedUrl });
}

async function confirmaMedia(req, res, admin) {
  const b = req.body || {};
  const c = await citeste(b.id);
  if (!c) return refuzLipsa(res);
  const tip = b.tip;
  if (!R.MEDIA[tip]) return trimiteEroare(res, 400, 'TIP_MATERIAL', 'Tip de material necunoscut.', 'Unknown asset type.');
  const ext = String(b.cale || '').split('.').pop();
  const asteptata = prefixMedia(c) + tip + '.' + ext;
  const mimeDinExt = Object.keys(R.MEDIA[tip].tip === 'video' ? R.MIME_VIDEO : R.MIME_IMAGINE).find((m) => R.mimePermis(tip, m) === ext);
  if (b.cale !== asteptata || !mimeDinExt) {
    return refuzMaterial(res, tip, 'Calea fișierului nu aparține acestei campanii.', 'The file path does not belong to this campaign.', 'CALE_INVALIDA');
  }
  const info = await VF.inspecteaza(supabaseAdmin, BUCKET, b.cale);
  if (!info.exista) return refuzMaterial(res, tip, 'Fișierul nu s-a găsit în stocare. Încărcați-l din nou.', 'The file was not found in storage. Upload it again.', 'FISIER_LIPSA');
  const d = dimensiuni(b);
  const refuz = !VF.tipPotrivit(mimeDinExt, info.tip)
    ? refuzMaterial(res, tip, 'Conținutul fișierului nu e ' + ext.toUpperCase() + ' (verificat pe server). Exportați din nou materialul.', 'The file content is not ' + ext.toUpperCase() + ' (checked on the server). Export the asset again.', 'CONTINUT_INVALID')
    : verificaMaterial(res, tip, mimeDinExt, info.marime, d);
  if (refuz) {
    await supabaseAdmin.storage.from(BUCKET).remove([b.cale]);
    return refuz;
  }
  const media = Object.assign({}, c.media || {});
  const vechi = media[tip] && media[tip].cale;
  media[tip] = { cale: b.cale, latime: d.latime, inaltime: d.inaltime, marime_bytes: info.marime, mime: mimeDinExt };
  if (R.MEDIA[tip].tip === 'video' && d.durata != null) media[tip].durata_s = Math.round(d.durata * 10) / 10;
  const { data, error } = await supabaseAdmin.from(TABEL).update({ media, actualizat_de: admin.id, updated_at: new Date().toISOString() }).eq('id', c.id).select().single();
  if (error) throw new EroareDb(error);
  if (vechi && vechi !== b.cale) await supabaseAdmin.storage.from(BUCKET).remove([vechi]);
  await inregistreazaAudit({ admin, req, actiune: 'campanie_material_salvat', entitate: TABEL, entitate_id: c.id, detalii: { tip, cale: b.cale, marime: info.marime, latime: d.latime, inaltime: d.inaltime } });
  return res.status(200).json({ ok: true, campanie: data, media_urls: await adreseMedia(data, false) });
}

async function stergeMedia(req, res, admin) {
  const b = req.body || {};
  const c = await citeste(b.id);
  if (!c) return refuzLipsa(res);
  if (!R.MEDIA[b.tip]) return trimiteEroare(res, 400, 'TIP_MATERIAL', 'Tip de material necunoscut.', 'Unknown asset type.');
  const media = Object.assign({}, c.media || {});
  const vechi = media[b.tip] && media[b.tip].cale;
  if (!vechi) return res.status(200).json({ ok: true, campanie: c });
  delete media[b.tip];
  if (c.stare === 'activa') {
    const erori = R.valideaza(Object.assign({}, c, { media }), await limite(), { activare: true });
    if (erori.length) {
      return trimiteEroare(res, 409, 'MATERIAL_NECESAR', 'Campania activă are nevoie de acest material: ' + erori[0].ro + ' Readuceți-o la ciornă sau încărcați întâi înlocuitorul.',
        'The active campaign needs this asset: ' + erori[0].en + ' Bring it back to draft or upload the replacement first.', [camp('media.' + b.tip, erori[0].ro, erori[0].en)]);
    }
  }
  const { data, error } = await supabaseAdmin.from(TABEL).update({ media, actualizat_de: admin.id, updated_at: new Date().toISOString() }).eq('id', c.id).select().single();
  if (error) throw new EroareDb(error);
  if (String(vechi).startsWith(prefixMedia(c))) await supabaseAdmin.storage.from(BUCKET).remove([vechi]);
  await inregistreazaAudit({ admin, req, actiune: 'campanie_material_sters', entitate: TABEL, entitate_id: c.id, detalii: { tip: b.tip, cale: vechi } });
  return res.status(200).json({ ok: true, campanie: data, media_urls: await adreseMedia(data, false) });
}

const ACTIUNI = { creeaza, salveaza, stare: schimbaStare, duplica, sterge, url_incarcare: urlIncarcare, confirma_media: confirmaMedia, sterge_media: stergeMedia };

async function handler(req, res, admin) {
  res.setHeader('Cache-Control', 'private, no-store');
  const nivel = await nivelSeo(admin);
  if (!nivel) return refuzaFaraDrept(res);
  const poateScrie = nivel === 'scriere';
  req.query = req.query || {};
  try {
    if (req.method === 'GET') {
      if (req.query.id) {
        const c = await citeste(req.query.id);
        if (!c) return refuzLipsa(res);
        if (req.query.export) {
          const adrese = await adreseMedia(c, true);
          const fisiere = Object.keys(adrese).map((t) => adrese[t]);
          await inregistreazaAudit({ admin, req, actiune: 'campanie_export', entitate: TABEL, entitate_id: c.id, detalii: { fisiere: fisiere.length } });
          return res.status(200).json({ ok: true, export: { nume_arhiva: numeArhiva(c), fisiere, txt: { nume: 'texte.txt', continut: textExport(c) }, link_final: R.linkFinal(c), expira_in_s: EXPIRA_S } });
        }
        return res.status(200).json({ ok: true, campanie: c, media_urls: await adreseMedia(c, false), limite: await limite(), poate_scrie: poateScrie });
      }
      return await lista(req, res, poateScrie);
    }
    if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');
    const actiune = req.body && req.body.actiune;
    const fn = ACTIUNI[actiune];
    if (!fn) return trimiteEroare(res, 400, 'ACTIUNE_INVALIDA', 'Acțiune necunoscută.', 'Unknown action.');
    if (!poateScrie) return refuzaFaraScriere(res);
    return await fn(req, res, admin);
  } catch (err) {
    if (err instanceof EroareDb && migrareLipsa(err.db)) return refuzMigrare(res);
    console.error('[admin/seo-campanii]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare internă. Reîncercați.', 'Internal error. Try again.');
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
module.exports.intern = { citeste, prefixMedia, segmentPagina, limite, BUCKET, TABEL, EroareDb, refuzLipsa, adreseMedia, textExport };

// /api/admin/seo-landing.js
// Paginile de destinație din back-office (pasul 12-L1, 19 nov. 2026; macheta L1.5):
// mydarrin-superadmin.html → SEO → tabul „Pagini de destinație” (seo-panou-landing.js).
//
// Conținutul primului ecran al celor 7 pagini (lib/landing-pagini.js), pe pagină,
// pe variantă („implicita” sau numele din utm_campaign) și pe limbă (RO / EN),
// în tabela landing_continut: ciorna (editată aici) și varianta publicată (citită
// de /api/public/landing). Publicarea cere RO și EN complete; fiecare publicare
// mută versiunea anterioară în landing_continut_istoric, cu revenire.
//
// Acces (lib/permisiuni-seo.js): citirea — superadmin sau admin cu rând pe `seo`;
// orice scriere — superadmin sau admin cu poate_scrie (altfel 403). Fiecare
// scriere se auditează; erorile au forma comună (lib/raspuns-eroare.js), RO + EN,
// cu câmpul greșit. Limitele de caractere se verifică aici (și în baza de date).
//
// GET                              → { ok, pagini:[{ cale, tip, variante:[…] }], url_site, poate_scrie }
// GET ?pagina=&varianta=           → { ok, ciorna:{ro,en}, publicat:{ro,en}|null, imagine, profesie, versiune, istoric:[…], din_implicit }
// POST { actiune:'salveaza', pagina, varianta, profesie, ro:{…}, en:{…} }   → ciorna (o variantă nouă = prima ei salvare)
// POST { actiune:'publica', pagina, varianta }                               → landing_publica (RO + EN complete)
// POST { actiune:'revino', pagina, varianta, versiune }                      → landing_revino
// POST { actiune:'sterge', pagina, varianta }                                → ciorna + publicarea variantei (nu „implicita”)
// POST { actiune:'url_incarcare', pagina, varianta, id, w, mime, marime, latime, inaltime }
//                                  → adresă semnată în seo-og, landing/<pagina>/<varianta>/<id>-<w>.webp
// POST { actiune:'confirma_imagine', pagina, varianta, id, fisiere:[{ w, cale, latime, inaltime }] }
//                                  → verificarea conținutului (WebP, ≤ 300 KB, ≤ 1600 px, fără EXIF / XMP), imaginea pe ciornă
// POST { actiune:'sterge_imagine', pagina, varianta }                       → imaginea scoasă din ciornă

const crypto = require('crypto');
const { requireAuth } = require('../../lib/auth-middleware');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { inregistreazaAudit } = require('../../lib/audit-log');
const { trimiteEroare, camp, formaComuna } = require('../../lib/raspuns-eroare');
const { nivelSeo, refuzaFaraDrept, refuzaFaraScriere } = require('../../lib/permisiuni-seo');
const L = require('../../lib/landing-pagini');
const VF = require('../../lib/verifica-fisier');
const { siteUrl } = require('../../lib/adresa-site');

const TABEL = 'landing_continut';
const ISTORIC = 'landing_continut_istoric';
const BUCKET = 'seo-og';
const IMAGINE_COLOANE = ['imagine_url', 'imagine_latime', 'imagine_inaltime', 'imagine_variante'];

class EroareDb extends Error { constructor(e) { super(e && e.message); this.db = e; } }
function migrareLipsa(err) {
  return !!err && (err.code === '42P01' || err.code === '42703' || err.code === 'PGRST205' || err.code === 'PGRST204' || err.code === 'PGRST202' || err.code === '42883');
}
function refuzMigrare(res) {
  return trimiteEroare(res, 409, 'MIGRARE_LIPSA',
    'Tabelele paginilor de destinație nu există încă: aplicați migrarea docs/migrations-propuse/2026-11-19_pagini-destinatie.sql.',
    'The landing page tables do not exist yet: apply the migration docs/migrations-propuse/2026-11-19_pagini-destinatie.sql.');
}

function segment(pagina) { return String(pagina).replace(/^\/+/, '').replace(/[^a-z0-9._-]+/gi, '-') || 'index'; }
function urlPublic(cale) {
  const baza = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return `${baza}/storage/v1/object/public/${BUCKET}/${cale}`;
}

// Pagina și varianta din corp / adresă: validate, sau răspunsul de eroare deja trimis (null).
function tinta(res, b) {
  const pagina = String((b && b.pagina) || '');
  if (!L.esteCunoscuta(pagina)) {
    trimiteEroare(res, 400, 'PAGINA_INVALIDA', 'Pagina nu este o pagină de destinație.', 'The page is not a landing page.', [camp('pagina', 'Alegeți o pagină din listă.', 'Choose a page from the list.')]);
    return null;
  }
  const varianta = L.numeVarianta(b.varianta);
  if (!varianta) {
    trimiteEroare(res, 400, 'VARIANTA_INVALIDA',
      'Numele variantei e valoarea utm_campaign: litere mici, cifre, punct, cratimă sau liniuță jos, cel mult 60 de caractere (ex. instalatori).',
      'The variant name is the utm_campaign value: lowercase letters, digits, dot, hyphen or underscore, at most 60 characters (e.g. plumbers).',
      [camp('varianta', 'Folosiți doar a-z, 0-9, „.”, „-”, „_” (ex. instalatori).', 'Use only a-z, 0-9, ".", "-", "_" (e.g. plumbers).')]);
    return null;
  }
  return { pagina, varianta };
}

function texteDin(r) {
  const o = {};
  L.CAMPURI_TEXT.forEach((k) => { o[k] = r && r[k] != null ? String(r[k]) : ''; });
  return o;
}
function imagineDin(r) {
  if (!r || !r.imagine_url) return null;
  return { url: r.imagine_url, latime: r.imagine_latime, inaltime: r.imagine_inaltime, variante: Array.isArray(r.imagine_variante) ? r.imagine_variante : [] };
}
function egale(a, b) {
  if (!a || !b) return false;
  return L.CAMPURI_TEXT.every((k) => String(a[k] || '') === String(b[k] || '')) && String(a.imagine_url || '') === String(b.imagine_url || '');
}

async function randuri(pagina, varianta) {
  let q = supabaseAdmin.from(TABEL).select('*');
  if (pagina) q = q.eq('pagina', pagina);
  if (varianta) q = q.eq('varianta', varianta);
  const { data, error } = await q;
  if (error) throw new EroareDb(error);
  return data || [];
}
async function emailuri(ids) {
  const unice = [...new Set(ids.filter(Boolean))];
  if (!unice.length) return {};
  const { data } = await supabaseAdmin.from('profiles').select('id, email').in('id', unice);
  return Object.fromEntries((data || []).map((p) => [p.id, p.email]));
}

// ── Lista ───────────────────────────────────────────────────────────────
async function lista(res, poateScrie) {
  const toate = await randuri();
  const mail = await emailuri(toate.map((r) => r.autor));
  const pagini = L.PAGINI.map((p) => {
    const ale = toate.filter((r) => r.pagina === p.cale);
    const nume = [...new Set([L.IMPLICITA].concat(ale.map((r) => r.varianta)))];
    const variante = nume.map((v) => {
      const rv = ale.filter((r) => r.varianta === v);
      const c = { ro: rv.find((r) => r.stare === 'ciorna' && r.limba === 'ro'), en: rv.find((r) => r.stare === 'ciorna' && r.limba === 'en') };
      const pb = { ro: rv.find((r) => r.stare === 'publicat' && r.limba === 'ro'), en: rv.find((r) => r.stare === 'publicat' && r.limba === 'en') };
      const publicata = !!(pb.ro && pb.en);
      const modificata = publicata && (c.ro || c.en) ? !(egale(c.ro, pb.ro) && egale(c.en, pb.en)) : false;
      const ultim = rv.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
      let stare = 'din_fisier';
      if (publicata) stare = modificata ? 'modificata' : 'publicata';
      else if (rv.length) stare = 'ciorna';
      return {
        varianta: v, stare, versiune: publicata ? pb.ro.versiune : null, publicat_la: publicata ? pb.ro.publicat_la : null,
        actualizat_la: ultim ? ultim.updated_at : null, actualizat_de_email: ultim ? mail[ultim.autor] || null : null,
        profesie: (c.ro && c.ro.profesie) || (pb.ro && pb.ro.profesie) || null,
        link: L.linkReclama(p.cale, v, (c.ro && c.ro.profesie) || (pb.ro && pb.ro.profesie) || null),
      };
    });
    return { cale: p.cale, tip: p.tip, categorie: p.categorie, variante };
  });
  return res.status(200).json({ ok: true, pagini, limite: L.MAXIM, url_site: siteUrl(), poate_scrie: poateScrie });
}

// ── O variantă ──────────────────────────────────────────────────────────
async function detalii(req, res, t, poateScrie) {
  const rv = await randuri(t.pagina, t.varianta);
  const c = { ro: rv.find((r) => r.stare === 'ciorna' && r.limba === 'ro'), en: rv.find((r) => r.stare === 'ciorna' && r.limba === 'en') };
  const pb = { ro: rv.find((r) => r.stare === 'publicat' && r.limba === 'ro'), en: rv.find((r) => r.stare === 'publicat' && r.limba === 'en') };
  const p = L.pagina(t.pagina);
  // Fără ciornă: pornește de la varianta publicată sau, pentru „implicita”, de la textele din pagină.
  let dinImplicit = false;
  const ciorna = {};
  L.LIMBI.forEach((l) => {
    if (c[l]) ciorna[l] = texteDin(c[l]);
    else if (pb[l]) ciorna[l] = texteDin(pb[l]);
    else { ciorna[l] = Object.assign(texteDin(null), p.implicit[l]); dinImplicit = true; }
  });
  const { data: ist, error } = await supabaseAdmin.from(ISTORIC).select('*').eq('pagina', t.pagina).eq('varianta', t.varianta);
  if (error) throw new EroareDb(error);
  const mail = await emailuri(rv.map((r) => r.autor).concat((ist || []).map((r) => r.publicat_de)));
  const versiuni = {};
  (ist || []).forEach((r) => {
    const v = versiuni[r.versiune] || (versiuni[r.versiune] = { versiune: r.versiune, publicat_la: r.publicat_la, publicat_de_email: mail[r.publicat_de] || null, arhivat_la: r.arhivat_la, limbi: [] });
    v.limbi.push(r.limba);
    v['titlu_' + r.limba] = r.titlu;
    if (r.limba === 'ro') v.texte_ro = texteDin(r);
    if (r.limba === 'en') v.texte_en = texteDin(r);
  });
  const sursa = c.ro || pb.ro;
  return res.status(200).json({
    ok: true, pagina: t.pagina, varianta: t.varianta, din_implicit: dinImplicit,
    ciorna, publicat: pb.ro && pb.en ? { ro: texteDin(pb.ro), en: texteDin(pb.en) } : null,
    versiune: pb.ro ? pb.ro.versiune : null, publicat_la: pb.ro ? pb.ro.publicat_la : null,
    imagine: imagineDin(c.ro || pb.ro), imagine_publicata: imagineDin(pb.ro),
    profesie: (sursa && sursa.profesie) || null,
    istoric: Object.values(versiuni).filter((v) => v.limbi.length === 2).sort((a, b) => b.versiune - a.versiune),
    poate_scrie: poateScrie,
  });
}

// ── Scrierile ───────────────────────────────────────────────────────────
function refuzValidare(res, erori, cod, ro, en) {
  return trimiteEroare(res, 400, cod || 'CONTINUT_INVALID',
    ro || `Varianta are ${erori.length} ${erori.length === 1 ? 'problemă' : 'probleme'}: ${erori[0].ro}`,
    en || `The variant has ${erori.length} ${erori.length === 1 ? 'problem' : 'problems'}: ${erori[0].en}`,
    erori.slice(0, 30).map((e) => camp(e.camp, e.ro, e.en)));
}

async function salveaza(req, res, admin) {
  const b = req.body || {};
  const t = tinta(res, b);
  if (!t) return null;
  if (!L.profesieValida(b.profesie)) {
    return trimiteEroare(res, 400, 'PROFESIE_INVALIDA', 'Profesia din link e un cod scurt, cu litere mici și cratimă (ex. instalator).',
      'The trade in the link is a short code, lowercase with hyphens (e.g. instalator).', [camp('profesie', 'Alegeți profesia din listă.', 'Choose the trade from the list.')]);
  }
  const erori = [];
  const texte = {};
  L.LIMBI.forEach((l) => {
    const sursa = b[l] && typeof b[l] === 'object' ? b[l] : {};
    texte[l] = {};
    L.CAMPURI_TEXT.forEach((k) => { texte[l][k] = L.curat(sursa[k]) || null; });
    L.valideazaLimba(texte[l], l).forEach((e) => erori.push(e));
  });
  if (erori.length) return refuzValidare(res, erori);
  const existente = await randuri(t.pagina, t.varianta);
  const acum = new Date().toISOString();
  for (const l of L.LIMBI) {
    const vechi = existente.find((r) => r.stare === 'ciorna' && r.limba === l);
    const pub = existente.find((r) => r.stare === 'publicat' && r.limba === l);
    const rand = Object.assign({ pagina: t.pagina, varianta: t.varianta, limba: l, stare: 'ciorna', profesie: b.profesie || null, autor: admin.id, updated_at: acum }, texte[l]);
    if (vechi) {
      const { error } = await supabaseAdmin.from(TABEL).update(rand).eq('id', vechi.id);
      if (error) throw new EroareDb(error);
    } else {
      // Prima ciornă: păstrează imaginea și versiunea variantei publicate (dacă există).
      const baza = pub ? Object.fromEntries(IMAGINE_COLOANE.map((k) => [k, pub[k]])) : {};
      const { error } = await supabaseAdmin.from(TABEL).insert(Object.assign(baza, rand, { versiune: pub ? pub.versiune : 0, created_at: acum }));
      if (error) throw new EroareDb(error);
    }
  }
  await inregistreazaAudit({ admin, req, actiune: 'landing_ciorna_salvata', entitate: TABEL, entitate_id: `${t.pagina}|${t.varianta}`, detalii: { pagina: t.pagina, varianta: t.varianta } });
  return detalii(req, res, t, true);
}

async function publica(req, res, admin) {
  const t = tinta(res, req.body || {});
  if (!t) return null;
  const rv = await randuri(t.pagina, t.varianta);
  const c = { ro: rv.find((r) => r.stare === 'ciorna' && r.limba === 'ro'), en: rv.find((r) => r.stare === 'ciorna' && r.limba === 'en') };
  if (!c.ro && !c.en) {
    return trimiteEroare(res, 409, 'FARA_CIORNA', 'Salvați întâi ciorna variantei, apoi publicați.', 'Save the variant draft first, then publish.');
  }
  const erori = [];
  L.LIMBI.forEach((l) => { L.valideazaLimba(c[l] || {}, l, { publicare: true }).forEach((e) => erori.push(e)); });
  if (erori.length) {
    const faraEn = erori.some((e) => /^en\./.test(e.camp));
    const faraRo = erori.some((e) => /^ro\./.test(e.camp));
    if (faraEn && !faraRo) {
      return refuzValidare(res, erori, 'PUBLICARE_FARA_EN',
        'Varianta se publică doar cu RO și EN complete: completați în tabul „English” ' + erori.map((e) => e.ro.split(' (')[0].toLowerCase()).filter((x, i, a) => a.indexOf(x) === i).join(', ') + '.',
        'The variant can be published only with RO and EN complete: fill in on the “English” tab ' + erori.map((e) => e.en.split(' (')[0].toLowerCase()).filter((x, i, a) => a.indexOf(x) === i).join(', ') + '.');
    }
    return refuzValidare(res, erori, 'PUBLICARE_INCOMPLETA',
      'Varianta se publică doar cu RO și EN complete. ' + erori[0].ro, 'The variant can be published only with RO and EN complete. ' + erori[0].en);
  }
  const { data, error } = await supabaseAdmin.rpc('landing_publica', { p_pagina: t.pagina, p_varianta: t.varianta, p_autor: admin.id });
  if (error) {
    if (/LANDING_(INCOMPLET|LIPSA_LIMBA)/.test(error.message || '')) {
      return trimiteEroare(res, 409, 'PUBLICARE_INCOMPLETA', 'Varianta se publică doar cu RO și EN complete.', 'The variant can be published only with RO and EN complete.');
    }
    throw new EroareDb(error);
  }
  await inregistreazaAudit({ admin, req, actiune: 'landing_publicata', entitate: TABEL, entitate_id: `${t.pagina}|${t.varianta}`, detalii: { pagina: t.pagina, varianta: t.varianta, versiune: data } });
  return detalii(req, res, t, true);
}

async function revino(req, res, admin) {
  const b = req.body || {};
  const t = tinta(res, b);
  if (!t) return null;
  const versiune = Number(b.versiune);
  if (!Number.isInteger(versiune) || versiune < 1) {
    return trimiteEroare(res, 400, 'VERSIUNE_INVALIDA', 'Alegeți o versiune din istoric.', 'Choose a version from the history.', [camp('versiune', 'Alegeți o versiune din istoric.', 'Choose a version from the history.')]);
  }
  const { data, error } = await supabaseAdmin.rpc('landing_revino', { p_pagina: t.pagina, p_varianta: t.varianta, p_versiune: versiune, p_autor: admin.id });
  if (error) {
    if (/LANDING_VERSIUNE_LIPSA/.test(error.message || '')) return trimiteEroare(res, 404, 'VERSIUNE_LIPSA', 'Versiunea nu mai există în istoric.', 'The version is no longer in the history.');
    throw new EroareDb(error);
  }
  await inregistreazaAudit({ admin, req, actiune: 'landing_revenire', entitate: TABEL, entitate_id: `${t.pagina}|${t.varianta}`, detalii: { pagina: t.pagina, varianta: t.varianta, din: versiune, versiune_noua: data } });
  return detalii(req, res, t, true);
}

async function sterge(req, res, admin) {
  const t = tinta(res, req.body || {});
  if (!t) return null;
  if (t.varianta === L.IMPLICITA) {
    return trimiteEroare(res, 409, 'IMPLICITA', 'Varianta implicită nu se șterge; o puteți edita sau reveni la o versiune din istoric.',
      'The default variant cannot be deleted; you can edit it or roll back to a version from the history.');
  }
  const { error } = await supabaseAdmin.from(TABEL).delete().eq('pagina', t.pagina).eq('varianta', t.varianta);
  if (error) throw new EroareDb(error);
  await inregistreazaAudit({ admin, req, actiune: 'landing_varianta_stearsa', entitate: TABEL, entitate_id: `${t.pagina}|${t.varianta}`, detalii: { pagina: t.pagina, varianta: t.varianta } });
  return res.status(200).json({ ok: true });
}

// ── Imaginea: direct din browser în Storage, pe adresă semnată ───────────
function refuzImagine(res, ro, en, cod) {
  return trimiteEroare(res, 400, cod || 'IMAGINE_INVALIDA', ro, en, [camp('imagine', ro, en)]);
}
function verificaDeclarat(res, b) {
  if (b.mime !== L.IMAGINE.mime) {
    return refuzImagine(res, 'Imaginea se încarcă în format WebP (convertită automat de panou). Alegeți un JPG, PNG sau WebP și încercați din nou.',
      'The image is uploaded as WebP (converted automatically by the panel). Choose a JPG, PNG or WebP and try again.', 'TIP_FISIER');
  }
  const marime = Number(b.marime);
  if (!(marime > 0) || marime > L.IMAGINE.marimeMaxima) {
    return refuzImagine(res, `Imaginea are peste ${L.IMAGINE.marimeMaxima / 1024} KB. Alegeți o imagine mai simplă sau mai mică.`,
      `The image is larger than ${L.IMAGINE.marimeMaxima / 1024} KB. Choose a simpler or smaller image.`, 'FISIER_PREA_MARE');
  }
  const lat = Number(b.latime), ina = Number(b.inaltime);
  if (!Number.isInteger(lat) || !Number.isInteger(ina) || lat < 1 || ina < 1 || Math.max(lat, ina) > L.IMAGINE.laturaMaxima) {
    return refuzImagine(res, `Latura mare a imaginii trebuie să fie de cel mult ${L.IMAGINE.laturaMaxima} px.`,
      `The long edge of the image must be at most ${L.IMAGINE.laturaMaxima} px.`, 'DIMENSIUNI');
  }
  return null;
}
const RE_ID = /^[a-f0-9]{12}$/;
async function urlIncarcare(req, res, admin) {
  const b = req.body || {};
  const t = tinta(res, b);
  if (!t) return null;
  const refuz = verificaDeclarat(res, b);
  if (refuz) return refuz;
  const id = RE_ID.test(String(b.id || '')) ? b.id : crypto.randomBytes(6).toString('hex');
  const w = Number(b.w);
  if (!L.IMAGINE.latimi.includes(w)) return refuzImagine(res, 'Lățimea variantei de imagine nu e permisă.', 'The image width is not allowed.');
  const cale = `landing/${segment(t.pagina)}/${t.varianta}/${id}-${w}.webp`;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(cale);
  if (error || !data) {
    console.error('[admin/seo-landing url_incarcare]', error);
    return trimiteEroare(res, 503, 'BUCKET_INDISPONIBIL', 'Nu am putut pregăti încărcarea. Verificați că bucket-ul seo-og există (migrarea 2026-11-19).',
      'We could not prepare the upload. Check that the seo-og bucket exists (the 2026-11-19 migration).');
  }
  await inregistreazaAudit({ admin, req, actiune: 'landing_imagine_incarcare', entitate: 'storage', entitate_id: `${BUCKET}/${cale}`, detalii: { marime: Number(b.marime), latime: Number(b.latime), inaltime: Number(b.inaltime) } });
  return res.status(200).json({ ok: true, id, bucket: BUCKET, cale: data.path || cale, token: data.token, url_semnat: data.signedUrl });
}

async function confirmaImagine(req, res, admin) {
  const b = req.body || {};
  const t = tinta(res, b);
  if (!t) return null;
  const id = String(b.id || '');
  const fisiere = Array.isArray(b.fisiere) ? b.fisiere.slice(0, L.IMAGINE.latimi.length) : [];
  const toateCaile = fisiere.map((f) => String(f && f.cale || ''));
  const curata = async () => { const v = toateCaile.filter((c) => c.startsWith('landing/')); if (v.length) await supabaseAdmin.storage.from(BUCKET).remove(v); };
  if (!RE_ID.test(id) || !fisiere.length) return refuzImagine(res, 'Încărcarea imaginii nu e completă. Încercați din nou.', 'The image upload is not complete. Try again.', 'CALE_INVALIDA');
  const variante = [];
  for (const f of fisiere) {
    const w = Number(f.w);
    const asteptata = `landing/${segment(t.pagina)}/${t.varianta}/${id}-${w}.webp`;
    if (!L.IMAGINE.latimi.includes(w) || f.cale !== asteptata) {
      await curata();
      return refuzImagine(res, 'Calea imaginii nu aparține acestei pagini și variante.', 'The image path does not belong to this page and variant.', 'CALE_INVALIDA');
    }
    const info = await VF.inspecteaza(supabaseAdmin, BUCKET, f.cale);
    if (!info.exista) { await curata(); return refuzImagine(res, 'Imaginea nu s-a găsit în stocare. Încărcați-o din nou.', 'The image was not found in storage. Upload it again.', 'FISIER_LIPSA'); }
    const wp = VF.infoWebp(info.octeti);
    let refuz = null;
    if (info.tip !== 'image/webp' || !wp) refuz = ['Conținutul fișierului nu e o imagine WebP (verificat pe server). Imaginea trebuie convertită de panou.', 'The file content is not a WebP image (checked on the server). The image must be converted by the panel.', 'CONTINUT_INVALID'];
    else if (!(info.marime > 0) || info.marime > L.IMAGINE.marimeMaxima) refuz = [`Imaginea are peste ${L.IMAGINE.marimeMaxima / 1024} KB (verificat pe server).`, `The image is larger than ${L.IMAGINE.marimeMaxima / 1024} KB (checked on the server).`, 'FISIER_PREA_MARE'];
    else if (Math.max(wp.latime, wp.inaltime) > L.IMAGINE.laturaMaxima) refuz = [`Latura mare a imaginii depășește ${L.IMAGINE.laturaMaxima} px.`, `The long edge of the image exceeds ${L.IMAGINE.laturaMaxima} px.`, 'DIMENSIUNI'];
    else if (wp.metadate) refuz = ['Imaginea conține metadate (EXIF sau XMP). Încărcați-o din nou din panou, care le elimină.', 'The image contains metadata (EXIF or XMP). Upload it again from the panel, which removes them.', 'METADATE'];
    if (refuz) { await curata(); return refuzImagine(res, refuz[0], refuz[1], refuz[2]); }
    variante.push({ w, url: urlPublic(f.cale), latime: wp.latime, inaltime: wp.inaltime, marime: info.marime });
  }
  variante.sort((a, c) => a.w - c.w);
  const mare = variante[variante.length - 1];
  const imagine = { imagine_url: mare.url, imagine_latime: mare.latime, imagine_inaltime: mare.inaltime, imagine_variante: variante.map((v) => ({ w: v.latime, url: v.url })) };
  await aplicaPeCiorna(t, imagine, admin);
  await inregistreazaAudit({ admin, req, actiune: 'landing_imagine_salvata', entitate: TABEL, entitate_id: `${t.pagina}|${t.varianta}`, detalii: { id, variante: variante.map((v) => `${v.latime}x${v.inaltime}:${v.marime}`) } });
  return detalii(req, res, t, true);
}

// Imaginea pe ciorna ambelor limbi (ciorna se creează din publicat sau din textele implicite, dacă lipsește).
async function aplicaPeCiorna(t, imagine, admin) {
  const rv = await randuri(t.pagina, t.varianta);
  const p = L.pagina(t.pagina);
  const acum = new Date().toISOString();
  for (const l of L.LIMBI) {
    const c = rv.find((r) => r.stare === 'ciorna' && r.limba === l);
    if (c) {
      const { error } = await supabaseAdmin.from(TABEL).update(Object.assign({}, imagine, { autor: admin.id, updated_at: acum })).eq('id', c.id);
      if (error) throw new EroareDb(error);
    } else {
      const pub = rv.find((r) => r.stare === 'publicat' && r.limba === l);
      const texte = pub ? texteDin(pub) : (t.varianta === L.IMPLICITA ? Object.assign(texteDin(null), p.implicit[l]) : texteDin(null));
      L.CAMPURI_TEXT.forEach((k) => { if (!texte[k]) texte[k] = null; });
      const { error } = await supabaseAdmin.from(TABEL).insert(Object.assign({ pagina: t.pagina, varianta: t.varianta, limba: l, stare: 'ciorna', profesie: pub ? pub.profesie : null,
        versiune: pub ? pub.versiune : 0, autor: admin.id, created_at: acum, updated_at: acum }, texte, imagine));
      if (error) throw new EroareDb(error);
    }
  }
}

async function stergeImagine(req, res, admin) {
  const t = tinta(res, req.body || {});
  if (!t) return null;
  const { error } = await supabaseAdmin.from(TABEL).update({ imagine_url: null, imagine_latime: null, imagine_inaltime: null, imagine_variante: [], updated_at: new Date().toISOString(), autor: admin.id })
    .eq('pagina', t.pagina).eq('varianta', t.varianta).eq('stare', 'ciorna');
  if (error) throw new EroareDb(error);
  await inregistreazaAudit({ admin, req, actiune: 'landing_imagine_scoasa', entitate: TABEL, entitate_id: `${t.pagina}|${t.varianta}`, detalii: { pagina: t.pagina, varianta: t.varianta } });
  return detalii(req, res, t, true);
}

const ACTIUNI = { salveaza, publica, revino, sterge, url_incarcare: urlIncarcare, confirma_imagine: confirmaImagine, sterge_imagine: stergeImagine };

async function handler(req, res, admin) {
  res.setHeader('Cache-Control', 'private, no-store');
  const nivel = await nivelSeo(admin);
  if (!nivel) return refuzaFaraDrept(res);
  const poateScrie = nivel === 'scriere';
  req.query = req.query || {};
  try {
    if (req.method === 'GET') {
      if (req.query.pagina) {
        const t = tinta(res, { pagina: req.query.pagina, varianta: req.query.varianta || L.IMPLICITA });
        if (!t) return null;
        return await detalii(req, res, t, poateScrie);
      }
      return await lista(res, poateScrie);
    }
    if (req.method !== 'POST') return trimiteEroare(res, 405, 'METODA', 'Metodă nepermisă.', 'Method not allowed.');
    const fn = ACTIUNI[req.body && req.body.actiune];
    if (!fn) return trimiteEroare(res, 400, 'ACTIUNE_INVALIDA', 'Acțiune necunoscută.', 'Unknown action.');
    if (!poateScrie) return refuzaFaraScriere(res);
    return await fn(req, res, admin);
  } catch (err) {
    if (err instanceof EroareDb && migrareLipsa(err.db)) return refuzMigrare(res);
    if (err instanceof EroareDb && err.db && err.db.code === '23514') {
      return trimiteEroare(res, 400, 'CONTINUT_INVALID', 'Baza de date a refuzat conținutul (o limită de caractere sau un câmp obligatoriu).',
        'The database rejected the content (a character limit or a required field).');
    }
    console.error('[admin/seo-landing]', err);
    return trimiteEroare(res, 500, 'EROARE_SERVER', 'Eroare internă. Reîncercați.', 'Internal error. Try again.');
  }
}

module.exports = formaComuna(requireAuth(['admin', 'superadmin'], handler));
module.exports.intern = { segment, TABEL, ISTORIC, BUCKET };

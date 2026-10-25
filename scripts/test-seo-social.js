// scripts/test-seo-social.js
// Pasul 11-S (23 oct. 2026): testele unitare ale SEO-ului pe limbă, ale
// previzualizărilor la partajare (OG) și ale campaniilor social media, cu
// handler-ele reale peste Supabase-ul simulat (scripts/supabase-simulat.js).
// Nimic nu ajunge la producție.
//   L. SEO pe limbă: ro → RO; en, bg, de, el, fr, tr → EN; fără migrare → null;
//   D. drepturile: superadmin; admin `seo` cu / fără poate_scrie; admin fără rând; fără rol → 403;
//   O. middleware-ul pentru roboții de previzualizare (în scripts/test-seo-og-middleware.js);
//   C. campaniile: validare (lungimi, CTA, URL, UTM, materiale), stări, duplicare, export;
//   U. încărcarea materialelor: adrese semnate, calea, verificarea conținutului.
// Rulare: node scripts/test-seo-social.js   (DOAR=L|D|C|U)

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;

const apiPublic = require(path.join(RADACINA, 'api/public/seo-config.js'));
const apiSeo = require(path.join(RADACINA, 'api/admin/seo.js'));
const SP = require(path.join(RADACINA, 'lib/seo-pagini.js'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) { ok++; } else { esec++; console.log('  ✗ ' + m); } }
const DOAR = process.env.DOAR || '';
const ruleaza = (s) => !DOAR || DOAR.includes(s);

function reset() {
  DB.tabele = {
    profiles: [
      { id: 'sup', email: 'super@example.com', roles: ['superadmin'] },
      { id: 'scr', email: 'seo-scriere@example.com', roles: ['admin'] },
      { id: 'cit', email: 'seo-citire@example.com', roles: ['admin'] },
      { id: 'adm', email: 'fara-drept@example.com', roles: ['admin'] },
      { id: 'cli', email: 'client@example.com', roles: ['client'] },
      { id: 'fara', email: 'fara-rol@example.com', roles: [] },
    ],
    admin_permissions: [
      { admin_id: 'scr', sectiune: 'seo', poate_scrie: true },
      { admin_id: 'cit', sectiune: 'seo', poate_scrie: false },
      { admin_id: 'adm', sectiune: 'investitori', poate_scrie: true },
    ],
    audit_log: [],
    seo_config: [],
    seo_campanii_social: [],
    backoffice_config: [],
  };
  DB.coloane = {
    seo_config: ['id', 'page_path', 'limba', 'meta_title', 'meta_description', 'canonical_url', 'og_titlu', 'og_descriere', 'og_imagine_url', 'og_imagine_alt', 'og_imagine_latime', 'og_imagine_inaltime', 'updated_at', 'updated_by'],
  };
  DB.storage = {};
  DB.utilizatori = {
    'tok-sup': { id: 'sup', email: 'super@example.com' }, 'tok-scr': { id: 'scr', email: 'seo-scriere@example.com' },
    'tok-cit': { id: 'cit', email: 'seo-citire@example.com' }, 'tok-adm': { id: 'adm', email: 'fara-drept@example.com' },
    'tok-cli': { id: 'cli', email: 'client@example.com' }, 'tok-fara': { id: 'fara', email: 'fara-rol@example.com' },
  };
}

async function apel(api, { metoda = 'GET', token = null, query = {}, body = null } = {}) {
  const res = raspuns();
  await api(cerere({ metoda, token, query, body }), res);
  return res;
}

(async () => {
  // ── L. SEO pe limbă ───────────────────────────────────────────────────
  if (ruleaza('L')) {
    reset();
    verifica(SP.limbaSeo('ro') === 'ro' && SP.limbaSeo('RO-ro') === 'ro', 'limbaSeo: ro → ro');
    ['en', 'bg', 'de', 'el', 'fr', 'tr', '', null, 'xx'].forEach((l) => verifica(SP.limbaSeo(l) === 'en', `limbaSeo: ${l} → en`));
    verifica(SP.caleSeo('/despre-noi.html') === '/despre-noi' && SP.caleSeo('/index') === '/' && SP.caleSeo('/') === '/' && SP.caleSeo('/mydarrin-devino-partener') === '/partener',
      'caleSeo: .html, /index și fișierul scurtăturii /partener');

    let r = await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/despre-noi', limba: 'ro', meta_title: 'Titlu RO', meta_description: 'Descriere RO' } });
    verifica(r.statusCode === 200 && r.corp.config.limba === 'ro', 'superadmin salvează varianta RO');
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/despre-noi', limba: 'en', meta_title: 'Title EN' } });
    verifica(r.statusCode === 200 && DB.tabele.seo_config.length === 2, 'varianta EN e un rând separat (page_path, limba)');
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/despre-noi', limba: 'ro', meta_title: 'Titlu RO 2' } });
    verifica(DB.tabele.seo_config.length === 2 && DB.tabele.seo_config.find((x) => x.limba === 'ro').meta_title === 'Titlu RO 2', 'a doua salvare RO actualizează același rând');

    for (const [lang, asteptat] of [['ro', 'Titlu RO 2'], ['en', 'Title EN'], ['bg', 'Title EN'], ['de', 'Title EN'], ['el', 'Title EN'], ['fr', 'Title EN'], ['tr', 'Title EN']]) {
      r = await apel(apiPublic, { query: { path: '/despre-noi', lang } });
      verifica(r.statusCode === 200 && r.corp.config && r.corp.config.meta_title === asteptat, `public ?lang=${lang} → ${asteptat} (${JSON.stringify(r.corp)})`);
    }
    r = await apel(apiPublic, { query: { path: '/despre-noi.html', lang: 'en' } });
    verifica(r.corp.config && r.corp.config.meta_title === 'Title EN', 'public: /despre-noi.html găsește suprascrierea paginii');
    r = await apel(apiPublic, { query: { path: '/despre-noi' } });
    verifica(r.corp.config && r.corp.config.meta_title === 'Titlu RO 2', 'public fără lang → RO');
    r = await apel(apiPublic, { query: { path: '/mydarrin-contact', lang: 'en' } });
    verifica(r.statusCode === 200 && r.corp.config === null, 'pagină fără suprascriere → config null');
    verifica(r.headere['Cache-Control'] === 'public, max-age=300', 'cache public de 5 minute');

    // Nicio scurgere a titlului RO pe EN: doar RO salvat → EN primește null.
    await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/cum-platesc', limba: 'ro', meta_title: 'Doar RO' } });
    r = await apel(apiPublic, { query: { path: '/cum-platesc', lang: 'en' } });
    verifica(r.corp.config === null, 'doar RO salvat → vizitatorul EN nu primește titlul RO');

    r = await apel(apiSeo, { metoda: 'DELETE', token: 'tok-sup', query: { page_path: '/despre-noi', limba: 'en' } });
    verifica(r.statusCode === 200 && DB.tabele.seo_config.filter((x) => x.page_path === '/despre-noi').length === 1, 'ștergerea EN lasă varianta RO');

    r = await apel(apiSeo, { token: 'tok-sup' });
    const p = r.corp.pagini.find((x) => x.page_path === '/despre-noi');
    verifica(r.statusCode === 200 && p && p.override.ro && p.override.ro.meta_title === 'Titlu RO 2' && p.override.en === null && r.corp.poate_scrie === true, 'GET: suprascrierile pe limbă ale fiecărei pagini');

    // Validări
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/despre-noi', limba: 'de', meta_title: 'x' } });
    verifica(r.statusCode === 400 && r.corp.cod === 'LIMBA_INVALIDA', 'limba de → 400');
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/mydarrin-superadmin', limba: 'ro', meta_title: 'x' } });
    verifica(r.statusCode === 400 && r.corp.cod === 'PAGINA_INVALIDA', 'pagină din afara listei → 400');
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/despre-noi', limba: 'ro', canonical_url: 'javascript:alert(1)' } });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'canonical_url'), 'URL canonic fără https → 400 pe câmpul canonical_url');
    verifica(DB.tabele.audit_log.some((a) => a.actiune === 'seo_salvat') && DB.tabele.audit_log.some((a) => a.actiune === 'seo_sters'), 'salvarea și ștergerea se auditează');

    // Fără migrare: coloana limba lipsește → public null, admin 409.
    DB.coloane.seo_config = ['id', 'page_path', 'meta_title', 'meta_description', 'canonical_url', 'updated_at', 'updated_by'];
    r = await apel(apiPublic, { query: { path: '/despre-noi', lang: 'ro' } });
    verifica(r.statusCode === 200 && r.corp.config === null, 'fără migrare: public → config null (nu titlul greșit)');
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/despre-noi', limba: 'ro', meta_title: 'x' } });
    verifica(r.statusCode === 409 && r.corp.cod === 'MIGRARE_LIPSA', 'fără migrare: admin → 409 MIGRARE_LIPSA');
  }

  // ── D. Drepturile pe secțiunea SEO ────────────────────────────────────
  if (ruleaza('D')) {
    reset();
    const corp = { page_path: '/despre-noi', limba: 'ro', meta_title: 'x' };
    let r = await apel(apiSeo, { token: 'tok-scr' });
    verifica(r.statusCode === 200 && r.corp.poate_scrie === true, 'admin seo cu poate_scrie: citire + poate_scrie');
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-scr', body: corp });
    verifica(r.statusCode === 200, 'admin seo cu poate_scrie: salvează');
    r = await apel(apiSeo, { token: 'tok-cit' });
    verifica(r.statusCode === 200 && r.corp.poate_scrie === false, 'admin seo fără poate_scrie: citește, poate_scrie false');
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-cit', body: corp });
    verifica(r.statusCode === 403 && r.corp.cod === 'FARA_DREPT_SCRIERE', 'admin seo fără poate_scrie: salvarea → 403 FARA_DREPT_SCRIERE');
    r = await apel(apiSeo, { metoda: 'DELETE', token: 'tok-cit', query: { page_path: '/despre-noi', limba: 'ro' } });
    verifica(r.statusCode === 403, 'admin seo fără poate_scrie: ștergerea → 403');
    r = await apel(apiSeo, { token: 'tok-adm' });
    verifica(r.statusCode === 403 && r.corp.cod === 'FARA_DREPT', 'admin fără rând pe seo → 403');
    r = await apel(apiSeo, { token: 'tok-cli' });
    verifica(r.statusCode === 403, 'client → 403');
    r = await apel(apiSeo, { token: 'tok-fara' });
    verifica(r.statusCode === 403, 'fără rol → 403');
    r = await apel(apiSeo, {});
    verifica(r.statusCode === 401, 'fără sesiune → 401');
    DB.tabele.admin_permissions = null;   // eroare la citire → fail-closed
    r = await apel(apiSeo, { token: 'tok-scr' });
    verifica(r.statusCode === 403, 'eroare la citirea admin_permissions → 403 (fail-closed)');
  }

  // ── C. Campaniile ─────────────────────────────────────────────────────
  if (ruleaza('C')) {
    const apiC = require(path.join(RADACINA, 'api/admin/seo-campanii.js'));
    const R = require(path.join(RADACINA, 'lib/seo-campanii.js'));
    reset();
    const post = (token, body) => apel(apiC, { metoda: 'POST', token, body });
    const baza = { actiune: 'creeaza', page_path: '/despre-noi', limba: 'ro', nume_campanie: 'Lansare DE TEST', platforme: ['facebook', 'tiktok'] };

    let r = await post('tok-sup', baza);
    verifica(r.statusCode === 200 && r.corp.campanie.stare === 'ciorna' && r.corp.campanie.limba === 'ro', 'creare: ciornă RO');
    const id = r.corp.campanie.id;
    r = await post('tok-sup', baza);
    verifica(r.statusCode === 409 && r.corp.cod === 'NUME_EXISTENT', 'același nume, aceeași pagină și limbă → 409');
    r = await post('tok-sup', { ...baza, nume_campanie: '  ' });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'nume_campanie'), 'nume gol → 400 pe nume_campanie');
    r = await post('tok-sup', { ...baza, page_path: '/mydarrin-superadmin', nume_campanie: 'x' });
    verifica(r.statusCode === 400 && r.corp.cod === 'PAGINA_INVALIDA', 'pagină nepublică → 400');

    // Lungimile, pe platformele bifate (Meta 40 / 125 / 30, TikTok 100)
    const s = (n) => 'a'.repeat(n);
    r = await post('tok-sup', { actiune: 'salveaza', id, titlu_reclama: s(41) });
    verifica(r.statusCode === 400 && r.corp.campuri[0].camp === 'titlu_reclama' && /Meta 40/.test(r.corp.mesaj.ro), 'titlu de 41 cu Facebook bifat → refuzat (Meta 40)');
    r = await post('tok-sup', { actiune: 'salveaza', id, titlu_reclama: s(40), text_principal: s(101) });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'text_principal') && /TikTok 100/.test(r.corp.mesaj.ro), 'text de 101 cu TikTok bifat → refuzat (TikTok 100)');
    r = await post('tok-sup', { actiune: 'salveaza', id, platforme: ['youtube'], titlu_reclama: s(200), text_principal: s(300) });
    verifica(r.statusCode === 200, 'doar YouTube bifat: fără limită implicită (200 / 300 de caractere acceptate)');
    r = await post('tok-sup', { actiune: 'salveaza', id, platforme: ['facebook'], titlu_reclama: s(40), text_principal: s(125), descriere_link: s(31) });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'descriere_link'), 'descrierea de 31 cu Facebook → refuzată (Meta 30)');
    DB.tabele.backoffice_config.push({ cheie: 'campanii_limite_meta_descriere', valoare: '60', tara_cod: 'ALL' });
    r = await post('tok-sup', { actiune: 'salveaza', id, platforme: ['facebook'], titlu_reclama: s(40), text_principal: s(125), descriere_link: s(31) });
    verifica(r.statusCode === 200, 'limita din backoffice_config (60) are prioritate față de cea implicită');
    r = await apel(apiC, { token: 'tok-sup', query: { page_path: '/despre-noi' } });
    verifica(r.corp.limite.meta_descriere === 60 && r.corp.limite.meta_titlu === 40 && r.corp.campanii.length === 1, 'GET: lista paginii și limitele în vigoare');
    // Platformele, CTA, URL, UTM
    r = await post('tok-sup', { actiune: 'salveaza', id, platforme: ['facebook', 'snapchat'] });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'platforme'), 'platformă din afara listei → refuzată');
    r = await post('tok-sup', { actiune: 'salveaza', id, cta: 'click_aici' });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'cta'), 'CTA din afara listei → refuzat');
    for (const u of ['http://mydarrin.homebestpal.com/x', 'https://evil.example.com/', 'https://mydarrin.homebestpal.com.evil.com/', 'https://admin.mydarrin.homebestpal.com/', 'javascript:alert(1)', 'https://user:p@mydarrin.homebestpal.com/']) {
      r = await post('tok-sup', { actiune: 'salveaza', id, url_destinatie: u });
      verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'url_destinatie'), 'URL în afara domeniului / fără https → refuzat: ' + u);
    }
    r = await post('tok-sup', { actiune: 'salveaza', id, utm_campaign: 'lansare octombrie' });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'utm_campaign'), 'UTM cu spațiu → refuzat');
    r = await post('tok-sup', { actiune: 'salveaza', id, cta: 'cere_oferta', url_destinatie: 'https://mydarrin.homebestpal.com/despre-noi?x=1', utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'lansare-oct', utm_content: 'patrat_1' });
    verifica(r.statusCode === 200, 'CTA, URL și UTM valide → salvate');
    verifica(R.linkFinal(r.corp.campanie) === 'https://mydarrin.homebestpal.com/despre-noi?x=1&utm_source=facebook&utm_medium=paid_social&utm_campaign=lansare-oct&utm_content=patrat_1', 'linkul final cu UTM: ' + R.linkFinal(r.corp.campanie));

    // Activarea cere materialele platformelor bifate
    r = await post('tok-sup', { actiune: 'salveaza', id, platforme: ['facebook', 'tiktok', 'youtube'], text_principal: 'Text DE TEST' });
    r = await post('tok-sup', { actiune: 'stare', id, stare: 'activa' });
    const campuri = (r.corp.campuri || []).map((c) => c.camp);
    verifica(r.statusCode === 400 && campuri.includes('media.video_vertical') && campuri.includes('media.video_orizontal') && campuri.includes('media.imagine_patrat'),
      'activarea fără materiale → refuzată (TikTok: 9:16; YouTube: 16:9 sau 9:16; Facebook: pătrat / 4:5 / video) ' + JSON.stringify(campuri));
    const c0 = DB.tabele.seo_campanii_social.find((x) => x.id === id);
    const pref = `despre-noi/ro/${id}/`;
    c0.media = { video_vertical: { cale: pref + 'video_vertical.mp4', latime: 1080, inaltime: 1920, durata_s: 15, marime_bytes: 1000, mime: 'video/mp4' } };
    r = await post('tok-sup', { actiune: 'stare', id, stare: 'activa' });
    verifica(r.statusCode === 200 && r.corp.campanie.stare === 'activa', 'cu video 9:16: TikTok, YouTube și Facebook sunt acoperite → activă');
    r = await post('tok-sup', { actiune: 'salveaza', id, platforme: ['facebook', 'general_patrat'] });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'media.imagine_patrat'), 'campanie activă: bifarea unei platforme fără material → refuzată');
    r = await post('tok-cit', { actiune: 'stare', id, stare: 'ciorna' });
    verifica(r.statusCode === 403 && r.corp.cod === 'FARA_DREPT_SCRIERE', 'schimbarea stării fără poate_scrie → 403');
    r = await post('tok-sup', { actiune: 'sterge', id });
    verifica(r.statusCode === 409 && r.corp.cod === 'DOAR_CIORNE', 'ștergerea unei campanii active → 409 (doar ciornele)');

    // Duplicare RO → EN: textele goale, restul copiat, materialele nu
    r = await post('tok-sup', { actiune: 'duplica', id, limba: 'en' });
    const en = r.corp.campanie;
    verifica(r.statusCode === 200 && en.limba === 'en' && en.stare === 'ciorna' && en.nume_campanie === 'Lansare DE TEST (EN)' && en.titlu_reclama === null && en.text_principal === null && en.descriere_link === null
      && en.cta === 'cere_oferta' && en.utm_source === 'facebook' && JSON.stringify(en.platforme) === JSON.stringify(['facebook', 'tiktok', 'youtube']) && JSON.stringify(en.media) === '{}',
      'duplicare RO → EN: ciornă, textele goale de tradus, CTA / UTM / platforme copiate, fără materiale ' + JSON.stringify(en));
    r = await post('tok-sup', { actiune: 'duplica', id: en.id, limba: 'en' });
    verifica(r.statusCode === 200 && r.corp.campanie.nume_campanie === 'Lansare DE TEST (copie)', 'duplicare în aceeași limbă: „(copie)” ' + r.corp.campanie.nume_campanie);
    r = await post('tok-sup', { actiune: 'duplica', id: en.id, limba: 'en' });
    verifica(r.statusCode === 200 && r.corp.campanie.nume_campanie === 'Lansare DE TEST (copie 2)', 'a doua copie: „(copie 2)” ' + r.corp.campanie.nume_campanie);
    r = await post('tok-sup', { actiune: 'duplica', id, limba: 'de' });
    verifica(r.statusCode === 400, 'duplicare în limba de → 400');

    // Arhivare, readucere, ștergerea ciornei
    r = await post('tok-sup', { actiune: 'stare', id, stare: 'arhivata' });
    verifica(r.statusCode === 200 && r.corp.campanie.stare === 'arhivata', 'arhivare');
    r = await post('tok-sup', { actiune: 'salveaza', id, nume_campanie: 'Alt nume' });
    verifica(r.statusCode === 409 && r.corp.cod === 'CAMPANIE_ARHIVATA', 'campania arhivată nu se editează');
    r = await post('tok-sup', { actiune: 'stare', id, stare: 'activa' });
    verifica(r.statusCode === 409 && r.corp.cod === 'TRANZITIE_INVALIDA', 'arhivată → activă direct: refuzat');
    r = await post('tok-sup', { actiune: 'stare', id, stare: 'ciorna' });
    verifica(r.statusCode === 200 && r.corp.campanie.stare === 'ciorna', 'arhivată → ciornă');
    DB.storage['campanii-media'] = new Set([pref + 'video_vertical.mp4']);
    r = await post('tok-sup', { actiune: 'sterge', id });
    verifica(r.statusCode === 200 && !DB.tabele.seo_campanii_social.some((x) => x.id === id) && !DB.storage['campanii-media'].has(pref + 'video_vertical.mp4'), 'ștergerea ciornei, cu materialele ei din stocare');

    // Exportul: doar materialele acestei campanii (calea cu pagina, limba și id-ul ei)
    reset();
    r = await post('tok-sup', { ...baza, platforme: ['tiktok'], titlu_reclama: 'Titlu', text_principal: 'Text', cta: 'afla_mai_multe', url_destinatie: 'https://mydarrin.homebestpal.com/despre-noi', utm_source: 'tiktok' });
    const ex = r.corp.campanie;
    r = await post('tok-sup', { actiune: 'creeaza', page_path: '/mydarrin-contact', limba: 'ro', nume_campanie: 'Altă pagină' });
    const alta = r.corp.campanie;
    const pe = `despre-noi/ro/${ex.id}/`, pa = `mydarrin-contact/ro/${alta.id}/`;
    DB.storage['campanii-media'] = new Set([pe + 'video_vertical.mp4', pa + 'imagine_patrat.jpg']);
    DB.tabele.seo_campanii_social.find((x) => x.id === ex.id).media = {
      video_vertical: { cale: pe + 'video_vertical.mp4', latime: 1080, inaltime: 1920, mime: 'video/mp4', marime_bytes: 10 },
      imagine_patrat: { cale: pa + 'imagine_patrat.jpg', latime: 1080, inaltime: 1080, mime: 'image/jpeg', marime_bytes: 10 },   // calea altei pagini
    };
    r = await apel(apiC, { token: 'tok-sup', query: { export: '1', id: ex.id } });
    const f = r.corp.export && r.corp.export.fisiere;
    verifica(r.statusCode === 200 && f.length === 1 && f[0].nume === 'video_vertical.mp4' && f[0].url.includes(pe) && !JSON.stringify(r.corp).includes(pa),
      'exportul nu conține materialul altei pagini ' + JSON.stringify(f));
    verifica(/exp=600/.test(f[0].url) && r.corp.export.expira_in_s === 600, 'adresele semnate expiră în 10 minute');
    const txt = r.corp.export.txt.continut;
    verifica(/Află mai multe \/ Learn more \(afla_mai_multe\)/.test(txt) && txt.includes('https://mydarrin.homebestpal.com/despre-noi?utm_source=tiktok') && /Titlu/.test(txt),
      'texte.txt: textele, CTA RO / EN și linkul cu UTM');
    verifica(r.corp.export.nume_arhiva === 'campanie-despre-noi-ro-lansare-de-test.zip', 'numele arhivei: ' + r.corp.export.nume_arhiva);
    verifica(DB.tabele.audit_log.some((a) => a.actiune === 'campanie_export'), 'exportul se auditează');
    r = await apel(apiC, { token: 'tok-cit', query: { export: '1', id: ex.id } });
    verifica(r.statusCode === 200, 'exportul cere doar dreptul de citire');
    for (const [tok, cod] of [['tok-adm', 403], ['tok-cli', 403], ['tok-fara', 403], [null, 401]]) {
      r = await apel(apiC, { token: tok, query: { page_path: '/despre-noi' } });
      verifica(r.statusCode === cod, `campanii, ${tok || 'fără sesiune'} → ${cod}`);
    }
    r = await post('tok-cit', { ...baza, nume_campanie: 'Citire' });
    verifica(r.statusCode === 403, 'admin seo fără poate_scrie: crearea → 403');
    verifica(['campanie_creata', 'campanie_export'].every((a) => DB.tabele.audit_log.some((x) => x.actiune === a)), 'acțiunile se auditează');

    // Fără migrare
    DB.tabele.seo_campanii_social = null;
    r = await apel(apiC, { token: 'tok-sup', query: { page_path: '/despre-noi' } });
    verifica(r.statusCode === 409 && r.corp.cod === 'MIGRARE_LIPSA', 'fără tabelă → 409 MIGRARE_LIPSA');
  }

  // ── U. Încărcarea materialelor ────────────────────────────────────────
  if (ruleaza('U')) {
    const apiC = require(path.join(RADACINA, 'api/admin/seo-campanii.js'));
    const VF = require(path.join(RADACINA, 'lib/verifica-fisier.js'));
    reset();
    // Conținutul „încărcat” (cale → { octeti, marime }); fetch-ul semnat întoarce primii octeți, cu Range.
    const FISIERE = new Map();
    const pune = (bucket, cale, octeti, marime) => { FISIERE.set(bucket + '/' + cale, { octeti, marime: marime || octeti.length }); (DB.storage[bucket] = DB.storage[bucket] || new Set()).add(cale); };
    globalThis.fetch = async (url, opt) => {
      const m = /^https:\/\/sim\.supabase\/sign\/(.+?)\?/.exec(String(url));
      const f = m && FISIERE.get(decodeURIComponent(m[1]));
      if (!f) return new Response('nu', { status: 404 });
      const range = opt && opt.headers && opt.headers.Range;
      return new Response(f.octeti.slice(0, 64), { status: range ? 206 : 200, headers: range ? { 'content-range': `bytes 0-63/${f.marime}` } : { 'content-length': String(f.marime) } });
    };
    const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(80)]);
    const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(80)]);
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(80)]);
    const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(80)]);
    const WEBM = Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.alloc(80)]);
    verifica(VF.detecteazaTip(MP4) === 'video/mp4' && VF.detecteazaTip(MOV) === 'video/quicktime' && VF.detecteazaTip(PNG) === 'image/png' && VF.detecteazaTip(JPG) === 'image/jpeg' && VF.detecteazaTip(WEBM) === 'video/webm'
      && VF.detecteazaTip(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')) === 'image/webp' && VF.detecteazaTip(Buffer.from('<html><body>')) === null, 'detecteazaTip după primii octeți');
    verifica(VF.tipPotrivit('video/mp4', 'video/quicktime') && !VF.tipPotrivit('image/jpeg', 'image/png'), 'MP4 / MOV același container; JPG ≠ PNG');

    const post = (token, body) => apel(apiC, { metoda: 'POST', token, body });
    let r = await post('tok-sup', { actiune: 'creeaza', page_path: '/despre-noi', limba: 'ro', nume_campanie: 'Materiale DE TEST', platforme: ['tiktok'] });
    const c = r.corp.campanie;
    r = await post('tok-sup', { actiune: 'creeaza', page_path: '/despre-noi', limba: 'ro', nume_campanie: 'Alta DE TEST' });
    const alta = r.corp.campanie;
    const pref = `despre-noi/ro/${c.id}/`;
    const cere = (b) => post('tok-sup', { actiune: 'url_incarcare', id: c.id, ...b });

    r = await cere({ tip: 'video_vertical', mime: 'video/mp4', marime: 1000, latime: 1080, inaltime: 1080 });
    verifica(r.statusCode === 400 && r.corp.cod === 'DIMENSIUNI' && r.corp.campuri[0].camp === 'media.video_vertical', 'video 1:1 pentru 9:16 → refuzat (raport)');
    r = await cere({ tip: 'video_vertical', mime: 'video/mp4', marime: 1000, latime: 540, inaltime: 960 });
    verifica(r.statusCode === 400 && r.corp.cod === 'DIMENSIUNI' && /720 × 1280/.test(r.corp.mesaj.ro), '9:16 la 540 × 960 → refuzat (minimum 720 × 1280)');
    r = await cere({ tip: 'video_vertical', mime: 'video/mp4', marime: 60 * 1048576, latime: 1080, inaltime: 1920 });
    verifica(r.statusCode === 400 && r.corp.cod === 'FISIER_PREA_MARE' && /Exportați din nou/.test(r.corp.mesaj.ro), 'video de 60 MB → refuzat, „Exportați din nou”');
    r = await cere({ tip: 'video_vertical', mime: 'video/x-msvideo', marime: 1000, latime: 1080, inaltime: 1920 });
    verifica(r.statusCode === 400 && r.corp.cod === 'TIP_FISIER', 'video AVI → refuzat (MP4 / MOV / WebM)');
    r = await cere({ tip: 'imagine_patrat', mime: 'image/png', marime: 6 * 1048576, latime: 1080, inaltime: 1080 });
    verifica(r.statusCode === 400 && r.corp.cod === 'FISIER_PREA_MARE', 'imagine de 6 MB → refuzată (5 MB)');
    r = await cere({ tip: 'imagine_feed_4x5', mime: 'image/png', marime: 1000, latime: 1080, inaltime: 1080 });
    verifica(r.statusCode === 400 && r.corp.cod === 'DIMENSIUNI', 'imagine 1:1 ca 4:5 → refuzată');
    r = await cere({ tip: 'imagine_link_1_91', mime: 'image/png', marime: 1000, latime: 1210, inaltime: 640 });
    verifica(r.statusCode === 200, '1,91:1 la 1210 × 640 (în toleranța de 2 %) → acceptat');
    r = await cere({ tip: 'video_vertical', mime: 'video/mp4', marime: 1000, latime: 720, inaltime: 1280, durata_s: 15.2 });
    verifica(r.statusCode === 200 && r.corp.cale === pref + 'video_vertical.mp4' && r.corp.bucket === 'campanii-media' && /^https:\/\/sim\.supabase\/upload\/campanii-media\//.test(r.corp.url_semnat),
      'adresă semnată: <pagina>/<limba>/<id>/<tip>.<ext> în campanii-media ' + r.corp.cale);
    r = await post('tok-cit', { actiune: 'url_incarcare', id: c.id, tip: 'video_vertical', mime: 'video/mp4', marime: 1000, latime: 1080, inaltime: 1920 });
    verifica(r.statusCode === 403, 'adresa de încărcare fără poate_scrie → 403');

    const confirma = (b) => post('tok-sup', { actiune: 'confirma_media', id: c.id, tip: 'video_vertical', latime: 1080, inaltime: 1920, durata_s: 15.25, ...b });
    r = await confirma({ cale: `despre-noi/ro/${alta.id}/video_vertical.mp4` });
    verifica(r.statusCode === 400 && r.corp.cod === 'CALE_INVALIDA', 'confirmare cu calea altei campanii → refuzată');
    r = await confirma({ cale: '../' + pref + 'video_vertical.mp4' });
    verifica(r.statusCode === 400 && r.corp.cod === 'CALE_INVALIDA', 'confirmare cu ../ → refuzată');
    r = await confirma({ cale: pref + 'video_vertical.mp4' });
    verifica(r.statusCode === 400 && r.corp.cod === 'FISIER_LIPSA', 'confirmare fără fișier în stocare → refuzată');
    pune('campanii-media', pref + 'video_vertical.mp4', PNG);
    r = await confirma({ cale: pref + 'video_vertical.mp4' });
    verifica(r.statusCode === 400 && r.corp.cod === 'CONTINUT_INVALID' && !DB.storage['campanii-media'].has(pref + 'video_vertical.mp4'), 'un PNG numit .mp4 → refuzat după conținut și șters din stocare');
    pune('campanii-media', pref + 'video_vertical.mp4', MP4, 55 * 1048576);
    r = await confirma({ cale: pref + 'video_vertical.mp4' });
    verifica(r.statusCode === 400 && r.corp.cod === 'FISIER_PREA_MARE' && !DB.storage['campanii-media'].has(pref + 'video_vertical.mp4'), 'fișier de 55 MB în stocare (deși declarat mic) → refuzat și șters');
    pune('campanii-media', pref + 'video_vertical.mp4', MP4, 12345678);
    r = await confirma({ cale: pref + 'video_vertical.mp4', latime: 1000, inaltime: 1000 });
    verifica(r.statusCode === 400 && r.corp.cod === 'DIMENSIUNI', 'dimensiunile 1:1 la confirmare → refuzate');
    pune('campanii-media', pref + 'video_vertical.mp4', MP4, 12345678);
    r = await confirma({ cale: pref + 'video_vertical.mp4' });
    const mv = r.corp.campanie && r.corp.campanie.media.video_vertical;
    verifica(r.statusCode === 200 && mv && mv.cale === pref + 'video_vertical.mp4' && mv.marime_bytes === 12345678 && mv.latime === 1080 && mv.inaltime === 1920 && mv.durata_s === 15.3 && mv.mime === 'video/mp4',
      'video MP4 verificat: media.video_vertical { cale, lățime, înălțime, durată, mărime din stocare, mime } ' + JSON.stringify(mv));
    verifica(r.corp.media_urls.video_vertical && /exp=600/.test(r.corp.media_urls.video_vertical.url), 'răspunsul aduce adresa de previzualizare (10 min)');
    // Înlocuire cu altă extensie: fișierul vechi se șterge
    pune('campanii-media', pref + 'video_vertical.mov', MOV, 2000);
    r = await confirma({ cale: pref + 'video_vertical.mov' });
    verifica(r.statusCode === 200 && r.corp.campanie.media.video_vertical.cale === pref + 'video_vertical.mov' && !DB.storage['campanii-media'].has(pref + 'video_vertical.mp4'), 'înlocuirea MP4 → MOV șterge fișierul vechi');
    // Imagine: JPG cu conținut PNG → refuzat
    pune('campanii-media', pref + 'imagine_patrat.jpg', PNG);
    r = await post('tok-sup', { actiune: 'confirma_media', id: c.id, tip: 'imagine_patrat', cale: pref + 'imagine_patrat.jpg', latime: 1080, inaltime: 1080 });
    verifica(r.statusCode === 400 && r.corp.cod === 'CONTINUT_INVALID', 'imagine .jpg cu conținut PNG → refuzată');
    // Activare, apoi ștergerea materialului necesar → 409
    await post('tok-sup', { actiune: 'salveaza', id: c.id, text_principal: 'Text DE TEST', cta: 'afla_mai_multe', url_destinatie: 'https://mydarrin.homebestpal.com/despre-noi' });
    r = await post('tok-sup', { actiune: 'stare', id: c.id, stare: 'activa' });
    verifica(r.statusCode === 200, 'cu video 9:16 verificat, campania TikTok se activează');
    r = await post('tok-sup', { actiune: 'sterge_media', id: c.id, tip: 'video_vertical' });
    verifica(r.statusCode === 409 && r.corp.cod === 'MATERIAL_NECESAR', 'ștergerea materialului cerut de o campanie activă → 409');
    await post('tok-sup', { actiune: 'stare', id: c.id, stare: 'ciorna' });
    r = await post('tok-sup', { actiune: 'sterge_media', id: c.id, tip: 'video_vertical' });
    verifica(r.statusCode === 200 && !r.corp.campanie.media.video_vertical && !DB.storage['campanii-media'].has(pref + 'video_vertical.mov'), 'ciornă: materialul se șterge, și din stocare');
    verifica(['campanie_material_incarcare', 'campanie_material_salvat', 'campanie_material_sters'].every((a) => DB.tabele.audit_log.some((x) => x.actiune === a)), 'încărcările se auditează');

    // Imaginea OG (api/admin/seo.js, bucket-ul public seo-og)
    process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';
    const og = (b) => apel(apiSeo, { metoda: 'POST', token: 'tok-sup', body: { page_path: '/despre-noi', limba: 'en', ...b } });
    r = await og({ actiune: 'url_incarcare_og', mime: 'image/png', marime: 1000, latime: 1080, inaltime: 1080 });
    verifica(r.statusCode === 400 && r.corp.cod === 'DIMENSIUNI' && r.corp.campuri[0].camp === 'og_imagine_url', 'OG 1:1 → refuzat (1,91:1)');
    r = await og({ actiune: 'url_incarcare_og', mime: 'image/png', marime: 1000, latime: 1000, inaltime: 523 });
    verifica(r.statusCode === 400 && /1200 × 630/.test(r.corp.mesaj.ro), 'OG 1000 × 523 → refuzat (minimum 1200 × 630)');
    r = await og({ actiune: 'url_incarcare_og', mime: 'image/png', marime: 1000, latime: 1200, inaltime: 630 });
    const caleOg = r.corp.cale;
    verifica(r.statusCode === 200 && r.corp.bucket === 'seo-og' && /^despre-noi\/en\/og-[a-f0-9]{12}\.png$/.test(caleOg), 'OG: adresă semnată în seo-og, cale nouă la fiecare încărcare ' + caleOg);
    r = await og({ actiune: 'confirma_og', cale: caleOg.replace('despre-noi', 'mydarrin-contact'), latime: 1200, inaltime: 630 });
    verifica(r.statusCode === 400 && r.corp.cod === 'CALE_INVALIDA', 'OG: calea altei pagini → refuzată');
    pune('seo-og', caleOg, PNG, 400000);
    r = await og({ actiune: 'confirma_og', cale: caleOg, latime: 1200, inaltime: 630 });
    verifica(r.statusCode === 200 && r.corp.url_public === 'https://abcdefgh.supabase.co/storage/v1/object/public/seo-og/' + caleOg && r.corp.latime === 1200, 'OG verificat → adresa publică ' + r.corp.url_public);
    r = await apel(apiSeo, { metoda: 'POST', token: 'tok-cit', body: { actiune: 'url_incarcare_og', page_path: '/despre-noi', limba: 'en', mime: 'image/png', marime: 1000, latime: 1200, inaltime: 630 } });
    verifica(r.statusCode === 403, 'OG fără poate_scrie → 403');
  }

  if (typeof module.exports.maiDeparte === 'function') await module.exports.maiDeparte({ verifica, apel, reset, ruleaza });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

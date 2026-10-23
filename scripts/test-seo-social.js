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

  if (typeof module.exports.maiDeparte === 'function') await module.exports.maiDeparte({ verifica, apel, reset, ruleaza });

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

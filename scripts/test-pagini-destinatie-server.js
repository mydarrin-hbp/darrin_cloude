// scripts/test-pagini-destinatie-server.js
// Pasul 12-L1 (19 nov. 2026): serverul paginilor de destinație — handler-ele reale
// (api/admin/seo-landing.js, api/public/landing.js) peste Supabase-ul simulat
// (scripts/supabase-simulat.js). Funcțiile SQL landing_publica / landing_revino
// sunt simulate în scripts/landing-rpc-simulat.js, cu aceeași regulă; pe Postgres le verifică
// scripts/test-migrare-pagini-destinatie.js (inclusiv RLS pentru anon).
// Nimic nu ajunge la producție.
//   P. publicul: doar variantele publicate (ciornele nu ies), varianta din
//      utm_campaign → implicita → null, cache scurt, pagina necunoscută → 400;
//   D. drepturile: fără token 401; fără dreptul SEO 403 (citire și scriere);
//      doar citire 403 la scriere; superadmin / admin cu poate_scrie: da;
//   V. validarea pe server: limitele de caractere (cu câmpul greșit), numele
//      variantei, profesia; publicarea fără EN → refuzată, cu mesaj clar;
//   F. fluxul: ciornă → publicare (v1) → ciornă nouă → publicare (v2, v1 în
//      istoric) → revenire la v1 (v3); ștergerea unei variante; „implicita” nu;
//   I. imaginea: alt format / peste 300 KB / peste 1600 px → refuzate înainte;
//      conținut PNG, WebP peste 300 KB, WebP cu EXIF → refuzate după încărcare
//      (fișierele șterse); WebP corect → pe ciornă, cu variantele pentru srcset.
// Rulare: node scripts/test-pagini-destinatie-server.js   (DOAR=P|D|V|F|I)

const path = require('path');
const sim = require('./supabase-simulat');
sim.instaleaza();
const { DB, cerere, raspuns, RADACINA } = sim;
process.env.SUPABASE_URL = 'https://abcdefgh.supabase.co';

const apiAdmin = require(path.join(RADACINA, 'api/admin/seo-landing.js'));
const apiPublic = require(path.join(RADACINA, 'api/public/landing.js'));
const L = require(path.join(RADACINA, 'lib/landing-pagini.js'));

let ok = 0, esec = 0;
function verifica(c, m) { if (c) { ok++; } else { esec++; console.log('  ✗ ' + m); } }
const DOAR = process.env.DOAR || '';
const ruleaza = (s) => !DOAR || DOAR.includes(s);

// Funcțiile SQL landing_publica / landing_revino, simulate (aceeași regulă ca în migrare).
require('./landing-rpc-simulat').instaleaza(DB);

function reset() {
  DB.tabele = {
    profiles: [
      { id: 'sup', email: 'super@example.com', roles: ['superadmin'] },
      { id: 'scr', email: 'seo-scriere@example.com', roles: ['admin'] },
      { id: 'cit', email: 'seo-citire@example.com', roles: ['admin'] },
      { id: 'adm', email: 'fara-drept@example.com', roles: ['admin'] },
      { id: 'cli', email: 'client@example.com', roles: ['client'] },
    ],
    admin_permissions: [
      { admin_id: 'scr', sectiune: 'seo', poate_scrie: true },
      { admin_id: 'cit', sectiune: 'seo', poate_scrie: false },
      { admin_id: 'adm', sectiune: 'investitori', poate_scrie: true },
    ],
    audit_log: [], landing_continut: [], landing_continut_istoric: [],
  };
  DB.coloane = {};
  DB.storage = {};
  DB.utilizatori = {
    'tok-sup': { id: 'sup', email: 'super@example.com' }, 'tok-scr': { id: 'scr', email: 'seo-scriere@example.com' },
    'tok-cit': { id: 'cit', email: 'seo-citire@example.com' }, 'tok-adm': { id: 'adm', email: 'fara-drept@example.com' },
    'tok-cli': { id: 'cli', email: 'client@example.com' },
  };
  apiPublic._golesteCache();
}

async function apel(api, { metoda = 'GET', token = null, query = {}, body = null } = {}) {
  const res = raspuns();
  await api(cerere({ metoda, token, query, body }), res);
  return res;
}
const admin = (body, token = 'tok-sup') => apel(apiAdmin, { metoda: 'POST', token, body });
const public_ = (query) => apel(apiPublic, { query });

const RO = { eticheta: 'Parteneri de servicii · Instalatori', titlu: 'Instalator? Primește comenzi în zona ta.', subtitlu: 'Clienții comandă și plătesc în platformă. Tu vezi suma ta înainte să accepți.',
  beneficiu_1: 'Comenzi alocate automat în orașul tău', beneficiu_2: 'Plata e păstrată ca garanție până termini lucrarea', beneficiu_3: '100% din manoperă rămâne la tine', buton: 'Devino partener', sub_buton: 'Gratuit · contul în 60 de secunde' };
const EN = { eticheta: 'Service partners · Plumbers', titlu: 'Plumber? Get jobs in your area.', subtitlu: 'Clients order and pay on the platform. You see your amount before you accept.',
  beneficiu_1: 'Jobs assigned automatically in your city', beneficiu_2: 'Payment held as a guarantee until the job is done', beneficiu_3: '100% of the labour stays with you', buton: 'Become a partner', sub_buton: 'Free · account in 60 seconds' };
const salveaza = (x = {}, token) => admin(Object.assign({ actiune: 'salveaza', pagina: '/parteneri/servicii', varianta: 'instalatori', profesie: 'instalator', ro: RO, en: EN }, x), token);

// Fișierele „încărcate” (conținut real), citite de lib/verifica-fisier.js prin fetch.
const INCARCATE = new Map();
globalThis.fetch = async (url) => {
  const m = /^https:\/\/sim\.supabase\/sign\/(.+?)\?/.exec(String(url));
  const b = m && INCARCATE.get(decodeURIComponent(m[1]));
  if (!b) return new Response('nu', { status: 404 });
  return new Response(b.subarray(0, 64), { status: 206, headers: { 'content-range': `bytes 0-63/${b.length}` } });
};
function incarca(cale, buf) { INCARCATE.set('seo-og/' + cale, buf); (DB.storage['seo-og'] = DB.storage['seo-og'] || new Set()).add(cale); }
// WebP minimal: VP8 (simplu) sau VP8X (extins, cu steaguri de metadate), cu lățimea / înălțimea date.
function webp(latime, inaltime, { extins = false, exif = false, marime = 2000 } = {}) {
  const b = Buffer.alloc(Math.max(marime, 64));
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8);
  if (extins) {
    b.write('VP8X', 12); b.writeUInt32LE(10, 16); b[20] = exif ? 0x08 : 0x00;
    b.writeUIntLE(latime - 1, 24, 3); b.writeUIntLE(inaltime - 1, 27, 3);
  } else {
    b.write('VP8 ', 12); b.writeUInt32LE(b.length - 20, 16);
    b[20] = 0x10; b[21] = 0x02; b[22] = 0x00; b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
    b.writeUInt16LE(latime & 0x3fff, 26); b.writeUInt16LE(inaltime & 0x3fff, 28);
  }
  return b;
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200)]);

(async () => {
  if (ruleaza('P')) {
    console.log('P. Publicul');
    reset();
    let r = await public_({ pagina: '/parteneri/servicii' });
    verifica(r.statusCode === 200 && r.corp.ok && r.corp.continut === null, 'fără conținut în bază: continut null (pagina rămâne cu textele implicite)');
    verifica(/s-maxage=60/.test(r.headere['Cache-Control'] || ''), 'cache scurt (s-maxage=60): ' + r.headere['Cache-Control']);
    await salveaza();
    apiPublic._golesteCache();
    r = await public_({ pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.corp.continut === null && r.corp.varianta === null, 'varianta doar în ciornă: NU ajunge la public (anon nu citește ciorne)');
    verifica(!JSON.stringify(r.corp).includes('Instalator?'), 'niciun text din ciornă în răspunsul public');
    await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    apiPublic._golesteCache();
    r = await public_({ pagina: '/parteneri/servicii', varianta: 'Instalatori' });
    verifica(r.corp.varianta === 'instalatori' && r.corp.continut.ro.titlu === RO.titlu && r.corp.continut.en.titlu === EN.titlu, 'varianta publicată (utm_campaign, majusculele ignorate): RO și EN');
    verifica(!('autor' in r.corp) && !JSON.stringify(r.corp).includes('sup'), 'fără autor / date interne în răspunsul public');
    r = await public_({ pagina: '/parteneri/servicii', varianta: 'alta' });
    verifica(r.corp.continut === null, 'variantă nepublicată, fără implicita publicată: continut null → implicita din HTML');
    r = await public_({ pagina: '/parteneri/servicii', varianta: '<script>' });
    verifica(r.statusCode === 200 && r.corp.continut === null, 'utm_campaign invalid: tratat ca lipsă');
    r = await public_({ pagina: '/despre' });
    verifica(r.statusCode === 400 && r.corp.cod === 'PAGINA_INVALIDA', 'pagina care nu e de destinație: 400');
    DB.tabele.landing_continut.filter((x) => x.stare === 'publicat').forEach((x) => { x.varianta = 'implicita'; });
    apiPublic._golesteCache();
    r = await public_({ pagina: '/parteneri/servicii', varianta: 'alta' });
    verifica(r.corp.varianta === 'implicita' && r.corp.continut.ro.titlu === RO.titlu, 'fără potrivire → implicita publicată');
  }

  if (ruleaza('D')) {
    console.log('D. Drepturile');
    reset();
    let r = await apel(apiAdmin, {});
    verifica(r.statusCode === 401, 'fără token: 401 (' + r.statusCode + ')');
    r = await apel(apiAdmin, { token: 'tok-adm' });
    verifica(r.statusCode === 403 && r.corp.cod === 'FARA_DREPT', 'admin fără dreptul SEO: citirea → 403');
    r = await salveaza({}, 'tok-adm');
    verifica(r.statusCode === 403 && r.corp.cod === 'FARA_DREPT', 'admin fără dreptul SEO: scrierea → 403');
    r = await salveaza({}, 'tok-cli');
    verifica(r.statusCode === 403, 'client: 403 (' + r.statusCode + ')');
    r = await salveaza({}, 'tok-cit');
    verifica(r.statusCode === 403 && r.corp.cod === 'FARA_DREPT_SCRIERE' && /citire/.test(r.corp.mesaj.ro), 'doar citire: scrierea → 403 FARA_DREPT_SCRIERE');
    r = await apel(apiAdmin, { token: 'tok-cit' });
    verifica(r.statusCode === 200 && r.corp.poate_scrie === false && r.corp.pagini.length === 7, 'doar citire: lista celor 7 pagini, poate_scrie false');
    r = await salveaza({}, 'tok-scr');
    verifica(r.statusCode === 200 && r.corp.ciorna.ro.titlu === RO.titlu, 'admin cu poate_scrie: salvează');
    verifica(DB.tabele.audit_log.some((a) => a.actiune === 'landing_ciorna_salvata'), 'salvarea e auditată');
    for (const a of ['publica', 'revino', 'sterge', 'url_incarcare', 'confirma_imagine', 'sterge_imagine']) {
      r = await admin({ actiune: a, pagina: '/parteneri/servicii', varianta: 'instalatori', versiune: 1 }, 'tok-cit');
      verifica(r.statusCode === 403, `doar citire: „${a}” → 403`);
    }
  }

  if (ruleaza('V')) {
    console.log('V. Validarea pe server');
    reset();
    const limite = { eticheta: 40, titlu: 60, subtitlu: 140, beneficiu_1: 60, beneficiu_2: 60, beneficiu_3: 60, buton: 24, sub_buton: 60, imagine_alt: 140 };
    for (const [k, n] of Object.entries(limite)) {
      let r = await salveaza({ ro: Object.assign({}, RO, { [k]: 'ă'.repeat(n + 1) }) });
      verifica(r.statusCode === 400 && r.corp.cod === 'CONTINUT_INVALID' && r.corp.campuri.some((c) => c.camp === 'ro.' + k) && new RegExp('maximum ' + n).test(r.corp.mesaj.ro),
        `${k} RO cu ${n + 1} caractere: 400, câmpul ro.${k}, „maximum ${n}”`);
      r = await salveaza({ en: Object.assign({}, EN, { [k]: 'a'.repeat(n) }) });
      verifica(r.statusCode === 200, `${k} EN cu ${n} caractere: acceptat`);
    }
    let r = await salveaza({ varianta: 'Instalatori Iarna!' });
    verifica(r.statusCode === 400 && r.corp.cod === 'VARIANTA_INVALIDA' && r.corp.campuri[0].camp === 'varianta', 'numele variantei invalid: 400 VARIANTA_INVALIDA');
    r = await salveaza({ profesie: 'Instalator!' });
    verifica(r.statusCode === 400 && r.corp.cod === 'PROFESIE_INVALIDA', 'profesia invalidă: 400');
    r = await salveaza({ pagina: '/despre' });
    verifica(r.statusCode === 400 && r.corp.cod === 'PAGINA_INVALIDA', 'pagina necunoscută: 400');
    // Publicarea fără EN
    reset();
    await salveaza({ en: {} });
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 400 && r.corp.cod === 'PUBLICARE_FARA_EN' && /RO și EN complete/.test(r.corp.mesaj.ro) && /English/.test(r.corp.mesaj.ro) && /RO and EN complete/.test(r.corp.mesaj.en),
      'publicarea fără EN: refuzată, mesaj clar RO + EN (' + (r.corp.mesaj && r.corp.mesaj.ro) + ')');
    verifica(r.corp.campuri.length === 8 && r.corp.campuri.every((c) => /^en\./.test(c.camp)), 'câmpurile EN lipsă sunt marcate (8)');
    verifica(!DB.tabele.landing_continut.some((x) => x.stare === 'publicat'), 'nimic publicat');
    await salveaza({ en: Object.assign({}, EN, { buton: '' }) });
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 400 && r.corp.cod === 'PUBLICARE_FARA_EN' && r.corp.campuri.length === 1 && r.corp.campuri[0].camp === 'en.buton', 'EN fără textul butonului: refuzată, câmpul en.buton');
    await salveaza({ ro: Object.assign({}, RO, { titlu: '' }) });
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 400 && r.corp.cod === 'PUBLICARE_INCOMPLETA', 'RO incomplet: PUBLICARE_INCOMPLETA');
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'nu-exista' });
    verifica(r.statusCode === 409 && r.corp.cod === 'FARA_CIORNA', 'publicarea unei variante fără ciornă: 409');
  }

  if (ruleaza('F')) {
    console.log('F. Fluxul ciornă → publicare → istoric → revenire');
    reset();
    let r = await apel(apiAdmin, { token: 'tok-sup', query: { pagina: '/parteneri/servicii', varianta: 'implicita' } });
    verifica(r.statusCode === 200 && r.corp.din_implicit && r.corp.ciorna.ro.titlu === L.pagina('/parteneri/servicii').implicit.ro.titlu && r.corp.ciorna.en.titlu === L.pagina('/parteneri/servicii').implicit.en.titlu,
      'implicita fără rânduri: editorul pornește de la textele din pagină (RO + EN)');
    await salveaza();
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 200 && r.corp.versiune === 1 && r.corp.publicat.ro.titlu === RO.titlu, 'publicată: versiunea 1');
    await salveaza({ ro: Object.assign({}, RO, { titlu: 'Instalator? Comenzi noi în orașul tău.' }) });
    r = await apel(apiAdmin, { token: 'tok-sup' });
    const v = r.corp.pagini.find((p) => p.cale === '/parteneri/servicii').variante.find((x) => x.varianta === 'instalatori');
    verifica(v.stare === 'modificata' && v.versiune === 1 && v.link === '/parteneri/servicii?utm_campaign=instalatori&profesie=instalator', 'lista: „modificata”, v1, linkul pentru reclamă (' + v.link + ')');
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.corp.versiune === 2 && r.corp.istoric.length === 1 && r.corp.istoric[0].versiune === 1 && r.corp.istoric[0].titlu_ro === RO.titlu, 'a doua publicare: v2, v1 în istoric');
    r = await admin({ actiune: 'revino', pagina: '/parteneri/servicii', varianta: 'instalatori', versiune: 1 });
    verifica(r.statusCode === 200 && r.corp.versiune === 3 && r.corp.publicat.ro.titlu === RO.titlu && r.corp.ciorna.ro.titlu === RO.titlu, 'revenirea la v1: publicată ca v3, ciorna la fel');
    verifica(r.corp.istoric.map((x) => x.versiune).join(',') === '2,1', 'istoricul: v2, v1');
    verifica(DB.tabele.audit_log.some((a) => a.actiune === 'landing_revenire'), 'revenirea e auditată');
    r = await admin({ actiune: 'revino', pagina: '/parteneri/servicii', varianta: 'instalatori', versiune: 9 });
    verifica(r.statusCode === 404 && r.corp.cod === 'VERSIUNE_LIPSA', 'versiune inexistentă: 404');
    r = await admin({ actiune: 'sterge', pagina: '/parteneri/servicii', varianta: 'implicita' });
    verifica(r.statusCode === 409 && r.corp.cod === 'IMPLICITA', 'implicita nu se șterge');
    r = await admin({ actiune: 'sterge', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 200 && !DB.tabele.landing_continut.length, 'varianta ștearsă (ciornă + publicare)');
    r = await apel(apiAdmin, { token: 'tok-sup' });
    verifica(r.corp.pagini.every((p) => p.variante[0].varianta === 'implicita'), 'fiecare pagină are „implicita” în listă');
  }

  if (ruleaza('I')) {
    console.log('I. Imaginea');
    reset();
    const baza = { actiune: 'url_incarcare', pagina: '/parteneri/servicii', varianta: 'instalatori', id: 'a1b2c3d4e5f6', w: 1600, mime: 'image/webp', marime: 120000, latime: 1600, inaltime: 900 };
    let r = await admin(Object.assign({}, baza, { mime: 'image/png' }));
    verifica(r.statusCode === 400 && r.corp.cod === 'TIP_FISIER' && r.corp.campuri[0].camp === 'imagine', 'alt format (PNG declarat): 400 TIP_FISIER');
    r = await admin(Object.assign({}, baza, { marime: 300 * 1024 + 1 }));
    verifica(r.statusCode === 400 && r.corp.cod === 'FISIER_PREA_MARE' && /300 KB/.test(r.corp.mesaj.ro), 'peste 300 KB (declarat): 400 FISIER_PREA_MARE');
    r = await admin(Object.assign({}, baza, { latime: 2400, inaltime: 1350 }));
    verifica(r.statusCode === 400 && r.corp.cod === 'DIMENSIUNI', 'peste 1600 px: 400 DIMENSIUNI');
    r = await admin(baza);
    verifica(r.statusCode === 200 && r.corp.cale === 'landing/parteneri-servicii/instalatori/a1b2c3d4e5f6-1600.webp' && r.corp.bucket === 'seo-og', 'adresă semnată în seo-og/landing/… (' + r.corp.cale + ')');
    const confirma = (fis) => admin({ actiune: 'confirma_imagine', pagina: '/parteneri/servicii', varianta: 'instalatori', id: 'a1b2c3d4e5f6', fisiere: fis });
    const cale = (w) => `landing/parteneri-servicii/instalatori/a1b2c3d4e5f6-${w}.webp`;
    incarca(cale(1600), PNG);
    r = await confirma([{ w: 1600, cale: cale(1600) }]);
    verifica(r.statusCode === 400 && r.corp.cod === 'CONTINUT_INVALID' && !DB.storage['seo-og'].has(cale(1600)), 'conținut PNG sub nume .webp: refuzat după încărcare, fișierul șters');
    incarca(cale(1600), webp(1600, 900, { marime: 300 * 1024 + 10 }));
    r = await confirma([{ w: 1600, cale: cale(1600) }]);
    verifica(r.statusCode === 400 && r.corp.cod === 'FISIER_PREA_MARE' && /verificat pe server/.test(r.corp.mesaj.ro), 'WebP real peste 300 KB: refuzat (verificat pe server)');
    incarca(cale(1600), webp(1600, 900, { extins: true, exif: true }));
    r = await confirma([{ w: 1600, cale: cale(1600) }]);
    verifica(r.statusCode === 400 && r.corp.cod === 'METADATE', 'WebP cu EXIF: refuzat (METADATE)');
    incarca(cale(1600), webp(2000, 1125));
    r = await confirma([{ w: 1600, cale: cale(1600) }]);
    verifica(r.statusCode === 400 && r.corp.cod === 'DIMENSIUNI', 'WebP real de 2000 px: refuzat (DIMENSIUNI)');
    r = await confirma([{ w: 1600, cale: 'landing/parteneri-materiale/instalatori/a1b2c3d4e5f6-1600.webp' }]);
    verifica(r.statusCode === 400 && r.corp.cod === 'CALE_INVALIDA', 'calea altei pagini: refuzată');
    incarca(cale(1600), webp(1600, 900, { marime: 150000 }));
    incarca(cale(800), webp(800, 450, { marime: 60000 }));
    incarca(cale(480), webp(480, 270, { marime: 25000 }));
    r = await confirma([{ w: 1600, cale: cale(1600) }, { w: 800, cale: cale(800) }, { w: 480, cale: cale(480) }]);
    verifica(r.statusCode === 200 && r.corp.imagine && r.corp.imagine.latime === 1600 && r.corp.imagine.inaltime === 900 && r.corp.imagine.variante.length === 3
      && r.corp.imagine.url === 'https://abcdefgh.supabase.co/storage/v1/object/public/seo-og/' + cale(1600), 'WebP corect: imaginea pe ciornă, 3 variante pentru srcset, adresa publică');
    verifica(r.corp.ciorna.ro.titlu === '' && DB.tabele.landing_continut.filter((x) => x.stare === 'ciorna').length === 2, 'ciorna RO + EN creată pentru imagine (textele se completează apoi)');
    await salveaza({ ro: Object.assign({}, RO, { imagine_alt: '' }), en: Object.assign({}, EN, { imagine_alt: 'Plumber at work' }) });
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 400 && r.corp.campuri.some((c) => c.camp === 'ro.imagine_alt'), 'imaginea fără text alternativ RO: publicarea refuzată, câmpul ro.imagine_alt');
    await salveaza({ ro: Object.assign({}, RO, { imagine_alt: 'Instalator la lucru' }), en: Object.assign({}, EN, { imagine_alt: 'Plumber at work' }) });
    r = await admin({ actiune: 'publica', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 200 && r.corp.imagine_publicata && r.corp.imagine_publicata.variante.length === 3, 'publicată cu imaginea');
    apiPublic._golesteCache();
    r = await public_({ pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.corp.imagine && r.corp.imagine.variante.length === 3 && r.corp.continut.en.imagine_alt === 'Plumber at work', 'publicul primește imaginea, variantele și textul alternativ');
    r = await admin({ actiune: 'sterge_imagine', pagina: '/parteneri/servicii', varianta: 'instalatori' });
    verifica(r.statusCode === 200 && r.corp.imagine === null && r.corp.imagine_publicata !== null, 'imaginea scoasă din ciornă; varianta publicată rămâne până la publicare');
  }

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

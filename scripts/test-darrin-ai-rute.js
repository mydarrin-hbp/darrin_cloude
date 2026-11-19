// scripts/test-darrin-ai-rute.js
// Pasul 12-D2, partea B: fiecare răspuns Darrin AI duce pe ruta corectă.
// Supabase, Anthropic și KV simulate (niciun apel real).
//   A. serverul: relevanta (potrivit / neclar / fara_legatura) și intrebare;
//      fără legătură → fără servicii, fără consultanță, explicație fixă; neclar
//      → întrebarea, consultanța doar la a doua încercare; incercare: 3 → 400;
//      ruta salvată în ai_raw_response; promptul RO cere „tu”; limitele
//      10 (vizitator, IP) / 20 (cont) / 60 (superadmin) și mesajul 429 cu
//      minutele rămase, RO + EN;
//   B. Chromium (catalog și „Creează deviz”, RO și EN, 390 și 1366 px):
//      fara_legatura → textul fix, 0 carduri, niciun link spre un serviciu,
//      căsuța portocalie ascunsă, focus în câmp; neclar → întrebarea fără
//      căsuța portocalie, răspunsul ca incercare: 2, a doua oară căsuța cu un
//      singur buton; erorile 429 / 500 / timeout / fără internet → mesaj cu
//      „Reîncearcă”, fără căsuța portocalie, fără „Nu am putut determina”,
//      fără „estimare”, textul și pozele rămân, pașii necolorați; EN fără
//      română în panou;
//   C. catalog: butoanele plutitoare nu se suprapun cu niciun buton din panou
//      (390 / 1366 / 1920 px); fundal blurat ⇒ panou vizibil (deschis / închis
//      de mai multe ori, redeschis rapid, după o eroare, după limita de
//      cereri, cu pagina derulată, 1366 și 1920 px).
// Capturi (opțional): CAPTURI_12D2=docs/capturi-12d2 node scripts/test-darrin-ai-rute.js
// Rulare: node scripts/test-darrin-ai-rute.js   (FARA_BROWSER=1: doar A)

const path = require('path');
const C = require('./darrin-ai-test-comun');
const { eRo } = require('./recunoaste-ro');
const { test, egal, adevarat, cheama, ANTHROPIC, DB, KV, reset } = C;
const { EXPLICATIE_FARA_LEGATURA, INTREBARE_IMPLICITA, LIMITE_CERERI, valideazaRezultatAI } = C.apiDeviz;

const R = {
  potrivit: (lang) => ({ relevanta: 'potrivit', categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer'], incredere: 0.86, explicatie: lang === 'ro' ? 'Caloriferul pierde apă la racord.' : 'The radiator is leaking at the joint.' }),
  faraLegatura: (lang) => ({ relevanta: 'fara_legatura', categorie_slug: 'instalatii-termice', servicii_ids: ['consultanta-darrin'], incredere: 0.1, explicatie: lang === 'ro' ? 'Documentul este un raport ANAF cu CUI 12345678 și venituri de 50.000 lei.' : 'The document is an ANAF tax report.' }),
  neclar: (lang) => ({ relevanta: 'neclar', categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer', 'reparatie-garnituri-calorifer', 'consultanta-darrin'], incredere: 0.35, explicatie: lang === 'ro' ? 'Ai menționat un calorifer.' : 'You mentioned a radiator.', intrebare: lang === 'ro' ? 'Ce se întâmplă cu caloriferul: curge, nu se încălzește sau vrei să-l înlocuiești?' : 'What is happening with the radiator: is it leaking, not heating up, or do you want to replace it?' }),
};

// ── A. Serverul ──────────────────────────────────────────────────────
async function testeServer() {
  console.log('A. api/darrin-ai/deviz.js — rutele');
  reset();
  for (const lang of ['ro', 'en']) {
    await test(`${lang}: fara_legatura → servicii: [], fără consultanță și preț, explicația înlocuită cu textul fix`, async () => {
      ANTHROPIC.raspuns = R.faraLegatura(lang);
      const r = await cheama({ mod: 'servicii', text: 'raport fiscal', lang });
      egal(r.statusCode, 200);
      egal(r.corp.relevanta, 'fara_legatura'); egal(r.corp.servicii, []);
      egal(r.corp.recomanda_consultanta, false); egal(r.corp.consultanta, null); egal(r.corp.intrebare, null);
      egal(r.corp.explicatie, EXPLICATIE_FARA_LEGATURA[lang]);
      adevarat(!/ANAF|12345678|50\.000/.test(JSON.stringify(r.corp)), 'conținutul documentului a ajuns în răspuns');
      const rand = DB.tabele.devize_ai_requests[DB.tabele.devize_ai_requests.length - 1];
      egal(rand.ai_raw_response.myd, { relevanta: 'fara_legatura', intrebare: null, incercare: 1 }, 'ruta în ai_raw_response');
      egal(rand.ai_explicatie, EXPLICATIE_FARA_LEGATURA[lang]);
    });
    await test(`${lang}: neclar (prima încercare) → întrebarea, ≤ 3 servicii posibile fără consultanță, recomanda_consultanta: false`, async () => {
      ANTHROPIC.raspuns = R.neclar(lang);
      const r = await cheama({ mod: 'servicii', text: 'calorifer', lang });
      egal(r.corp.relevanta, 'neclar'); egal(r.corp.intrebare, R.neclar(lang).intrebare);
      egal(r.corp.recomanda_consultanta, false); egal(r.corp.consultanta, null);
      egal(r.corp.servicii.map((s) => s.id_serviciu), ['inlocuire-calorifer', 'reparatie-garnituri-calorifer']);
      egal(r.corp.incercare, 1);
      const rand = DB.tabele.devize_ai_requests[DB.tabele.devize_ai_requests.length - 1];
      egal(rand.ai_raw_response.myd.intrebare, R.neclar(lang).intrebare);
    });
    await test(`${lang}: neclar la a doua încercare (incercare: 2) → consultanța, fără o nouă întrebare`, async () => {
      ANTHROPIC.raspuns = R.neclar(lang); ANTHROPIC.cereri.length = 0;
      const r = await cheama({ mod: 'servicii', text: 'calorifer\n\nrăspuns', lang, incercare: 2 });
      egal(r.corp.relevanta, 'neclar'); egal(r.corp.intrebare, null); egal(r.corp.incercare, 2);
      egal(r.corp.recomanda_consultanta, true); egal(r.corp.consultanta.id_serviciu, 'consultanta-darrin');
      adevarat(/a doua încercare/.test(ANTHROPIC.cereri[0].system), 'promptul nu spune că e a doua încercare');
    });
    await test(`${lang}: neclar fără întrebare, cu o întrebare prea lungă sau cu sume → întrebarea fixă a serverului`, async () => {
      const sluguri = [{ slug: 'instalatii-termice', title: 'x' }];
      const servicii = C.S.map((s) => ({ id: s.id, id_serviciu: s.id_serviciu, titlu: s.titlu, traduceri: { en: { titlu: s.en } } }));
      for (const intrebare of [undefined, '', 'x'.repeat(201), 'Ai un buget de 500 lei?']) {
        const r = valideazaRezultatAI({ ...R.neclar(lang), intrebare }, { sluguri, servicii, lang });
        egal(r.intrebare, INTREBARE_IMPLICITA[lang], JSON.stringify(intrebare));
      }
    });
  }
  await test('potrivit: ca înainte — consultanța doar la încredere < 0,5', async () => {
    ANTHROPIC.raspuns = R.potrivit('ro');
    let r = await cheama({ mod: 'servicii', text: 'curge un calorifer', lang: 'ro' });
    egal(r.corp.relevanta, 'potrivit'); egal(r.corp.recomanda_consultanta, false);
    ANTHROPIC.raspuns = { ...R.potrivit('ro'), incredere: 0.4 };
    r = await cheama({ mod: 'servicii', text: 'curge un calorifer', lang: 'ro' });
    egal(r.corp.recomanda_consultanta, true);
  });
  await test('incercare: 3 (sau 0, sau „2.5”) → 400 în forma comună; 1 și 2 trec', async () => {
    KV.date.clear(); // limita de cereri a IP-ului de test
    ANTHROPIC.raspuns = R.potrivit('ro');
    for (const incercare of [3, 0, 2.5]) {
      const r = await cheama({ mod: 'servicii', text: 'x', incercare });
      egal(r.statusCode, 400, 'incercare ' + incercare); egal(r.corp.ok, false);
      adevarat(JSON.stringify(r.corp.campuri).includes('incercare'), 'câmpul incercare');
    }
    for (const incercare of [1, 2]) egal((await cheama({ mod: 'servicii', text: 'x', incercare })).statusCode, 200);
  });
  await test('unealta modelului: relevanta (enum) obligatorie, intrebare ≤ 200 de caractere, servicii_ids poate fi gol', async () => {
    KV.date.clear(); // limita de cereri a IP-ului de test
    ANTHROPIC.cereri.length = 0; ANTHROPIC.raspuns = R.potrivit('ro');
    await cheama({ mod: 'servicii', text: 'x', lang: 'ro' });
    const sch = ANTHROPIC.cereri[0].tools[0].input_schema;
    egal(sch.properties.relevanta.enum, ['potrivit', 'neclar', 'fara_legatura']);
    adevarat(sch.required.includes('relevanta'));
    egal(sch.properties.intrebare.maxLength, 200);
    egal(sch.properties.servicii_ids.minItems, 0);
  });
  await test('tonul: promptul în română cere adresarea cu „tu”; cel în engleză nu are regula', async () => {
    KV.date.clear(); // limita de cereri a IP-ului de test
    ANTHROPIC.cereri.length = 0; ANTHROPIC.raspuns = R.potrivit('ro');
    await cheama({ mod: 'servicii', text: 'x', lang: 'ro' });
    await cheama({ mod: 'servicii', text: 'x', lang: 'en' });
    const [ro, en] = ANTHROPIC.cereri.map((c) => c.system);
    adevarat(/te adresezi clientului cu „tu”/.test(ro) && /niciodată „ați menționat”/.test(ro), 'regula „tu” lipsește din promptul RO');
    adevarat(!/„tu”/.test(en), 'regula „tu” în promptul EN');
    adevarat(/fara_legatura/.test(ro) && /neclar/.test(ro), 'promptul nu explică rutele');
  });

  console.log('A. Limita de cereri (10 / 20 / 60 în 10 minute)');
  const limita = async (n, opt) => {
    const coduri = [];
    for (let i = 0; i < n; i++) coduri.push((await cheama({ mod: 'servicii', text: 'x', lang: 'ro' }, opt)).statusCode);
    return coduri;
  };
  reset();
  ANTHROPIC.raspuns = R.potrivit('ro');
  DB.utilizatori['tok-client'] = { id: 'u-client', email: 'c@exemplu.ro' };
  DB.utilizatori['tok-admin'] = { id: 'u-admin', email: 'a@exemplu.ro' };
  DB.tabele.profiles = [{ id: 'u-client', roles: ['client'] }, { id: 'u-admin', roles: ['superadmin'] }];
  egal(LIMITE_CERERI, { vizitator: 10, cont: 20, superadmin: 60 });
  await test('vizitator: 10 cereri trec, a 11-a → 429 cu minutele, RO + EN, Retry-After', async () => {
    const coduri = await limita(10, { ip: '203.0.113.5' });
    egal(coduri.filter((c) => c === 200).length, 10);
    const r = await cheama({ mod: 'servicii', text: 'x' }, { ip: '203.0.113.5' });
    egal(r.statusCode, 429); egal(r.corp.cod, 'PREA_MULTE_CERERI');
    egal(r.corp.mesaj.ro, 'Ai trimis multe cereri la Darrin AI într-un timp scurt. Poți încerca din nou peste 10 minute.');
    egal(r.corp.mesaj.en, 'You sent many requests to Darrin AI in a short time. You can try again in 10 minutes.');
    egal(r.headere['Retry-After'], '600');
    // Alt IP: are limita lui.
    egal((await cheama({ mod: 'servicii', text: 'x' }, { ip: '203.0.113.6' })).statusCode, 200);
  });
  await test('429: minutele rămase din fereastră (2 min 5 s → „3 minute”, 40 s → „1 minut”)', async () => {
    const cheie = [...KV.date.keys()].find((k) => k.startsWith('ratelimit:darrin-ai-deviz:ip:'));
    KV.date.get(cheie).exp = Date.now() + 125000;
    let r = await cheama({ mod: 'servicii', text: 'x' }, { ip: '203.0.113.5' });
    adevarat(/peste 3 minute\.$/.test(r.corp.mesaj.ro) && /in 3 minutes\.$/.test(r.corp.mesaj.en), JSON.stringify(r.corp.mesaj));
    egal(r.headere['Retry-After'], '125');
    KV.date.get(cheie).exp = Date.now() + 40000;
    r = await cheama({ mod: 'servicii', text: 'x' }, { ip: '203.0.113.5' });
    adevarat(/peste 1 minut\.$/.test(r.corp.mesaj.ro) && /in 1 minute\.$/.test(r.corp.mesaj.en), JSON.stringify(r.corp.mesaj));
  });
  await test('cont autentificat: 20 cereri pe cont (de pe IP-uri diferite), a 21-a → 429', async () => {
    const coduri = [];
    for (let i = 0; i < 20; i++) coduri.push((await cheama({ mod: 'servicii', text: 'x' }, { token: 'tok-client', ip: '198.51.100.' + i })).statusCode);
    egal(coduri.filter((c) => c === 200).length, 20);
    egal((await cheama({ mod: 'servicii', text: 'x' }, { token: 'tok-client', ip: '198.51.100.99' })).statusCode, 429);
  });
  await test('superadmin (rolul din profiles.roles): 60 trec, a 61-a → 429', async () => {
    const coduri = await limita(60, { token: 'tok-admin', ip: '192.0.2.1' });
    egal(coduri.filter((c) => c === 200).length, 60);
    egal((await cheama({ mod: 'servicii', text: 'x' }, { token: 'tok-admin', ip: '192.0.2.1' })).statusCode, 429);
  });
  await test('rolul superadmin scris doar în user_metadata nu dă limita de 60 (cont obișnuit: 20)', async () => {
    DB.utilizatori['tok-fals'] = { id: 'u-fals', user_metadata: { roles: ['superadmin'] } };
    DB.tabele.profiles.push({ id: 'u-fals', roles: ['client'] });
    const coduri = await limita(21, { token: 'tok-fals', ip: '192.0.2.50' });
    egal(coduri.filter((c) => c === 200).length, 20); egal(coduri[20], 429);
  });
}

// ── B / C. Chromium ──────────────────────────────────────────────────
async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { C.stare.esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI_12D2 ? path.resolve(process.env.CAPTURI_12D2) : null;
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();
  const POZA = Buffer.from('89504e470d0a1a0a0000000d49484452000000100000001008020000009091683600000017494441547801636460f8cf400a30a2b1c160d4005d0c00a2a703fd4b7cd5f40000000049454e44ae426082', 'hex');

  const SUPRAFETE = [
    {
      nume: 'catalog', adresa: '/mydarrin-catalog.html', deschide: (pg) => pg.evaluate(() => openConsultanta()),
      camp: '#chat-input', buton: '#send-to-ai-btn', mesaj: '#ai-mesaj', input: '#file-input', preview: '#file-preview',
      rezultat: '#ai-result', text: '#ai-recommendation', carduri: '#rec-services [data-ai-serviciu]', portocaliu: '#escalate-to-argint',
      panou: '#cons-bronz', captura: '#consultanta-modal',
    },
    {
      nume: 'creeaza-deviz', adresa: '/mydarrin-creeaza-deviz.html', deschide: async () => {},
      camp: '#dv-text', buton: '#dv-submit-btn', mesaj: '#dv-mesaj', input: '#dv-file', preview: '#dv-file-preview',
      rezultat: '#dv-rezultat', text: '#dv-rez-explicatie', carduri: '#dv-rez-servicii .svc-card', portocaliu: '#dv-rez-consultanta',
      panou: '#dv-formular, #dv-rezultat', captura: '#deviz-hero',
    },
  ];
  const vizibil = (pg, sel) => pg.$eval(sel, (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !!e.offsetParent; }).catch(() => false);
  const textVizibil = (pg, sel) => pg.$$eval(sel, (e) => e.map((x) => x.innerText).join(' | '));
  const trimite = async (pg, s, text) => { await pg.fill(s.camp, text); await pg.click(s.buton); };
  const asteaptaRezultat = (pg, s) => pg.waitForFunction(([r]) => { const e = document.querySelector(r); return e && getComputedStyle(e).display !== 'none' && e.getAttribute('data-relevanta'); }, [s.rezultat]);
  const fixRo = EXPLICATIE_FARA_LEGATURA;
  // Pentru capturi: rezultatul adus în ecran, după derularea animată a paginii.
  const laRezultat = async (pg, s, sel, bloc) => { await pg.waitForTimeout(600); await pg.evaluate(([r, b]) => document.querySelector(r).scrollIntoView({ block: b }), [sel || s.rezultat, bloc || 'start']); await pg.waitForTimeout(200); };

  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [390, 1366]) {
        console.log(`B. Chromium · ${lang.toUpperCase()} · ${latime}px`);
        for (const s of SUPRAFETE) {
          reset();
          const ctx = await C.context(browser, latime, lang);
          await ctx.addInitScript(() => { window.MYD_DAI_TIMEOUT_MS = 1500; });
          const tag = `${lang} ${latime} ${s.nume}`;

          await test(`${tag}: fara_legatura → doar textul fix, 0 carduri, niciun link spre un serviciu, fără căsuța portocalie, focus în câmp`, async () => {
            ANTHROPIC.raspuns = R.faraLegatura(lang);
            const pg = await C.pagina(ctx, baza, s.adresa);
            await s.deschide(pg); await pg.waitForTimeout(400);
            await trimite(pg, s, lang === 'ro' ? 'raport ANAF trimestrul 3' : 'tax report quarter 3');
            await asteaptaRezultat(pg, s);
            egal((await textVizibil(pg, s.text)).trim().split('\n')[0], fixRo[lang]);
            egal(await pg.$$eval(s.carduri, (e) => e.length), 0, 'carduri');
            egal(await pg.$$eval(`${s.rezultat} a[href*="/mydarrin-produs"], ${s.rezultat} a[href^="/servicii/"]`, (e) => e.filter((a) => a.offsetParent).length), 0, 'link spre un serviciu');
            egal(await vizibil(pg, s.portocaliu), false, 'căsuța portocalie');
            await pg.waitForTimeout(150);
            egal(await pg.evaluate((c) => document.activeElement === document.querySelector(c), s.camp), true, 'focus în câmpul de descriere');
            if (CAPTURI) { await laRezultat(pg, s); await C.captura(CAPTURI, pg, `${s.nume}-${lang}-${latime}-fara-legatura-dupa`, s.captura); }
            egal(pg.dialoguri, [], 'alert'); egal(pg.erori, [], 'erori JS');
            await pg.close();
          });

          await test(`${tag}: neclar → întrebarea fără căsuța portocalie; răspunsul ca incercare: 2; a doua oară căsuța cu un singur buton`, async () => {
            ANTHROPIC.raspuns = R.neclar(lang);
            const pg = await C.pagina(ctx, baza, s.adresa);
            await s.deschide(pg); await pg.waitForTimeout(400);
            await trimite(pg, s, lang === 'ro' ? 'calorifer' : 'radiator');
            await asteaptaRezultat(pg, s);
            egal(await pg.$eval(`${s.text} [data-ai-intrebare]`, (e) => e.textContent), R.neclar(lang).intrebare);
            egal(await pg.$$eval(s.carduri, (e) => e.map((x) => x.getAttribute('data-ai-serviciu'))), ['inlocuire-calorifer', 'reparatie-garnituri-calorifer'], 'serviciile posibile');
            egal(await vizibil(pg, s.portocaliu), false, 'căsuța portocalie la prima încercare');
            egal(ctx.cereriDeviz[ctx.cereriDeviz.length - 1].incercare, undefined, 'prima încercare fără câmpul incercare');
            if (CAPTURI) { await laRezultat(pg, s); await C.captura(CAPTURI, pg, `${s.nume}-${lang}-${latime}-neclar-1-dupa`, s.captura); }
            await trimite(pg, s, lang === 'ro' ? 'nu știu exact' : 'not sure');
            await pg.waitForFunction(([p]) => { const e = document.querySelector(p); return e && getComputedStyle(e).display !== 'none'; }, [s.portocaliu]);
            const ultima = ctx.cereriDeviz[ctx.cereriDeviz.length - 1];
            egal(ultima.incercare, 2, 'a doua încercare');
            adevarat(ultima.text.includes(lang === 'ro' ? 'calorifer' : 'radiator') && ultima.text.includes(R.neclar(lang).intrebare), 'descrierea de la început și întrebarea în a doua cerere');
            const butoane = await pg.$$eval(`${s.portocaliu} a, ${s.portocaliu} button`, (e) => e.filter((x) => x.offsetParent && getComputedStyle(x).display !== 'none').map((x) => [x.textContent.trim(), x.getAttribute('href')]));
            egal(butoane, [[lang === 'ro' ? 'Consultanță Darrin →' : 'Darrin Consultancy →', '/servicii/consultanta-darrin']], 'un singur buton în căsuța de consultanță');
            if (CAPTURI) { await laRezultat(pg, s, s.portocaliu, 'end'); await C.captura(CAPTURI, pg, `${s.nume}-${lang}-${latime}-neclar-2-consultanta-dupa`, s.captura); }
            egal(pg.dialoguri, [], 'alert'); egal(pg.erori, [], 'erori JS');
            await pg.close();
          });

          const ERORI = [
            ['429', async (r) => r.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '420' }, body: JSON.stringify({ ok: false, cod: 'PREA_MULTE_CERERI', mesaj: { ro: 'Ai trimis multe cereri la Darrin AI într-un timp scurt. Poți încerca din nou peste 7 minute.', en: 'You sent many requests to Darrin AI in a short time. You can try again in 7 minutes.' }, campuri: [] }) }), lang === 'ro' ? 'peste 7 minute' : 'in 7 minutes'],
            ['500', async (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, cod: 'EROARE_SERVER', mesaj: { ro: 'Nu am putut încărca catalogul My Darrin. Încearcă din nou.', en: 'We could not load the My Darrin catalogue. Please try again.' }, campuri: [] }) }), lang === 'ro' ? 'Nu am putut încărca catalogul' : 'could not load the My Darrin catalogue'],
            ['timeout', async () => { /* niciun răspuns */ }, lang === 'ro' ? 'nu a răspuns la timp' : "didn't answer in time"],
            ['fără internet', async (r) => r.abort('internetdisconnected'), lang === 'ro' ? 'Verifică conexiunea la internet' : 'Check your internet connection'],
          ];
          for (const [nume, raspunde, asteptat] of ERORI) {
            await test(`${tag}: eroare ${nume} → mesaj cu „Reîncearcă”, fără căsuța portocalie / „Nu am putut determina” / „estimare”; textul și poza rămân`, async () => {
              ctx.suprascrie = raspunde;
              const pg = await C.pagina(ctx, baza, s.adresa);
              await s.deschide(pg); await pg.waitForTimeout(400);
              await pg.setInputFiles(s.input, { name: 'poza.png', mimeType: 'image/png', buffer: POZA });
              await pg.waitForFunction((p) => document.querySelectorAll(p + ' [data-dai-fisier]').length === 1, s.preview);
              const text = lang === 'ro' ? 'curge un calorifer în baie' : 'a radiator is leaking in the bathroom';
              await trimite(pg, s, text);
              await pg.waitForSelector(`${s.mesaj} .md-feedback-eroare`, { timeout: 8000 });
              const m = await textVizibil(pg, `${s.mesaj} .md-feedback-eroare`);
              adevarat(m.includes(asteptat), 'mesajul: ' + m);
              egal(await pg.$$eval(`${s.mesaj} .md-reincearca`, (e) => e.map((b) => b.textContent)), [lang === 'ro' ? 'Reîncearcă' : 'Try again']);
              egal(await vizibil(pg, s.portocaliu), false, 'căsuța portocalie');
              egal(await vizibil(pg, s.rezultat), false, 'eroarea afișată ca rezultat');
              const panou = await textVizibil(pg, s.panou);
              adevarat(!/Nu am putut determina|could not determine/i.test(panou), '„Nu am putut determina” vizibil');
              adevarat(!/estimare|estimate/i.test(panou), '„estimare” vizibil: ' + (panou.match(/.{0,40}(estimare|estimate).{0,40}/i) || [])[0]);
              egal(await pg.$eval(s.camp, (e) => e.value), text, 'textul rămâne');
              egal(await pg.$$eval(`${s.preview} [data-dai-fisier]`, (e) => e.length), 1, 'poza rămâne');
              if (s.nume === 'catalog') egal(await pg.$eval('#cp-3', (e) => e.style.background), 'rgb(213, 223, 232)', 'pasul „Recomandare” necolorat');
              egal(await pg.$eval(s.buton, (b) => b.disabled), false, 'butonul deblocat');
              if (CAPTURI && nume === '429') await C.captura(CAPTURI, pg, `${s.nume}-${lang}-${latime}-eroare-429-dupa`, s.captura);
              // „Reîncearcă” trimite din nou aceeași cerere.
              ctx.suprascrie = null; ANTHROPIC.raspuns = R.potrivit(lang);
              await pg.click(`${s.mesaj} .md-reincearca`);
              await asteaptaRezultat(pg, s);
              egal(ctx.cereriDeviz[ctx.cereriDeviz.length - 1].files.length, 1, 'poza retrimisă');
              egal(pg.dialoguri, [], 'alert'); egal(pg.erori, [], 'erori JS');
              await pg.close();
            });
          }

          if (lang === 'en') {
            await test(`${tag}: EN — nicio frază în română vizibilă în panou după un răspuns`, async () => {
              ctx.suprascrie = null; ANTHROPIC.raspuns = R.neclar('en');
              const pg = await C.pagina(ctx, baza, s.adresa);
              await s.deschide(pg); await pg.waitForTimeout(400);
              await trimite(pg, s, 'radiator');
              await asteaptaRezultat(pg, s);
              const linii = (await textVizibil(pg, s.panou)).split('\n').map((x) => x.trim()).filter(Boolean);
              egal(linii.filter((l) => eRo(l)), [], 'texte în română');
              await pg.close();
            });
          }
          await ctx.close();
        }
      }
    }

    // ── C. Butoanele plutitoare și fundalul blurat (catalog) ──
    for (const latime of [390, 1366, 1920]) {
      console.log(`C. Catalog · ${latime}px`);
      for (const lang of ['ro', 'en']) {
        reset();
        const ctx = await C.context(browser, latime, lang, { inaltime: latime === 1920 ? 1080 : undefined, ip: '10.9.9.' + (latime % 250) });
        await test(`${lang} ${latime}: butoanele plutitoare (distribuire, Darrin AI) nu se suprapun cu niciun buton din panou`, async () => {
          ANTHROPIC.raspuns = { ...R.potrivit(lang), incredere: 0.3 };
          const pg = await C.pagina(ctx, baza, '/mydarrin-catalog.html');
          await pg.waitForSelector('#dai-fab');
          const inainte = await pg.evaluate(() => ['#dai-fab', '#myd-share-fab'].map((id) => { const e = document.querySelector(id); return !!(e && getComputedStyle(e).display !== 'none'); }));
          await pg.evaluate(() => openConsultanta()); await pg.waitForTimeout(500);
          await trimite(pg, SUPRAFETE[0], lang === 'ro' ? 'curge ceva' : 'something leaks');
          await pg.waitForSelector('#escalate-to-argint', { state: 'visible' });
          await pg.evaluate(() => { const c = document.getElementById('consultanta-continut'); c.scrollTop = c.scrollHeight; });
          await pg.waitForTimeout(300);
          const r = await pg.evaluate(() => {
            const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
            const plutitoare = ['#dai-fab', '#myd-share-fab', '#dai-chat-panel', '#myd-share-panel'].map((id) => document.querySelector(id)).filter((e) => e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).map((e) => ({ id: e.id, ...rect(e) }));
            const butoane = [...document.querySelectorAll('#consultanta-modal button, #consultanta-modal a')].filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0).map((e) => ({ t: e.textContent.trim().slice(0, 30), ...rect(e) }));
            const peste = [];
            for (const f of plutitoare) for (const b of butoane) {
              if (f.x < b.x + b.w && b.x < f.x + f.w && f.y < b.y + b.h && b.y < f.y + f.h) peste.push(f.id + ' × ' + b.t);
            }
            return { peste, plutitoare: plutitoare.map((f) => f.id) };
          });
          egal(r.peste, [], 'suprapuneri');
          egal(r.plutitoare, [], 'butoane plutitoare vizibile cât e panoul deschis');
          if (CAPTURI && (lang === 'ro' || latime === 1920)) await C.captura(CAPTURI, pg, `catalog-${lang}-${latime}-panou-fara-plutitoare-dupa`, latime === 1920 ? null : '#consultanta-modal');
          await pg.evaluate(() => closeConsultanta()); await pg.waitForTimeout(500);
          const dupa = await pg.evaluate(() => ['#dai-fab', '#myd-share-fab'].map((id) => { const e = document.querySelector(id); return !!(e && getComputedStyle(e).display !== 'none'); }));
          egal(dupa, inainte, 'butoanele plutitoare revin după închidere');
          await pg.close();
        });

        if (latime === 390 && lang === 'en') { await ctx.close(); continue; }
        await test(`${lang} ${latime}: fundal blurat ⇒ panou vizibil (deschis / închis de 4 ori, redeschis rapid, după o eroare, după limita de cereri, pagină derulată)`, async () => {
          const pg = await C.pagina(ctx, baza, '/mydarrin-catalog.html');
          const verifica = async (moment) => {
            await pg.waitForTimeout(500);
            const st = await pg.evaluate(() => {
              const o = document.getElementById('consultanta-overlay');
              const m = document.getElementById('consultanta-modal');
              const r = m.getBoundingClientRect();
              const vizibilO = getComputedStyle(o).display !== 'none';
              const vv = window.visualViewport; const jos = vv ? vv.offsetTop + vv.height : innerHeight;
              // Panoul acoperă cel puțin 90% din înălțimea vizibilă (regula comună [id$="-modal"] îl limitează la 95vh).
              const inEcran = r.top <= 1 && r.bottom >= 0.9 * jos && r.left < innerWidth && r.right > innerWidth - 50 && m.classList.contains('cons-open');
              return { vizibilO, inEcran, r: [r.left, r.top, r.width, r.height].map(Math.round), scroll: Math.round(scrollY), overlays: document.querySelectorAll('#consultanta-overlay').length };
            });
            egal(st.overlays, 1, 'un singur #consultanta-overlay');
            if (st.vizibilO) adevarat(st.inEcran, `${moment}: fundal blurat fără panou (panou la ${st.r.join(',')}, derulare ${st.scroll})`);
            return st;
          };
          const deschide = async (y) => { await pg.evaluate((yy) => window.scrollTo(0, yy), y); await pg.waitForTimeout(150); await pg.evaluate(() => openConsultanta()); };
          for (const [i, y] of [[1, 0], [2, 2500], [3, 4000], [4, 1200]]) {
            await deschide(y);
            adevarat((await verifica(`deschiderea ${i}, derulare ${y}`)).vizibilO, 'fundalul la deschidere');
            await pg.evaluate(() => closeConsultanta());
            egal((await verifica(`închiderea ${i}`)).vizibilO, false, 'fundalul rămâne după închidere');
          }
          // Închis și redeschis repede (înaintea animației de 350 ms).
          await deschide(3000); await pg.waitForTimeout(400);
          await pg.evaluate(() => { closeConsultanta(); setTimeout(() => openConsultanta(), 120); });
          adevarat((await verifica('redeschis rapid')).vizibilO, 'fundalul după redeschiderea rapidă');
          await pg.evaluate(() => closeConsultanta()); await verifica('închis după redeschidere');
          // După o eroare și după limita de cereri.
          ctx.suprascrie = async (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, cod: 'SERVICIU_EXTERN', mesaj: { ro: 'x', en: 'x' }, campuri: [] }) });
          await deschide(2000); await trimite(pg, SUPRAFETE[0], 'x');
          await pg.waitForSelector('#ai-mesaj .md-feedback-eroare');
          await verifica('după o eroare');
          await pg.evaluate(() => closeConsultanta()); await verifica('închis după eroare');
          ctx.suprascrie = null;
          ANTHROPIC.raspuns = R.potrivit(lang);
          for (let i = 0; i < 10; i++) await C.cheama({ mod: 'servicii', text: 'x' }, { ip: '10.9.9.' + (latime % 250) });
          await deschide(3500); await trimite(pg, SUPRAFETE[0], 'x');
          await pg.waitForSelector('#ai-mesaj .md-feedback-eroare');
          adevarat(/minute/.test(await textVizibil(pg, '#ai-mesaj')), 'mesajul 429 cu minutele');
          await verifica('după limita de cereri');
          await pg.evaluate(() => closeConsultanta()); await verifica('închis după limită');
          await deschide(5000); await verifica('redeschis după limită, derulat');
          egal(pg.erori, [], 'erori JS');
          await pg.close();
        });
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  await testeServer();
  if (!process.env.FARA_BROWSER) await testeBrowser();
  console.log(`\n${C.stare.ok} trecute, ${C.stare.esec} eșuate.`);
  process.exit(C.stare.esec ? 1 : 0);
})();

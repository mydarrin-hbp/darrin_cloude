// scripts/test-darrin-ai-poze.js
// Pasul 12-D2, partea A: pozele merg de pe orice dispozitiv, cel mult 5 fișiere.
// Supabase, Anthropic și KV simulate (niciun apel real).
//   A. lib/sterge-metadate-imagine.js pe JPEG, PNG, WebP (funcție pură);
//   B. api/darrin-ai/deviz.js: 6 fișiere → 400, total > 3 MB → 400, image/heic
//      → 400, PDF > 2 MB → 400, modelul primește 5 blocuri de imagine fără EXIF,
//      Storage simulat primește imaginile fără EXIF;
//   C. Chromium (catalog și „Creează deviz”, 360 / 390 / 412 / 1366 px, RO și EN):
//      o poză de 4000 × 3000 px (~5 MB) cu EXIF și GPS → latura ≤ 1568 px,
//      ≤ 500 KB, fără EXIF / GPS, cererea trece; 5 fișiere trec, al 6-lea arată
//      mesajul și nu se adaugă; total > 3 MB refuzat; HEIC nedecodabil → mesaj;
//      PDF de 1 MB trece, de 3 MB refuzat; butonul blocat cât se pregătesc
//      pozele; zona „×” ≥ 44 × 44 px; niciun alert / confirm.
// Capturi (opțional): CAPTURI_12D2=docs/capturi-12d2 node scripts/test-darrin-ai-poze.js
// Rulare: node scripts/test-darrin-ai-poze.js   (FARA_BROWSER=1: doar A–B)

const path = require('path');
const C = require('./darrin-ai-test-comun');
const { stergeMetadateImagine } = require(path.join(C.RADACINA, 'lib/sterge-metadate-imagine.js'));
const { test, egal, adevarat, cheama, ANTHROPIC, STORAGE, reset } = C;

const RASPUNS_OK = { relevanta: 'potrivit', categorie_slug: 'instalatii-termice', servicii_ids: ['inlocuire-calorifer'], incredere: 0.86, explicatie: 'Caloriferul pierde apă.' };
const b64 = (buf) => buf.toString('base64');

// ── A. Funcția pură ──────────────────────────────────────────────────
async function testePure() {
  console.log('A. lib/sterge-metadate-imagine.js');
  await test('JPEG: APP1 (EXIF + GPS) și APP13 scoase, restul segmentelor neschimbate', async () => {
    const j = C.jpegSintetic();
    adevarat(C.areMetadate(j), 'fișierul de test nu are metadate');
    const r = stergeMetadateImagine(j, 'image/jpeg');
    egal(r.ok, true); egal(r.scoase, 2);
    adevarat(!C.areMetadate(r.buffer), 'au rămas metadate');
    egal(r.buffer.length, j.length - (j.length - r.buffer.length));
    egal(C.dimensiuniJpeg(r.buffer), { inaltime: 10, latime: 12 }, 'SOF păstrat');
    egal([r.buffer[0], r.buffer[1], r.buffer[r.buffer.length - 2], r.buffer[r.buffer.length - 1]], [0xff, 0xd8, 0xff, 0xd9]);
  });
  await test('PNG: eXIf, tEXt, iTXt, zTXt scoase; IHDR, IDAT, IEND păstrate', async () => {
    const p = C.pngCuMetadate();
    const r = stergeMetadateImagine(p, 'image/png');
    egal(r.ok, true); egal(r.scoase, 4);
    const t = r.buffer.toString('latin1');
    adevarat(!t.includes(C.MARCAJ) && !/eXIf|tEXt|iTXt|zTXt/.test(t), 'au rămas metadate');
    adevarat(t.includes('IHDR') && t.includes('IDAT') && t.includes('IEND'), 'blocuri de imagine pierdute');
  });
  await test('WebP: EXIF și „XMP ” scoase, indicatorii din VP8X șterși, mărimea RIFF corectă', async () => {
    const w = C.webpCuMetadate();
    const r = stergeMetadateImagine(w, 'image/webp');
    egal(r.ok, true); egal(r.scoase, 2);
    const t = r.buffer.toString('latin1');
    adevarat(!t.includes(C.MARCAJ) && !t.includes('EXIF') && !t.includes('XMP '), 'au rămas metadate');
    adevarat(t.includes('VP8L'), 'blocul de imagine pierdut');
    egal(r.buffer.readUInt32LE(4), r.buffer.length - 8, 'mărimea RIFF');
    egal(r.buffer[20] & 0x0c, 0, 'indicatorii EXIF / XMP din VP8X');
  });
  await test('un fișier care nu are structura formatului → ok: false', async () => {
    egal(stergeMetadateImagine(Buffer.from('nu e o imagine'), 'image/jpeg').ok, false);
    egal(stergeMetadateImagine(Buffer.from('nu e o imagine'), 'image/png').ok, false);
    egal(stergeMetadateImagine(Buffer.from('RIFF0000WAVE'), 'image/webp').ok, false);
    egal(stergeMetadateImagine(C.jpegSintetic(), 'image/gif').ok, false);
  });
}

// ── B. Serverul ──────────────────────────────────────────────────────
async function testeServer() {
  console.log('B. api/darrin-ai/deviz.js — fișierele');
  reset();
  const jpeg = b64(C.jpegSintetic(3000));
  const imagine = { mime: 'image/jpeg', data_base64: jpeg };
  await test('6 fișiere → 400 (forma comună, câmpul files)', async () => {
    ANTHROPIC.raspuns = RASPUNS_OK;
    const r = await cheama({ mod: 'servicii', text: 'calorifer', files: Array(6).fill(imagine) });
    egal(r.statusCode, 400); egal(r.corp.ok, false);
    adevarat(JSON.stringify(r.corp.campuri).includes('files'), 'câmpul files');
  });
  await test('total > 3 MB → 400 FISIERE_PREA_MARI, mesaj RO + EN', async () => {
    const mare = { mime: 'image/jpeg', data_base64: b64(C.jpegSintetic(1100 * 1024)) };
    const r = await cheama({ mod: 'servicii', text: 'x', files: [mare, mare, mare] });
    egal(r.statusCode, 400); egal(r.corp.cod, 'FISIERE_PREA_MARI');
    adevarat(/3 MB/.test(r.corp.mesaj.ro) && /3 MB/.test(r.corp.mesaj.en));
    egal(r.corp.campuri.map((c) => c.camp), ['files']);
  });
  await test('image/heic → 400 (tipul nu mai e acceptat)', async () => {
    const r = await cheama({ mod: 'servicii', text: 'x', files: [{ mime: 'image/heic', data_base64: jpeg }] });
    egal(r.statusCode, 400); egal(r.corp.ok, false);
  });
  await test('PDF > 2 MB → 400 PDF_PREA_MARE; PDF de 1 MB trece', async () => {
    let r = await cheama({ mod: 'servicii', text: 'x', files: [{ mime: 'application/pdf', data_base64: b64(C.pdf(2.2 * 1024 * 1024)) }] });
    egal(r.statusCode, 400); egal(r.corp.cod, 'PDF_PREA_MARE');
    r = await cheama({ mod: 'servicii', text: 'x', files: [{ mime: 'application/pdf', data_base64: b64(C.pdf(1024 * 1024)) }] });
    egal(r.statusCode, 200);
  });
  await test('o „poză” care nu e JPEG → 400 FISIER_INVALID, RO + EN', async () => {
    const r = await cheama({ mod: 'servicii', text: 'x', files: [{ mime: 'image/jpeg', data_base64: b64(Buffer.from('nu e jpeg')) }] });
    egal(r.statusCode, 400); egal(r.corp.cod, 'FISIER_INVALID');
    adevarat(r.corp.mesaj.ro && r.corp.mesaj.en);
  });
  await test('5 imagini (JPEG, PNG, WebP) → modelul primește 5 blocuri de imagine, fără EXIF / GPS', async () => {
    ANTHROPIC.cereri.length = 0; STORAGE.length = 0;
    const files = [
      imagine, imagine,
      { mime: 'image/png', data_base64: b64(C.pngCuMetadate()) },
      { mime: 'image/webp', data_base64: b64(C.webpCuMetadate()) },
      imagine,
    ];
    const r = await cheama({ mod: 'servicii', text: 'calorifer', files });
    egal(r.statusCode, 200);
    const blocuri = ANTHROPIC.cereri[0].messages[0].content.filter((b) => b.type === 'image');
    egal(blocuri.length, 5);
    egal(blocuri.map((b) => b.source.media_type), ['image/jpeg', 'image/jpeg', 'image/png', 'image/webp', 'image/jpeg']);
    blocuri.forEach((b, i) => adevarat(!C.areMetadate(Buffer.from(b.source.data, 'base64')), `blocul ${i} are metadate`));
    adevarat(/până la 5 poze/.test(ANTHROPIC.cereri[0].system), 'promptul nu pomenește 5 poze');
    adevarat(/nu identifici persoane/.test(ANTHROPIC.cereri[0].system), 'promptul nu interzice identificarea persoanelor');
  });
  await test('Storage simulat (deviz-ai-uploads) primește aceleași imagini curățate', async () => {
    egal(STORAGE.length, 5);
    STORAGE.forEach((f) => { egal(f.bucket, 'deviz-ai-uploads'); adevarat(!C.areMetadate(f.buf), f.cale + ' are metadate'); });
    const salvat = ANTHROPIC.cereri[0].messages[0].content.filter((b) => b.type === 'image').map((b) => b.source.data);
    egal(STORAGE.map((f) => f.buf.toString('base64')), salvat, 'Storage = ce a văzut modelul');
  });
}

// ── C. Chromium ──────────────────────────────────────────────────────
async function testeBrowser() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { C.stare.esec++; console.log('  ✗ Playwright lipsește'); return; }
  const { porneste } = require('./server-test');
  const CAPTURI = process.env.CAPTURI_12D2 ? path.resolve(process.env.CAPTURI_12D2) : null;
  const srv = await porneste(0);
  const baza = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch();

  // Poza mare: 4000 × 3000 px, ~5 MB, cu EXIF + GPS (APP1) și APP13.
  const gen = await browser.newPage();
  const brut = Buffer.from(await gen.evaluate(async () => {
    const mic = document.createElement('canvas'); mic.width = 1000; mic.height = 750;
    const mx = mic.getContext('2d'); const id = mx.createImageData(mic.width, mic.height);
    let s = 12345; const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < id.data.length; i += 4) { id.data[i] = r() * 255; id.data[i + 1] = r() * 255; id.data[i + 2] = r() * 255; id.data[i + 3] = 255; }
    mx.putImageData(id, 0, 0);
    const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
    c.getContext('2d').drawImage(mic, 0, 0, 4000, 3000);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    const u8 = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }), 'base64');
  const mica = Buffer.from(await gen.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = '#7a9'; x.fillRect(0, 0, 320, 240); x.fillStyle = '#335'; x.fillRect(40, 40, 120, 90);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    const u8 = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }), 'base64');
  await gen.close();
  const POZA_MARE = C.cuExif(brut);
  console.log(`   (poza de test: 4000 × 3000 px, ${(POZA_MARE.length / 1048576).toFixed(2)} MB, cu EXIF + GPS)`);
  const fis = (name, mimeType, buffer) => ({ name, mimeType, buffer });
  const MASURI = [];

  const SUPRAFETE = [
    { nume: 'catalog', adresa: '/mydarrin-catalog.html', deschide: (pg) => pg.evaluate(() => openConsultanta()), input: '#file-input', preview: '#file-preview', mesaj: '#ai-mesaj', buton: '#send-to-ai-btn', camp: '#chat-input', rezultat: '#rec-services [data-ai-serviciu]', captura: '#cons-bronz' },
    { nume: 'creeaza-deviz', adresa: '/mydarrin-creeaza-deviz.html', deschide: async () => {}, input: '#dv-file', preview: '#dv-file-preview', mesaj: '#dv-mesaj', buton: '#dv-submit-btn', camp: '#dv-text', rezultat: '#dv-rez-servicii .svc-card', captura: '#deviz-hero' },
  ];
  const miniaturi = (pg, s) => pg.$$eval(`${s.preview} [data-dai-fisier]`, (e) => e.length);
  const textMesaj = (pg, s) => pg.$eval(s.mesaj, (e) => e.innerText.replace(/\s+/g, ' ').trim());

  try {
    for (const lang of ['ro', 'en']) {
      for (const latime of [360, 390, 412, 1366]) {
        console.log(`C. Chromium · ${lang.toUpperCase()} · ${latime}px`);
        reset();
        const ctx = await C.context(browser, latime, lang);
        for (const s of SUPRAFETE) {
          await test(`${lang} ${latime} ${s.nume}: poza de ~5 MB → ≤ 1568 px, ≤ 500 KB, fără EXIF / GPS; butonul blocat în timpul pregătirii; cererea trece`, async () => {
            ANTHROPIC.raspuns = RASPUNS_OK; ANTHROPIC.cereri.length = 0;
            const pg = await C.pagina(ctx, baza, s.adresa);
            await s.deschide(pg);
            await pg.waitForTimeout(400);
            // Observă butonul: a fost blocat cât timp apărea „Se pregătesc pozele…”?
            await pg.evaluate(([b, m]) => {
              window.__blocat = false;
              const obs = () => { const btn = document.querySelector(b); const z = document.querySelector(m); if (btn && btn.disabled && z && /pregătesc|Preparing/.test(z.textContent)) window.__blocat = true; };
              new MutationObserver(obs).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
            }, [s.buton, s.mesaj]);
            await pg.setInputFiles(s.input, fis('IMG_20261118_1941.jpg', 'image/jpeg', POZA_MARE));
            await pg.waitForFunction((p) => document.querySelectorAll(p + ' [data-dai-fisier]').length === 1, s.preview, { timeout: 20000 });
            egal(await pg.evaluate(() => window.__blocat), true, 'butonul blocat + mesajul „Se pregătesc pozele…”');
            egal(await pg.$eval(s.buton, (b) => b.disabled), false, 'butonul deblocat la final');
            await pg.fill(s.camp, lang === 'ro' ? 'curge un calorifer' : 'a radiator is leaking');
            await pg.click(s.buton);
            await pg.waitForSelector(s.rezultat);
            const corp = ctx.cereriDeviz[ctx.cereriDeviz.length - 1];
            egal(corp.files.length, 1);
            const trimis = Buffer.from(corp.files[0].data_base64, 'base64');
            const d = C.dimensiuniJpeg(trimis);
            adevarat(d && Math.max(d.latime, d.inaltime) <= 1568, 'latura ' + JSON.stringify(d));
            adevarat(trimis.length <= 500 * 1024, `${Math.round(trimis.length / 1024)} KB > 500 KB`);
            adevarat(!C.areMetadate(trimis), 'EXIF / GPS în poza trimisă');
            egal(corp.files[0].mime, 'image/jpeg');
            const laModel = Buffer.from(ANTHROPIC.cereri[0].messages[0].content.find((b) => b.type === 'image').source.data, 'base64');
            adevarat(!C.areMetadate(laModel), 'EXIF la model');
            MASURI.push({ lang, latime, pagina: s.nume, inainte: POZA_MARE.length, dupa: trimis.length, ...d });
            egal(await miniaturi(pg, s), 0, 'miniaturile se golesc după trimitere');
            egal(pg.dialoguri, [], 'alert / confirm'); egal(pg.erori, [], 'erori JS');
            await pg.close();
          });

          await test(`${lang} ${latime} ${s.nume}: 5 fișiere trec, al 6-lea arată mesajul și nu se adaugă; „×” ≥ 44 × 44 px`, async () => {
            const pg = await C.pagina(ctx, baza, s.adresa);
            await s.deschide(pg);
            await pg.waitForTimeout(400);
            await pg.setInputFiles(s.input, [1, 2, 3, 4, 5].map((i) => fis(`poza-${i}.png`, 'image/png', mica)));
            await pg.waitForFunction((p) => document.querySelectorAll(p + ' [data-dai-fisier]').length === 5, s.preview);
            egal(await textMesaj(pg, s), '', 'niciun mesaj pentru 5 fișiere');
            if (CAPTURI && (latime === 390 || latime === 1366)) await C.captura(CAPTURI, pg, `${s.nume}-${lang}-${latime}-5-miniaturi-dupa`, s.preview);
            await pg.setInputFiles(s.input, fis('poza-6.png', 'image/png', mica));
            await pg.waitForFunction((m) => document.querySelector(m).textContent.trim().length > 0, s.mesaj);
            egal(await textMesaj(pg, s), (lang === 'ro' ? 'Poți atașa cel mult 5 fișiere.' : 'You can attach up to 5 files.') + ' ×', 'mesajul la al 6-lea');
            egal(await miniaturi(pg, s), 5, 'al 6-lea nu s-a adăugat');
            if (CAPTURI && (latime === 390 || latime === 1366)) await C.captura(CAPTURI, pg, `${s.nume}-${lang}-${latime}-al-6-lea-dupa`, s.captura === '#cons-bronz' ? '#consultanta-modal' : null);
            const x = await pg.$$eval(`${s.preview} .dai-sterge-fisier`, (e) => e.map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
            egal(x.length, 5);
            x.forEach(([w, h]) => adevarat(w >= 44 && h >= 44, `„×” are ${w} × ${h} px`));
            await pg.click(`${s.preview} [data-dai-fisier]:first-child .dai-sterge-fisier`);
            egal(await miniaturi(pg, s), 4, '„×” scoate fișierul');
            adevarat((await C.depasire(pg)) <= 0, 'derulare orizontală');
            egal(pg.dialoguri, [], 'alert / confirm'); egal(pg.erori, [], 'erori JS');
            await pg.close();
          });

          if (latime === 390 || latime === 1366) {
            await test(`${lang} ${latime} ${s.nume}: HEIC nedecodabil → mesaj; PDF 1 MB trece, 3 MB refuzat; total > 3 MB refuzat`, async () => {
              const pg = await C.pagina(ctx, baza, s.adresa);
              await s.deschide(pg);
              await pg.waitForTimeout(400);
              await pg.setInputFiles(s.input, fis('IMG_0001.HEIC', 'image/heic', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(4000, 7)])));
              await pg.waitForFunction((m) => /citi|read/.test(document.querySelector(m).textContent), s.mesaj);
              egal(await textMesaj(pg, s), (lang === 'ro' ? 'Nu putem citi această poză. Fă poza direct din cameră sau alege una JPG / PNG.' : "We can't read this photo. Take it with the camera or choose a JPG / PNG.") + ' ×');
              egal(await miniaturi(pg, s), 0);
              await pg.setInputFiles(s.input, fis('plan.pdf', 'application/pdf', C.pdf(1024 * 1024)));
              await pg.waitForFunction((p) => document.querySelectorAll(p + ' [data-dai-fisier]').length === 1, s.preview);
              await pg.setInputFiles(s.input, fis('mare.pdf', 'application/pdf', C.pdf(3 * 1024 * 1024)));
              await pg.waitForFunction((m) => /2 MB/.test(document.querySelector(m).textContent), s.mesaj);
              egal(await miniaturi(pg, s), 1, 'PDF-ul de 3 MB nu s-a adăugat');
              await pg.setInputFiles(s.input, [fis('a.pdf', 'application/pdf', C.pdf(1.9 * 1024 * 1024)), fis('b.pdf', 'application/pdf', C.pdf(1.9 * 1024 * 1024))]);
              await pg.waitForFunction((m) => /3 MB/.test(document.querySelector(m).textContent), s.mesaj);
              egal(await textMesaj(pg, s), (lang === 'ro' ? 'Fișierele atașate au împreună mai mult de 3 MB. Scoate un fișier sau alege unul mai mic.' : 'The attached files add up to more than 3 MB. Remove a file or choose a smaller one.') + ' ×');
              egal(await miniaturi(pg, s), 2, 'total ≤ 3 MB: doar primul PDF de 1,9 MB intră');
              egal(pg.dialoguri, [], 'alert / confirm'); egal(pg.erori, [], 'erori JS');
              await pg.close();
            });
          }
        }
        await ctx.close();
      }
    }
    // Inputul de fișiere: fără `capture`, poze și PDF, mai multe deodată.
    await test('inputurile de fișiere: multiple, accept="image/*,application/pdf", fără capture', async () => {
      const fs = require('fs');
      for (const [f, id] of [['mydarrin-catalog.html', 'file-input'], ['mydarrin-creeaza-deviz.html', 'dv-file']]) {
        const t = fs.readFileSync(path.join(C.RADACINA, f), 'utf8');
        const m = t.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
        adevarat(m, f + ': inputul lipsește');
        adevarat(/\bmultiple\b/.test(m[0]) && /accept="image\/\*,application\/pdf"/.test(m[0]) && !/capture/.test(m[0]), f + ': ' + m[0]);
      }
    });
  } finally {
    await browser.close();
    srv.close();
  }
  const u = MASURI.find((m) => m.latime === 390 && m.lang === 'ro' && m.pagina === 'catalog') || MASURI[0];
  if (u) console.log(`   Poza de test: ${(u.inainte / 1048576).toFixed(2)} MB, 4000 × 3000 px → ${Math.round(u.dupa / 1024)} KB, ${u.latime} × ${u.inaltime} px, fără EXIF / GPS`);
}

(async () => {
  await testePure();
  await testeServer();
  if (!process.env.FARA_BROWSER) await testeBrowser();
  console.log(`\n${C.stare.ok} trecute, ${C.stare.esec} eșuate.`);
  process.exit(C.stare.esec ? 1 : 0);
})();

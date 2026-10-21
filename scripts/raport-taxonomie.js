// scripts/raport-taxonomie.js
// Raport de completare a taxonomiei și propunere de potrivire automată
// (Etapa 1, reguli flexibile, 9 oct. 2026). DOAR CITIRE: nu modifică nimic.
//
// Rulare (merge și cu cheia anon: catalog_servicii și categorii sunt publice):
//   SUPABASE_URL=... SUPABASE_KEY=... node scripts/raport-taxonomie.js raport.md propunere.sql
//
// Propunerea (în ordinea încrederii):
//   1. domeniu identic cu titlul unei categorii de același tip;
//   2. domeniu asemănător (cuvinte comune, ≥ 50%);
//   3. cod NACE al serviciului = nace_ref al unei categorii.
// O categorie cu parent_id devine subcategorie_id, iar părintele ei categorie_id.
// Fișierul SQL conține actualizările COMENTATE, de aprobat de LM.

const fs = require('fs');

const URL = process.env.SUPABASE_URL || 'https://aacojyvujhywanaulvuu.supabase.co';
const KEY = process.env.SUPABASE_KEY;
const [OUT_MD = 'raport-taxonomie.md', OUT_SQL = 'propunere-taxonomie.sql'] = process.argv.slice(2);
if (!KEY) { console.error('Lipsește SUPABASE_KEY'); process.exit(2); }

async function citeste(tabel, select) {
  const r = await fetch(`${URL}/rest/v1/${tabel}?select=${select}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${tabel}: ${r.status} ${await r.text()}`);
  return r.json();
}

const TIP = { servicii: 'servicii', materiale: 'materiale', inchirieri: 'inchiriere', inchiriere: 'inchiriere' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const cuvinte = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
function asemanare(a, b) {
  const A = cuvinte(a), B = cuvinte(b);
  if (!A.size || !B.size) return 0;
  let comune = 0;
  A.forEach((w) => { if (B.has(w)) comune++; });
  return comune / Math.min(A.size, B.size);
}
const naceCod = (s) => String(s || '').replace(/^[A-Z]\s*/, '').trim();

(async () => {
  const servicii = await citeste('catalog_servicii', 'id,id_serviciu,titlu,categorie,domeniu,categorie_id,subcategorie_id,cod_esco,nace,descriere,etape_lucrare,instructiuni_intretinere,status_public');
  const categorii = await citeste('categorii', 'id,title,slug,category_type,parent_id,nace_ref');
  const catById = new Map(categorii.map((c) => [c.id, c]));

  const lipsa = (f) => servicii.filter((s) => f(s)).length;
  const goale = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  const total = servicii.length;
  const md = [];
  md.push(`# Raport taxonomie — ${new Date().toISOString().slice(0, 10)}`, '');
  md.push(`Servicii în catalog: **${total}** (publice: ${lipsa((s) => s.status_public)}). Categorii: ${categorii.length} (` +
    Object.entries(categorii.reduce((a, c) => { a[c.category_type] = (a[c.category_type] || 0) + 1; return a; }, {})).map(([k, v]) => `${k} ${v}`).join(', ') + `; cu părinte: ${categorii.filter((c) => c.parent_id).length}).`, '');
  md.push('| Câmp | Completat | Lipsă |', '|---|---|---|');
  for (const [eticheta, f] of [
    ['categorie_id', (s) => goale(s.categorie_id)], ['subcategorie_id', (s) => goale(s.subcategorie_id)],
    ['descriere', (s) => goale(s.descriere)], ['etape_lucrare', (s) => goale(s.etape_lucrare)],
    ['instructiuni_intretinere', (s) => goale(s.instructiuni_intretinere)], ['cod_esco', (s) => goale(s.cod_esco)], ['nace', (s) => goale(s.nace)],
  ]) md.push(`| ${eticheta} | ${total - lipsa(f)} | ${lipsa(f)} |`);
  md.push('');

  // Propunerea, doar pentru serviciile fără categorie_id.
  const propuneri = [];
  for (const s of servicii.filter((x) => goale(x.categorie_id))) {
    const tip = TIP[s.categorie] || null;
    const candidate = categorii.filter((c) => !tip || c.category_type === tip);
    let ales = null, metoda = null, scor = 0;
    for (const c of candidate) {
      if (norm(c.title) === norm(s.domeniu)) { ales = c; metoda = 'domeniu identic'; scor = 1; break; }
    }
    if (!ales) {
      for (const c of candidate) {
        const a = asemanare(s.domeniu || s.titlu, c.title);
        if (a >= 0.5 && a > scor) { ales = c; metoda = `domeniu asemănător (${Math.round(a * 100)}%)`; scor = a; }
      }
    }
    if (!ales && s.nace) {
      const c = candidate.find((x) => x.nace_ref && naceCod(x.nace_ref) && naceCod(s.nace).startsWith(naceCod(x.nace_ref)));
      if (c) { ales = c; metoda = 'cod NACE'; scor = 0.4; }
    }
    if (!ales) continue;
    const parinte = ales.parent_id ? catById.get(ales.parent_id) : null;
    propuneri.push({ s, categorie: parinte || ales, subcategorie: parinte ? ales : null, metoda });
  }

  md.push(`## Propunere de potrivire automată (${propuneri.length} din ${lipsa((s) => goale(s.categorie_id))} servicii fără categorie)`, '');
  md.push('Nimic nu se aplică automat. Fișierul SQL alăturat conține actualizările comentate.', '');
  md.push('| Serviciu | Tip | Domeniu | → Categorie | → Subcategorie | Metodă |', '|---|---|---|---|---|---|');
  for (const p of propuneri) md.push(`| ${p.s.titlu} (${p.s.id_serviciu}) | ${p.s.categorie || ''} | ${p.s.domeniu || ''} | ${p.categorie.title} | ${p.subcategorie?.title || '—'} | ${p.metoda} |`);
  const nepotrivite = servicii.filter((x) => goale(x.categorie_id) && !propuneri.some((p) => p.s.id === x.id));
  md.push('', `## Fără propunere (${nepotrivite.length}) — se aleg manual în back-office`, '');
  const peDomeniu = nepotrivite.reduce((a, s) => { const k = `${s.categorie || '?'} · ${s.domeniu || '(fără domeniu)'}`; a[k] = (a[k] || 0) + 1; return a; }, {});
  md.push('| Tip · domeniu | Servicii |', '|---|---|');
  Object.entries(peDomeniu).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => md.push(`| ${k} | ${v} |`));

  const sql = ['-- Propunere de potrivire automată a categoriilor (generată ' + new Date().toISOString().slice(0, 10) + ').',
    '-- DE APROBAT DE LM. Decomentați doar rândurile aprobate.', 'begin;'];
  for (const p of propuneri) {
    sql.push(`-- ${p.s.titlu} (${p.s.id_serviciu}) — ${p.metoda}`);
    sql.push(`-- update public.catalog_servicii set categorie_id = '${p.categorie.id}'${p.subcategorie ? `, subcategorie_id = '${p.subcategorie.id}'` : ''} where id = '${p.s.id}' and categorie_id is null;`);
  }
  sql.push('commit;');

  fs.writeFileSync(OUT_MD, md.join('\n') + '\n');
  fs.writeFileSync(OUT_SQL, sql.join('\n') + '\n');
  console.log(`servicii ${total}, fără categorie ${lipsa((s) => goale(s.categorie_id))}, propuneri ${propuneri.length}`);
})().catch((e) => { console.error(e); process.exit(1); });

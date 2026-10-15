// scripts/simuleaza-reguli-niveluri.js
// Simulare DOAR DE CITIRE (Etapa 1, reguli flexibile, 9 oct. 2026), pentru
// toate serviciile cu rețetă tehnică legată, pe fiecare nivel, la o țară și
// o cantitate:
//   1. Test de neschimbare: motorul cu regulile din baza de date (implicite)
//      vs. motorul fără nicio regulă — prețul trebuie să fie identic la ban.
//   2. Înainte / după: aceleași niveluri cu regulile implicite pe niveluri
//      ACTIVATE doar în memorie (nu se scrie nimic în baza de date).
//
// Rulare (cheia service_role, ca pe server; nu o puneți în repo):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/simuleaza-reguli-niveluri.js [RO] [1] > simulare.md
//
// Ieșire: Markdown pe stdout.

const { supabaseAdmin } = require('../lib/supabaseAdmin');
const { calculeazaCostNivel } = require('../lib/calculeaza-cost-recipe');
const { calculeazaPret } = require('../lib/calculeaza-pret');

const TARA = (process.argv[2] || 'RO').toUpperCase();
const CANTITATE = Number(process.argv[3] || 1);
const ORDINE = { Bronze: 0, Silver: 1, Gold: 2, Platinum: 3 };

// Valorile implicite propuse (aceleași ca în migrarea 2026-10-09), active.
const NIVELURI_IMPLICITE = [
  { nivel: 'Bronze', materiale: 'nu', include_curatenie: false, include_testare: false, include_raport_digital: false },
  { nivel: 'Silver', materiale: 'consumabile', include_curatenie: true, include_testare: false, include_raport_digital: false },
  { nivel: 'Gold', materiale: 'complet', include_curatenie: true, include_testare: true, include_raport_digital: false },
  { nivel: 'Platinum', materiale: 'complet', include_curatenie: true, include_testare: true, include_raport_digital: true },
].map((r, i) => ({ id: 'simulare-' + i, serviciu_id: null, categorie_id: null, nivel_activ: true, coef_manopera: 1, activ: true, valabil_de: '2026-01-01', ...r }));

async function pretFinal(cost) {
  if (cost.nivel_activ === false) return { text: 'nivel inactiv', valoare: null };
  if (cost.resurse_fara_pret.length) return { text: 'evaluare tehnică', valoare: null };
  const calc = await calculeazaPret({ cost_baza_servicii: cost.cost_baza_servicii, cost_materiale: cost.cost_materiale, cost_chirie_scule: cost.cost_utilaj, tara: TARA });
  return { text: calc.pret_final.toFixed(2), valoare: calc.pret_final };
}

(async () => {
  const { data: articole, error } = await supabaseAdmin.from('devize_articole').select('catalog_nivel_id').not('catalog_nivel_id', 'is', null);
  if (error) throw error;
  const nivelIds = [...new Set(articole.map((a) => a.catalog_nivel_id))];
  const { data: niveluri } = await supabaseAdmin.from('catalog_niveluri').select('id, serviciu_id, nivel').in('id', nivelIds);
  const { data: servicii } = await supabaseAdmin.from('catalog_servicii').select('id, id_serviciu, titlu').in('id', [...new Set(niveluri.map((n) => n.serviciu_id))]);
  const titlu = new Map(servicii.map((s) => [s.id, s]));
  niveluri.sort((a, b) => (titlu.get(a.serviciu_id)?.titlu || '').localeCompare(titlu.get(b.serviciu_id)?.titlu || '') || (ORDINE[a.nivel] ?? 9) - (ORDINE[b.nivel] ?? 9));

  const rezultate = [];
  let diferenteNeschimbare = 0;
  for (const n of niveluri) {
    const faraReguli = await calculeazaCostNivel({ nivelId: n.id, taraCod: TARA, cantitate: CANTITATE, reguli: { costuriFixe: [], niveluri: [] } });
    const reguliDinBaza = await calculeazaCostNivel({ nivelId: n.id, taraCod: TARA, cantitate: CANTITATE });
    const cuNiveluri = await calculeazaCostNivel({ nivelId: n.id, taraCod: TARA, cantitate: CANTITATE, reguli: { niveluri: NIVELURI_IMPLICITE } });
    const a = await pretFinal(faraReguli);
    const b = await pretFinal(reguliDinBaza);
    const c = await pretFinal(cuNiveluri);
    const identic = a.text === b.text && faraReguli.cost_baza_servicii === reguliDinBaza.cost_baza_servicii && faraReguli.cost_materiale === reguliDinBaza.cost_materiale;
    if (!identic) diferenteNeschimbare++;
    rezultate.push({ serviciu: titlu.get(n.serviciu_id), nivel: n.nivel, a, b, c, identic, client: cuNiveluri.nivel_include?.materiale_furnizate_de_client?.length || 0 });
  }

  const out = [];
  out.push(`# Simulare reguli flexibile — ${TARA}, cantitate ${CANTITATE}, ${new Date().toISOString().slice(0, 10)}`);
  out.push('');
  out.push(`Niveluri cu rețetă: ${rezultate.length}, servicii: ${new Set(rezultate.map((r) => r.serviciu?.id)).size}.`);
  out.push(`Test de neschimbare (reguli din baza de date vs. fără reguli): ${diferenteNeschimbare === 0 ? 'identic pe toate nivelurile' : diferenteNeschimbare + ' diferențe'}.`);
  out.push('');
  out.push('| Serviciu | Nivel | Azi | Cu regulile din bază | Neschimbat | Cu regulile pe niveluri activate | Diferență | Materiale furnizate de client |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const r of rezultate) {
    const dif = r.a.valoare != null && r.c.valoare != null ? (r.c.valoare - r.a.valoare).toFixed(2) : '—';
    out.push(`| ${r.serviciu?.titlu || '?'} (${r.serviciu?.id_serviciu || ''}) | ${r.nivel} | ${r.a.text} | ${r.b.text} | ${r.identic ? 'da' : '**NU**'} | ${r.c.text} | ${dif} | ${r.client} |`);
  }
  console.log(out.join('\n'));
  process.exit(diferenteNeschimbare ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

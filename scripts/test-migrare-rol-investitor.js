// scripts/test-migrare-rol-investitor.js
// Test SQL pentru migrarea propusă a pasului 11-I1
// (docs/migrations-propuse/2026-11-14_rol_solicitat_investitor.sql), pe un
// Postgres local (PGlite, în memorie). Nimic nu ajunge în Supabase.
//
// Pornește de la starea din producție (citită pe 14 nov. 2026): constrângerea
// profiles_rol_solicitat_valid fără 'investor' și handle_new_user() din
// 2026-11-01_fereastra_cont.sql, fără drept de execuție pentru anon / authenticated.
//
// Verifică:
//   1. prima rulare: constrângerea acceptă 'investor'; un cont nou cu
//      rol_solicitat = 'investor' îl păstrează, iar roles rămâne {client}
//      (rolul investor nu se dă la înscriere); partenerii și valorile
//      necunoscute se comportă ca înainte;
//   2. a doua rulare: fără erori, aceeași definiție;
//   3. constrângerea refuză valori necunoscute;
//   4. funcția rămâne security definer, cu search_path fix, fără execute pentru
//      anon / authenticated;
//   5. verificarea de la final oprește tranzacția dacă funcția nu conține 'investor'.
//
// Cerințe (nu e dependență a proiectului): npm i --no-save @electric-sql/pglite
// Rulare: node scripts/test-migrare-rol-investitor.js

const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs', 'migrations-propuse');
const MIGRARE = fs.readFileSync(path.join(D, '2026-11-14_rol_solicitat_investitor.sql'), 'utf8');
const VECHE = fs.readFileSync(path.join(D, '2026-11-01_fereastra_cont.sql'), 'utf8');

// Funcția din 2026-11-01 (definiția din producție), fără restul migrării.
const FN_VECHE = VECHE.slice(VECHE.indexOf('create or replace function public.handle_new_user()'), VECHE.indexOf('$function$;') + '$function$;'.length);

const SCHEMA = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create type public.account_status as enum ('pending_otp', 'active');
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
create table public.profiles (
  id uuid primary key, email text, nume text, role text, roles text[], status public.account_status,
  tara text, limba text, gdpr_consimtamant_at timestamptz, rol_solicitat text, phone text unique, phone_verificat boolean
);
alter table public.profiles add constraint profiles_rol_solicitat_valid check (
  rol_solicitat is null or rol_solicitat in ('client', 'partener_servicii', 'partener_materiale',
    'partener_inchirieri', 'partener_curier', 'partener_asigurari'));
${FN_VECHE}
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
`;

let ok = 0, esec = 0;
function verifica(c, m) { if (c) ok++; else { esec++; console.log('  ✗ ' + m); } }

async function baza() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(SCHEMA);
  return db;
}
const rand = async (db, q) => (await db.query(q)).rows[0];
let n = 0;
async function cont(db, rolSolicitat) {
  n++;
  const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const meta = JSON.stringify({ prenume: 'Ana', nume: 'Test', rol_solicitat: rolSolicitat, gdpr_acceptat: 'true' });
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [id, `u${n}@exemplu.ro`, meta]);
  return rand(db, `select rol_solicitat, roles, role from public.profiles where id = '${id}'`);
}

(async () => {
  // 0. Înainte: 'investor' devine 'client' (problema din producție).
  {
    const db = await baza();
    const p = await cont(db, 'investor');
    verifica(p.rol_solicitat === 'client', `înainte de migrare, investor ar trebui să devină client: ${p.rol_solicitat}`);
  }

  const db = await baza();
  // 1. Prima rulare.
  await db.exec(MIGRARE);
  const inv = await cont(db, 'investor');
  verifica(inv.rol_solicitat === 'investor', `investor nu se păstrează: ${inv.rol_solicitat}`);
  verifica(JSON.stringify(inv.roles) === '["client"]' && inv.role === 'client', `investor primește alt rol la înscriere: ${JSON.stringify(inv)}`);
  const ps = await cont(db, 'partener_servicii');
  verifica(ps.rol_solicitat === 'partener_servicii' && JSON.stringify(ps.roles) === '["client"]', `partener: ${JSON.stringify(ps)}`);
  const nec = await cont(db, 'admin');
  verifica(nec.rol_solicitat === 'client', `valoare necunoscută: ${nec.rol_solicitat}`);
  const faraRol = await cont(db, undefined);
  verifica(faraRol.rol_solicitat === 'client', `fără rol: ${faraRol.rol_solicitat}`);

  // 2. A doua rulare: fără erori, aceeași definiție.
  const def1 = (await rand(db, "select pg_get_functiondef('public.handle_new_user'::regproc) d")).d;
  let eroare = null;
  try { await db.exec(MIGRARE); } catch (e) { eroare = e.message; }
  verifica(!eroare, `a doua rulare: ${eroare}`);
  const def2 = (await rand(db, "select pg_get_functiondef('public.handle_new_user'::regproc) d")).d;
  verifica(def1 === def2, 'a doua rulare schimbă funcția');

  // 3. Constrângerea.
  let refuzat = false;
  try { await db.query("update public.profiles set rol_solicitat = 'superadmin' where rol_solicitat = 'investor'"); } catch (e) { refuzat = /profiles_rol_solicitat_valid/.test(e.message); }
  verifica(refuzat, 'constrângerea acceptă o valoare necunoscută');
  const cons = (await rand(db, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'profiles_rol_solicitat_valid'")).d;
  verifica(/'investor'/.test(cons) && /partener_asigurari/.test(cons) && /'client'/.test(cons), `constrângerea: ${cons}`);

  // 4. Securitatea funcției.
  const s = await rand(db, `select prosecdef, proconfig::text cfg,
    has_function_privilege('anon', 'public.handle_new_user()', 'execute') anon,
    has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') auth
    from pg_proc where proname = 'handle_new_user'`);
  verifica(s.prosecdef && /search_path=public/.test(s.cfg) && !s.anon && !s.auth, `securitatea funcției: ${JSON.stringify(s)}`);

  // Diferența față de funcția din producție: doar lista pentru _rol_solicitat (și comentariul).
  const nou = MIGRARE.slice(MIGRARE.indexOf('create or replace function public.handle_new_user()'), MIGRARE.indexOf('$function$;') + 11);
  const fara = (t) => t.replace(/--[^\n]*\n/g, '').replace(/,\s*'investor'\)/, ')').replace(/\s+/g, ' ');
  verifica(fara(nou) === fara(FN_VECHE), 'funcția diferă de cea din producție și în altceva decât investor');
  verifica(!/roles[^;]*'investor'|array\['investor'/.test(nou), 'funcția pune investor în roles');

  // 5. Verificarea de la final oprește tranzacția.
  const strica = MIGRARE.replace(/'partener_asigurari',\n\s*'investor'\) then/, "'partener_asigurari') then");
  verifica(strica !== MIGRARE, 'nu am putut construi varianta greșită a migrării');
  const db2 = await baza();
  let oprit = null;
  try { await db2.exec(strica); } catch (e) { oprit = e.message; await db2.exec('rollback'); }
  verifica(oprit && /nu conține investor/.test(oprit), `verificarea nu oprește migrarea greșită: ${oprit}`);
  const cons2 = (await rand(db2, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'profiles_rol_solicitat_valid'")).d;
  verifica(!/'investor'/.test(cons2), 'după eroare, tranzacția nu s-a anulat');

  // Fișierul: o singură tranzacție, fără inserări de probă, fără alte tabele.
  verifica((MIGRARE.match(/^begin;/gm) || []).length === 1 && (MIGRARE.match(/^commit;/gm) || []).length === 1, 'migrarea nu e o singură tranzacție');
  verifica(!/\binsert into\b(?! public\.profiles \(id, email, nume)/i.test(MIGRARE), 'migrarea inserează date');
  const tabele = [...new Set((MIGRARE.match(/alter table\s+([\w.]+)/gi) || []).map((x) => x.split(/\s+/).pop()))];
  verifica(JSON.stringify(tabele) === '["public.profiles"]', `migrarea atinge alte tabele: ${tabele}`);

  console.log(`\n${ok} trecute, ${esec} picate`);
  process.exit(esec ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

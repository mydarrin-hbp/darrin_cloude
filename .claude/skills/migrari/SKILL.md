---
name: migrari
description: Regulile pentru orice schimbare de schemă sau funcție în Supabase (migrări în docs/migrations-propuse/). Se citește înainte de a scrie o migrare SQL, o funcție, o politică RLS sau cod care depinde de o coloană ori un tabel nou.
---

# Migrări Supabase — My Darrin

## Regula de bază (din CLAUDE.md, cuvânt cu cuvânt)
- Nicio modificare directă în producție din cod. Orice schimbare de schemă se scrie ca fișier în docs/migrations-propuse/, într-o singură tranzacție (begin/commit), rulabil de mai multe ori fără erori (if not exists / drop ... if exists), cu verificare la final.
- Migrările se aplică de LM în SQL Editor, ÎNAINTE de publicarea codului care le folosește.
- Funcțiile noi: search_path fix; funcțiile security definer nu se lasă executabile de anon.

## Șablonul fișierului
Numele: `docs/migrations-propuse/AAAA-LL-ZZ_<subiect>.sql` (vezi exemplele din folder).

```sql
-- <Pasul X>: <ce face migrarea, în română>
-- Se rulează de LM în SQL Editor, înainte de publicarea codului care o folosește.
-- Rulabil de mai multe ori fără erori.
begin;

create table if not exists public.exemplu ( ... );
alter table public.exemplu add column if not exists camp_nou text;
create index if not exists exemplu_camp_nou_idx on public.exemplu (camp_nou);

drop policy if exists "exemplu_citire" on public.exemplu;
create policy "exemplu_citire" on public.exemplu for select using ( ... );

create or replace function public.functie_noua(...)
returns ... language plpgsql
security definer
set search_path = public, pg_temp
as $$ ... $$;
revoke all on function public.functie_noua(...) from public, anon;
grant execute on function public.functie_noua(...) to authenticated;   -- sau service_role, după caz

-- Verificarea, în același bloc: dacă ceva lipsește, tranzacția se oprește.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exemplu' and column_name = 'camp_nou') then
    raise exception 'Verificare: lipsește exemplu.camp_nou';
  end if;
  if has_function_privilege('anon', 'public.functie_noua(...)', 'execute') then
    raise exception 'Verificare: anon poate executa functie_noua';
  end if;
end $$;

commit;
```

## Reguli
- O singură tranzacție: `begin;` … `commit;`.
- Rulabilă de mai multe ori: `if not exists`, `add column if not exists`, `create or replace`, `drop ... if exists` înainte de `create policy` / `create trigger`.
- Verificarea se face în același bloc (în tranzacție, cu `raise exception`), nu ca pas separat.
- Fără tabele temporare.
- Funcții: `set search_path` fix; `security definer` → `revoke ... from public, anon`.
- Fiecare migrare are test: `scripts/test-migrare-<subiect>.js` (vezi cele existente), care verifică textul fișierului (begin/commit, if not exists, search_path, anon).
- Ordinea: LM rulează migrarea în SQL Editor ÎNAINTE de merge / publicarea codului. În PR.md se spune clar ce migrare trebuie rulată și în ce ordine.
- Nu se folosesc pe producție uneltele care scriu în baza de date (de exemplu `apply_migration` sau `execute_sql` cu modificări).

Task-urile cu migrări se pornesc cu `/model opusplan` sau `/effort high`.
